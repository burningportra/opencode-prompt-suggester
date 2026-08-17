import type { ReseedTrigger, SeedArtifact } from "../domain/seed.ts"

export interface SeederPromptInput {
  reseedTrigger: ReseedTrigger
  previousSeed: SeedArtifact | null
  cwd: string
  step: number
  maxSteps: number
  history: Array<{
    modelResponse: string
    toolResult?: string
  }>
}

export function renderSeederSystemPrompt(): string {
  return `You are an agentic read-only repository seeder for opencode-prompt-suggester.

You can explore using one tool call per step:
- ls {"path"?: string, "limit"?: number}
- find {"pattern": string, "path"?: string, "limit"?: number}
- grep {"pattern": string, "path"?: string, "glob"?: string, "ignoreCase"?: boolean, "limit"?: number}
- read {"path": string, "offset"?: number, "limit"?: number}

CRITICAL RULES:
- Read-only exploration only.
- Act like a coding agent: explore freely before finalizing.
- Explicitly investigate and report repository evidence for these categories:
  1) vision
  2) architecture
  3) principles/guidelines/conventions
- If no file is found for a category, that is valid, but you MUST say so explicitly in categoryFindings with found=false and rationale.
- Multiple files per category are allowed and encouraged when relevant.

Reply with STRICT JSON only (no markdown):
Tool call shape:
{
  "type": "tool",
  "tool": "ls|find|grep|read",
  "arguments": { ... },
  "reason": "short reason"
}

Final shape:
{
  "type": "final",
  "seed": {
    "projectIntentSummary": string,
    "objectivesSummary": string,
    "constraintsSummary": string,
    "principlesGuidelinesSummary": string,
    "implementationStatusSummary": string,
    "topObjectives": string[],
    "constraints": string[],
    "keyFiles": [{ "path": string, "whyImportant": string, "category": "vision|architecture|principles_guidelines|code_entrypoint|other" }],
    "categoryFindings": {
      "vision": { "found": boolean, "rationale": string, "files": string[] },
      "architecture": { "found": boolean, "rationale": string, "files": string[] },
      "principles_guidelines": { "found": boolean, "rationale": string, "files": string[] }
    },
    "openQuestions": string[],
    "reseedNotes": string
  }
}

Do not return type=final until you have explicitly investigated likely sources for vision, architecture, and principles/guidelines.`
}

function previousSeedSummary(previousSeed: SeedArtifact | null): string {
  if (!previousSeed) return "none"
  return JSON.stringify(
    {
      projectIntentSummary: previousSeed.projectIntentSummary,
      objectivesSummary: previousSeed.objectivesSummary,
      constraintsSummary: previousSeed.constraintsSummary,
      principlesGuidelinesSummary: previousSeed.principlesGuidelinesSummary,
      implementationStatusSummary: previousSeed.implementationStatusSummary,
      topObjectives: previousSeed.topObjectives,
      constraints: previousSeed.constraints,
      keyFiles: previousSeed.keyFiles?.map((file) => ({
        path: file.path,
        category: file.category,
        whyImportant: file.whyImportant,
      })) ?? [],
      categoryFindings: previousSeed.categoryFindings,
    },
    null,
    2,
  )
}

function historyText(history: SeederPromptInput["history"]): string {
  if (history.length === 0) return "(none yet)"
  return history
    .map((entry, index) => {
      return `Step ${index + 1} model response:\n${entry.modelResponse}\n\nStep ${index + 1} tool result:\n${entry.toolResult ?? "(none)"}`
    })
    .join("\n\n")
}

export function renderSeederUserPrompt(input: SeederPromptInput): string {
  return `Repository root: ${input.cwd}
Reseed reason: ${input.reseedTrigger.reason}
Changed files: ${input.reseedTrigger.changedFiles.join(", ") || "(none)"}
Git diff summary: ${input.reseedTrigger.gitDiffSummary ?? "(none)"}
Step: ${input.step}/${input.maxSteps}

Previous seed summary:
${previousSeedSummary(input.previousSeed)}

Exploration history:
${historyText(input.history)}

Decide the next best tool call, or return type=final only when enough evidence has been gathered.`
}

export function renderForcedSeederFinalPrompt(input: SeederPromptInput): string {
  return `Repository root: ${input.cwd}
Reseed reason: ${input.reseedTrigger.reason}
Forced final synthesis after reaching exploration limit of ${input.maxSteps} steps.

Previous seed summary:
${previousSeedSummary(input.previousSeed)}

Exploration history:
${historyText(input.history)}

Tool use is now DISABLED.
You MUST return exactly one STRICT JSON object with type="final".
Do NOT return type="tool".
If evidence is incomplete, state that explicitly in categoryFindings and openQuestions.`
}
