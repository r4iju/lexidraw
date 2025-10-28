## Audit: LLM Configuration and Context (current state)

### Scope

- **Primary**: `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx`, `apps/lexidraw/src/app/documents/[documentId]/plugins/ToolbarPlugin/llm-config.tsx`
- **Related**: `apps/lexidraw/src/server/api/routers/config.ts`, `apps/lexidraw/src/app/documents/[documentId]/context/settings-context.tsx`, chat plugins that call the LLM (`use-send-query.ts`, `use-slide-creation-workflow.ts`), autocomplete path (`src/hooks/use-autocomplete-engine.ts`), and the mount site for the provider (`document-editor.tsx`).

### High-level overview

- **LLMProvider**: Client-side React context that holds user LLM configuration (model, provider, temperature, max tokens) and exposes chat generation APIs (text + streaming, with optional tools). It instantiates provider SDK clients using API keys from user/server config.
- **LlmModelSelector (Toolbar)**: UI control to toggle Chat/Autocomplete, set temperature/max tokens, and pick models. It updates the context config and persists via tRPC after a debounce.
- **Persistence**: Server stores structured config under `config.llm` (and a separate `config.autocomplete` for the simpler autocomplete engine). Updates flow through `api.config.updateLlmConfig` and are merged server-side.
- **Autocomplete**: The LLMContext’s autocomplete path is deprecated. A separate `useAutocompleteEngine()` uses a server action and `config.getAutocompleteConfig`.

### Key files and responsibilities

- **`llm-context.tsx`**

  - Exposes: `llmConfig`, `setLlmConfiguration`, `generateChatResponse`, `generateChatStream`, `availableModels`, `getProviderInstance`, and legacy autocomplete-related helpers/state.
  - Manages provider instances via `@ai-sdk/google` and `@ai-sdk/openai`, pulling API keys from `initialConfig`.
  - Saves config via `api.config.updateLlmConfig` with a 2s debounce.
  - Implements prompt construction with optional file parts for multimodal inputs.
  - Provides a hardcoded `availableModels` list (OpenAI GPT‑5 tiers, Gemini 2.x tiers).

- **`llm-config.tsx` (Toolbar LlmModelSelector)**

  - UI to enable Chat/Autocomplete (via `useSettings`), adjust temperature and max tokens, and switch model/provider from `availableModels`.
  - Calls `setLlmConfiguration` to update context + trigger debounced persistence.
  - Caps `maxOutputTokens` in the UI by provider (OpenAI 32,768; Google 65,535).

- **`server/api/routers/config.ts`**

  - Schemas: `LlmBaseConfigSchema`, `LlmConfigSchema`, `PatchSchema` (zod).
  - Endpoints: `getConfig()` returns merged defaults + user config. `updateLlmConfig()` merges and persists under `config.llm` and returns the new (validated) config.
  - Separate, richer path for autocomplete: `getAutocompleteConfig()` and `updateAutocompleteConfig()` with distinct defaults and constraints tailored to the server action engine.

- **`settings-context.tsx`**

  - Stores local UI settings in `localStorage` (e.g., enable/disable Chat/Autocomplete) via `useSettings()`. Not persisted server-side.

- **Consumers**
  - `use-send-query.ts`: Chat assistant and Agent flows use `generateChatStream` (plain chat) and `generateChatResponse` (tools, steps), reading from `llmConfig.chat` for temperature/tokens. Supports files and limited agent planning.
  - `use-slide-creation-workflow.ts`: Multi-step tool-driven workflow exclusively uses `generateChatResponse` with tools, step orchestration, and retry semantics.
  - `AutocompletePlugin/LLMWidget.tsx`: Displays error state from `autocompleteState` or `chatState`.
  - `document-editor.tsx`: Mounts `<LLMProvider initialConfig={initialLlmConfig}>` inside provider tree next to other feature providers.

### Data flow and relationships

- **Initial load**

  - `document-editor.tsx` obtains `initialLlmConfig` server-side (tRPC `getConfig()`) and mounts `LLMProvider` with it.
  - `LLMProvider` seeds internal `llmConfig` state.

