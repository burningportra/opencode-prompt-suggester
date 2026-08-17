import type { SuggestionPromptContext } from "../domain/suggestion.ts"

function renderChangedExamples(
  examples: Array<{ suggestedPrompt: string; actualUserPrompt: string }>,
): string {
  if (examples.length === 0) return "RecentUserCorrections:\n(none)"
  return `RecentUserCorrections:\n${examples
    .map(
      (example) =>
        `- instead of ${JSON.stringify(example.suggestedPrompt)}\n  the user wrote: ${JSON.stringify(example.actualUserPrompt)}`,
    )
    .join("\n")}`
}

export function renderSuggestionPrompt(context: SuggestionPromptContext): string {
  const intentSeed = context.intentSeed
    ? JSON.stringify(
        {
          projectIntentSummary: context.intentSeed.projectIntentSummary,
          objectivesSummary: context.intentSeed.objectivesSummary,
          constraintsSummary: context.intentSeed.constraintsSummary,
          principlesGuidelinesSummary: context.intentSeed.principlesGuidelinesSummary,
          implementationStatusSummary: context.intentSeed.implementationStatusSummary,
          topObjectives: context.intentSeed.topObjectives,
          constraints: context.intentSeed.constraints,
          openQuestions: context.intentSeed.openQuestions,
          keyFiles: context.intentSeed.keyFiles,
          categoryFindings: context.intentSeed.categoryFindings,
        },
        null,
        2,
      )
    : "none"

  return `Write the next message the user would most likely send in this OpenCode session.

Return only the user's message text.
Do not explain.
Do not describe the instructions you were given.
If no plausible next user message is clear, return exactly ${context.noSuggestionToken}.

TurnStatus:
${context.turnStatus}

AbortContext:
${context.abortContextNote ?? "(none)"}

ProjectIntent:
${intentSeed}

RecentUserMessages:
${context.recentUserPrompts.length > 0 ? context.recentUserPrompts.map((prompt) => `- ${prompt}`).join("\n") : "(none)"}

ToolSignals:
${context.toolSignals.length > 0 ? context.toolSignals.map((signal) => `- ${signal}`).join("\n") : "(none)"}

TouchedFiles:
${context.touchedFiles.length > 0 ? context.touchedFiles.map((file) => `- ${file}`).join("\n") : "(none)"}

UnresolvedQuestions:
${context.unresolvedQuestions.length > 0 ? context.unresolvedQuestions.map((item) => `- ${item}`).join("\n") : "(none)"}

${renderChangedExamples(context.recentChanged)}
${
  context.customInstruction.trim()
    ? `

Additional user preference:
${context.customInstruction.trim()}`
    : ""
}

LatestAssistantMessage:
\`\`\`
${context.latestAssistantTurn || "(empty)"}
\`\`\`

Guidance:
- Stay close to the user's recent style and current trajectory.
- Treat RecentUserMessages as the strongest signal.
- Use ProjectIntent to stay aligned with the project's current goals and constraints.
- If AbortContext is present, assume the user intentionally interrupted the previous execution.
- Learn from RecentUserCorrections: avoid repeating directions the user moved away from.
- If the latest assistant message proposed a next step and it fits, a short reply like "Yes.", "Go ahead.", or "Proceed." is often best.
- Only add more text when it adds new information such as a constraint, correction, or emphasis.
- Do not restate, summarize, or paraphrase the assistant's proposal unless repeating a small part is necessary to add that new information.
- If nothing new needs to be added, prefer affirmation only.
- If the assistant's direction clearly conflicts with the user's recent behavior or ProjectIntent, write a natural pivot instead.
- Keep the result under ${context.maxSuggestionChars} characters. Prefer fewer when possible.`
}
