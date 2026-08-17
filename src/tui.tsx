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

const tui: TuiPlugin = async (api) => {
  await writeJson(path.join(stateRoot(), "tui-heartbeat.json"), {
    ts: new Date().toISOString(),
    phase: "boot",
    rev: 28,
  })

  const roots = [...new Set([api.state.path.worktree, api.state.path.directory].filter(Boolean))] as string[]
  const solid = await import("solid-js").catch(() => undefined)
  const [ghost, setGhost] = solid?.createSignal("") ?? [() => "", (_: string) => undefined]
  let dismissed = ""
  let promptRef: TuiPromptRef | undefined

  const sessionID = () => {
    const route = api.route.current
    if (route.name === "session") return String(route.params?.sessionID ?? "") || undefined
    return undefined
  }

  const typed = () => promptRef?.current.input ?? ""

  const paintPlaceholder = (text: string) => {
    const renderer = api.renderer as {
      root?: unknown
      currentFocusedRenderable?: unknown
      requestRender?: () => void
    }
    const rootsToWalk = [renderer, renderer.root, renderer.currentFocusedRenderable]
    const seen = new Set<unknown>()
    let painted = 0
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object" || seen.has(node)) return
      seen.add(node)
      const rec = node as {
        placeholder?: unknown
        getChildren?: () => unknown[]
        children?: unknown[]
        childNodes?: unknown[]
      }
      if ("placeholder" in rec && typeof rec.placeholder === "string") {
        try {
          Object.defineProperty(rec, "placeholder", {
            configurable: true,
            enumerable: true,
            get: () => text,
            set: () => undefined,
          })
        } catch {
          rec.placeholder = text
        }
        painted += 1
      }
      const kids = rec.getChildren?.() ?? rec.children ?? rec.childNodes ?? []
      if (Array.isArray(kids)) for (const kid of kids) visit(kid)
    }
    for (const node of rootsToWalk) visit(node)
    renderer.requestRender?.()
    return painted
  }

  const accept = () => {
    const text = ghost()
    if (!text || !promptRef) return false
    promptRef.set({ input: text, parts: [] })
    setGhost("")
    paintPlaceholder("")
    return true
  }

  const refresh = async () => {
    const id = sessionID()
    const live = await findLive(roots, id)
    await writeJson(path.join(stateRoot(), "tui-heartbeat.json"), {
      ts: new Date().toISOString(),
      phase: "poll",
      rev: 28,
      sessionID: id ?? "",
      live: live?.text ?? "",
      status: live?.status ?? "missing",
      painted: ghost() && !typed().trim() ? paintPlaceholder(ghost()) : 0,
    }).catch(() => undefined)
    const root = roots[0]
    if (root) {
      const config = await loadConfig(root)
      if (!config.enabled) {
        setGhost("")
        paintPlaceholder("")
        return
      }
    }
    if (!live || live.status !== "ready" || !live.text) return
    if (id && live.sessionID !== id) return
    if (live.text === dismissed) return
    setGhost(live.text)
    if (!typed().trim()) paintPlaceholder(live.text)
  }

  api.event.on("session.idle", () => {
    dismissed = ""
    void refresh()
  })
  const poll = setInterval(() => {
    void refresh()
    if (ghost() && (typed() === " " || typed() === "\t")) accept()
    if (ghost() && !typed().trim()) paintPlaceholder(ghost())
  }, 80)
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
      setGhost("")
      paintPlaceholder("")
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
          onSubmit: props.on_submit,
          showPlaceholder: !text,
          ref: (ref) => {
            promptRef = ref
            props.ref?.(ref)
            if (text) queueMicrotask(() => paintPlaceholder(text))
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