- **UI → context → server**

  - User changes in `LlmModelSelector` call `setLlmConfiguration({ chat | autocomplete: partial })`.
  - Context merges changes into `llmConfig`, applies per-provider token caps (OpenAI only, client-side), and schedules a debounced save.
  - Debounced save calls `api.config.updateLlmConfig.mutate(payload)`. Server merges into persistent `config.llm` and returns the full merged config (as a Patch shape).

- **Server → client after save**

  - On mutation success, context currently updates `autocompleteState` and `chatState` with fields from the returned config, but does not update `llmConfig` directly.
  - This introduces potential divergence between `llmConfig` (source of truth for generation) and the state objects used for UI error/status.

- **Generation**
  - `generateChatStream`: Direct text streaming; ignores tool calls in the stream; supports optional files via `buildPrompt()` and `ai.streamText`.
  - `generateChatResponse`: Non-streaming; supports tools, step orchestration (`prepareStep`), and optional `repairToolCall`; uses `ai.generateText`.
  - Both use `chatProvider.current(llmConfig.chat.modelId)` from the provider instance created with API keys.

### State and persistence boundaries (current issues)

- **Config vs runtime state leakage**

  - On `updateLlmConfig` success, the code spreads server-returned config into `chatState`/`autocompleteState` (which are meant for runtime error/streaming flags). This mixes config fields (e.g., `modelId`, `provider`, `maxOutputTokens`) into non-config state objects.
  - `llmConfig` itself is not refreshed from the server response after save; it only relies on the pre-save local merge, which can drift from server-enforced defaults.

- **Duplicate/fragmented config setters**

  - `setLlmConfiguration` updates `llmConfig` and persists (debounced).
  - `setChatLlmOptions`/`setAutocompleteLlmOptions` update `chatState`/`autocompleteState` and persist, but do not update `llmConfig`.
  - Result: multiple code paths to “change config” with different local effects; easy to create race conditions or UI desync.

- **Debounce durability**
  - Debounced save is 2s and there is no explicit flush on unmount/route change. Edits made shortly before navigation risk being dropped.

### Model/provider handling

- **Static model list**: `availableModels` is hardcoded (GPT‑5 family; Gemini 2.x). There’s no server-driven source of truth or capability discovery.
- **Token caps duplicated**: Caps exist both in `LlmModelSelector` (OpenAI 32,768; Google 65,535) and in `llm-context` (OpenAI cap applied when merging). Server defaults in `getConfig()` allow `chat.maxOutputTokens: 100_000` for Google, which differs from UI caps.
- **Providers/keys**: Clients are created client-side with API keys from `initialConfig` (potentially user-provided). This intentionally exposes keys in the browser if present.

### Chat flows: how call sites use the context

- **Chat mode (`use-send-query.ts`)**

  - For chat: uses `generateChatStream` and streams text into UI; uses `llmConfig.chat.temperature` and `maxOutputTokens`.
  - For agent: plans a subset of tools, then uses `generateChatResponse` with steps and tool displays, including a retry path with a fallback subset.
  - Handles attached files via prompt and `files` array (the context turns files into `FilePart`s for the SDK).

- **Slides workflow (`use-slide-creation-workflow.ts`)**
  - Multi-step process uses `generateChatResponse` exclusively with required/auto tool selection and retries. No streaming path.
  - Steps expect deterministic tool call patterns and surface tool displays to the chat timeline for traceability.

### Autocomplete path (separate system)

- `useAutocompleteEngine()` fetches a distinct `config.autocomplete` document via tRPC, then calls a server action (`runAutocomplete`). It is decoupled from `LLMProvider` and the deprecated `generateAutocomplete()`.
- Toolbar’s Autocomplete toggle uses `useSettings` (localStorage only), not the server autocomplete config. This is intentionally lightweight UI state, not global persistence.

### UI surface considerations

- **Tabs restricted**: `LlmModelSelector` renders only the Chat tab (`onValueChange` ignores `autocomplete`). UI implies multi-mode but is functionally Chat-only.
- **Enable toggles**: Chat/Autocomplete enablement is controlled by `useSettings` (localStorage), not persisted per user on the server.
- **Input sanitation**: `Max Tokens` field strips non-digits and applies per-provider caps on blur; `Temperature` enforces [0,1].

