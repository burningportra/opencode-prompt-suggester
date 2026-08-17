import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { requestReseed, statusText } from "./app/suggester.ts"
import { loadConfig, loadLive, saveConfig } from "./infra/store.ts"
import { PLUGIN_ID } from "./infra/paths.ts"
import type { GhostAcceptKey } from "./domain/config.ts"

type KeymapApi = {
  intercept?: (fn: (evt: KeyLike) => unknown) => () => void
  registerLayer?: (layer: Record<string, unknown>) => () => void
  on?: (event: string, fn: (evt: KeyLike) => unknown) => () => void
}

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
  let promptRef: TuiPromptRef | undefined
  let current = ""
  let enabled = true
  let acceptKeys: GhostAcceptKey[] = ["space", "right", "tab"]

  const refreshConfig = async () => {
    const config = await loadConfig(worktree)
    enabled = config.enabled
    acceptKeys = config.suggestion.ghostAcceptKeys
  }

  const refreshLive = async (sessionID?: string) => {
    const live = await loadLive(worktree)
    if (!live || (sessionID && live.sessionID !== sessionID)) return
    current = live.status === "ready" ? live.text : ""
  }

  await refreshConfig()

  const sessionID = () => {
    const route = api.route.current
    return route.name === "session" ? String(route.params?.sessionID ?? "") || undefined : undefined
  }

  const accept = () => {
    if (!enabled || !current) return false
    if (!promptRef) return false
    if (promptRef.current.input.trim()) return false
    promptRef.set({ input: current, parts: [] })
    return true
  }

  const eventKey = (evt: KeyLike): string => {
    return String(evt.name ?? evt.key ?? evt.id ?? evt.sequence ?? "")
      .toLowerCase()
      .replace(/^key_/, "")
      .replace(/^arrow-?/, "")
  }

  const shouldAccept = (evt: KeyLike): boolean => {
    if (!enabled || !current) return false
    if (promptRef && promptRef.current.input !== "") return false
    const mapped = KEY_ALIASES[eventKey(evt)]
    return Boolean(mapped && acceptKeys.includes(mapped))
  }

  const consume = (evt: KeyLike): boolean => {
    if (!shouldAccept(evt)) return false
    evt.preventDefault?.()
    evt.stopPropagation?.()
    return accept()
  }

  api.event.on("session.idle", () => {
    void refreshLive(sessionID())
  })

  const poll = setInterval(() => {
    void refreshConfig()
    void refreshLive(sessionID())
  }, 400)
  api.lifecycle.onDispose(() => clearInterval(poll))

  const keymap = (api as { keymap?: KeymapApi }).keymap
  keymap?.registerLayer?.({
    commands: [
      {
        namespace: "suggester",
        name: "suggester.accept",
        title: "Accept suggested prompt",
        category: "Suggester",
        slashName: "suggester-accept",
        run() {
          return accept()
        },
      },
    ],
    bindings: [{ key: "ctrl+y", cmd: "suggester.accept", desc: "Accept suggestion" }],
  })
  keymap?.intercept?.((evt) => consume(evt) || undefined)
  keymap?.on?.("key", (evt) => consume(evt) || undefined)

  const renderer = api.renderer as { on?: (event: string, fn: (evt: KeyLike) => void) => () => void }
  for (const event of ["key", "keypress", "keydown"]) {
    renderer.on?.(event, (evt) => {
      consume(evt)
    })
  }

  api.command?.register(() => [
    {
      title: enabled ? "Disable prompt suggester" : "Enable prompt suggester",
      value: "suggester.toggle",
      category: "Suggester",
      slash: { name: "suggester", aliases: ["suggesterSettings"] },
      async onSelect() {
        await refreshConfig()
        api.ui.dialog.replace(() =>
          api.ui.DialogSelect({
            title: "Prompt suggester",
            options: [
              { title: enabled ? "Disable" : "Enable", value: "toggle" as const },
              { title: "Accept suggestion", value: "accept" as const },
              { title: "Reseed project intent", value: "reseed" as const },
              { title: "Set custom instruction", value: "instruction" as const },
              { title: "Show status", value: "status" as const },
            ],
            async onSelect(option) {
              const choice = String(option.value)
              if (choice === "toggle") {
                enabled = !enabled
                await saveConfig(worktree, "project", { enabled })
                api.ui.toast({ message: enabled ? "Suggester on" : "Suggester off", variant: "info" })
              } else if (choice === "accept") {
                accept()
              } else if (choice === "reseed") {
                const id = sessionID()
                if (!id) {
                  api.ui.toast({ message: "Open a session first", variant: "warning" })
                } else {
                  await requestReseed({
                    client: api.client,
                    directory: api.state.path.directory,
                    worktree,
                    sessionID: id,
                  })
                  api.ui.toast({ message: "Reseed finished", variant: "success" })
                }
              } else if (choice === "instruction") {
                const config = await loadConfig(worktree)
                api.ui.dialog.replace(() =>
                  api.ui.DialogPrompt({
                    title: "Custom instruction",
                    value: config.suggestion.customInstruction,
                    async onConfirm(value: string) {
                      await saveConfig(worktree, "project", {
                        suggestion: { ...config.suggestion, customInstruction: value },
                      })
                      api.ui.toast({ message: "Instruction saved", variant: "success" })
                      api.ui.dialog.clear()
                    },
                  }),
                )
                return
              } else if (choice === "status") {
                const id = sessionID() ?? "none"
                const body = await statusText(worktree, id)
                api.ui.dialog.replace(() =>
                  api.ui.DialogAlert({
                    title: "Suggester status",
                    message: `${body}\naccept: ${acceptKeys.join(", ")}`,
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
    {
      title: "Accept suggested prompt",
      value: "suggester.accept",
      category: "Suggester",
      slash: { name: "suggester-accept" },
      onSelect: () => {
        accept()
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
        const placeholders = enabled && current ? { normal: [current] } : undefined
        return api.ui.Prompt({
          sessionID: props.session_id,
          visible: props.visible,
          disabled: props.disabled,
          onSubmit: props.on_submit,
          showPlaceholder: true,
          placeholders,
          ref: (ref) => {
            promptRef = ref
            props.ref?.(ref)
          },
        })
      },
    },
  } as never)
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
