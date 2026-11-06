import type { Plugin } from "@opencode/plugin"

type Model = {
  providerID: string
  id: string
  variant?: string
}

export type SourceMessage = {
  type: string
  text?: string
  error?: unknown
  finish?: string
  content?: ReadonlyArray<{
    type: string
    text?: string
    name?: string
    state?: {
      status?: string
      input?: Record<string, unknown>
      title?: string
    }
  }>
}

type LegacyPart =
  | { type: "text"; text: string }
  | {
      type: "tool"
      tool: string
      state?: {
        status?: string
        input?: Record<string, unknown>
        title?: string
      }
    }

export type LegacyMessage = {
  info: {
    role: "user" | "assistant"
    error?: unknown
    finishReason?: string
  }
  parts: LegacyPart[]
}

export type SuggesterRuntime = {
  readonly directory: string
  readonly smallModel?: string
  generate(
    prompt: string,
    modelSpec: string | undefined,
    smallModel: string | undefined,
    sessionID?: string,
  ): Promise<string>
  messages(sessionID: string): Promise<LegacyMessage[]>
}

const runtimes = new Map<string, SuggesterRuntime>()

export function rememberRuntime(directory: string, runtime: SuggesterRuntime): void {
  runtimes.set(directory, runtime)
}

export function forgetRuntime(directory: string): void {
  runtimes.delete(directory)
}

export function runtimeFor(directory: string): SuggesterRuntime | undefined {
  return runtimes.get(directory)
}

export function createRuntime(
  ctx: Plugin.Context,
  directory: string,
  defaultSmallModel?: string,
): SuggesterRuntime {
  return {
    directory,
    smallModel: defaultSmallModel,
    async generate(prompt, modelSpec, smallModel, sessionID) {
      const model = await resolveModel(ctx, modelSpec, smallModel ?? defaultSmallModel, sessionID)
      const result = await ctx.experimental.generate.text({ model, prompt })
      return result.text.trim()
    },
    async messages(sessionID) {
      const messages = (await ctx.session.context({ sessionID })) as readonly SourceMessage[]
      return toLegacyMessages(messages)
    },
  }
}

export async function completeHidden(input: {
  directory: string
  sessionID?: string
  system: string
  prompt: string
  modelSpec?: string
  smallModel?: string
}): Promise<{ text: string; sessionID: string }> {
  const runtime = runtimeFor(input.directory)
  if (!runtime) throw new Error("prompt suggester runtime is not available")

  const text = await runtime.generate(
    `${input.system}\n\n${input.prompt}`,
    input.modelSpec,
    input.smallModel ?? runtime.smallModel,
    input.sessionID,
  )
  return { text, sessionID: "" }
}

async function resolveModel(
  ctx: Plugin.Context,
  spec: string | undefined,
  smallModel: string | undefined,
  sessionID: string | undefined,
): Promise<Model | undefined> {
  const explicit = parseModelSpec(spec === "small" ? smallModel : spec)
  if (explicit) return explicit

  if (spec === "small") return (await defaultModel(ctx)) ?? (await sessionModel(ctx, sessionID))
  return (await sessionModel(ctx, sessionID)) ?? (await defaultModel(ctx))
}

function parseModelSpec(spec: string | undefined): Model | undefined {
  if (!spec || spec === "session-default" || spec === "small") return undefined
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) return undefined
  return { providerID: spec.slice(0, slash), id: spec.slice(slash + 1) }
}

async function sessionModel(ctx: Plugin.Context, sessionID: string | undefined): Promise<Model | undefined> {
  if (!sessionID) return undefined
  const session = await ctx.session.get({ sessionID })
  const model = session.model
  if (!model) return undefined
  return { providerID: model.providerID, id: model.id, variant: model.variant }
}

async function defaultModel(ctx: Plugin.Context): Promise<Model | undefined> {
  const result = await ctx.model.default()
  const info = result.data
  if (!info) return undefined
  return { providerID: info.providerID, id: info.modelID }
}

export function toLegacyMessages(messages: readonly SourceMessage[]): LegacyMessage[] {
  const out: LegacyMessage[] = []

  for (const message of messages) {
    if (message.type === "user") {
      out.push({
        info: { role: "user" },
        parts: message.text ? [{ type: "text", text: message.text }] : [],
      })
      continue
    }

    if (message.type !== "assistant") continue

    const parts: LegacyPart[] = []
    for (const part of message.content ?? []) {
      if (part.type === "text" && part.text) {
        parts.push({ type: "text", text: part.text })
        continue
      }
      if (part.type === "tool" && part.name) {
        parts.push({
          type: "tool",
          tool: part.name,
          state: part.state
            ? {
                status: part.state.status,
                input: part.state.input,
                title: part.state.title,
              }
            : undefined,
        })
      }
    }

    out.push({
      info: {
        role: "assistant",
        error: message.error,
        finishReason: message.finish,
      },
      parts,
    })
  }

  return out
}
