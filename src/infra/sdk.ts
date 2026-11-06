/**
 * Extracts the first JSON object from a model response. Seeder responses are
 * sometimes wrapped in prose or a fenced code block.
 */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1]?.trim() ?? trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error(`no JSON object: ${trimmed.slice(0, 180)}`)
  return JSON.parse(body.slice(start, end + 1))
}
