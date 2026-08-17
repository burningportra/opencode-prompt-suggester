/** @jsxImportSource @opentui/solid */
import { readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { loadConfig, loadLive, readJson, writeJson } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"

void writeFile(path.join(stateRoot(), "tui-module-load.txt"), `${new Date().toISOString()} eval\n`).catch(() => undefined)

type KeyLike = {
  name?: string
  key?: string
  sequence?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

type Field = {
  plainText?: string
  insertText?: (text: string) => void
  clear?: () => void
  setText?: (text: string) => void
}

const ACCEPT = new Set(["space", " ", "right", "arrowright", "tab"])
const DISMISS = new Set(["backspace", "delete"])

const tui: TuiPlugin = async (api) => {
  await writeJson(path.join(stateRoot(), "tui-heartbeat.json"), {
    ts: new Date().toISOString(),
    phase: "boot",
    rev: 17,
  })

  const roots = [...new Set([api.state.path.worktree, api.state.path.directory].filter(Boolean))] as string[]
  const solid = await import("solid-js").catch(() => undefined)
  const [ghost, setGhost] = solid?.createSignal("") ?? [() => "", (_: string) => undefined]
  let dismissed = ""
  let promptRef: TuiPromptRef | undefined
  let field: Field | undefined

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const typed = () => field?.plainText ?? promptRef?.current.input ?? ""

  const accept = () => {
    const text = ghost()
    if (!text || typed().trim()) return false
    field?.insertText?.(text)
    field?.setText?.(text)
    promptRef?.set({ input: text, parts: [] })
    setGhost("")
    return true
  }

  const refresh = async () => {
    const id = sessionID()
    const live = await findLive(roots, id)
    await writeJson(path.join(stateRoot(), "tui-heartbeat.json"), {
      ts: new Date().toISOString(),
      phase: "poll",
      rev: 17,
      sessionID: id ?? "",
      live: live?.text ?? "",
      status: live?.status ?? "missing",
    }).catch(() => undefined)
    const root = roots[0]
    if (root) {
      const config = await loadConfig(root)
      if (!config.enabled) {
        setGhost("")
        return
      }
    }
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === dismissed) return
    setGhost(live.text)
  }

  api.event.on("session.idle", () => {
    dismissed = ""
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
    if (ghost() && (typed() === " " || typed() === "\t")) accept()
  }, 80)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => {
    if (typed()) return
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if (ACCEPT.has(name) && ghost()) {
      evt.preventDefault?.()
      accept()
      return true
    }
    if (DISMISS.has(name) && ghost()) {
      evt.preventDefault?.()
      dismissed = ghost()
      setGhost("")
      return true
    }
  })

  api.slots.register({
    order: 50,
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
          <box width="100%" visible={props.visible !== false}>
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
                maxHeight={8}
                placeholder={ghost() || undefined}
                placeholderColor={theme.textMuted}
                textColor={theme.text}
                focusedTextColor={theme.text}
                focusedBackgroundColor={theme.backgroundElement}
                cursorColor={theme.text}
                onKeyDown={(evt: KeyLike) => {
                  if (typed()) return
                  const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
                  if (ACCEPT.has(name) && ghost()) {
                    evt.preventDefault?.()
                    accept()
                  }
                  if (DISMISS.has(name) && ghost()) {
                    evt.preventDefault?.()
                    dismissed = ghost()
                    setGhost("")
                  }
                }}
                onSubmit={() => {
                  const text = typed().trim() || ghost()
                  if (!text) return
                  promptRef?.set({ input: text, parts: [] })
                  promptRef?.submit()
                  props.on_submit?.()
                  field?.clear?.()
                  field?.setText?.("")
                  setGhost("")
                }}
                ref={(node: Field) => {
                  field = node
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

  void refresh()
}

async function findLive(roots: string[], sessionID?: string): Promise<LiveSuggestion | null> {
  for (const root of roots) {
    const live = await loadLive(root, sessionID)
    if (live) return live
  }
  if (!sessionID) return null
  const base = stateRoot()
  const projects = await readdir(path.join(base, "projects")).catch(() => [])
  for (const project of projects) {
    const live = await readJson<LiveSuggestion>(
      path.join(base, "projects", project, "sessions", sessionID, "live.json"),
    )
    if (live) return live
  }
  return null
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
