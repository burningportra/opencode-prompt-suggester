import type { SuggesterConfig } from "../domain/config.ts"
import type { SeedArtifact } from "../domain/seed.ts"
import type { SteeringEvent } from "../domain/steering.ts"
import type { SuggestionPromptContext, TurnStatus } from "../domain/suggestion.ts"

interface MessageBundle {
  info?: { role?: string; error?: unknown }
  parts?: Array<{
    type?: string
    text?: string
    tool?: string
    state?: { status?: string; input?: Record<string, unknown>; title?: string }
  }>
}

export function buildSuggestionContext(input: {
  config: SuggesterConfig
  seed: SeedArtifact | null
  messages: MessageBundle[]
  steering: SteeringEvent[]
  turnStatus: TurnStatus
  abortNote?: string
}): SuggestionPromptContext {
  const { config } = input
  const users = input.messages
    .filter((message) => message.info?.role === "user")
    .flatMap((message) => textOf(message))
    .filter(Boolean)
    .slice(-config.suggestion.maxRecentUserPrompts)
    .map((text) => clip(text, config.suggestion.maxRecentUserPromptChars))

  const assistants = input.messages.filter((message) => message.info?.role === "assistant")
  const latest = assistants.at(-1)
  const latestText = clip(textOf(latest).join("\n"), config.suggestion.maxAssistantTurnChars)

  const toolSignals: string[] = []
  const touched = new Set<string>()
  const questions: string[] = []
  for (const message of input.messages.slice(-12)) {
    for (const part of message.parts ?? []) {
      if (part.type === "tool" && part.tool) {
        const title = part.state?.title ? ` ${part.state.title}` : ""
        toolSignals.push(clip(`${part.tool}${title}`, config.suggestion.maxToolSignalChars))
        const file = firstString(part.state?.input, ["filePath", "path", "target"])
        if (file) touched.add(file)
      }
      if (part.type === "text" && part.text) {
        for (const match of part.text.match(/\?\s*$/gm) ?? []) {
          void match
        }
        for (const line of part.text.split("\n")) {
          if (line.trim().endsWith("?")) questions.push(clip(line.trim(), 180))
        }
      }
    }
  }

  const recentChanged = input.steering
    .filter((event) => event.kind === "changed_course")
    .slice(-config.steering.maxChangedExamples)
    .map((event) => ({
      suggestedPrompt: event.suggestedPrompt,
      actualUserPrompt: event.actualUserPrompt,
    }))

  return {
    turnStatus: input.turnStatus,
    abortContextNote: input.abortNote ? clip(input.abortNote, config.suggestion.maxAbortContextChars) : undefined,
    intentSeed: input.seed
      ? {
          projectIntentSummary: input.seed.projectIntentSummary,
          objectivesSummary: input.seed.objectivesSummary,
          constraintsSummary: input.seed.constraintsSummary,
          principlesGuidelinesSummary: input.seed.principlesGuidelinesSummary,
          implementationStatusSummary: input.seed.implementationStatusSummary,
          topObjectives: input.seed.topObjectives,
          constraints: input.seed.constraints,
          openQuestions: input.seed.openQuestions,
          keyFiles: input.seed.keyFiles.map((file) => ({
            path: file.path,
            category: file.category,
            whyImportant: file.whyImportant,
          })),
          categoryFindings: input.seed.categoryFindings,
        }
      : null,
    recentUserPrompts: users,
    toolSignals: toolSignals.slice(-config.suggestion.maxToolSignals),
    touchedFiles: [...touched].slice(-config.suggestion.maxTouchedFiles),
    unresolvedQuestions: questions.slice(-config.suggestion.maxUnresolvedQuestions),
    recentChanged,
    customInstruction: config.suggestion.customInstruction,
    latestAssistantTurn: latestText,
    noSuggestionToken: config.suggestion.noSuggestionToken,
    maxSuggestionChars: config.suggestion.maxSuggestionChars,
  }
}

function textOf(message: MessageBundle | undefined): string[] {
  return (message?.parts ?? [])
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text ?? "")
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value
  }
}
