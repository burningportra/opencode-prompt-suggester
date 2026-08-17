/** @jsxImportSource @opentui/solid */
import { readdir } from "node:fs/promises"
import path from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, readJson, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import { sessionCall } from "./infra/sdk.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"

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
  focused?: boolean
}

const ACCEPT = new Set(["space", " ", "right", "arrowright", "tab"])
const DISMISS = new Set(["backspace", "delete"])

const tui: TuiPlugin = async (api) => {
  const roots = unique([api.state.path.worktree, api.state.path.directory])
  const [ghost, setGhost] = createSignal("")
  let field: Field | undefined
  let dismissed = ""

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const empty = () => !field?.plainText

  const accept = () => {
    const text = ghost()
    if (!text || !empty()) return false
    field?.insertText?.(text)
    field?.setText?.(text)
    setGhost("")
    return true
  }

  const refresh = async () => {
    const config = await loadConfig(roots[0] ?? api.state.path.directory)
    if (!config.enabled) {
      setGhost("")
      return
    }
    const id = sessionID()
    const live = await findLive(roots, id)
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === dismissed) return
    setGhost(live.text)
  }

  const send = async (text: string) => {
    const id = sessionID()
    if (!id || !text.trim()) return
    dismissed = ""
    setGhost("")
    field?.clear?.()
    field?.setText?.("")
    const client = api.client as { session: { prompt: (...args: never[]) => Promise<unknown> } }
    await sessionCall(client.session.prompt.bind(client.session), id, {
      directory: api.state.path.directory,
      parts: [{ type: "text", text: text.trim() }],
    })
  }

  const onKey = (evt: KeyLike) => {
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if (!empty()) return
    if (ACCEPT.has(name) || ACCEPT.has(name.replace(/^arrow/, ""))) {
      if (!ghost()) return
      evt.preventDefault?.()
      evt.stopPropagation?.()
      accept()
      return
    }
    if (DISMISS.has(name) && ghost()) {
      evt.preventDefault?.()
      evt.stopPropagation?.()
      dismissed = ghost()
      setGhost("")
    }
  }

  api.event.on("session.idle", () => {
    dismissed = ""
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
  }, 250)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => {
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if (!empty()) return
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

  api.command?.register(() => [
    {
      title: "Accept suggested prompt",
      value: "suggester.accept",
      slash: { name: "suggester-accept" },
      onSelect: () => {
        accept()
      },
    },
    {
      title: "Prompt suggester",
      value: "suggester.status",
      slash: { name: "suggester" },
      async onSelect() {
        api.ui.dialog.replace(() =>
          api.ui.DialogAlert({
            title: "Suggester",
            message: await statusText(roots[0] ?? api.state.path.directory, sessionID() ?? "none"),
          }),
        )
      },
    },
    {
      title: "Reseed",
      value: "suggester.reseed",
      onSelect: () => {
        const id = sessionID()
        const root = roots[0]
        if (!id || !root) return
        void requestReseed({
          client: api.client,
          directory: api.state.path.directory,
          worktree: root,
          sessionID: id,
        })
      },
    },
    {
      title: "Disable prompt suggester",
      value: "suggester.off",
      onSelect: () => {
        const root = roots[0]
        if (!root) return
        void saveConfig(root, "project", { enabled: false })
        setGhost("")
      },
    },
  ])

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
                onKeyDown={onKey}
                onSubmit={() => {
                  const typed = field?.plainText?.trim() || ""
                  void send(typed || ghost())
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
  const root = stateRoot()
  const projects = await readdir(path.join(root, "projects")).catch(() => [])
  for (const project of projects) {
    const live = await readJson<LiveSuggestion>(
      path.join(root, "projects", project, "sessions", sessionID, "live.json"),
    )
    if (live) return live
  }
  return null
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
