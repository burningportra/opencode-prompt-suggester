export async function sdkCall<T>(fn: (...args: never[]) => Promise<unknown>, ...attempts: unknown[]): Promise<T> {
  let last: unknown
  for (const args of attempts) {
    try {
      const result = await (fn as (arg: unknown) => Promise<unknown>)(args)
      return unwrap<T>(result)
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

export function unwrap<T>(result: unknown): T {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: T }).data
  }
  return result as T
}

export function extractText(result: unknown): string {
  const payload = unwrap<{ parts?: Array<{ type?: string; text?: string }>; info?: unknown }>(result)
  const parts = Array.isArray(payload?.parts) ? payload.parts : []
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

export function parseModel(spec: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!spec || spec === "session-default" || spec === "small") return undefined
  const index = spec.indexOf("/")
  if (index <= 0) return undefined
  return { providerID: spec.slice(0, index), modelID: spec.slice(index + 1) }
}

export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1]?.trim() ?? trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("no JSON object")
  return JSON.parse(body.slice(start, end + 1))
}
