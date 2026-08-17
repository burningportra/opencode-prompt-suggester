import { HIDDEN_SESSION_TITLE } from "../infra/paths.ts"
import { extractText, parseModel, sdkCall, sessionCall } from "../infra/sdk.ts"

type Client = {
  session: {
    create: (...args: never[]) => Promise<unknown>
    prompt: (...args: never[]) => Promise<unknown>
    get?: (...args: never[]) => Promise<unknown>
    delete?: (...args: never[]) => Promise<unknown>
  }
}

export async function completeHidden(input: {
  client: Client
  hiddenSessionID?: string
  directory: string
  system: string
  prompt: string
  modelSpec?: string
  smallModel?: string
  reuse?: boolean
}): Promise<{ text: string; sessionID: string }> {
  let sessionID = await ensureHiddenSession(
    input.client,
    input.reuse ? input.hiddenSessionID : undefined,
    input.directory,
  )
  const model = parseModel(input.modelSpec === "small" ? input.smallModel : input.modelSpec)
  const body: Record<string, unknown> = {
    system: input.system,
    parts: [{ type: "text", text: input.prompt }],
    tools: {
      bash: false,
      edit: false,
      write: false,
      read: false,
      grep: false,
      glob: false,
      list: false,
      task: false,
    },
  }
  if (model) body.model = model
  let result: unknown
  try {
    result = await sessionCall(
      input.client.session.prompt.bind(input.client.session),
      sessionID,
      { directory: input.directory, ...body },
    )
  } catch {
    sessionID = await ensureHiddenSession(input.client, undefined, input.directory)
    result = await sessionCall(
      input.client.session.prompt.bind(input.client.session),
      sessionID,
      { directory: input.directory, ...body },
    )
  }
  if (!input.reuse && input.client.session.delete) {
    await sessionCall(input.client.session.delete.bind(input.client.session), sessionID, {
      directory: input.directory,
    }).catch(() => undefined)
  }
  return { text: extractText(result), sessionID }
}

async function ensureHiddenSession(client: Client, existing: string | undefined, directory: string): Promise<string> {
  if (existing) return existing
  const created = await sdkCall<{ id?: string; sessionID?: string }>(
    client.session.create.bind(client.session),
    { body: { title: HIDDEN_SESSION_TITLE }, query: { directory } },
    { title: HIDDEN_SESSION_TITLE, directory },
  )
  const id = created.id ?? created.sessionID
  if (!id) throw new Error("failed to create hidden suggester session")
  return id
}
