import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { SuggesterConfig } from "../domain/config.ts"
import {
  CURRENT_GENERATOR_VERSION,
  CURRENT_SEED_VERSION,
  emptyFindings,
  SEEDER_PROMPT_VERSION,
  SUGGESTION_PROMPT_VERSION,
  validateSeedDraft,
  type ReseedTrigger,
  type SeedArtifact,
  type SeedDraft,
  type SeedKeyFile,
} from "../domain/seed.ts"
import { configFingerprint } from "../domain/config.ts"
import { parseJsonObject } from "../infra/sdk.ts"
import {
  renderForcedSeederFinalPrompt,
  renderSeederSystemPrompt,
  renderSeederUserPrompt,
} from "../prompts/seeder-template.ts"
import { completeHidden } from "./hidden.ts"

type Client = Parameters<typeof completeHidden>[0]["client"] & {
  find?: {
    files?: (...args: never[]) => Promise<unknown>
    text?: (...args: never[]) => Promise<unknown>
  }
  file?: { read?: (...args: never[]) => Promise<unknown> }
}

export async function runSeeder(input: {
  client: Client
  directory: string
  worktree: string
  config: SuggesterConfig
  previous: SeedArtifact | null
  trigger: ReseedTrigger
  hiddenSessionID?: string
  smallModel?: string
}): Promise<{ seed: SeedArtifact; hiddenSessionID: string; steps: number }> {
  const history: Array<{ modelResponse: string; toolResult?: string }> = []
  let hiddenSessionID = input.hiddenSessionID
  const maxSteps = input.config.seed.maxSteps

  for (let step = 1; step <= maxSteps + 1; step++) {
    const forced = step > maxSteps
    const prompt = forced
      ? renderForcedSeederFinalPrompt({
          reseedTrigger: input.trigger,
          previousSeed: input.previous,
          cwd: input.directory,
          step,
          maxSteps,
          history,
        })
      : renderSeederUserPrompt({
          reseedTrigger: input.trigger,
          previousSeed: input.previous,
          cwd: input.directory,
          step,
          maxSteps,
          history,
        })
    const result = await completeHidden({
      client: input.client,
      hiddenSessionID,
      directory: input.directory,
      system: renderSeederSystemPrompt(),
      prompt,
      modelSpec: input.config.inference.seederModel,
      smallModel: input.smallModel,
    })
    hiddenSessionID = result.sessionID
    const parsed = parseJsonObject(result.text) as {
      type?: string
      tool?: string
      arguments?: Record<string, unknown>
      seed?: SeedDraft
    }
    if (parsed.type === "final" || forced) {
      const draft = parsed.seed
      if (!draft) throw new Error("seeder returned final without seed")
      const error = validateSeedDraft(draft)
      if (error) throw new Error(`invalid seed: ${error}`)
      const keyFiles = await hashKeyFiles(input.directory, draft.keyFiles ?? [])
      const seed: SeedArtifact = {
        seedVersion: CURRENT_SEED_VERSION,
        generatedAt: new Date().toISOString(),
        generatorVersion: CURRENT_GENERATOR_VERSION,
        seederPromptVersion: SEEDER_PROMPT_VERSION,
        suggestionPromptVersion: SUGGESTION_PROMPT_VERSION,
        configFingerprint: configFingerprint(input.config),
        projectIntentSummary: draft.projectIntentSummary,
        objectivesSummary: draft.objectivesSummary,
        constraintsSummary: draft.constraintsSummary,
        principlesGuidelinesSummary: draft.principlesGuidelinesSummary,
        implementationStatusSummary: draft.implementationStatusSummary,
        topObjectives: draft.topObjectives ?? [],
        constraints: draft.constraints ?? [],
        keyFiles,
        categoryFindings: draft.categoryFindings ?? emptyFindings(),
        openQuestions: draft.openQuestions ?? [],
        reseedNotes: draft.reseedNotes,
        lastReseedReason: input.trigger.reason,
        lastChangedFiles: input.trigger.changedFiles,
      }
      return { seed, hiddenSessionID, steps: history.length + 1 }
    }
    if (parsed.type !== "tool" || !parsed.tool) {
      history.push({ modelResponse: result.text, toolResult: "invalid seeder payload" })
      continue
    }
    const toolResult = await runSeederTool(input.directory, parsed.tool, parsed.arguments ?? {})
    history.push({ modelResponse: result.text, toolResult })
  }
  throw new Error("seeder exhausted without a final seed")
}

