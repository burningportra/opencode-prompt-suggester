export const CURRENT_SEED_VERSION = 3
export const CURRENT_GENERATOR_VERSION = "2026-08-17.1"
export const SEEDER_PROMPT_VERSION = "2026-08-17.1"
export const SUGGESTION_PROMPT_VERSION = "2026-08-17.1"

export type ReseedReason =
  | "initial_missing"
  | "manual"
  | "key_file_changed"
  | "config_changed"
  | "generator_changed"

export type SeedKeyFileCategory =
  | "vision"
  | "architecture"
  | "principles_guidelines"
  | "code_entrypoint"
  | "other"

export const REQUIRED_SEED_CATEGORIES: SeedKeyFileCategory[] = [
  "vision",
  "architecture",
  "principles_guidelines",
]

export interface SeedCategoryFinding {
  found: boolean
  rationale: string
  files: string[]
}

export type SeedCategoryFindings = Record<
  "vision" | "architecture" | "principles_guidelines",
  SeedCategoryFinding
>

export interface SeedKeyFile {
  path: string
  hash: string
  whyImportant: string
  category: SeedKeyFileCategory
}

export interface SeedArtifact {
  seedVersion: number
  generatedAt: string
  sourceCommit?: string
  generatorVersion: string
  seederPromptVersion: string
  suggestionPromptVersion: string
  configFingerprint: string
  modelId?: string
  projectIntentSummary: string
  objectivesSummary: string
  constraintsSummary: string
  principlesGuidelinesSummary: string
  implementationStatusSummary: string
  topObjectives: string[]
  constraints: string[]
  keyFiles: SeedKeyFile[]
  categoryFindings?: SeedCategoryFindings
  openQuestions: string[]
  reseedNotes?: string
  lastReseedReason?: ReseedReason
  lastChangedFiles?: string[]
}

export interface SeedDraft {
  projectIntentSummary: string
  objectivesSummary: string
  constraintsSummary: string
  principlesGuidelinesSummary: string
  implementationStatusSummary: string
  topObjectives: string[]
  constraints: string[]
  keyFiles: Array<Pick<SeedKeyFile, "path" | "whyImportant" | "category">>
  categoryFindings?: SeedCategoryFindings
  openQuestions: string[]
  reseedNotes?: string
}

export interface ReseedTrigger {
  reason: ReseedReason
  changedFiles: string[]
  gitDiffSummary?: string
}

export function emptyFindings(): SeedCategoryFindings {
  return {
    vision: { found: false, rationale: "not investigated", files: [] },
    architecture: { found: false, rationale: "not investigated", files: [] },
    principles_guidelines: { found: false, rationale: "not investigated", files: [] },
  }
}

export function validateSeedDraft(draft: SeedDraft): string | null {
  const findings = draft.categoryFindings
  if (!findings) return "missing categoryFindings"
  for (const key of ["vision", "architecture", "principles_guidelines"] as const) {
    const finding = findings[key]
    if (!finding) return `missing categoryFindings.${key}`
    if (!finding.rationale?.trim()) return `empty rationale for ${key}`
    if (finding.found && (!Array.isArray(finding.files) || finding.files.length === 0)) {
      return `${key} marked found without files`
    }
  }
  return null
}
