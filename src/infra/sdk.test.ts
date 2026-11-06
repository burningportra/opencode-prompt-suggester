import assert from "node:assert/strict"
import test from "node:test"
import { parseJsonObject } from "./sdk.ts"

test("parseJsonObject parses json from raw and fenced markdown", () => {
  assert.deepEqual(parseJsonObject('{"type": "tool", "tool": "ls"}'), { type: "tool", tool: "ls" })
  assert.deepEqual(
    parseJsonObject('Here is the json:\n```json\n{"type": "final", "seed": {}}\n```\nHope this helps!'),
    { type: "final", seed: {} },
  )
  assert.throws(() => parseJsonObject("not a json object"), /no JSON object/)
})
