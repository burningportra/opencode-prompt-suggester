import { readdir } from "node:fs/promises"
import path from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, readJson, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"
import type { GhostAcceptKey } from "./domain/config.ts"

type KeyLike = {
  name?: string
  key?: string
  sequence?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const ACCEPT: Record<string, GhostAcceptKey> = {
  right: "right",
  arrowright: "right",
  space: "space",
  " ": "space",
  tab: "tab",
}

const tui: TuiPlugin = async (api) => {
  const roots = unique([api.state.path.worktree, api.state.path.directory])
  const [ghost, setGhost] = createSignal("")
  let promptRef: TuiPromptRef | undefined
  let dismissed = ""
  let acceptKeys: GhostAcceptKey[] = ["space", "right", "tab"]

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const empty = () => !promptRef?.current.input

  const accept = () => {
    const text = ghost()
    if (!text || !promptRef || !empty()) return false
    promptRef.set({ input: text, parts: [] })
    setGhost("")
    return true
  }

  const dismiss = () => {
    const text = ghost()
    if (!text) return false
    dismissed = text
    setGhost("")
    return true
  }

  const refresh = async () => {
    const config = await loadConfig(roots[0] ?? worktreeFallback(api))
    acceptKeys = config.suggestion.ghostAcceptKeys
    if (!config.enabled) {
      setGhost("")
      return
    }
    const id = sessionID()
    const live = await findLive(roots, id)
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === dismissed) return
    if (live.text === ghost()) return
    setGhost(live.text)
  }

  const consume = (evt: KeyLike) => {
    if (!empty()) return false
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if (name === "backspace" || name === "delete") {
      if (!ghost()) return false
      evt.preventDefault?.()
      evt.stopPropagation?.()
      return dismiss()
    }
    const mapped = ACCEPT[name.replace(/^arrow/, "")]
    if (!mapped || !acceptKeys.includes(mapped)) return false
    evt.preventDefault?.()
    evt.stopPropagation?.()
    return accept()
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
  keymap?.intercept?.((evt) => consume(evt) || undefined)

  api.command?.register(() => [
    {
      title: "Accept suggested prompt",
      value: "suggester.accept",
      category: "Suggester",
      slash: { name: "suggester-accept" },
      onSelect: () => {
        accept()
      },
    },
    {
      title: "Prompt suggester",
      value: "suggester.status",
      category: "Suggester",
      slash: { name: "suggester" },
      async onSelect() {
        const id = sessionID() ?? "none"
        const body = await statusText(roots[0] ?? worktreeFallback(api), id)
        api.ui.dialog.replace(() =>
          api.ui.DialogAlert({
            title: "Suggester",
            message: `${body}\nghost: ${ghost() || "(none)"}`,
          }),
        )
      },
    },
    {
      title: "Reseed project intent",
      value: "suggester.reseed",
      category: "Suggester",
      async onSelect() {
        const id = sessionID()
        const root = roots[0]
        if (!id || !root) return
        await requestReseed({
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
      category: "Suggester",
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
          ref?: (ref: TuiPromptRef | undefined) => void
        },
      ) {
        const text = ghost()
        return api.ui.Prompt({
          sessionID: props.session_id,
          visible: props.visible,
          disabled: props.disabled,
          onSubmit: props.on_submit,
          showPlaceholder: true,
          placeholders: text ? { normal: [text] } : undefined,
          ref: (ref) => {
            promptRef = ref
            props.ref?.(ref)
          },
        })
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

function worktreeFallback(api: { state: { path: { worktree?: string; directory?: string } } }) {
  return api.state.path.worktree || api.state.path.directory || process.cwd()
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
