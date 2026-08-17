import assert from "node:assert/strict"
import test from "node:test"
import { emptyFindings, validateSeedDraft, type SeedDraft } from "./seed.ts"
import { DEFAULT_CONFIG, mergeConfig, configFingerprint } from "./config.ts"

test("validateSeedDraft passes for valid draft", () => {
  const draft: SeedDraft = {
    projectIntentSummary: "Build a plugin",
    objectivesSummary: "Suggest prompts",
    constraintsSummary: "No bloat",
    principlesGuidelinesSummary: "Fast and clean",
    implementationStatusSummary: "In progress",
    topObjectives: ["Speed"],
    constraints: ["Small context"],
    keyFiles: [{ path: "README.md", category: "vision", whyImportant: "Overview" }],
    categoryFindings: {
      vision: { found: true, rationale: "README explains vision", files: ["README.md"] },
      architecture: { found: false, rationale: "Flat project, no ARCHITECTURE.md", files: [] },
      principles_guidelines: { found: false, rationale: "No guidelines document found", files: [] },
    },
    openQuestions: [],
  }
  assert.equal(validateSeedDraft(draft), null)
})

test("validateSeedDraft fails if categoryFindings missing", () => {
  const draft = {
    projectIntentSummary: "",
    objectivesSummary: "",
    constraintsSummary: "",
    principlesGuidelinesSummary: "",
    implementationStatusSummary: "",
    topObjectives: [],
    constraints: [],
    keyFiles: [],
    openQuestions: [],
  } as unknown as SeedDraft
  assert.match(validateSeedDraft(draft) ?? "", /missing categoryFindings/)
})

test("validateSeedDraft fails if category found=true without files", () => {
  const draft: SeedDraft = {
    projectIntentSummary: "",
    objectivesSummary: "",
    constraintsSummary: "",
    principlesGuidelinesSummary: "",
    implementationStatusSummary: "",
    topObjectives: [],
    constraints: [],
    keyFiles: [],
    categoryFindings: {
      vision: { found: true, rationale: "Found it", files: [] },
      architecture: { found: false, rationale: "None", files: [] },
      principles_guidelines: { found: false, rationale: "None", files: [] },
    },
    openQuestions: [],
  }
  assert.match(validateSeedDraft(draft) ?? "", /vision marked found without files/)
})

test("validateSeedDraft fails if rationale is empty", () => {
  const draft: SeedDraft = {
    projectIntentSummary: "",
    objectivesSummary: "",
    constraintsSummary: "",
    principlesGuidelinesSummary: "",
    implementationStatusSummary: "",
    topObjectives: [],
    constraints: [],
    keyFiles: [],
    categoryFindings: {
      vision: { found: false, rationale: "   ", files: [] },
      architecture: { found: false, rationale: "None", files: [] },
      principles_guidelines: { found: false, rationale: "None", files: [] },
    },
    openQuestions: [],
  }
  assert.match(validateSeedDraft(draft) ?? "", /empty rationale for vision/)
})

test("mergeConfig applies overrides over defaults", () => {
  const custom = mergeConfig({ enabled: false }, { suggestion: { maxSuggestionChars: 100 } })
  assert.equal(custom.enabled, false)
  assert.equal(custom.suggestion.maxSuggestionChars, 100)
  assert.equal(custom.seed.maxSteps, DEFAULT_CONFIG.seed.maxSteps)
})

test("configFingerprint is deterministic", () => {
  const fp1 = configFingerprint(DEFAULT_CONFIG)
  const fp2 = configFingerprint(mergeConfig())
  assert.equal(fp1, fp2)
})
