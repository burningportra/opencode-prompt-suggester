/** @jsxImportSource @opentui/solid */
import { readdir } from "node:fs/promises"
import path from "node:path"
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { loadConfig, loadLive, loadSeed, readJson, saveConfig, saveSeed } from "./infra/store.ts"
import { PLUGIN_ID, stateRoot } from "./infra/paths.ts"
import type { LiveSuggestion } from "./domain/suggestion.ts"

type KeyLike = {
  name?: string
  key?: string
  sequence?: string
  preventDefault?: () => void
}

type Field = { placeholder?: unknown }

const tui: TuiPlugin = async (api) => {
  const roots = [...new Set([api.state.path.worktree, api.state.path.directory].filter(Boolean))] as string[]
  const solid = await import("solid-js").catch(() => undefined)
  const [ghost, setGhost] = solid?.createSignal("") ?? [() => "", (_: string) => undefined]
  let dismissed = ""
  let submitted = false
  let promptRef: TuiPromptRef | undefined
  let field: Field | undefined

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const typed = () => promptRef?.current.input ?? ""

  const paint = (text: string) => {
    const renderer = api.renderer as {
      currentFocusedRenderable?: unknown
      requestRender?: () => void
    }
    const node = renderer.currentFocusedRenderable as Field | undefined
    if (node && "placeholder" in node) field = node
    if (!field) return
    field.placeholder = text || null
    renderer.requestRender?.()
  }

  const clearGhost = () => {
    setGhost("")
    paint("")
  }

  const accept = () => {
    const text = ghost()
    if (!text || !promptRef) return false
    promptRef.set({ input: text, parts: [] })
    clearGhost()
    return true
  }

  const refresh = async () => {
    const id = sessionID()
    const live = await findLive(roots, id)
    if (submitted || !live || live.status !== "ready" || !live.text || live.text === dismissed) {
      if (ghost()) clearGhost()
      return
    }
    if (id && live.sessionID !== id) return
    setGhost(live.text)
    if (!typed().trim()) paint(live.text)
  }

  api.event.on("session.idle", () => {
    dismissed = ""
    submitted = false
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
    if (ghost() && (typed() === " " || typed() === "\t")) accept()
    else if (!submitted && ghost() && !typed().trim()) paint(ghost())
  }, 200)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: { intercept?: (fn: (evt: KeyLike) => unknown) => () => void } }).keymap
  keymap?.intercept?.((evt) => {
    if (typed()) return
    const name = String(evt.name ?? evt.key ?? evt.sequence ?? "").toLowerCase()
    if ((name === "space" || name === " " || name === "right" || name === "arrowright" || name === "tab") && ghost()) {
      evt.preventDefault?.()
      accept()
      return true
    }
    if ((name === "backspace" || name === "delete") && ghost()) {
      evt.preventDefault?.()
      dismissed = ghost()
      clearGhost()
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
        const text = ghost()
        return api.ui.Prompt({
          sessionID: props.session_id,
          visible: props.visible,
          disabled: props.disabled,
          onSubmit: () => {
            dismissed = ghost() || dismissed
            submitted = true
            clearGhost()
            props.on_submit?.()
          },
          showPlaceholder: !text,
          ref: (ref) => {
            promptRef = ref
            props.ref?.(ref)
            if (text) queueMicrotask(() => paint(text))
          },
        })
      },
    },
  } as never)

  api.command?.register?.(() => [
    {
      title: "Suggester: Settings & Status",
      value: "suggester",
      category: "Suggester",
      description: "View status and configure prompt suggester",
      slash: { name: "suggester" },
      onSelect: async () => {
        const root = roots[0]
        if (!root) return
        const cfg = await loadConfig(root)
        const live = await findLive(roots, sessionID())
        const seed = await loadSeed(root)
        api.ui.toast({
          variant: "info",
          title: "Suggester Status",
          message: `Enabled: ${cfg.enabled} | Model: ${cfg.inference.suggesterModel} | Seed: ${seed ? "ready" : "none"} | Current: ${live?.text || "(none)"}`,
        })
      },
    },
    {
      title: "Suggester: Enable",
      value: "suggester.on",
      category: "Suggester",
      description: "Enable prompt suggestions",
      slash: { name: "suggester on", aliases: ["suggester:on"] },
      onSelect: async () => {
        const root = roots[0]
        if (root) await saveConfig(root, "project", { enabled: true })
        api.ui.toast({ variant: "success", message: "Prompt suggester enabled" })
        void refresh()
      },
    },
    {
      title: "Suggester: Disable",
      value: "suggester.off",
      category: "Suggester",
      description: "Disable prompt suggestions",
      slash: { name: "suggester off", aliases: ["suggester:off"] },
      onSelect: async () => {
        const root = roots[0]
        if (root) await saveConfig(root, "project", { enabled: false })
        clearGhost()
        api.ui.toast({ variant: "info", message: "Prompt suggester disabled" })
      },
    },
    {
      title: "Suggester: Reseed Project Intent",
      value: "suggester.reseed",
      category: "Suggester",
      description: "Trigger fresh intent re-seeding",
      slash: { name: "suggester reseed", aliases: ["suggester:reseed"] },
      onSelect: async () => {
        const root = roots[0]
        if (root) {
          const { unlink } = await import("node:fs/promises")
          const { seedPath } = await import("./infra/paths.ts")
          await unlink(seedPath(root)).catch(() => undefined)
        }
        api.ui.toast({ variant: "info", message: "Project intent seed reset; will reseed next turn." })
      },
    },
  ])

  void refresh()
}

async function findLive(roots: string[], sessionID?: string): Promise<LiveSuggestion | null> {
  for (const root of roots) {
    const live = await loadLive(root, sessionID)
    if (live) return live
  }
  if (!sessionID) return null
  const projects = await readdir(path.join(stateRoot(), "projects")).catch(() => [])
  for (const project of projects) {
    const live = await readJson<LiveSuggestion>(
      path.join(stateRoot(), "projects", project, "sessions", sessionID, "live.json"),
    )
    if (live) return live
  }
  return null
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