### Error handling and observability

- **Chat**: Errors are caught and written into `chatState.error`; `LLMWidget` displays errors if present. Streaming path calls `callbacks.onError`.
- **Agent/steps**: Tools and step orchestration propagate errors, with a retry strategy in slide workflow. Errors are surfaced to the chat timeline.
- **Telemetry**: No centralized logging/metrics for usage, latency, token counts, or failure rates. Streaming exposes `finishReason` and `usage` internally but is not surfaced.

### Security and platform

- **API keys in client**: If user-specific `googleApiKey`/`openaiApiKey` are set, they are passed to the browser to initialize SDK clients. This is acceptable only if keys are intentionally user-owned and the UX expects client-side calls; otherwise consider a server-side proxy.
- **Provider limits**: There’s no centralized server-side validation for provider-specific limits; UI and client context enforce partial constraints.

### Risks and smells (prioritized)

- **Config/state conflation**: Mixing server config into `chatState`/`autocompleteState` and not updating `llmConfig` from server responses risks drift and subtle bugs.
- **Multiple setters**: `setLlmConfiguration` vs `setChatLlmOptions`/`setAutocompleteLlmOptions` diverge. Some call sites read `llmConfig`, others rely on state updates—can desync easily.
- **Debounced persistence without flush**: Potential for lost updates on quick navigation/close.
- **Duplicated token-cap logic**: Enforced in multiple places with different values; server defaults differ from UI caps.
- **Static model catalog**: Hardcoded list risks mismatch with provider availability or server policy.
- **Client-held API keys**: If keys are not intentionally user-provided for client use, this is a security concern.
- **Autocomplete UX inconsistency**: Toolbar advertises Autocomplete mode but disables it; separate engine/config may confuse users and devs.

### Refactor plan (based on decisions)

- **Unify config paths; remove drifting setters**

  - Make `llmConfig` the only client config state; stop spreading config into `chatState`/`autocompleteState`.
  - Remove `setChatLlmOptions` and `setAutocompleteLlmOptions`. Introduce a single `updateLlmConfig(partial, { mode: 'chat' | 'agent' | 'autocomplete' })` in context that updates `llmConfig` and persists.
  - On successful persist (`updateLlmConfig` tRPC), refresh `llmConfig` from the server’s normalized response to avoid drift.

- **Split Chat vs Agent configuration (separate defaults)**

  - Add an `agent` section to server config: `config.llm.agent: { modelId, provider, temperature, maxOutputTokens }`.
  - Update zod schemas and router (`LlmConfigSchema`, `PatchSchema`, `getConfig`, `updateLlmConfig`). Provide server defaults for agent.
  - Call sites: use `llmConfig.chat` for chat flows (`generateChatStream` in `use-send-query.ts`), and `llmConfig.agent` for agent flows (`generateChatResponse` in agent mode and in `use-slide-creation-workflow.ts`).

- **Server-enforced limits; remove client caps**

  - Enforce provider-specific caps server-side on both `getConfig` (normalize) and `updateLlmConfig` (validate + coerce). Return normalized values.
  - Remove client-side token-cap logic in `llm-context.tsx` and `llm-config.tsx`. UI simply displays current values; optional read-only hints can come from server.

- **Model selection policy: app-controlled, not user-selected**

  - Remove the Model dropdown from `LlmModelSelector`. The app (server) decides which model/provider to use per feature (chat/agent/autocomplete) via config defaults and policy.
  - ~Optionally keep a hidden dev flag to re-enable model pickers for internal testing.~

- **Toolbar scope**

  - Keep only on/off toggles for Chat and Autocomplete in the Toolbar (via `useSettings`).
  - Limit Chat controls to temperature and max tokens. Autocomplete config remains owned by the separate engine and not editable here.

