export type SteeringKind = "accepted_exact" | "accepted_edited" | "changed_course"

export interface SteeringEvent {
  at: string
  kind: SteeringKind
  suggestedPrompt: string
  actualUserPrompt: string
  score: number
}

export function similarity(a: string, b: string): number {
  const left = normalize(a)
  const right = normalize(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const gramsA = ngrams(left)
  const gramsB = ngrams(right)
  let overlap = 0
  for (const [gram, count] of gramsA) overlap += Math.min(count, gramsB.get(gram) ?? 0)
  const total = [...gramsA.values()].reduce((s, n) => s + n, 0) + [...gramsB.values()].reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  return (2 * overlap) / total
}

export function classifySteering(
  suggested: string,
  actual: string,
  threshold: number,
): { kind: SteeringKind; score: number } {
  const score = similarity(suggested, actual)
  if (score >= 0.97) return { kind: "accepted_exact", score }
  if (score >= threshold) return { kind: "accepted_edited", score }
  return { kind: "changed_course", score }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function ngrams(value: string): Map<string, number> {
  const map = new Map<string, number>()
  const padded = ` ${value} `
  for (let i = 0; i < padded.length - 2; i++) {
    const gram = padded.slice(i, i + 3)
    map.set(gram, (map.get(gram) ?? 0) + 1)
  }
  return map
}
