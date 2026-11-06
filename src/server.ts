import { unlink } from "node:fs/promises"
import { Plugin } from "@opencode/plugin"
import { PromptSuggester } from "./rpc.ts"
import { createRuntime, forgetRuntime, rememberRuntime } from "./app/hidden.ts"
import { onSessionIdle, onUserMessage } from "./app/suggester.ts"
import { loadConfig, loadLive, loadSeed, saveConfig, saveLive } from "./infra/store.ts"
import { PLUGIN_ID, seedPath } from "./infra/paths.ts"

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx: Plugin.Context) {
    const directory = ctx.location.directory
    const worktree = directory
    const smallModel = typeof ctx.options.smallModel === "string" ? ctx.options.smallModel : undefined

    rememberRuntime(directory, createRuntime(ctx, directory, smallModel))

    async function sessionDirectory(sessionID: string): Promise<string> {
      const session = await ctx.session.get({ sessionID })
      return session.location?.directory ?? directory
    }

    async function live(sessionID: string) {
      const dir = await sessionDirectory(sessionID)
      return loadLive(dir, sessionID)
    }

    async function status(sessionID: string) {
      const dir = await sessionDirectory(sessionID)
      const [config, seed, current] = await Promise.all([
        loadConfig(dir),
        loadSeed(dir),
        loadLive(dir, sessionID),
      ])
      return {
        enabled: config.enabled,
        suggesterModel: config.inference.suggesterModel,
        seedReady: Boolean(seed),
        suggestion: current?.text ?? "",
        status: current?.status ?? "none",
      }
    }

    const registration = await ctx.rpc.register(PromptSuggester, {
      get: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const current = await live(sessionID)
        return {
          sessionID,
          suggestion: current?.text ?? "",
          status: current?.status ?? "none",
        }
      },
      refresh: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const dir = await sessionDirectory(sessionID)
        await onSessionIdle({ directory: dir, worktree: dir, sessionID })
        const current = await loadLive(dir, sessionID)
        return {
          sessionID,
          suggestion: current?.text ?? "",
          status: current?.status ?? "none",
        }
      },
      clear: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const dir = await sessionDirectory(sessionID)
        await saveLive(dir, {
          sessionID,
          text: "",
          status: "none",
          updatedAt: new Date().toISOString(),
        })
        return { sessionID, suggestion: "", status: "none" }
      },
      status: async (input) => {
        const { sessionID } = input as { sessionID: string }
        return status(sessionID)
      },
      configure: async (input) => {
        const { sessionID, enabled } = input as { sessionID: string; enabled: boolean }
        const dir = await sessionDirectory(sessionID)
        await saveConfig(dir, "project", { enabled })
        return status(sessionID)
      },
      reseed: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const dir = await sessionDirectory(sessionID)
        await unlink(seedPath(dir)).catch(() => undefined)
        return status(sessionID)
      },
    })

    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.parentID) return
      if (session.location?.directory && session.location.directory !== directory) return
      await onUserMessage({
        directory,
        worktree,
        sessionID: event.sessionID,
        text: event.prompt.text,
      })
    })

    const controller = new AbortController()

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: [
            "session.execution.started",
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "session.deleted",
          ],
          signal: controller.signal,
        })) {
          if (event.type === "session.deleted") continue

          const session = await ctx.session.get({ sessionID: event.data.sessionID })
          if (session.parentID) continue
          if (session.location?.directory && session.location.directory !== directory) continue

          if (event.type === "session.execution.started") {
            await saveLive(directory, {
              sessionID: event.data.sessionID,
              text: "",
              status: "pending",
              updatedAt: new Date().toISOString(),
            })
            continue
          }

          try {
            await onSessionIdle({
              directory,
              worktree,
              sessionID: event.data.sessionID,
            })
          } catch (error) {
            console.error("[opencode-prompt-suggester] suggestion failed", error)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-prompt-suggester] event stream failed", error)
        }
      }
    })()

    return async () => {
      controller.abort()
      forgetRuntime(directory)
      await registration.dispose()
    }
  },
})
