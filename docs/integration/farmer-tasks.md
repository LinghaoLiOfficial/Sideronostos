# Farmer tasks in the six bot conversations

The entry points are `/si/multi-agent` and each module's chat dock. The farmer
chooses the job, supplies only the information that job needs, and opens the
confirmed result. The primary UI does not expose HTTP verbs, endpoint paths,
record identifiers, JSON bodies, or an operation catalogue.

| Bot | Tasks and working destinations |
| --- | --- |
| Field guide | Browse/search fields by name; add a field; edit its details with version checks; open planting history and environmental conditions; browse saved planting plans; open the farm boundary workspace. |
| Water specialist | Pick a saved field, observation and optional date range; read published moisture, rainfall or reference evapotranspiration; open a published map. |
| Soil specialist | Pick a saved field and optional date range for surface moisture; open SMAP maps only. |
| Weather specialist | Pick a saved field and date range for historical rainfall or reference evapotranspiration. No forecast control is offered. |
| Rotation guide | Browse saved plans and calculations; open progress; confirm cancellation; retry eligible calculations; download schedules; save a feasible result option by name; select two named saved plans for the existing comparison workspace; open the full planner for a new plan. |
| Local knowledge | Submit a question with region and crop through the existing evidence pipeline. Missing evidence asks for a source rather than requesting the supplied region and crop again. |

## User experience and integrity

- One task panel replaces the two overlapping tool surfaces. Forms have English
  and Chinese labels, native validation and visible keyboard focus. Dock tasks
  have one scroll container; confirmed results return to the top.
- Location can come from a saved field or the device location with the farmer's
  browser permission. Coordinate entry remains available. A field without a
  boundary is explicitly checked as a point.
- Crop settings are selected by name, with example data identified. Existing
  planting history and geometry are retained during a details edit.
- Unsaved input is retained in session storage, scoped to account, bot and
  conversation. Browser storage restrictions do not prevent task execution.
- A lost response keeps the exact request and journal key for retry. A successful
  result is restored only after checking the owned backend journal. Accepted jobs
  remain pending and link to progress; unavailable observations have no success
  link or screenshot.
- Completion cards link to the saved record and provide a downloadable screenshot
  of the completion summary. This is not a screenshot of the destination page.
- Field polygon editing, crop-history editing, new planning, and comparisons use
  their existing full workspaces. These workflows require richer decisions than
  a small chat form; no agronomic inputs are silently invented to launch a run.

## Verification

`farmer-tasks.test.tsx` exercises named records, scoped observation payloads,
zero-valued observations, missing fields, interrupted creation and refresh,
owner isolation, versioned edits preserving history, cancellation confirmation,
pending status and local-question failure recovery. The existing workspace and
dock suites verify integration.

The maintained `assistant-live.spec.ts` uses the real assistant and business HTTP
handlers with a dedicated PostgreSQL test database and synthetic identity. It
checks both original chat questions, field creation/edit/reopen, restored results,
all three observation specialists, rotation entry points, local questions and all
six docks. `assistant-completed.spec.ts` separately checks the completion image
with controlled responses. Desktop and mobile runs use the configured browser
channel. Screenshots are written to `sideronostos-frontend/output/playwright`.

The demo still uses mock knowledge without an external LLM credential. Empty
satellite releases and an empty rotation job history exercise honest empty states;
these checks do not establish successful processing of every satellite product or
every live rotation scenario. New planning, comparison science and worker execution
retain their existing workspace validation and tests.

For an isolated frontend preview, set `NEXT_OUTPUT_DIR=.next-farmer-tasks` and
`NEXT_PUBLIC_API_BASE_URL` to the intended backend before starting Next. The default
output directory remains `.next`; alternate `.next-*` outputs are ignored by Git.