- **Keys and call path migration (client → server)**

  - Implement server endpoints for generation (streaming and non-streaming) using server-held keys.
  - Update context to call these server endpoints for all chat/agent invocations immediately (no feature flags).
  - Remove client-side provider instantiation and any code paths that rely on browser-held keys. Keep per-user keys only if explicitly required and safe.

- **Debounce and persistence**

  - Keep 2s debounce for typing. Add an optional `flush()` on `pagehide`/unmount to minimize lost edits (decision pending). Ensure immediate save on blur for numeric inputs.

- **Cleanup and deprecations**

  - Remove deprecated `generateAutocomplete` from `llm-context.tsx`.
  - Update `LlmModelSelector` to Chat-only controls and hide the Autocomplete tab.
  - Rename `setLlmConfiguration` → `updateLlmConfig` for clarity; update all call sites.
  - Document that `generateChatStream` is text-only (no tools); all tool flows must use `generateChatResponse`.

### Phased implementation plan

- **Phase 0 — Prep and alignment (1–2 days)**

  - Inventory call sites using `useLLM`: `use-send-query.ts`, `use-slide-creation-workflow.ts`, Toolbar `llm-config.tsx`, provider mount in `document-editor.tsx`.
  - Confirm desired defaults for `chat`, `agent`, and `autocomplete` (tokens/temperature/models) with product.
  - Agree on server caps policy per provider (max output tokens and any temp bounds beyond [0,1]).
  - Acceptance criteria:
    - A short ADR in the repo summarizing decisions above.
    - Test-doc outlining which flows should use chat vs agent.

- **Phase 1 — Unify client config; remove drifting setters (1–2 days)**

  - Changes:
    - In `llm-context.tsx`, make `llmConfig` the single config state; stop spreading config into `chatState`/`autocompleteState` on save success.
    - Remove `setChatLlmOptions` and `setAutocompleteLlmOptions`; replace with `updateLlmConfig(partial, { mode })` that updates `llmConfig` and schedules persistence.
    - On mutation success, refresh `llmConfig` from the returned server config to avoid drift.
  - Affected files:
    - `context/llm-context.tsx` (state shape, setters, save flow)
    - Call sites referencing removed setters
  - Acceptance criteria:
    - Only `llmConfig` holds config; runtime states only track errors/streaming.
    - All existing UI updates still reflect latest config after save.

- **Phase 2 — Add Agent config to server and client types (1–2 days)**

  - Changes:
    - Server: Extend zod schemas and router: add `agent` to `LlmConfigSchema` and `PatchSchema`; update `getConfig` defaults and `updateLlmConfig` merge logic.
    - Client: Extend `LLMConfig` to include `agent`; update call sites to use `llmConfig.agent` in agent flows (`use-send-query.ts` agent branch, `use-slide-creation-workflow.ts`).
    - Provide safe fallback to `chat` if `agent` missing during migration.
  - Affected files:
    - `server/api/routers/config.ts` (schemas, defaults, update handler)
    - `context/llm-context.tsx`, agent call sites
  - Acceptance criteria:
    - Agent flows read from `llmConfig.agent`; chat flows remain on `llmConfig.chat`.
    - `getConfig()` returns validated `agent` section with defaults.

- **Phase 3 — Server-enforced caps; remove client caps (1 day)**

  - Changes:
    - Move provider caps to server: normalize values in `getConfig`; validate/coerce in `updateLlmConfig`.
    - Remove client-side capping in `llm-context.tsx` and `llm-config.tsx`.
  - Affected files:
    - `server/api/routers/config.ts` (normalization and validation)
    - `context/llm-context.tsx`, `plugins/ToolbarPlugin/llm-config.tsx`
  - Acceptance criteria:
    - UI shows server-normalized values; client contains no ad-hoc caps.

- **Phase 4 — Toolbar scope and model picker removal (0.5–1 day)**

  - Changes:
    - Remove the Model dropdown; keep only Chat temperature/tokens and the on/off toggles (Chat and Autocomplete via `useSettings`).
    - Ensure the Autocomplete tab is hidden; Toolbar remains Chat-focused.
  - Affected files:
    - `plugins/ToolbarPlugin/llm-config.tsx`
  - Acceptance criteria:
    - No model selection UI; only Chat controls and the enable toggles remain.

