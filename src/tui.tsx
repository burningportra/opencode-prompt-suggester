/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, Show } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID } from "./infra/paths.ts"
import type { GhostAcceptKey } from "./domain/config.ts"

type KeyLike = {
  name?: string
  key?: string
  sequence?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const KEY_ALIASES: Record<string, GhostAcceptKey> = {
  right: "right",
  arrowright: "right",
  space: "space",
  " ": "space",
  tab: "tab",
}

const tui: TuiPlugin = async (api) => {
  const worktree = api.state.path.worktree || api.state.path.directory
  const [ghost, setGhost] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  let promptRef: TuiPromptRef | undefined
  let acceptKeys: GhostAcceptKey[] = ["space", "right", "tab"]

  const sessionID = () => {
    const route = api.route.current
    return route.name === "session" ? String(route.params?.sessionID ?? "") || undefined : undefined
  }

  const refresh = async () => {
    const config = await loadConfig(worktree)
    setEnabled(config.enabled)
    acceptKeys = config.suggestion.ghostAcceptKeys
    const id = sessionID()
    const live = await loadLive(worktree, id)
    if (!config.enabled || !live || live.status !== "ready" || (id && live.sessionID !== id)) {
      setGhost("")
      return
    }
    setGhost(live.text)
  }

  const accept = () => {
    const text = ghost()
    if (!enabled() || !text || !promptRef) return false
    if (promptRef.current.input.trim()) return false
    promptRef.set({ input: text, parts: [] })
    return true
  }

  const consume = (evt: KeyLike) => {
    if (!enabled() || !ghost()) return false
    if (promptRef?.current.input) return false
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    const mapped = KEY_ALIASES[name.replace(/^arrow/, "")]
    if (!mapped || !acceptKeys.includes(mapped)) return false
    evt.preventDefault?.()
    evt.stopPropagation?.()
    return accept()
  }

  await refresh()
  api.event.on("session.idle", () => {
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
  }, 250)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => consume(evt) || undefined)

  api.command?.register(() => [
    {
      title: "Prompt suggester",
      value: "suggester.toggle",
      category: "Suggester",
      slash: { name: "suggester" },
      async onSelect() {
        await refresh()
        api.ui.dialog.replace(() =>
          api.ui.DialogSelect({
            title: "Prompt suggester",
            options: [
              { title: enabled() ? "Disable" : "Enable", value: "toggle" },
              { title: "Accept suggestion", value: "accept" },
              { title: "Reseed", value: "reseed" },
              { title: "Status", value: "status" },
            ],
            async onSelect(option) {
              const choice = String(option.value)
              if (choice === "toggle") {
                setEnabled(!enabled())
                await saveConfig(worktree, "project", { enabled: enabled() })
              } else if (choice === "accept") {
                accept()
              } else if (choice === "reseed") {
                const id = sessionID()
                if (id) {
                  await requestReseed({
                    client: api.client,
                    directory: api.state.path.directory,
                    worktree,
                    sessionID: id,
                  })
                }
              } else if (choice === "status") {
                api.ui.dialog.replace(() =>
                  api.ui.DialogAlert({
                    title: "Suggester",
                    message: `${await statusText(worktree, sessionID() ?? "none")}\nghost: ${ghost() || "(none)"}`,
                  }),
                )
                return
              }
              api.ui.dialog.clear()
            },
          }),
        )
      },
    },
  ])

  api.slots.register({
    order: 20,
    slots: {
      session_prompt(
        _ctx: unknown,
        props: {
          session_id: string
          visible?: boolean
          disabled?: boolean
          on_submit?: () => void
          ref?: (ref: TuiPromptRef | undefined) => void
        },
      ) {
        const text = createMemo(() => ghost())
        const theme = api.theme.current
        return (
          <box width="100%">
            <Show when={text()}>
              <box width="100%" paddingLeft={2} paddingBottom={0}>
                <text fg={theme.textMuted}>tab {text()}</text>
              </box>
            </Show>
            {api.ui.Prompt({
              sessionID: props.session_id,
              visible: props.visible,
              disabled: props.disabled,
              onSubmit: props.on_submit,
              showPlaceholder: true,
              placeholders: text() ? { normal: [text()!] } : undefined,
              ref: (ref) => {
                promptRef = ref
                props.ref?.(ref)
              },
            })}
          </box>
        )
      },
    },
  } as never)
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
