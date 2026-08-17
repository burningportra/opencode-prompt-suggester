import { HIDDEN_SESSION_TITLE } from "../infra/paths.ts"
import { extractText, parseModel, sdkCall } from "../infra/sdk.ts"

type Client = {
  session: {
    create: (...args: never[]) => Promise<unknown>
    prompt: (...args: never[]) => Promise<unknown>
    get?: (...args: never[]) => Promise<unknown>
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
}): Promise<{ text: string; sessionID: string }> {
  const sessionID = await ensureHiddenSession(input.client, input.hiddenSessionID, input.directory)
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
  const result = await sdkCall(
    input.client.session.prompt.bind(input.client.session),
    { path: { sessionID }, body, query: { directory: input.directory } },
    { path: { id: sessionID }, body, query: { directory: input.directory } },
    { sessionID, ...body, directory: input.directory },
  )
  return { text: extractText(result), sessionID }
}

async function ensureHiddenSession(client: Client, existing: string | undefined, directory: string): Promise<string> {
  if (existing) {
    try {
      if (client.session.get) {
        await sdkCall(
          client.session.get.bind(client.session),
          { path: { sessionID: existing }, query: { directory } },
          { path: { id: existing }, query: { directory } },
          { sessionID: existing, directory },
        )
      }
      return existing
    } catch {
      // recreate
    }
  }
  const created = await sdkCall<{ id?: string; sessionID?: string }>(
    client.session.create.bind(client.session),
    { body: { title: HIDDEN_SESSION_TITLE }, query: { directory } },
    { title: HIDDEN_SESSION_TITLE, directory },
  )
  const id = created.id ?? created.sessionID
  if (!id) throw new Error("failed to create hidden suggester session")
  return id
}
