export async function sdkCall<T>(fn: (...args: never[]) => Promise<unknown>, ...attempts: unknown[]): Promise<T> {
  let last: Error | undefined
  for (const args of attempts) {
    try {
      const result = await (fn as (arg: unknown) => Promise<unknown>)(args)
      const error = sdkError(result)
      if (error) {
        last = new Error(errorMessage(error))
        continue
      }
      return unwrap<T>(result)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw last ?? new Error("SDK call failed")
}

export function unwrap<T>(result: unknown): T {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: T }).data
  }
  return result as T
}

function sdkError(result: unknown): unknown {
  if (!result || typeof result !== "object") return
  if (!Object.prototype.hasOwnProperty.call(result, "error")) return
  return (result as { error?: unknown }).error
}

function errorMessage(error: unknown): string {
  if (!error) return "unknown SDK error"
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message
  }
  try {
    return JSON.stringify(error).slice(0, 400)
  } catch {
    return String(error)
  }
}

export function extractText(result: unknown): string {
  const payload = unwrap<{
    parts?: Array<{ type?: string; text?: string }>
    info?: { parts?: Array<{ type?: string; text?: string }> }
  }>(result)
  const parts = Array.isArray(payload?.parts)
    ? payload.parts
    : Array.isArray(payload?.info?.parts)
      ? payload.info.parts
      : []
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
  if (start < 0 || end <= start) throw new Error(`no JSON object: ${trimmed.slice(0, 180)}`)
  return JSON.parse(body.slice(start, end + 1))
}
