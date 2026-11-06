/** @jsxImportSource @opentui/solid */
import { unlink } from "node:fs/promises"
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { loadConfig, loadLive, loadSeed, saveConfig } from "./infra/store.ts"
import { seedPath } from "./infra/paths.ts"

type PromptApi = {
  text?(): string
  isEmpty(): boolean
  focused?(): boolean
  set?(text: string): boolean
  submit?(text: string): boolean
}

export default Plugin.define({
  id: "opencode-prompt-suggester",
  setup(context) {
    const directory = context.location?.directory ?? context.data.location.default().directory
    const [ghost, setGhost] = createSignal("")
    const [ghostSession, setGhostSession] = createSignal<string | undefined>()
    let dismissed = ""
    let liveUpdated = ""

    const promptApi = (context.ui as typeof context.ui & { prompt?: PromptApi }).prompt

    const currentSessionID = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const clearGhost = () => {
      setGhost("")
      setGhostSession(undefined)
    }

    const sessionDirectory = (sessionID: string) =>
      context.data.session.get(sessionID)?.location?.directory ?? directory

    const refresh = async () => {
      const sessionID = currentSessionID()
      if (!sessionID) {
        clearGhost()
        return
      }

      const live = await loadLive(sessionDirectory(sessionID), sessionID)
      if (!live || live.status !== "ready" || !live.text || live.sessionID !== sessionID) {
        clearGhost()
        return
      }

      if (live.updatedAt !== liveUpdated) {
        liveUpdated = live.updatedAt
        dismissed = ""
      }

      if (live.text === dismissed) {
        clearGhost()
        return
      }

      setGhost(live.text)
      setGhostSession(sessionID)
    }

    const accept = (submit: boolean) => {
      const text = ghost()
      if (!text) return

      if (!promptApi) {
        context.ui.toast.show({
          title: "Prompt suggester",
          message:
            "This OpenCode build has no TUI prompt API. Update OpenCode, apply patches/tui-prompt-api.patch, or use the Desktop app.",
          variant: "warning",
        })
        return
      }

      if (!promptApi.isEmpty()) {
        context.ui.toast.show({
          title: "Prompt suggester",
          message: "Clear the prompt before accepting a suggestion.",
          variant: "warning",
        })
        return
      }

      const ok = submit ? promptApi.submit?.(text) === true : promptApi.set?.(text) === true
      if (!ok) {
        context.ui.toast.show({
          title: "Prompt suggester",
          message: submit ? "Could not submit the suggestion." : "Could not insert the suggestion.",
          variant: "warning",
        })
        return
      }

      dismissed = text
      clearGhost()
    }

    const dismiss = () => {
      if (!ghost()) return
      dismissed = ghost()
      clearGhost()
    }

    const command = async (input?: string) => {
      const action = (input ?? "").trim().toLowerCase()

      if (action === "on" || action === "off") {
        await saveConfig(directory, "project", { enabled: action === "on" })
        if (action === "off") {
          dismissed = ghost()
          clearGhost()
        }
        context.ui.toast.show({
          title: "Prompt suggester",
          message: action === "on" ? "Suggestions enabled." : "Suggestions disabled.",
          variant: "success",
        })
        return
      }

      if (action === "reseed") {
        await unlink(seedPath(directory)).catch(() => undefined)
        context.ui.toast.show({
          title: "Prompt suggester",
          message: "Project intent seed cleared; it will reseed on the next turn.",
          variant: "info",
        })
        return
      }

      const sessionID = currentSessionID()
      const [config, seed, live] = await Promise.all([
        loadConfig(directory),
        loadSeed(directory),
        sessionID ? loadLive(sessionDirectory(sessionID), sessionID) : Promise.resolve(null),
      ])
      context.ui.toast.show({
        title: "Prompt suggester",
        message: `Enabled: ${config.enabled} | Model: ${config.inference.suggesterModel} | Seed: ${seed ? "ready" : "none"} | Current: ${live?.text || "(none)"}`,
        variant: "info",
      })
    }

    const removeSlot = context.ui.slot({
      append: "session.composer.top",
      render: (input) => (
        <Show when={ghost() && input.sessionID === ghostSession()}>
          <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={2}>
            <text fg={context.theme.text.faint}>↳</text>
            <text fg={context.theme.text.muted}>{ghost()}</text>
            <text fg={context.theme.text.faint}>
              {promptApi?.set ? "space / right · ctrl+alt+n" : "ctrl+alt+n"}
            </text>
          </box>
        </Show>
      ),
    })

    context.keymap.layer(() => {
      const text = ghost()
      const empty = promptApi ? promptApi.isEmpty() : true

      return {
        mode: "global",
        priority: 100,
        commands: [
          {
            id: "suggester.accept",
            title: "Accept suggested next prompt",
            bind: "ctrl+alt+n",
            enabled: Boolean(text),
            run: () => accept(true),
          },
          {
            id: "suggester.dismiss",
            title: "Dismiss suggested next prompt",
            bind: "ctrl+alt+x",
            enabled: Boolean(text),
            run: dismiss,
          },
          {
            id: "suggester.command",
            title: "Suggester: Settings & Status",
            palette: true,
            slash: { name: "suggester", aliases: ["suggester:status"], arguments: true },
            run: command,
          },
          ...(promptApi?.set
            ? [
                {
                  id: "suggester.insert-space",
                  title: "Insert suggested next prompt",
                  bind: "space",
                  enabled: Boolean(text) && empty,
                  run: () => accept(false),
                },
                {
                  id: "suggester.insert-right",
                  title: "Insert suggested next prompt",
                  bind: "right",
                  enabled: Boolean(text) && empty,
                  run: () => accept(false),
                },
                {
                  id: "suggester.dismiss-backspace",
                  title: "Dismiss suggested next prompt",
                  bind: "backspace",
                  enabled: Boolean(text) && empty,
                  run: dismiss,
                },
              ]
            : []),
        ],
      }
    })

    void refresh()
    const timer = setInterval(() => void refresh(), 250)
    const offSucceeded = context.data.on("session.execution.succeeded", () => {
      dismissed = ""
      void refresh()
    })
    const offFailed = context.data.on("session.execution.failed", () => {
      dismissed = ""
      void refresh()
    })
    const offStarted = context.data.on("session.execution.started", () => {
      clearGhost()
    })

    return () => {
      clearInterval(timer)
      offSucceeded()
      offFailed()
      offStarted()
      removeSlot()
    }
  },
})
