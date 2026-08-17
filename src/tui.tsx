/** @jsxImportSource @opentui/solid */
import { readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { loadConfig, loadLive, readJson, writeJson } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import { sessionCall } from "./infra/sdk.ts"
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
    rev: 23,
  })

  const roots = [...new Set([api.state.path.worktree, api.state.path.directory].filter(Boolean))] as string[]
  const solid = await import("solid-js").catch(() => undefined)
  const [ghost, setGhost] = solid?.createSignal("") ?? [() => "", (_: string) => undefined]
  let dismissed = ""
  let field: Field | undefined

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const typed = () => field?.plainText ?? ""

  const accept = () => {
    const text = ghost()
    if (!text || typed().trim()) return false
    field?.insertText?.(text)
    field?.setText?.(text)
    setGhost("")
    return true
  }

  const send = async (text: string) => {
    const id = sessionID()
    const value = text.trim()
    if (!id || !value) return
    setGhost("")
    field?.clear?.()
    field?.setText?.("")
    const client = api.client as { session: { prompt: (...args: never[]) => Promise<unknown> } }
    await sessionCall(client.session.prompt.bind(client.session), id, {
      directory: api.state.path.directory,
      parts: [{ type: "text", text: value }],
    })
  }

  const refresh = async () => {
    const id = sessionID()
    const live = await findLive(roots, id)
    await writeJson(path.join(stateRoot(), "tui-heartbeat.json"), {
      ts: new Date().toISOString(),
      phase: "poll",
      rev: 23,
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
    if (typed().trim()) return
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
          visible?: boolean
          on_submit?: () => void
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
              paddingBottom={1}
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
                  void send(typed() || ghost())
                  props.on_submit?.()
                }}
                ref={(node: Field) => {
                  field = node
                }}
              />
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
