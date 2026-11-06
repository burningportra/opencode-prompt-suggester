/** @jsxImportSource solid-js */
import { Command, createKeyed, Plugin } from "@opencode/plugin/gui"
import * as Gui from "@opencode/plugin/gui"
import type { MountedSession, Registry, SessionScreen } from "@opencode/plugin/gui"
import { createStore } from "solid-js/store"
import { PromptSuggester } from "./rpc.ts"

type PlaceholderInput = {
  readonly session: MountedSession
  readonly screen: SessionScreen
}

type PlaceholderItem = {
  readonly id: string
  readonly order?: number
  show(input: PlaceholderInput): string | undefined
}

const ComposerPlaceholder = (
  Gui as typeof Gui & { ComposerPlaceholder?: Registry<PlaceholderItem> }
).ComposerPlaceholder

export default Plugin.define({
  setup(ctx) {
    const [suggestions, setSuggestions] = createStore<Record<string, string>>({})

    const currentSessionID = () => ctx.sessions.current()?.id
    const currentSuggestion = () => {
      const sessionID = currentSessionID()
      return sessionID ? suggestions[sessionID] ?? "" : ""
    }

    const emptyComposer = () => {
      const composer = ctx.screen.current()?.composer
      return composer ? !composer.text().trim() : false
    }

    let refreshGhost: () => void = () => {}
    let disposeGhost: () => void = () => {}

    if (ComposerPlaceholder) {
      ctx.add(ComposerPlaceholder, {
        id: "ghost",
        show: ({ session, screen }) => {
          const text = suggestions[session.id] ?? ""
          if (!text) return
          if (screen.composer.text().trim()) return
          return text
        },
      })
    } else {
      const ghost = installDomGhost(currentSuggestion)
      refreshGhost = ghost.schedule
      disposeGhost = ghost.dispose
    }

    async function sync(sessionID: string) {
      try {
        const result = (await ctx.client.rpc(PromptSuggester).get({ sessionID })) as {
          suggestion: string
          status: string
        }
        setSuggestions(sessionID, result.status === "ready" ? result.suggestion : "")
        refreshGhost()
      } catch (error) {
        console.error("[prompt-suggester] could not read suggestion", error)
      }
    }

    createKeyed(
      () => currentSessionID(),
      (sessionID) => {
        if (sessionID) void sync(sessionID)
        refreshGhost()
      },
    )

    const timer = setInterval(() => {
      const sessionID = currentSessionID()
      if (sessionID) void sync(sessionID)
    }, 500)

    ctx.add(Command, (): Command => ({
      id: "insert",
      title: "Insert suggested next prompt",
      bind: "tab",
      scope: '[data-component="composer"]',
      editable: true,
      hidden: true,
      enabled: Boolean(currentSuggestion()) && emptyComposer(),
      run: () => {
        const composer = ctx.screen.current()?.composer
        const text = currentSuggestion()
        if (!composer || !text || composer.text().trim()) return false
        if (!composer.focused()) return false
        composer.setText(text)
        refreshGhost()
        return
      },
    }))

    ctx.add(Command, (): Command => ({
      id: "send",
      title: "Send suggested next prompt",
      bind: "enter",
      scope: '[data-component="composer"]',
      editable: true,
      hidden: true,
      enabled: Boolean(currentSuggestion()) && emptyComposer(),
      run: () => {
        const sessionID = currentSessionID()
        const text = currentSuggestion()
        const composer = ctx.screen.current()?.composer
        if (!sessionID || !text || !composer || composer.text().trim()) return false
        if (!composer.focused()) return false

        // Put the text in the draft and decline the key so the composer's own
        // Enter handler submits it with the selected agent, model, and files.
        composer.setText(text)
        setSuggestions(sessionID, "")
        refreshGhost()
        return false
      },
    }))

    ctx.add(Command, (): Command => ({
      id: "dismiss",
      title: "Dismiss suggested next prompt",
      bind: "escape",
      scope: '[data-component="composer"]',
      editable: true,
      hidden: true,
      enabled: Boolean(currentSuggestion()) && emptyComposer(),
      run: () => {
        const sessionID = currentSessionID()
        const composer = ctx.screen.current()?.composer
        if (!sessionID || !currentSuggestion() || !composer?.focused()) return false
        setSuggestions(sessionID, "")
        refreshGhost()
        void ctx.client.rpc(PromptSuggester).clear({ sessionID }).catch(() => {})
        return
      },
    }))

    ctx.add(Command, (): Command => ({
      id: "suggester",
      title: "Suggester: Settings & Status",
      slash: { name: "suggester", arguments: true },
      run: async (input) => {
        const sessionID = currentSessionID()
        if (!sessionID) {
          ctx.toast.show({
            title: "Prompt suggester",
            description: "Open a session first.",
          })
          return
        }

        const action = (input ?? "").trim().toLowerCase()
        try {
          if (action === "on" || action === "off") {
            const result = (await ctx.client.rpc(PromptSuggester).configure({
              sessionID,
              enabled: action === "on",
            })) as { enabled: boolean }
            if (!result.enabled) {
              setSuggestions(sessionID, "")
              refreshGhost()
            }
            ctx.toast.show({
              title: "Prompt suggester",
              description: action === "on" ? "Suggestions enabled." : "Suggestions disabled.",
            })
            return
          }

          if (action === "reseed") {
            await ctx.client.rpc(PromptSuggester).reseed({ sessionID })
            ctx.toast.show({
              title: "Prompt suggester",
              description: "Project intent seed cleared; it will reseed on the next turn.",
            })
            return
          }

          if (action === "refresh") {
            const result = (await ctx.client.rpc(PromptSuggester).refresh({ sessionID })) as {
              suggestion: string
              status: string
            }
            setSuggestions(sessionID, result.status === "ready" ? result.suggestion : "")
            refreshGhost()
            return
          }

          const result = (await ctx.client.rpc(PromptSuggester).status({ sessionID })) as {
            enabled: boolean
            suggesterModel: string
            seedReady: boolean
            suggestion: string
            status: string
          }
          ctx.toast.show({
            title: "Prompt suggester",
            description: `Enabled: ${result.enabled} | Model: ${result.suggesterModel} | Seed: ${result.seedReady ? "ready" : "none"} | Current: ${result.suggestion || "(none)"}`,
          })
        } catch (error) {
          console.error("[prompt-suggester] command failed", error)
          ctx.toast.show({
            title: "Prompt suggester",
            description: "Could not update the suggester.",
            variant: "error",
          })
        }
      },
    }))

    refreshGhost()

    return () => {
      clearInterval(timer)
      disposeGhost()
    }
  },
})

