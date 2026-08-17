import assert from "node:assert/strict"
import test from "node:test"
import { buildSuggestionContext } from "./context.ts"
import { DEFAULT_CONFIG } from "../domain/config.ts"
import { renderSuggestionPrompt } from "../prompts/suggestion-template.ts"

test("buildSuggestionContext extracts user messages, tool signals, and questions", () => {
  const context = buildSuggestionContext({
    config: DEFAULT_CONFIG,
    seed: null,
    messages: [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "Please fix the login bug" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/auth.ts" }, title: "auth.ts" } },
          { type: "text", text: "I found the issue. Should I proceed with the fix?" },
        ],
      },
    ],
    steering: [
      {
        at: new Date().toISOString(),
        kind: "changed_course",
        suggestedPrompt: "Run tests",
        actualUserPrompt: "Fix login first",
        score: 0.1,
      },
    ],
    turnStatus: "success",
  })

  assert.deepEqual(context.recentUserPrompts, ["Please fix the login bug"])
  assert.ok(context.toolSignals.some((s) => s.includes("read auth.ts")))
  assert.deepEqual(context.touchedFiles, ["src/auth.ts"])
  assert.ok(context.unresolvedQuestions.some((q) => q.includes("Should I proceed with the fix?")))
  assert.equal(context.recentChanged.length, 1)

  const prompt = renderSuggestionPrompt(context)
  assert.match(prompt, /Please fix the login bug/)
  assert.match(prompt, /src\/auth\.ts/)
  assert.match(prompt, /Should I proceed with the fix\?/)
  assert.match(prompt, /RecentUserCorrections/)
})
