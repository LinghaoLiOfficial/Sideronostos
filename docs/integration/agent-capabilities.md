# Farmer agent action capability inventory

This inventory describes the agent integration branch. The multi-agent workspace
exposes an OpenAPI-derived, allowlisted executor for every current HTTP operation
under the field, remote-sensing, and rotation module prefixes. The server
dispatches through existing business routers with the verified caller's
identity; those services scope reads and writes to `user.id`.

| Module | Operations in the generic executor | Guided actions |
| --- | ---: | --- |
| Field management (`/field-shift`) | 14 | Create owned field |
| Remote sensing (`/agri-data`) | 6 | Open published layer; read selected observation |
| Rotation (`/rotation-optimizer`) | 19 | Generic executor; no task-specific guided form yet |
| Local agriculture | 0 | Published product-help KB and fixed web-search preset; no business API exists |

Local crop prices and varieties remain labeled mock examples; there is no trusted
current local data API. The map's browser-local farm object is distinct from a
saved Field Shift field.

## Action core contract

`AgentActionService.advance(session, owner_user_id, conversation_id, request,
pending=None, language="en")` accepts a typed `ActionRequest`, then returns an
`ActionOutcome`. Only `field.create`, `remote_sensing.layer`, and
`remote_sensing.fact` are registered. Other names fail schema validation. The
caller must derive `owner_user_id` from verified authentication and retrieve
`pending` from the same owned conversation; a client-supplied pending object is
not authoritative. The `needs_input` outcome includes missing field names and a
serializable pending state for the next turn. Validation failures retain that
state so corrected inputs can resume.

The authenticated HTTP boundary is
`POST /farm-assistant/conversations/{conversation_id}/actions` with
`{action, arguments, idempotency_key}`. Repeat the same key and action with
new required arguments to resume. `GET .../actions` lists the 50 newest
persisted action outcomes, including pending prompts; `GET .../actions/{key}`
retrieves one outcome. The server ignores any client-supplied pending state.
The database journal serializes operations by locking the owned conversation,
stores the merged arguments, payload hash, outcome, and timestamped audit
events, and rejects key reuse with different inputs after success. Field
creation uses the existing `FieldShiftService` validation with its commit
deferred; the field row and action result commit in one transaction. The
deterministic field ID also ties the write to the owner, conversation, and key.
Real PostgreSQL tests cover concurrent duplicate requests and rollback before
commit. No model-generated HTTP path or URL is executed.

Successful field creation links to `/field-shift?field=<UUID>&step=field`.
Published layer manifests link to `/field-shift/map?layer=<id>`. Available
selection facts link to `/field-shift/map?selection=<id>` with `obsStart` and
`obsEnd` when provided. These query parameters are consumed by the existing
workspaces. A missing published fact, validation failure, or owner-denied
lookup has no success link. The backend confirms each result before a link is
returned. No arbitrary URL is accepted from an LLM.

## Generic module executor

`GET /farm-assistant/conversations/{id}/operations` returns the current
module's OpenAPI operations, titles, schemas, and required inputs. `POST` to
the same route asks for missing inputs before dispatch, forwards the caller's
authentication to the exact registered ASGI route, and journals the payload
and outcome under an idempotency key. `GET .../operations/history` restores
recent outcomes after refresh. A completed call returns a local result link
and a browser-generated screenshot of the completion card. HTTP 202 remains
`pending` with a progress link and no completion screenshot.

The water specialist can use all remote-sensing operations. The soil and
weather specialists retain their scoped guided actions; generic operations
are blocked for them so they cannot retrieve the other specialty's data
through an unfiltered business endpoint. The catalog is an explicit operation
picker with JSON input for complex request bodies. It does not infer
operations from free chat prose.

## Bot identity and entry points

`/si/multi-agent` and the four `/si` module docks share the six identities in
`sideronostos-frontend/src/lib/bot-catalog.ts`. The server stores `bot_id` on
each owned conversation and validates its preset. Existing conversations are
backfilled to the default identity for their preset. Each workspace identity
has separate new-chat and history controls; the module docks load only the
selected identity's conversation. English is the default, and the Chinese
preference persists in the browser and conversation.

Remote water can use published surface soil moisture, historical rainfall, and
historical reference ET₀. Remote soil is limited to SMAP surface soil moisture;
remote weather is limited to historical rainfall and reference ET₀ and cannot
claim a forecast. The server filters context and retrieval sources and checks
action metrics and layer products, even for requests that bypass the UI. The
workspace shows only the corresponding guided action choices. Published data
may be unavailable for a selection; neither specialty creates an observation.

The four SI module routes are still placeholder pages. Their bottom-right
docks now support authenticated chat, source viewing, and voice draft entry;
guided actions are available in the multi-agent workspace. The existing
functional `/fields` and rotation assistants are unchanged.

## Verification and remaining gates

- A dedicated local browser smoke uses real assistant, knowledge, field,
  remote-sensing, and rotation HTTP handlers with PostgreSQL. It verifies a
  sourced answer, field creation and reopen, operation history restoration,
  remote layer listing, rotation profile listing, and local-knowledge chat.
  The identity is synthetic, the KB is explicitly mock, and the web preset
  may return no external hit. A separate browser component test mocks API
  replies.
- Catalog coverage checks all 39 operation schemas, and an offline transport
  test dispatches each operation to a simulated registered route using its
  OpenAPI input shape. Every stateful operation has not yet completed an
  independent live business run. Rotation jobs and
  published satellite layers require their own data releases, workers, and
  scenario inputs for a complete operational matrix.
- Free-text intent routing is not implemented; chat prose alone cannot trigger
  a write. The workspace has a generic operation picker and three guided
  actions; module docks remain chat-only. A production AI provider and real
  agronomic corpus have not been configured or evaluated.

The checked-in browser evidence is under `docs/integration/evidence`:
`assistant-field-completion.png`, `assistant-field-result-page.png`,
`assistant-remote-sensing.png`, `assistant-rotation.png`, and
`assistant-local-knowledge.png`. These show synthetic test-user data, not a
production deployment.
