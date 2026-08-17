import assert from "node:assert/strict"
import test from "node:test"
import { extractText, parseJsonObject, parseModel, unwrap } from "./sdk.ts"

test("unwrap extracts data if present", () => {
  assert.equal(unwrap({ data: "hello" }), "hello")
  assert.deepEqual(unwrap({ foo: "bar" }), { foo: "bar" })
  assert.equal(unwrap("plain"), "plain")
})

test("extractText handles various shapes", () => {
  assert.equal(extractText("hello world"), "hello world")
  assert.equal(extractText({ text: "from text field" }), "from text field")
  assert.equal(
    extractText({ parts: [{ type: "text", text: "part 1" }, { type: "other" }, { type: "text", text: "part 2" }] }),
    "part 1\npart 2",
  )
  assert.equal(
    extractText({ data: { info: { parts: [{ type: "text", text: "nested info" }] } } }),
    "nested info",
  )
  assert.equal(extractText(null), "")
  assert.equal(extractText({}), "")
})

test("parseModel parses provider/model strings", () => {
  assert.deepEqual(parseModel("openai/gpt-4o-mini"), { providerID: "openai", modelID: "gpt-4o-mini" })
  assert.deepEqual(parseModel("anthropic/claude-3-5-haiku-20241022"), {
    providerID: "anthropic",
    modelID: "claude-3-5-haiku-20241022",
  })
  assert.equal(parseModel("small"), undefined)
  assert.equal(parseModel("session-default"), undefined)
  assert.equal(parseModel(undefined), undefined)
  assert.equal(parseModel("invalid-without-slash"), undefined)
})

test("parseJsonObject parses json from raw and fenced markdown", () => {
  assert.deepEqual(parseJsonObject('{"type": "tool", "tool": "ls"}'), { type: "tool", tool: "ls" })
  assert.deepEqual(
    parseJsonObject('Here is the json:\n```json\n{"type": "final", "seed": {}}\n```\nHope this helps!'),
    { type: "final", seed: {} },
  )
  assert.throws(() => parseJsonObject("not a json object"), /no JSON object/)
})