- **Phase 5 — Server proxy endpoints and immediate switch (2–3 days)**

  - Changes:
    - Implement server-side generation:
      - Non-streaming: a server action (e.g., `server/actions/llm/generate.ts`) wrapping `ai.generateText` with server-held keys.
      - Streaming: a route handler (e.g., `app/api/llm/stream/route.ts`) using `ai.streamText` and responding with `text/event-stream`.
    - Update `llm-context.tsx` to call these endpoints instead of using provider SDKs client-side. Remove client `createOpenAI`/`createGoogleGenerativeAI` instances and key usage.
    - Handle file uploads for multimodal calls via `FormData` to the route handler or server action.
  - Affected files:
    - `context/llm-context.tsx` (call sites, provider removal)
    - New server action/route handler files; optional tRPC wrappers if preferred
  - Acceptance criteria:
    - All chat/agent calls route through the server; no API keys in the browser.
    - Streaming chat works end-to-end with SSE.

- **Phase 6 — Cleanup, deprecations, and docs (0.5–1 day)**

  - Changes:
    - Remove deprecated `generateAutocomplete` from context.
    - Rename `setLlmConfiguration` → `updateLlmConfig` in code and docs.
    - Document that tool streaming is not supported in `generateChatStream`; tool flows use `generateChatResponse`.
  - Acceptance criteria:
    - No references to deprecated APIs remain; docs reflect final behavior.

- **Phase 7 — QA and observability (optional but recommended, 1–2 days)**
  - Add basic logging for generation errors and timings on the server; capture token usage where available.
  - Smoke tests for:
    - Chat streaming and error surfaces
    - Agent flows (tools invoked, retries) in `use-slide-creation-workflow`
    - Toolbar edits persisting and reflecting normalized values
    - Autocomplete unaffected (still via its server action)
  - Acceptance criteria:
    - No regressions in the editor chat or slides workflow; telemetry visible in logs.

### Notable implementation details and constraints

- **Files**: `buildPrompt()` converts `File[] | FileList` to `FilePart[]` for multimodal input; `use-send-query` also adds file names into the prompt text for context.
- **Abort**: Streaming respects `AbortSignal` and sets state accordingly. Response flow treats `AbortError`/`ExitError` specially to avoid false errors.
- **Tool orchestration**: `prepareStep` in agent mode can alter tool choice dynamically and emit system messages showing tool display info.

### Questions for the team

1. Are OpenAI/Google API keys intentionally user-supplied for client-side usage? If not, should we proxy all calls server-side and remove keys from the browser?

- yes. but let's add a plan to remove this server provide instead.

2. Should Chat and Agent share the same configurable model/temperature/tokens, or be separated (e.g., “agent defaults”)?

- separated

3. Where should provider-specific limits live (UI vs client context vs server)? My recommendation: server normalizes and returns computed caps.

- server

4. Do we want Toolbar to control Autocomplete, or is Autocomplete intentionally separate (server-action-based) and should be hidden here?

- toolbar and autocomplete are different concerns. only the on-off toggle should live in toolbar.

5. Is the hardcoded model list sufficient for now, or should we implement a server-provided catalog with gradual rollout and per-user gating?

- if the app controls which model is used for which feature this list will not be needed in the first place

6. Can we remove `setChatLlmOptions`/`setAutocompleteLlmOptions` and converge on a single config setter to prevent state drift?

- yes remove them

7. Do we need a persistence flush on route change/unmount to avoid dropped edits under the current debounce window?

- unknown

### Summary for a refactor plan (at a glance)

- Make `llmConfig` the single config state; remove drifting setters; refresh from server after saves.
- Add `config.llm.agent` and route agent flows to it; keep chat separate.
- Enforce provider caps on the server; UI displays normalized values only.
- Remove model picker from Toolbar; app/server selects models per feature.
- Keep Toolbar only for Chat controls (temp/tokens) and on/off toggles; Autocomplete config remains separate.
- Immediately route LLM calls via server proxy and remove client-held keys.
- Keep debounce; optionally add pagehide/unmount flush.
