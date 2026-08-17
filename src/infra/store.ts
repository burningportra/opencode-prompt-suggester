import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { mergeConfig, type SuggesterConfig } from "../domain/config.ts"
import type { SeedArtifact } from "../domain/seed.ts"
import type { SteeringEvent } from "../domain/steering.ts"
import type { LiveSuggestion } from "../domain/suggestion.ts"
import { emptyUsage, type UsageCounters } from "../domain/usage.ts"
import {
  livePath,
  logPath,
  projectConfigPath,
  seedPath,
  sessionDir,
  userConfigPath,
} from "./paths.ts"

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return null
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export async function loadConfig(worktree: string, stateOverride?: string): Promise<SuggesterConfig> {
  const user = await readJson<Partial<SuggesterConfig>>(userConfigPath(stateOverride))
  const project = await readJson<Partial<SuggesterConfig>>(projectConfigPath(worktree, stateOverride))
  return mergeConfig(user ?? undefined, project ?? undefined)
}

export async function saveConfig(
  worktree: string,
  scope: "user" | "project",
  patch: Partial<SuggesterConfig>,
  stateOverride?: string,
): Promise<SuggesterConfig> {
  const file = scope === "user" ? userConfigPath(stateOverride) : projectConfigPath(worktree, stateOverride)
  const current = (await readJson<Partial<SuggesterConfig>>(file)) ?? {}
  const next = mergeConfig(current, patch)
  await writeJson(file, next)
  return loadConfig(worktree, stateOverride)
}

export async function loadSeed(worktree: string, stateOverride?: string): Promise<SeedArtifact | null> {
  return readJson<SeedArtifact>(seedPath(worktree, stateOverride))
}

export async function saveSeed(worktree: string, seed: SeedArtifact, stateOverride?: string): Promise<void> {
  await writeJson(seedPath(worktree, stateOverride), seed)
}

export async function loadLive(
  worktree: string,
  sessionID?: string,
  stateOverride?: string,
): Promise<LiveSuggestion | null> {
  if (sessionID) {
    const exact = await readJson<LiveSuggestion>(livePath(worktree, sessionID, stateOverride))
    if (exact) return exact
  }
  const fallback = await readJson<LiveSuggestion>(livePath(worktree, undefined, stateOverride))
  if (fallback && sessionID && fallback.sessionID !== sessionID) return null
  return fallback
}

export async function saveLive(worktree: string, live: LiveSuggestion, stateOverride?: string): Promise<void> {
  await writeJson(livePath(worktree, live.sessionID, stateOverride), live)
}

interface SessionState {
  lastSuggestion?: string
  hiddenSessionID?: string
  turnCount?: number
  steering: SteeringEvent[]
  usage: UsageCounters
}

async function sessionFile(worktree: string, sessionID: string, stateOverride?: string): Promise<string> {
  return path.join(sessionDir(worktree, sessionID, stateOverride), "state.json")
}

export async function loadSessionState(
  worktree: string,
  sessionID: string,
  stateOverride?: string,
): Promise<SessionState> {
  const stored = await readJson<SessionState>(await sessionFile(worktree, sessionID, stateOverride))
  return {
    lastSuggestion: stored?.lastSuggestion,
    hiddenSessionID: stored?.hiddenSessionID,
    turnCount: stored?.turnCount ?? 0,
    steering: stored?.steering ?? [],
    usage: stored?.usage ?? emptyUsage(),
  }
}

export async function saveSessionState(
  worktree: string,
  sessionID: string,
  state: SessionState,
  stateOverride?: string,
): Promise<void> {
  await writeJson(await sessionFile(worktree, sessionID, stateOverride), state)
}

export async function appendLog(
  worktree: string,
  event: Record<string, unknown>,
  stateOverride?: string,
): Promise<void> {
  const file = logPath(worktree, stateOverride)
  await mkdir(path.dirname(file), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  const { appendFile } = await import("node:fs/promises")
  await appendFile(file, `${line}\n`, "utf8")
}
