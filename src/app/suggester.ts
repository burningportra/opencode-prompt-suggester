import type { SuggesterConfig } from "../domain/config.ts"
import { classifySteering, type SteeringEvent } from "../domain/steering.ts"
import { normalizeSuggestion, type LiveSuggestion, type TurnStatus } from "../domain/suggestion.ts"
import { addUsage } from "../domain/usage.ts"
import { loadConfig, loadSeed, loadSessionState, saveLive, saveSeed, saveSessionState } from "../infra/store.ts"
import { sessionCall } from "../infra/sdk.ts"
import { renderSuggestionPrompt } from "../prompts/suggestion-template.ts"
import { buildSuggestionContext } from "./context.ts"
import { completeHidden } from "./hidden.ts"
import { runSeeder, staleTrigger } from "./seeder.ts"

type Client = Parameters<typeof completeHidden>[0]["client"] & {
  session: Parameters<typeof completeHidden>[0]["client"]["session"] & {
    messages?: (...args: never[]) => Promise<unknown>
    get?: (...args: never[]) => Promise<unknown>
  }
}

const reseeding = new Map<string, Promise<void>>()
const smallModelByDir = new Map<string, string | undefined>()
const hiddenByDir = new Map<string, string>()

export function rememberSmallModel(directory: string, spec?: string): void {
  smallModelByDir.set(directory, spec)
}

export async function onSessionIdle(input: {
  client: Client
  directory: string
  worktree: string
  sessionID: string
}): Promise<void> {
  if ([...hiddenByDir.values()].includes(input.sessionID)) return
  const [config, state, messages] = await Promise.all([
    loadConfig(input.worktree),
    loadSessionState(input.worktree, input.sessionID),
    listMessages(input.client, input.sessionID, input.directory),
  ])
  if (!config.enabled) return
  state.turnCount = (state.turnCount ?? 0) + 1

  const turnStatus = inferTurnStatus(messages)
  if (turnStatus !== "success" && config.suggestion.fastPathContinueOnError) {
    await publish(input.worktree, input.sessionID, "continue", state)
    return
  }

  const context = buildSuggestionContext({
    config,
    seed: null,
    messages,
    steering: state.steering,
    turnStatus,
  })
  const instant = fallbackSuggestion(context)
  await publish(input.worktree, input.sessionID, instant, state, { count: false })
  const seed = await loadSeed(input.worktree)
  if (seed) context.intentSeed = {
    projectIntentSummary: seed.projectIntentSummary,
    objectivesSummary: seed.objectivesSummary,
    constraintsSummary: seed.constraintsSummary,
    principlesGuidelinesSummary: seed.principlesGuidelinesSummary,
    implementationStatusSummary: seed.implementationStatusSummary,
    topObjectives: seed.topObjectives,
    constraints: seed.constraints,
    openQuestions: seed.openQuestions,
    keyFiles: seed.keyFiles.map((file) => ({
      path: file.path,
      category: file.category,
      whyImportant: file.whyImportant,
    })),
    categoryFindings: seed.categoryFindings,
  }
  const result = await completeHidden({
    client: input.client,
    directory: input.directory,
    hiddenSessionID: state.hiddenSessionID ?? hiddenByDir.get(input.directory),
    system: "Write only the user's next prompt. One short line. No tools.",
    prompt: renderSuggestionPrompt(context),
    modelSpec: config.inference.suggesterModel,
    smallModel: smallModelByDir.get(input.directory),
    reuse: true,
  })
  state.hiddenSessionID = result.sessionID
  hiddenByDir.set(input.directory, result.sessionID)
  const text = normalizeSuggestion(
    result.text,
    config.suggestion.noSuggestionToken,
    config.suggestion.maxSuggestionChars,
  )
  if (text !== instant) await publish(input.worktree, input.sessionID, text, state)
  else await saveSessionState(input.worktree, input.sessionID, state)
  if (
    config.reseed.enabled &&
    (state.turnCount === 1 || state.turnCount % config.reseed.turnCheckInterval === 0)
  ) {
    queueReseed(input, config, "idle")
  }
}