export async function staleTrigger(
  directory: string,
  config: SuggesterConfig,
  seed: SeedArtifact | null,
): Promise<ReseedTrigger | null> {
  if (!seed) return { reason: "initial_missing", changedFiles: [] }
  if (seed.generatorVersion !== CURRENT_GENERATOR_VERSION) {
    return { reason: "generator_changed", changedFiles: [] }
  }
  if (seed.configFingerprint !== configFingerprint(config)) {
    return { reason: "config_changed", changedFiles: [] }
  }
  const changed: string[] = []
  for (const file of seed.keyFiles) {
    const abs = path.resolve(directory, file.path)
    if (!inside(directory, abs)) continue
    try {
      const hash = createHash("sha256").update(await readFile(abs)).digest("hex")
      if (hash !== file.hash) changed.push(file.path)
    } catch {
      changed.push(file.path)
    }
  }
  if (changed.length > 0) return { reason: "key_file_changed", changedFiles: changed }
  return null
}

async function hashKeyFiles(
  directory: string,
  files: Array<Pick<SeedKeyFile, "path" | "whyImportant" | "category">>,
): Promise<SeedKeyFile[]> {
  const out: SeedKeyFile[] = []
  for (const file of files) {
    const abs = path.resolve(directory, file.path)
    let hash = ""
    try {
      if (inside(directory, abs)) hash = createHash("sha256").update(await readFile(abs)).digest("hex")
    } catch {
      hash = ""
    }
    out.push({ ...file, hash })
  }
  return out
}

async function runSeederTool(
  directory: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const rel = typeof args.path === "string" ? args.path : "."
  const abs = path.resolve(directory, rel)
  if (!inside(directory, abs)) return "path escapes repository"
  const limit = clamp(typeof args.limit === "number" ? args.limit : 40, 1, 80)
  if (tool === "ls") {
    const entries = await readdir(abs, { withFileTypes: true })
    return entries
      .slice(0, limit)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`)
      .join("\n")
  }
  if (tool === "find") {
    const pattern = String(args.pattern ?? "*")
    const matches = await walk(abs, directory, pattern, limit)
    return matches.join("\n") || "(none)"
  }
  if (tool === "grep") {
    const pattern = String(args.pattern ?? "")
    if (!pattern) return "missing pattern"
    const hits = await grep(abs, directory, pattern, Boolean(args.ignoreCase), limit)
    return hits.join("\n") || "(none)"
  }
  if (tool === "read") {
    const offset = typeof args.offset === "number" ? args.offset : 1
    const lineLimit = typeof args.limit === "number" ? args.limit : 80
    const text = await readFile(abs, "utf8")
    return text.split("\n").slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + lineLimit).join("\n")
  }
  return `unknown tool ${tool}`
}

async function walk(start: string, root: string, pattern: string, limit: number): Promise<string[]> {
  const out: string[] = []
  const stack = [start]
  const needle = pattern.replace(/^\*/, "").replace(/\*$/, "")
  while (stack.length && out.length < limit) {
    const current = stack.pop()
    if (!current) break
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!needle || entry.name.includes(needle) || full.includes(needle)) {
        out.push(path.relative(root, full))
      }
      if (out.length >= limit) break
    }
  }
  return out
}

async function grep(
  start: string,
  root: string,
  pattern: string,
  ignoreCase: boolean,
  limit: number,
): Promise<string[]> {
  const regex = new RegExp(pattern, ignoreCase ? "i" : "")
  const files = await walk(start, root, "", 80)
  const hits: string[] = []
  for (const rel of files) {
    const abs = path.join(root, rel)
    const info = await stat(abs).catch(() => null)
    if (!info || !info.isFile() || info.size > 200_000) continue
    const text = await readFile(abs, "utf8").catch(() => "")
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i] ?? "")) continue
      hits.push(`${rel}:${i + 1}:${(lines[i] ?? "").slice(0, 160)}`)
      if (hits.length >= limit) return hits
    }
  }
  return hits
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
