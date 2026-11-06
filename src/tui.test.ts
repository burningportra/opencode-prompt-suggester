import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  exports: Record<string, string>
}

test("package exports point at existing V2 entries", () => {
  for (const key of [".", "./server", "./tui", "./rpc"]) {
    assert.ok(pkg.exports[key], `missing export ${key}`)
    assert.ok(existsSync(join(root, pkg.exports[key])), `${key} target does not exist`)
  }
})

test("tui entry is a V2 tui plugin", () => {
  const src = readFileSync(join(root, pkg.exports["./tui"]), "utf8")
  assert.match(src, /@opencode\/plugin\/tui/)
  assert.match(src, /Plugin\.define/)
  assert.doesNotMatch(src, /api\.ui\.Prompt/)
})

test("server entry is a V2 server plugin", () => {
  const src = readFileSync(join(root, pkg.exports["./server"]), "utf8")
  assert.match(src, /@opencode\/plugin"/)
  assert.match(src, /Plugin\.define/)
  assert.match(src, /rpc\.register/)
})
