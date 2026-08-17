import { readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, readJson, saveConfig, writeJson } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"

void writeFile(
  path.join(stateRoot(), "tui-module-load.txt"),
  `${new Date().toISOString()} module-evaluated\n`,
).catch(() => undefined)

type KeyLike = {
  name?: string
  key?: string
  sequence?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const tui: TuiPlugin = async (api) => {
  await writeHeartbeat(api, { phase: "boot", rev: 14 })
  const createSignal = await loadSignal()
  await writeHeartbeat(api, { phase: "signal", rev: 14, solid: createSignal.solid })
  const roots = unique([api.state.path.worktree, api.state.path.directory])
  const [ghost, setGhost] = createSignal.fn("")
  let promptRef: TuiPromptRef | undefined
  let dismissed = ""

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const typed = () => promptRef?.current.input ?? ""

  const accept = () => {
    const text = ghost()
    if (!text || !promptRef) return false
    promptRef.set({ input: text, parts: [] })
    setGhost("")
    return true
  }

  const refresh = async () => {
    const root = roots[0] ?? api.state.path.directory
    const config = await loadConfig(root)
    if (!config.enabled) {
      setGhost("")
      return
    }
    const id = sessionID()
    const live = await findLive(roots, id)
    await writeHeartbeat(api, { sessionID: id, live: live?.text ?? "", status: live?.status ?? "missing" })
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === dismissed) return
    setGhost(live.text)
  }

  const tick = () => {
    const input = typed()
    const text = ghost()
    if (text && (input === " " || input === "\t")) {
      accept()
      return
    }
    if (!input && text) return
  }

  api.event.on("session.idle", () => {
    dismissed = ""
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
    tick()
  }, 80)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => {
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if (typed()) return
    if ((name === "right" || name === "arrowright" || name === "tab" || name === "space" || name === " ") && ghost()) {
      evt.preventDefault?.()
      accept()
      return true
    }
    if ((name === "backspace" || name === "delete") && ghost()) {
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
        if (root) void saveConfig(root, "project", { enabled: false })
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

async function writeHeartbeat(
  api: { state: { path: { state?: string; worktree?: string; directory?: string } } },
  extra: Record<string, unknown>,
) {
  const dir = api.state.path.state || stateRoot()
  await writeJson(path.join(dir, PLUGIN_ID, "tui-heartbeat.json"), {
    ts: new Date().toISOString(),
    ...extra,
  }).catch(() => undefined)
}

async function loadSignal(): Promise<{ fn: typeof import("solid-js")["createSignal"]; solid: boolean }> {
  try {
    const solid = await import("solid-js")
    return { fn: solid.createSignal, solid: true }
  } catch {
    return {
      solid: false,
      fn: ((init: unknown) => {
        let value = init
        return [() => value, (next: unknown) => { value = next }]
      }) as typeof import("solid-js")["createSignal"],
    }
  }
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
