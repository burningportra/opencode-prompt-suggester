export type TurnStatus = "success" | "error" | "aborted"

export type LiveSuggestionStatus = "pending" | "ready" | "none"

export interface LiveSuggestion {
  sessionID: string
  text: string
  status: LiveSuggestionStatus
  updatedAt: string
}

export interface SuggestionPromptContext {
  turnStatus: TurnStatus
  abortContextNote?: string
  intentSeed: {
    projectIntentSummary: string
    objectivesSummary: string
    constraintsSummary: string
    principlesGuidelinesSummary: string
    implementationStatusSummary: string
    topObjectives: string[]
    constraints: string[]
    openQuestions: string[]
    keyFiles: Array<{ path: string; category: string; whyImportant: string }>
    categoryFindings?: unknown
  } | null
  recentUserPrompts: string[]
  toolSignals: string[]
  touchedFiles: string[]
  unresolvedQuestions: string[]
  recentChanged: Array<{ suggestedPrompt: string; actualUserPrompt: string }>
  customInstruction: string
  latestAssistantTurn: string
  noSuggestionToken: string
  maxSuggestionChars: number
}

export function normalizeSuggestion(raw: string, noSuggestionToken: string, maxChars: number): string | null {
  const text = raw.trim().replace(/^["'`]+|["'`]+$/g, "")
  if (!text || text === noSuggestionToken) return null
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trim()
}
