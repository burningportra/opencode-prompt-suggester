export type GhostAcceptKey = "space" | "right" | "tab"

export interface SuggesterConfig {
  schemaVersion: number
  enabled: boolean
  seed: {
    maxDiffChars: number
    maxSteps: number
  }
  reseed: {
    enabled: boolean
    checkOnSessionStart: boolean
    checkAfterEveryTurn: boolean
    turnCheckInterval: number
  }
  suggestion: {
    noSuggestionToken: string
    customInstruction: string
    fastPathContinueOnError: boolean
    ghostAcceptKeys: GhostAcceptKey[]
    maxAssistantTurnChars: number
    maxRecentUserPrompts: number
    maxRecentUserPromptChars: number
    maxToolSignals: number
    maxToolSignalChars: number
    maxTouchedFiles: number
    maxUnresolvedQuestions: number
    maxAbortContextChars: number
    maxSuggestionChars: number
    prefillOnlyWhenEditorEmpty: boolean
  }
  steering: {
    historyWindow: number
    acceptedThreshold: number
    maxChangedExamples: number
  }
  inference: {
    seederModel: string
    suggesterModel: string
  }
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<U>
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P]
}

export type PartialSuggesterConfig = DeepPartial<SuggesterConfig>

export const DEFAULT_CONFIG: SuggesterConfig = {
  schemaVersion: 1,
  enabled: true,
  seed: {
    maxDiffChars: 3000,
    maxSteps: 8,
  },
  reseed: {
    enabled: false,
    checkOnSessionStart: false,
    checkAfterEveryTurn: false,
    turnCheckInterval: 10,
  },
  suggestion: {
    noSuggestionToken: "[no suggestion]",
    customInstruction: "",
    fastPathContinueOnError: true,
    ghostAcceptKeys: ["space", "right", "tab"],
    maxAssistantTurnChars: 1800,
    maxRecentUserPrompts: 5,
    maxRecentUserPromptChars: 180,
    maxToolSignals: 8,
    maxToolSignalChars: 240,
    maxTouchedFiles: 8,
    maxUnresolvedQuestions: 6,
    maxAbortContextChars: 280,
    maxSuggestionChars: 200,
    prefillOnlyWhenEditorEmpty: true,
  },
  steering: {
    historyWindow: 20,
    acceptedThreshold: 0.82,
    maxChangedExamples: 3,
  },
  inference: {
    seederModel: "session-default",
    suggesterModel: "small",
  },
}

export function mergeConfig(
  ...layers: Array<DeepPartial<SuggesterConfig> | undefined>
): SuggesterConfig {
  let result: SuggesterConfig = structuredClone(DEFAULT_CONFIG)
  for (const layer of layers) {
    if (!layer) continue
    result = {
      ...result,
      ...layer,
      seed: { ...result.seed, ...layer.seed },
      reseed: { ...result.reseed, ...layer.reseed },
      suggestion: { ...result.suggestion, ...layer.suggestion },
      steering: { ...result.steering, ...layer.steering },
      inference: { ...result.inference, ...layer.inference },
    }
  }
  return result
}

export function configFingerprint(config: SuggesterConfig): string {
  return JSON.stringify({
    seed: config.seed,
    reseed: config.reseed,
    suggestion: {
      customInstruction: config.suggestion.customInstruction,
      maxSuggestionChars: config.suggestion.maxSuggestionChars,
    },
    inference: config.inference,
  })
}
