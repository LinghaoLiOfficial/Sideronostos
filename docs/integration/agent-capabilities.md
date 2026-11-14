# Farmer agent action capability inventory

This inventory describes the backend on `main` at `bce7d46`, the conversation
domain slice at `b14daba`, and this action integration. A route is not an agent
tool merely because it exists. All private API routes require a verified user;
their services scope reads and writes to the authenticated `user.id`.

| User-facing capability | Existing API | Agent core |
| --- | --- | --- |
| List field profiles and demo assumptions | `GET /field-shift/profiles` | Pending |
| List owned fields | `GET /field-shift/fields` | Pending |
| Create an owned field | `POST /field-shift/fields` | `field.create` HTTP action |
| Read an owned field | `GET /field-shift/fields/{id}` | Pending |
| Edit an owned field with expected version | `PATCH /field-shift/fields/{id}` | Pending |
| Read or refresh field environment | `GET /field-shift/fields/{id}/environment` | Pending |
| Create and read field analysis | `POST /field-shift/fields/{id}/analyses`, `GET /field-shift/analyses/{id}` | Pending |
| List, save, and read field plans | `GET /field-shift/plans`, `POST /field-shift/plans`, `GET /field-shift/plans/{id}` | Pending |
| Create a remote sensing selection | `POST /agri-data/selections` | Pending; write needs idempotency |
| Read owned selection | `GET /agri-data/selections/{id}` | Pending |
| Request a specific published selection fact | `GET /agri-data/selections/{id}/facts` | `remote_sensing.fact` HTTP action |
| List published layers | `GET /agri-data/layers` | Pending |
| Request a specific published layer manifest | `GET /agri-data/layers/{id}/manifest` | `remote_sensing.layer` HTTP action |
| View authenticated layer tile | `GET /agri-data/layers/{id}/tiles/{z}/{x}/{y}` | Opened by the existing map, not an agent tool |
| Rotation profiles, releases, availability, preflight | `GET /rotation-optimizer/profiles`, `GET /rotation-optimizer/data-releases`, `GET /rotation-optimizer/data-releases/{id}`, `GET /rotation-optimizer/data-releases/{id}/availability`, `POST /rotation-optimizer/preflight` | Pending |
| Rotation run create, list, read, export, cancel, retry | `POST /rotation-optimizer/runs`, `GET /rotation-optimizer/runs`, `GET /rotation-optimizer/runs/{id}`, `GET /rotation-optimizer/runs/{id}/export`, `GET /rotation-optimizer/runs/{id}/export.csv`, `POST /rotation-optimizer/runs/{id}/cancel`, `POST /rotation-optimizer/runs/{id}/retry` | Pending; writes require explicit intent and idempotency |
| Rotation plan save, list, read, compare | `POST /rotation-optimizer/plans`, `GET /rotation-optimizer/plans`, `GET /rotation-optimizer/plans/{id}`, `POST /rotation-optimizer/compare` | Pending |
| Local agricultural rules and expert knowledge | Existing assistant knowledge retrieval | Answer-only; no action tool yet |
| Local crop prices and varieties | No current trusted local data API | Mock only, labeled as mock; no real-price or real-variety claims |
| Map farm edits on `/fields` | Browser local storage on current `main` | Unsupported by backend agent; a Field Shift field is a different record |

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

## Integration gates still open

- Integrate guided action controls with the conversation UI. Free-text intent
  routing is not implemented; chat prose alone cannot trigger a write.
- Verify the authenticated browser journey across refresh, duplicate retry,
  owner isolation, and result link navigation. PostgreSQL HTTP tests cover the
  backend portions, but are not a browser test.
- Add other existing operations one typed tool at a time after reviewing write
  permissions and idempotency semantics.
- Preserve existing assistant source/semantic evaluations and worker/DB gates.
