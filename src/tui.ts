import { readdir } from "node:fs/promises"
import path from "node:path"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, readJson, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"

const tui: TuiPlugin = async (api) => {
  const roots = unique([api.state.path.worktree, api.state.path.directory])
  let last = ""
  let booted = false
  let promptRef: TuiPromptRef | undefined

  await writeHeartbeat(api, { phase: "init", roots })
  api.ui.toast({ title: "suggester", message: "TUI plugin loaded", variant: "success", duration: 4000 })
  booted = true

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const accept = async (text: string) => {
    if (!text) return
    if (promptRef && !promptRef.current.input.trim()) {
      promptRef.set({ input: text, parts: [] })
      return
    }
    const client = api.client as { tui?: { appendPrompt?: (args: unknown) => Promise<unknown> } }
    await client.tui?.appendPrompt?.({ text })
    await client.tui?.appendPrompt?.({ body: { text } })
  }

  const refresh = async () => {
    const id = sessionID()
    const live = await findLive(roots, id)
    await writeHeartbeat(api, {
      phase: "poll",
      roots,
      sessionID: id,
      live: live?.text ?? "",
      status: live?.status ?? "missing",
    })
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === last) return
    last = live.text
    api.ui.toast({ title: "next", message: live.text, variant: "info", duration: 8000 })
    await accept(live.text)
  }

  api.event.on("session.idle", () => {
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
  }, 250)
  api.lifecycle.onDispose(() => clearInterval(poll))

  api.command?.register(() => [
    {
      title: "Accept suggested prompt",
      value: "suggester.accept",
      category: "Suggester",
      slash: { name: "suggester-accept" },
      onSelect: () => {
        void accept(last)
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
            message: `${body}\nlast: ${last || "(none)"}\ntui: ${booted ? "yes" : "no"}`,
          }),
        )
      },
    },
    {
      title: "Reseed project intent",
      value: "suggester.reseed",
      category: "Suggester",
      slash: { name: "suggester-reseed" },
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
        api.ui.toast({ message: "Reseed finished", variant: "success" })
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
        return api.ui.Prompt({
          sessionID: props.session_id,
          visible: props.visible,
          disabled: props.disabled,
          onSubmit: props.on_submit,
          showPlaceholder: true,
          placeholders: last ? { normal: [last] } : undefined,
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

async function writeHeartbeat(api: { state: { path: { state?: string; worktree?: string; directory?: string } } }, extra: Record<string, unknown>) {
  const dir = api.state.path.state || stateRoot()
  const file = path.join(dir, PLUGIN_ID, "tui-heartbeat.json")
  const { writeJson } = await import("./infra/store.ts")
  await writeJson(file, {
    ts: new Date().toISOString(),
    worktree: api.state.path.worktree,
    directory: api.state.path.directory,
    ...extra,
  }).catch(() => undefined)
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
