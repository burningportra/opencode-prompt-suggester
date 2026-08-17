/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID } from "./infra/paths.ts"
import type { GhostAcceptKey } from "./domain/config.ts"

type KeyLike = {
  name?: string
  key?: string
  id?: string
  sequence?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const KEY_ALIASES: Record<string, GhostAcceptKey> = {
  right: "right",
  arrowright: "right",
  "arrow-right": "right",
  space: "space",
  " ": "space",
  tab: "tab",
}

const tui: TuiPlugin = async (api) => {
  const worktree = api.state.path.worktree || api.state.path.directory
  const [ghost, setGhost] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  let promptRef: TuiPromptRef | undefined
  let input: {
    focused?: boolean
    placeholder?: string
    insertText?: (text: string) => void
    plainText?: string
    clear?: () => void
    setText?: (text: string) => void
  } | undefined
  let acceptKeys: GhostAcceptKey[] = ["space", "right", "tab"]
  let lastSent = ""

  const refreshConfig = async () => {
    const config = await loadConfig(worktree)
    setEnabled(config.enabled)
    acceptKeys = config.suggestion.ghostAcceptKeys
  }

  const sessionID = () => {
    const route = api.route.current
    return route.name === "session" ? String(route.params?.sessionID ?? "") || undefined : undefined
  }

  const refreshLive = async (id?: string) => {
    const live = await loadLive(worktree, id)
    if (!live || (id && live.sessionID !== id)) {
      if (id) setGhost("")
      return
    }
    setGhost(enabled() && live.status === "ready" ? live.text : "")
    if (lastSent && input?.plainText?.trim() === lastSent) {
      input.clear?.()
      input.setText?.("")
      lastSent = ""
    }
  }

  const accept = () => {
    const text = ghost()
    if (!enabled() || !text) return false
    if (input?.plainText?.trim()) return false
    input?.insertText?.(text)
    promptRef?.set({ input: text, parts: [] })
    return true
  }

  const eventKey = (evt: KeyLike) =>
    String(evt.name ?? evt.key ?? evt.id ?? evt.sequence ?? "")
      .toLowerCase()
      .replace(/^key_/, "")
      .replace(/^arrow-?/, "")

  const consume = (evt: KeyLike) => {
    if (!enabled() || !ghost()) return false
    if (input?.plainText) return false
    const mapped = KEY_ALIASES[eventKey(evt)]
    if (!mapped || !acceptKeys.includes(mapped)) return false
    evt.preventDefault?.()
    evt.stopPropagation?.()
    return accept()
  }

  await refreshConfig()

  api.event.on("session.idle", () => {
    void refreshLive(sessionID())
  })
  const poll = setInterval(() => {
    void refreshConfig()
    void refreshLive(sessionID())
  }, 300)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => consume(evt) || undefined)

  api.command?.register(() => [
    {
      title: enabled() ? "Disable prompt suggester" : "Enable prompt suggester",
      value: "suggester.toggle",
      category: "Suggester",
      slash: { name: "suggester", aliases: ["suggesterSettings"] },
      async onSelect() {
        await refreshConfig()
        api.ui.dialog.replace(() =>
          api.ui.DialogSelect({
            title: "Prompt suggester",
            options: [
              { title: enabled() ? "Disable" : "Enable", value: "toggle" },
              { title: "Accept suggestion", value: "accept" },
              { title: "Reseed project intent", value: "reseed" },
              { title: "Show status", value: "status" },
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
                    title: "Suggester status",
                    message: await statusText(worktree, sessionID() ?? "none"),
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
        const theme = api.theme.current
        return (
          <box width="100%">
            <box
              width="100%"
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              backgroundColor={theme.backgroundElement}
            >
              <textarea
                width="100%"
                minHeight={1}
                maxHeight={6}
                placeholder={ghost() || undefined}
                placeholderColor={theme.textMuted}
                textColor={theme.text}
                focusedTextColor={theme.text}
                focusedBackgroundColor={theme.backgroundElement}
                cursorColor={theme.text}
                onKeyDown={(evt: KeyLike) => {
                  consume(evt)
                }}
                onSubmit={() => {
                  const typed = input?.plainText?.trim() || ""
                  const text = typed || ghost()
                  if (!text) return
                  lastSent = text
                  promptRef?.set({ input: text, parts: [] })
                  promptRef?.submit()
                  props.on_submit?.()
                  input?.clear?.()
                  input?.setText?.("")
                }}
                ref={(node: typeof input) => {
                  input = node
                }}
              />
            </box>
            <box visible={false} height={0}>
              {api.ui.Prompt({
                sessionID: props.session_id,
                visible: false,
                disabled: props.disabled,
                showPlaceholder: false,
                onSubmit: props.on_submit,
                ref: (ref) => {
                  promptRef = ref
                  props.ref?.(ref)
                },
              })}
            </box>
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
