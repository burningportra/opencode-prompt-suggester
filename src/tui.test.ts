import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  exports: { "./tui": string }
}

test("tui entry keeps the stock Prompt for typing and submit", () => {
  const src = readFileSync(join(root, pkg.exports["./tui"]), "utf8")
  assert.match(src, /api\.ui\.Prompt\(/)
  assert.match(src, /onSubmit:/)
  assert.match(src, /props\.on_submit\?\.\(\)/)
  assert.match(src, /sessionID: props\.session_id/)
  assert.match(src, /showPlaceholder: true/)
  assert.match(src, /placeholders: text \? \{ normal: \[text\] \} : undefined/)
  assert.match(src, /isAcceptKey/)
  assert.match(src, /right/)
  assert.match(src, /space/)
  assert.doesNotMatch(src, /<textarea/)
  assert.doesNotMatch(src, /sessionCall/)
})
