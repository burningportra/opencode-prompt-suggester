import assert from "node:assert/strict"
import test from "node:test"
import { classifySteering, similarity } from "./steering.ts"
import { normalizeSuggestion } from "./suggestion.ts"

test("exact accept", () => {
  const verdict = classifySteering("Go ahead.", "Go ahead.", 0.82)
  assert.equal(verdict.kind, "accepted_exact")
})

test("edited accept", () => {
  const verdict = classifySteering("Run the unit tests", "Run the unit tests please", 0.82)
  assert.equal(verdict.kind, "accepted_edited")
})

test("changed course", () => {
  const verdict = classifySteering("Go ahead.", "scratch that, open the holdings page", 0.82)
  assert.equal(verdict.kind, "changed_course")
})

test("similarity is 1 for identical", () => {
  assert.equal(similarity("Yes.", "Yes."), 1)
})

test("normalize suggestion", () => {
  assert.equal(normalizeSuggestion("[no suggestion]", "[no suggestion]", 200), null)
  assert.equal(normalizeSuggestion("  Go ahead.  ", "[no suggestion]", 200), "Go ahead.")
})