export async function onUserMessage(input: {
  directory: string
  worktree: string
  sessionID: string
  text: string
}): Promise<void> {
  if ([...hiddenByDir.values()].includes(input.sessionID)) return
  const config = await loadConfig(input.worktree)
  const state = await loadSessionState(input.worktree, input.sessionID)
  if (state.hiddenSessionID === input.sessionID) return
  await saveLive(input.worktree, {
    sessionID: input.sessionID,
    text: "",
    status: "pending",
    updatedAt: new Date().toISOString(),
  })
  if (!state.lastSuggestion || !input.text.trim()) return
  const verdict = classifySteering(
    state.lastSuggestion,
    input.text.trim(),
    config.steering.acceptedThreshold,
  )
  const event: SteeringEvent = {
    at: new Date().toISOString(),
    kind: verdict.kind,
    suggestedPrompt: state.lastSuggestion,
    actualUserPrompt: input.text.trim(),
    score: verdict.score,
  }
  state.steering = [...state.steering, event].slice(-config.steering.historyWindow)
  await saveSessionState(input.worktree, input.sessionID, state)
}

function queueReseed(
  input: { client: Client; directory: string; worktree: string; sessionID: string },
  config: SuggesterConfig,
  _why: string,
): void {
  const key = input.worktree
  if (reseeding.has(key)) return
  const job = (async () => {
    try {
      const seed = await loadSeed(input.worktree)
      const trigger = await staleTrigger(input.directory, config, seed)
      if (!trigger) return
      await runReseed(input, config, trigger)
    } catch {
      // keep the last good seed
    } finally {
      reseeding.delete(key)
    }
  })()
  reseeding.set(key, job)
}

async function runReseed(
  input: { client: Client; directory: string; worktree: string; sessionID: string },
  config: SuggesterConfig,
  trigger: Parameters<typeof runSeeder>[0]["trigger"],
): Promise<void> {
  const state = await loadSessionState(input.worktree, input.sessionID)
  const result = await runSeeder({
    client: input.client,
    directory: input.directory,
    worktree: input.worktree,
    config,
    previous: await loadSeed(input.worktree),
    trigger,
    smallModel: smallModelByDir.get(input.directory),
  })
  state.usage = addUsage(state.usage, { seederCalls: 1, seederSteps: result.steps })
  await saveSeed(input.worktree, result.seed)
  await saveSessionState(input.worktree, input.sessionID, state)
}

async function publish(
  worktree: string,
  sessionID: string,
  text: string | null,
  state: Awaited<ReturnType<typeof loadSessionState>>,
  opts?: { count?: boolean },
): Promise<void> {
  const live: LiveSuggestion = {
    sessionID,
    text: text ?? "",
    status: text ? "ready" : "none",
    updatedAt: new Date().toISOString(),
  }
  state.lastSuggestion = text ?? undefined
  if (text && opts?.count !== false) {
    state.usage = addUsage(state.usage, { suggestionCalls: 1, suggestionChars: text.length })
  }
  await saveSessionState(worktree, sessionID, state)
  await saveLive(worktree, live)
}

function fallbackSuggestion(context: {
  latestAssistantTurn: string
  unresolvedQuestions?: string[]
}): string {
  const last = context.latestAssistantTurn.trim()
  if (context.unresolvedQuestions?.[0]) return "Yes."
  if (/\?\s*$/.test(last)) return "Yes."
  if (/restart|reload/i.test(last)) return "Restarted. What should I look for?"
  if (/look|check|try/i.test(last)) return "Checking now."
  return "Go ahead."
}

async function listMessages(client: Client, sessionID: string, directory: string): Promise<any[]> {
  if (!client.session.messages) return []
  const result = await sessionCall<any[]>(client.session.messages.bind(client.session), sessionID, {
    directory,
  })
  return Array.isArray(result) ? result : []
}

function inferTurnStatus(messages: any[]): TurnStatus {
  const latest = [...messages].reverse().find((message) => message?.info?.role === "assistant")
  if (!latest) return "success"
  const err = latest?.info?.error
  if (err) {
    const msg = typeof err === "string" ? err : err?.message ?? JSON.stringify(err)
    if (/abort|cancel/i.test(msg)) return "aborted"
    return "error"
  }
  const finish = latest?.info?.finishReason ?? latest?.info?.finish_reason
  if (typeof finish === "string" && /abort|cancel/i.test(finish)) return "aborted"
  return "success"
}
