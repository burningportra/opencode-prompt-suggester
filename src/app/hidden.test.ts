import assert from "node:assert/strict"
import test from "node:test"
import { toLegacyMessages, type SourceMessage } from "./hidden.ts"

test("toLegacyMessages keeps user text and assistant text parts", () => {
  const messages: SourceMessage[] = [
    { type: "user", text: "Add a health endpoint" },
    {
      type: "assistant",
      finish: "stop",
      content: [
        { type: "text", text: "I added /healthz." },
        { type: "reasoning", text: "internal" },
      ],
    },
  ]

  assert.deepEqual(toLegacyMessages(messages), [
    {
      info: { role: "user" },
      parts: [{ type: "text", text: "Add a health endpoint" }],
    },
    {
      info: { role: "assistant", error: undefined, finishReason: "stop" },
      parts: [{ type: "text", text: "I added /healthz." }],
    },
  ])
})

test("toLegacyMessages maps tool content and skips non-conversation messages", () => {
  const messages: SourceMessage[] = [
    { type: "system", text: "system" },
    {
      type: "assistant",
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          name: "read",
          state: { status: "completed", input: { filePath: "src/server.ts" } },
        },
      ],
    },
    { type: "idle" },
  ]

  assert.deepEqual(toLegacyMessages(messages), [
    {
      info: { role: "assistant", error: undefined, finishReason: "tool-calls" },
      parts: [
        {
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "src/server.ts" }, title: undefined },
        },
      ],
    },
  ])
})

test("toLegacyMessages drops empty user messages", () => {
  assert.deepEqual(toLegacyMessages([{ type: "user", text: "" }]), [
    { info: { role: "user" }, parts: [] },
  ])
})
