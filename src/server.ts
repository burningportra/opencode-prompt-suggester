import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { onSessionIdle, onUserMessage, rememberSmallModel } from "./app/suggester.ts"
import { PLUGIN_ID } from "./infra/paths.ts"

const PLUGIN_REVISION = 5

const server: Plugin = async ({ client, directory, worktree, project }) => {
  const root = worktree || project?.worktree || directory
  rememberSmallModel(directory, undefined)
  await client.app.log({
    body: { service: PLUGIN_ID, level: "info", message: `loaded revision ${PLUGIN_REVISION}` },
  })

  return {
    config: async (cfg) => {
      const small = typeof cfg.small_model === "string" ? cfg.small_model : undefined
      rememberSmallModel(directory, small)
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID) return
      try {
        await onSessionIdle({ client, directory, worktree: root, sessionID })
      } catch (error) {
        await client.app.log({
          body: {
            service: PLUGIN_ID,
            level: "error",
            message: `suggestion failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      }
    },
    "chat.message": async (input, output) => {
      const text = (output.parts ?? [])
        .filter((part) => part.type === "text" && "text" in part)
        .map((part) => ("text" in part ? String(part.text) : ""))
        .join("\n")
        .trim()
      if (!text) return
      await onUserMessage({
        directory,
        worktree: root,
        sessionID: input.sessionID,
        text,
      })
    },
  }
}

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule
