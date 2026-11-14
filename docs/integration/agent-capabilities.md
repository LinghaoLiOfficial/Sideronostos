# Farmer agent action capability inventory

This inventory describes the backend on `main` at `bce7d46` and the action core in
`farm_assistant/agent_actions.py`. A route is not an agent tool merely because it
exists. All private API routes require a verified user; their services scope reads
and writes to the authenticated `user.id`.

| User-facing capability | Existing API | Agent core |
| --- | --- | --- |
| List field profiles and demo assumptions | `GET /field-shift/profiles` | Pending |
| List owned fields | `GET /field-shift/fields` | Pending |
| Create an owned field | `POST /field-shift/fields` | `field.create` core; integration pending |
| Read an owned field | `GET /field-shift/fields/{id}` | Pending |
| Edit an owned field with expected version | `PATCH /field-shift/fields/{id}` | Pending |
| Read or refresh field environment | `GET /field-shift/fields/{id}/environment` | Pending |
| Create and read field analysis | `POST /field-shift/fields/{id}/analyses`, `GET /field-shift/analyses/{id}` | Pending |
| List, save, and read field plans | `GET /field-shift/plans`, `POST /field-shift/plans`, `GET /field-shift/plans/{id}` | Pending |
| Create a remote sensing selection | `POST /agri-data/selections` | Pending; write needs idempotency |
| Read owned selection | `GET /agri-data/selections/{id}` | Pending |
| Request a specific published selection fact | `GET /agri-data/selections/{id}/facts` | `remote_sensing.fact` core; integration pending |
| List published layers | `GET /agri-data/layers` | Pending |
| Request a specific published layer manifest | `GET /agri-data/layers/{id}/manifest` | `remote_sensing.layer` core; integration pending |
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

For `field.create`, pass a persistent `ActionJournal` implementation that
serializes requests by `(owner_user_id, conversation_id, idempotency_key)`,
records the payload hash and outcome, and rejects key reuse with different
inputs. The core refuses a write when this journal or a key is absent. Its
service call is the existing `FieldShiftService.create_field`, which commits
internally. A crash after that commit and before the journal records the
outcome can produce a duplicate on retry. Closing that gap requires a database
transaction/idempotency migration in the integration slice; this branch does
not claim crash-safe exactly-once writes or expose an HTTP action endpoint.
The journal should retain a timestamped audit record of attempted, succeeded,
failed, and replayed writes without logging secrets or raw model prose.

Successful field creation links to `/field-shift?field=<UUID>&step=field`.
Published layer manifests link to `/field-shift/map?layer=<id>`. Available
selection facts link to `/field-shift/map?selection=<id>` with `obsStart` and
`obsEnd` when provided. These query parameters are consumed by the existing
workspaces. A missing published fact, validation failure, or owner-denied
lookup has no success link. The backend confirms each result before a link is
returned. No arbitrary URL is accepted from an LLM.

## Integration gates still open

- Persist action state and audit in the owned assistant conversation; wire a
  typed endpoint or message path to this core and authenticate it.
- Add a durable idempotency ledger and close the field-service commit gap.
- Exercise field creation and remote sensing through the actual authenticated
  browser journey, including refresh, duplicate retry, owner isolation, and
  links opening the correct result.
- Preserve existing assistant source/semantic evaluations and worker/DB gates.