function installDomGhost(currentSuggestion: () => string) {
  let frame: number | undefined
  let lastApplied = ""

  function activeEditor(): HTMLElement | undefined {
    const editors = Array.from(
      document.querySelectorAll<HTMLElement>('[data-component="composer-editor"]'),
    )
    return editors.find((element) => element.offsetParent !== null) ?? editors[0]
  }

  function placeholder(): HTMLElement | undefined {
    const editor = activeEditor()
    return (
      editor?.parentElement?.querySelector<HTMLElement>(
        ":scope > div.pointer-events-none.absolute",
      ) ?? undefined
    )
  }

  function applyGhost() {
    const element = placeholder()
    if (!element) return

    const text = currentSuggestion()

    if (text) {
      if (element.dataset.promptSuggesterOriginal === undefined) {
        element.dataset.promptSuggesterOriginal = element.textContent ?? ""
      } else if (element.textContent !== lastApplied && element.textContent !== text) {
        element.dataset.promptSuggesterOriginal = element.textContent ?? ""
      }

      element.dataset.promptSuggesterGhost = "true"
      element.style.whiteSpace = "nowrap"
      element.style.overflow = "hidden"
      element.style.textOverflow = "ellipsis"
      if (element.textContent !== text) element.textContent = text
      lastApplied = text
      return
    }

    if (element.dataset.promptSuggesterGhost !== "true") return

    element.textContent = element.dataset.promptSuggesterOriginal ?? ""
    element.style.whiteSpace = ""
    element.style.overflow = ""
    element.style.textOverflow = ""
    delete element.dataset.promptSuggesterGhost
    delete element.dataset.promptSuggesterOriginal
    lastApplied = ""
  }

  function schedule() {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      applyGhost()
    })
  }

  const observer = new MutationObserver(() => schedule())
  const root = document.body ?? document.documentElement
  if (root) observer.observe(root, { subtree: true, childList: true, characterData: true })
  schedule()

  return {
    schedule,
    dispose: () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      restore()
    },
  }

  function restore() {
    const element = placeholder()
    if (!element || element.dataset.promptSuggesterGhost !== "true") return
    element.textContent = element.dataset.promptSuggesterOriginal ?? ""
    element.style.whiteSpace = ""
    element.style.overflow = ""
    element.style.textOverflow = ""
    delete element.dataset.promptSuggesterGhost
    delete element.dataset.promptSuggesterOriginal
    lastApplied = ""
  }
}
