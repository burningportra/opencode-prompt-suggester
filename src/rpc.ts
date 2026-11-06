import { Rpc } from "@opencode/plugin/rpc"

const sessionInput = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
  },
  required: ["sessionID"],
  additionalProperties: false,
} as const

const suggestionOutput = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    suggestion: { type: "string" },
    status: { type: "string" },
  },
  required: ["sessionID", "suggestion", "status"],
  additionalProperties: false,
} as const

const configureInput = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    enabled: { type: "boolean" },
  },
  required: ["sessionID", "enabled"],
  additionalProperties: false,
} as const

const statusOutput = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    suggesterModel: { type: "string" },
    seedReady: { type: "boolean" },
    suggestion: { type: "string" },
    status: { type: "string" },
  },
  required: ["enabled", "suggesterModel", "seedReady", "suggestion", "status"],
  additionalProperties: false,
} as const

export const PromptSuggester = Rpc.define({
  id: "prompt-suggester",
  events: {},
  methods: {
    get: {
      input: sessionInput,
      output: suggestionOutput,
    },
    refresh: {
      input: sessionInput,
      output: suggestionOutput,
    },
    clear: {
      input: sessionInput,
      output: suggestionOutput,
    },
    status: {
      input: sessionInput,
      output: statusOutput,
    },
    configure: {
      input: configureInput,
      output: statusOutput,
    },
    reseed: {
      input: sessionInput,
      output: statusOutput,
    },
  },
})
