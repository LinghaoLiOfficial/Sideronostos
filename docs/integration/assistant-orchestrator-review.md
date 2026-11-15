# Assistant request path review

Date: 2026-11-15. Baseline: `51fe1eb` on `feat/agent-bot-catalog-integration`.

## Current path

1. Both chat surfaces submit `{client_message_id, text, context}` to `POST /farm-assistant/conversations/{id}/messages`. `AssistantService.start_message` loads the owned conversation, deduplicates the message, freezes the currently selected owned field, map, run and published observations, and saves a pending message with a deadline.
2. `process_message` loads a bounded conversation history. The phase-one `field-guide` create flow is a special early branch. Other text calls `collect_evidence`, which routes greetings or product help, otherwise retrieves the pinned KB release, owned facts and a preset web search. `generate_answer` uses the offline mock or a structured model, then server-side citation and action validation. The response is stored on the message and restored after reload.
3. Guided controls call the three typed actions (`field.create`, `remote_sensing.layer`, `remote_sensing.fact`) or the generic module operation endpoint. `ModuleToolExecutor` builds a registry from the current OpenAPI routes: 14 field, 6 remote sensing and 19 rotation operations. It dispatches only registered same-process routes with caller authentication and records an idempotent outcome. The local knowledge module has no business operation.
4. Before phase one, free chat only performed evidence retrieval and answer generation. The phase-one field flow calls `field.create` from chat after explicit confirmation, but that special case does not yet provide general tool selection for the other module interfaces. The generic operation picker also lets a user execute writes directly without a chat confirmation step. The soil and weather specialists are blocked from generic remote-sensing operations because their data responses would otherwise escape specialist filtering.

## Changes required

- One server-owned bot configuration and tool registry should determine scope, rather than trusting a proposed path or URL from a model.
- An intent planner should distinguish information, local data, published external data, actions and mixed tasks. Its output is a candidate operation plus validated parameters, never a result claim. The existing `collect_evidence` remains the information path.
- A durable workflow record must accumulate missing inputs and explicit confirmation for every chat write. The operation executor retains the authorization and idempotency boundary. A 202 outcome remains pending until the business result is confirmed.
- Completed actions need a verified result URL and a protected screenshot of a loaded result page. The current phase-one screenshot service covers saved field results only.
- The 39 contracts already have catalog and simulated transport tests. Live business execution, job completion, download and image validation need separate fixtures and outcome evidence. Existing first-turn question evaluation cannot be counted as operation acceptance.

## Trust boundaries

The browser supplies an intent and context reference. The server owns the conversation, scope, catalog, parameters, auth and result URL. Knowledge and web snippets are untrusted evidence; account records and released observations are queried through their existing services. No model or mock output may select an arbitrary HTTP path, cross an owner's field, or bypass a write confirmation.
