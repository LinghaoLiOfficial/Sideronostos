# Independent Field Shift adversarial review

Review date: 2026-11-12 (Asia/Shanghai). Scope: the isolated `codex/field-shift` worktree and `FIELD_SHIFT.md`; farmer field/history → environment → constrained comparison → immutable saved evidence. Review only: no product code changed by this reviewer.

## Material findings

| Priority | Finding and evidence | Required correction / status |
|---|---|---|
| P1 | A late environment refresh can write one field's observations into the newly selected field/account cache. In `workspace.tsx`, the original `refresh` mutation used `onSuccess: value => client.setQueryData(environmentKey, value)`, where options change on rerender. A read-only reproduction with the installed TanStack `MutationObserver` started under key A, changed options while pending, and completed with A's fingerprint: key A remained empty and key B contained A's data. | **RESOLVED.** Mutation variables capture owner/field/version/location/navigation/cache key. Completion writes only the originating key; pending/error state is shown only in its matching context. Four regressions cover field/account switches with success/failure; independently rerun successfully. |
| P1 | Frontend follow-up found that a completed analysis could navigate back after the entire workspace page had unmounted, before the session query was collected. A location/owner check alone did not invalidate that continuation. | **RESOLVED.** Workspace cleanup increments the navigation sequence used by the shared current-request guard. The frontend owner added the failing unmount regression before the fix; this reviewer independently reran it in the final focused suite below. |
| P2 | Late field save / analysis completion can remove newer unsaved input. `FieldForm.submit` and `PlanningForm.submit` originally called `draft.clear()` unconditionally after `await`; controls remain editable while pending. Leaving and reopening the same field allows a fresh draft under the same session key, which the old continuation can delete. This violates draft recovery on a subsequent reload even if the current component still displays a fallback value. | **RESOLVED.** `clearIfUnchanged(submitted)` compares the stored draft with the submitted value before removal. Two unmount/reopen/late-completion regressions preserve the later draft. Submitted field/planning controls, save-dialog inputs and scenario sliders are disabled while their matching request is pending. |

The already identified save-response, auth-return-path and print-details work was excluded from this findings list to avoid duplication; the later page-unmount case is recorded separately above. No new P0 issue was identified. The findings above are resolved, with no remaining material finding identified in this bounded review. The root's separate final production/browser/print verification is linked below.

## Independent follow-up verification

After the frontend owner's changes, this reviewer re-read every workspace mutation (`refresh`, generation, field persistence/reload and plan save), session/field query keys and both form continuations. Request results retain their originating owner; current-view effects check identity/navigation, including invalidation when the workspace unmounts. Field cache updates cannot replace a greater stored version. Late field saves no longer reset a new field's refresh; reload state has an unmount/request guard. The save dialog binds owner, location, field version and dialog sequence. The draft comparison protects edits made after the submitting form was unmounted.

Independently executed from `sideronostos-frontend` at local test time **2026-11-12 00:33:28**:

```sh
node_modules/.bin/vitest run src/components/field-shift/workspace.test.tsx src/components/field-shift/journey.test.tsx
```

Result: **25 passed** (14 workspace, 11 journey), two test files, 1.85 seconds. This includes the four refresh outcomes, late generation state, workspace-unmount guard, old save/new refresh interaction, newer-version preservation, and two newer-draft regressions. This reviewer did not change product code and does not claim to have executed the root's later full-suite or browser checks.

## Final verification handoff

The root verifier subsequently reported **166 frontend tests and 166 backend tests passing**, frontend production build/lint/TypeScript success, and changed-backend lint/typing success. Final production comparison and mobile saved-plan axe scans each record **zero violations and zero incomplete items**. The root exercised a new field and saved plan through the real UI, retained its complete JSON, inspected the production screenshots, and visually checked the four-page printed plan. The original sample's immutable snapshot after browser reload, field edit and API restart remains verified.

These later results are documented in [product QA](product-qa.md), [browser quality](browser-quality.json), [new production plan](production-saved-plan.json) and [browser performance](browser-performance.json). Five warm full navigations per state measured readiness median/P95 of 74/107 ms for field, 75/124 ms for comparison and 74/126 ms for saved plan. These are same-machine local observations, not deployed performance or real-phone usability. Existing whole-backend Ruff 51, mypy 7 and three schema discrepancies remain documented in [backend verification](backend-verification.md). No open critical finding remains within the local demonstration scope; no deployment-readiness or locally validated agronomic claim is made.

## Backend and evidence boundaries examined

- Every private Field Shift route requires the verified principal. Service field/analysis/plan lookups constrain `owner_user_id`; owner IDs cannot be supplied through the extra-forbidden request contracts. Foreign objects return 404. Field writes use an atomic expected-version condition; analysis rechecks the authoritative version after environmental retrieval/calculation.
- History years are unique, known-crop validated and must precede the planning start. Three annual slots, per-year constraints and three-year comparison totals remain explicit. No claim of locally validated agronomy was inferred from the word “feasible.”
- Saved plans select the server-computed feasible option, retain the exact original field and full analysis/profile/environment/input snapshots, and use a unique owner/analysis/option constraint for duplicate saves. Existing local API evidence in `runtime-api.json` verified exact snapshots and unchanged original records after repeated calculations; this review did not rerun database tests or restart services.
- Date/location/quality checks and demo-versus-observed boundaries were read against the adapter and engine. The explicitly declared unconfirmed region, annual-crop scope and demonstration crop parameters are product boundaries, not defects.

## Rendered inspection

Inspected the actual saved screenshots `output/playwright/mobile-no-feasible.png`, `mobile-field-draft.png` and `desktop-environment.png`. The visible mobile states retain their primary action/status, labels and draft-restoration notice without horizontal text overflow. The desktop environmental chart has labeled axes/units, dated regional-data provenance, a retrievable table and explicit unavailable soil/vegetation facts. No additional material visual defect was identified in these images. Screenshots do not establish keyboard behavior, full-page mobile navigation, every error state, production rendering or real-user usability; the root verification owns those gates.

The component necessity pass found the inspected field inputs, environmental chart/table, no-feasible recovery action and evidence/limitation details directly support farmer decisions or recovery. No material extra component was recommended for removal.
