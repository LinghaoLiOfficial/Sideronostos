# Fields, assistant and model v3 integration

Status: IN PROGRESS. No completion or production-readiness claim.
Base: main / 8c498cf. Branch: codex/fields-bot-model-v3.
Authoritative objective: all eight sections of the user's goal-objective.md (2026-11-14).
No push, remote merge or deployment is authorized.

## Outcome and preserved behavior

One farmer journey: local drawing or login → draw/import farm → review partition →
complete agronomic information → synchronize owned fields → inspect readiness →
calculate/compare → save → return to the same field and ask an evidence-bound assistant.
Keep MapLibre/TerraDraw, partition modes, imports/exports, GIBS, bot companion/dictation,
legacy records, ownership checks, frozen snapshots, cancellation and honest failure states.

## Authority and decisions

NASA-modeling.md is the v3 mathematical specification; external-data-requirements and
model-data-assessment define readiness. Adjacent-planting and net-irrigation specify
supporting calculations. Earlier MILP/notation documents are explanatory where consistent.

- Calendar: local agricultural dates, daily inclusive sow/harvest; occupied through the
  explicit turnaround end. Next sow must be strictly after that end. Count fallow and
  family-gap days explicitly, with tests at both boundaries. Unknown history retains its
  precision; never invent exact harvest dates.
- GDD: version the recipe with cultivar parameters. Do not change a recipe without its
  associated maturity threshold. Historical weather replay is a scenario, never a forecast.
- Water: ha × mm × 10 = m³. Net root-zone irrigation and gross diversion are separate.
  Candidate precomputation requires explicit initial depletion assumptions; it does not
  constitute a continuously linked multi-season soil-water simulation.
- Objectives: six raw metrics with explicit positive scales; weighted gap minimization
  has higher priority than the agronomic/economic score. Hard prohibitions cannot soften.
  Missing mandatory inputs block calculation. Only explicitly optional objectives can
  be disabled; missing metrics are unavailable rather than zero.
- Readiness: engineering benchmark and locally prepared farm are separate modes. The
  Iowa parameter/weather package is not the selected pilot, and geographic guards remain.
- State: GIBS date, observation window and planning horizon are independent. Server field
  IDs/versions, selection revisions and immutable run snapshots govern assistant context.
- Farm persistence: minimum owned farm identity + partition revision + field links +
  resource grouping now; full partition history and collaboration are deferred.
- Compatibility: legacy v1/v2 analyses and runs stay readable. Add version-dispatched v3
  contracts and calculations within rotation_optimizer rather than silently relabeling v2.

## Requirement → implementation → proof

FE = sideronostos-frontend/src. BE = sideronostos-backend/src/sideronostos_backend/modules.
Every row starts NOT VERIFIED; record actual evidence as work completes.

| Requirement / current gap | Files and implementation | Required proof | Status |
|---|---|---|---|
| Owned farms and stable local/server field identity; currently browser-only | BE/field_shift/{models,schemas,service,router}.py; new farm schemas/service; additive Alembic migration and installed model registration. Owner-derived farm key, partition revision, per-field idempotency, optimistic updates; preserve existing endpoints | Real DB parallel retry, changed-payload conflict, unauthorized access, partial retry, changed partition, reopen | NOT VERIFIED |
| Polygon/area/center consistency | BE/field_shift synchronization validation; existing agri_data geometry validation. Recompute geodesic geometry area and validate declared values within documented tolerance | Invalid/self-intersecting polygon, mismatched area/coordinates, valid holes, no silent ring loss | NOT VERIFIED |
| Anonymous and per-account drafts; non-destructive upgrade | FE/features/fields/storage.ts; FE/types/workspace.ts; add scoped storage tests. Preserve original stores, explicit legacy import, owner-bound write queues | Fake IndexedDB migration plus real browser refresh/account-switch and delayed-write checks | NOT VERIFIED |
| Field completion and sync UX | FE/features/fields/fields-workspace.tsx, new completion/sync panel and hook; reuse field-form.tsx and history-editor.tsx; FE/lib/api/field-shift*.ts | Confirm boundary ≠ synchronized ≠ ready; duplicate/partial submissions; reload server mapping | NOT VERIFIED |
| Temporary AOI and scientific evidence | FE/features/fields/field-map.tsx; shared rotation selection/date controller; existing rotation.ts API | Point/polygon/viewport querying without changing farms; date/revision race and missing-data evidence | NOT VERIFIED |
| Shared navigation/context and bot | FE/components/rotation/{workspace,workspace-state,assistant-dock}.tsx/ts; FE/features/fields/fields-shell.tsx; existing bot components | Same owned field/version across pages; run snapshots; stale actions; login return; desktop/mobile companion and dictation controls | NOT VERIFIED |
| Planner migration and old URL compatibility | FE/components/rotation/{planner-form,planning-model,results}.tsx/ts; /field-shift/map/page.tsx only after capabilities migrate; auth-shell and old workspace links | Existing plan/history reopen; no duplicate map; preserve deep-link query; static /agriculture assets intact | NOT VERIFIED |
| Versioned v3 input and source/readiness metadata | BE/rotation_optimizer/{requests,schemas,profiles,service}.py and focused v3 contract/readiness modules; FE API types and conditional form sections | Missing != zero; source/units/time/region/confirmation traced; unknown region blocked; engineering fixtures labelled | NOT VERIFIED |
| Scientific candidate generation incl root water | BE/rotation_optimizer/{prepare,candidates,coefficients,scientific_verify}.py and focused v3 science module | Hand-calculated GDD, ET0/Kc, storage/TAW/RAW/NIR, daily balance, initial-state limitations and historical date precision | NOT VERIFIED |
| Full v3 MILP and independent verification | BE/rotation_optimizer/{milp,solver,verify,execution}.py and version-specific model builder/verifier | Enumerated oracle, all-pair spacing, hard suitability, daily water/equipment, seed/market periods, cover/bare, six metrics and lexicographic slack priority | NOT VERIFIED |
| Durable jobs, bounded capacity and saved results | Existing optimizer service/jobs/models; version-dispatched snapshots and exports | Cancellation, stale generation, timeout with/without solution, no license, partial baseline, no silent field/candidate truncation, saved reopen | NOT VERIFIED |
| Evidence-bound assistant v3 explanation | BE/farm_assistant/{context,schemas,model_view,prompts,validation}.py; knowledge manifest/readers and evaluation cases | Ownership and numeric binding; diagnostic gaps never actionable claim; new metrics/versions; frozen deterministic and live semantic evaluation distinguished | NOT VERIFIED |
| Full journey and handoff | FE e2e; backend integration suites; docs/integration plus updated ROTATION_V2 compatibility notes | Actual API/worker/DB/browser path, restart, desktop/mobile screenshots, check/build; requirement audit and unresolved calibration list | NOT VERIFIED |

## Execution stages

1. Establish baseline and owned farm/field synchronization API (tests before behavior).
2. Scope local storage, field completion and shared map/assistant context; integrate API.
3. Introduce v3 data/readiness contract, precomputation, model, verifier and job dispatch.
4. Connect planner/results and assistant to new contracts; version knowledge/help.
5. Exercise the complete stack, failures and responsive states; retain artifacts and audit.

## Baseline evidence (2026-11-14)

- Clean main at 8c498cf; new branch created, no remote changes.
- Backend `.venv/bin/python -m pytest -q`: 305 passed, 33 skipped (dedicated DB not set),
  five existing PDF/SWIG deprecation warnings. This does not prove DB persistence.
- Global pnpm invocation failed before tests due to package-manager mismatch and automatic
  install requiring TTY. Retry using repository-pinned corepack pnpm@10.15.0.
- Existing ROTATION_V2.md documents an AI semantic HOLD and historical provider quota failure.
  Do not inherit old passing test counts as current proof or erase that limitation.

## Completion ledger

Stages 1–2 are implemented with the checkpoint evidence below. Full journey acceptance and the v3 model remain pending.
Update this ledger only from inspected files and fresh verification output.

## Checkpoint 1 — 2026-11-14

Implemented (not full-goal completion):
- Owned farm/partition identity, per-field validation, idempotent batch receipts,
  partial retry and optimistic conflict behavior; additive migration 0017.
- Managed Polygon/area/reference-point/containment/overlap validation, including holes;
  old PATCH cannot bypass it. Old partition records remain readable and immutable.
- Browser storage v3 preserves legacy stores and adds per-owner workspaces/observations,
  explicit local-draft copying and owner-mismatch protection.

Fresh proof:
- New farm API cases failed first with missing-route 404; old edit bypass cases failed
  with erroneous 200 before the shared validation was added.
- Full backend suite against dedicated `sideronostos_fields_v3_test`: 351 passed,
  no skipped tests, five pre-existing SWIG/PDF deprecation warnings.
- New storage cases failed on owner leakage/overwrite before the implementation.
- Full frontend: 248 passed across 39 files. Scoped ESLint and TypeScript passed.
- Ruff passed for changed backend modules/migration/tests; mypy passed for 12 field_shift
  and geometry files. Whole-repository mypy is not asserted.
- Fresh isolated Alembic 0016 → 0017 → 0016 → 0017 preserved a seeded legacy record.
  Evidence: output/evidence/fields-bot-v3/farm-migration.json.
- Environment setup: installed only locked missing frontend packages with pnpm 10.15.0;
  Node 26 jsdom uses --no-experimental-webstorage. Removed an obsolete generated Next dev
  validator (archived in /private/tmp) after typegen; it referenced renamed old routes.

Checkpoint 1 remaining work (superseded by checkpoint 2 below):
1. Wire owner-scoped storage/import into the actual /fields page. Current UI still calls
   anonymous storage methods, so application-level account isolation is NOT VERIFIED.
   The legacy archive is intact but its import/export controls are not yet displayed.
2. Implement typed sync API adapter and field completion panel using existing FieldForm;
   preserve backend IDs/details through FieldMap's toFieldFeature conversion (currently
   reconstructs properties), choose an interior representative point for concave shapes,
   persist retry keys, and restore active farms from backend across devices.
3. Extract shared session/query/context/navigation from RotationWorkspace, add AOI without
   editing farm boundaries, attach AssistantDock, preserve date/run/deep-link distinctions.
4. Complete every v3 mathematical/data/readiness requirement, then planner/results/bot
   integration, end-to-end runtime and responsive QA. No model v3 code exists yet.

No application DB migration, runtime server restart, paid model call, push or deployment
has occurred. The overall goal remains ACTIVE, with the original eight-section scope.


## Checkpoint 2 — owned map, field details and assistant (2026-11-14)

Implemented:
- `/fields` loads the authenticated owner scope, explicitly imports anonymous/legacy
  copies and exports the untouched archive. Owner-bound durable queues, exact-request
  retry receipts and per-item results keep account switches and partial failures safe.
- New `farms.ts`, `farm-sync.ts`, `owned-workspace.ts`, `local-copy.ts`, completion and
  sync panels preserve local/server identities, versions and concave polygon geometry.
  Remote farm adoption keeps a separate unlinked local copy. An incomplete farm on a
  new device reports missing unsent boundaries rather than inventing them.
- Farm partition method/orientation/count are persisted. An optional
  `X-Workspace-Owner` consistency header rejects a delayed farm request after login
  changes; authenticated identity still exclusively determines ownership.
- FieldForm and HistoryEditor are reused. Managed geometry is read-only in the details
  form. Session drafts survive first synchronization. Late completion after panel
  unmount cannot navigate back, and an older receipt cannot replace a newer query cache.
- Shared session, navigation, science queries and assistant context are extracted from
  RotationWorkspace. `/fields` hosts the existing companion/collapse/dictation/chat UI,
  with field versions, AOI revision, separate observation dates and frozen run context.
- MapLibre temporary point/polygon/viewport AOI is separate from TerraDraw farm data.
  Authenticated prepared scientific rasters have an adapter; actual raster publication
  parity is NOT yet verified. GIBS remains visualization only. No published data is
  displayed honestly instead of being replaced by demo measurements.
- Login return paths and both planning return links support `/fields`. Stale page links
  to `/agriculture` now use `/refer-2`; static assets are unchanged. Mobile panels use
  the existing focus-trapped Sheet and restore focus on Escape.

Fresh verification:
- Full frontend: 270 tests / 44 files passed; TypeScript passed.
- Scoped ESLint: 0 errors, 2 existing cleanup-ref warnings in assistant/workspace.
- Full backend against dedicated `sideronostos_fields_v3_test`: 355 passed, no skips,
  5 existing PDF/SWIG deprecation warnings. Ruff passed; scoped mypy passed 13 files.
- Isolated real journey DB `sideronostos_fields_v3_journey_test` migrated to head.
  Real login → GeoJSON import → 4 confirmed strips → complete/save first field →
  point and mobile polygon AOI → planning page → map → refresh was exercised.
  Mobile Escape restores the Data trigger. No external email or paid model call.
- Permanent field before/after the mobile polygon: version 1; exact geometry and data
  unchanged. See `output/evidence/fields-bot-v3/aoi-field-isolation.json`.
- Screenshots: `output/playwright/fields-v3-saved-desktop.png`,
  `fields-v3-assistant-desktop.png`, corrected `fields-v3-assistant-mobile.png`,
  `fields-v3-query-mobile.png`. Iowa is an engineering fixture, not a chosen pilot.
- Browser console contains expected anonymous/expired-access-token 401s followed by
  refresh/login; no observed runtime exception. This is not a full production build.

Still required:
1. Full v3 contracts, readiness, source metadata, scientific preparation, daily MILP,
   independent verification, frozen job dispatch, and versioned results. No v3 model
   is implemented at this checkpoint.
2. Planner/results/bot integration for v3, farm resource groups and active-partition
   selection; comprehensive account switch, race, conflict, restart and full saved-plan
   journey verification. Automated tests cover several races; real-browser coverage is
   currently only the path described above.
3. Actual prepared-raster parity, then remove the duplicate map from the planner and
   redirect the legacy map URL with parameters. Legacy routes remain available now.
4. Fixed-case and live semantic assistant evaluation, full desktop/mobile acceptance,
   final documentation and real-region data/calibration checklist.

Overall goal remains ACTIVE. No push, remote merge or deployment.


## Checkpoint 3 — daily mathematical kernel (2026-11-14)

Implemented within `rotation_optimizer/v3/`, without changing live v2 dispatch:
- Strict versioned scientific/model contracts; sourced readiness reports distinguish
  missing values from confirmed zero, and retain QA, region/time and assumption state.
- Recipe-paired GDD, first maturity date, explicit turnaround and cover; staged Kc/root
  depth, FC/WP, effective rain, TAW/RAW, minimum NIR and per-day audit trace. The conservative
  dry initial/root-expansion policy is explicit; no continuous multiseason claim.
- Real daily Gurobi model with one path per field, species adjacency, all-pair family
  gaps/history, hard suitability/infrastructure/capacities, and five resource-gap types.
- Six raw metrics/positive scales and priority-ordered gap minimization then normalized
  score maximization. Unavailable optional metrics remain null with reasons.
- Independent calendar/resource verifier and independent GDD/Kc/root/NIR/cover/trace
  verifier. Corrupt metadata and trace values are rejected, not only wrong final totals.
- Real cancellation/deadline/license failure behavior. Model limits are explicit errors,
  never silent truncation. Gurobi results remain limited to the generated candidate set.

Design contract and scientific limitations: `docs/integration/model-v3-core.md`.
Kernel artifacts: `output/evidence/fields-bot-v3/kernel-smoke.json` contains complete
synthetic inputs and actual Gurobi results for zero-gap priority and a five-resource
125-unit gap-cost diagnostic. These are engineering fixtures, not farm recommendations.

Fresh proof: full dedicated-DB backend suite 426 passed / 0 skipped (5 pre-existing
PDF/SWIG warnings); 71 v3 cases; scoped Ruff passed and mypy passed 9 modules.
See `output/evidence/fields-bot-v3/checkpoint-3.json`. All original application
integration work is still required: v3 profile/data preparation and suitability/economic/
risk/soil coefficients; server-owned readiness policy; farm/current partition/resource
snapshots; task dispatcher, immutable result compatibility; planner/results/bot/knowledge;
full end-to-end and AI evaluation. The v3 functions are currently a tested library, not
an exposed replacement backend. Overall goal remains ACTIVE.

## Checkpoint 4 — sourced profiles and data-preflight API (2026-11-14)

Implemented:
- Separate server-owned v3 regional profile catalog with value/unit/source audit and hash.
  The Iowa profile is an explicitly acknowledged engineering benchmark; all new agronomic,
  operating-estimate and objective-reference values remain labelled assumptions.
- Bounded farmer-input drafts and server-owned readiness requirements for soil, history,
  baseline, daily water/equipment, period seed/market, bare caps and gap remedies. Unknown
  is never zero; hard zero is not softened; malformed/nonfinite scalar inputs are rejected.
- `GET /rotation-optimizer/v3/profiles` and `POST /rotation-optimizer/v3/readiness` use real
  ownership, current farm partition and version checks, plus the captured-owner header.
  Read-only reports fingerprint actual snapshots. Existing v2 routes and jobs are retained.
- Raw weather unit/QA/calendar/location/provenance checks and FAO-56 historical replay.
  UTC versus local-date approximation is explicitly versioned and acknowledged. Calibrated
  profiles cannot inherit that engineering proxy silently.
- Exact water-system membership is enforced in both the input policy and frozen model.

Fresh verification: full dedicated-DB backend suite **491 passed, 0 skipped** (5 existing
PDF/SWIG warnings); scoped Ruff passed; mypy passed all **14 v3 modules**. Tests include
actual PostgreSQL API ownership/partition/version checks, unavailable weather, malformed
inputs, source applicability, zero versus unknown, and metadata fingerprint changes.
No frontend code changed in this checkpoint; no new browser journey claim is made.

Real data evidence: downloaded the seven required public NASA POWER variables for the
Iowa 2025 reference point. The old repository sample had only three. All **365/365** days
passed adapter checks and a full 2027 historical replay. Stored raw/prepared files and
`power-v3-validation.json`; published only into the isolated journey database. An actual
saved field's read-only preflight still blocks missing farmer data and unaccepted
assumptions. See `journey-data-readiness.json` and `model-v3-data-contract.md`.

Remaining: candidate compilation and independent coefficient verification, v3 job
submission/execution/publication, planner/results/bot/knowledge integration, immutable
saved-plan journey, raster parity, full UI/AI evaluation and final requirement audit.
The available readiness API does not itself generate a v3 solution. Overall goal ACTIVE.


## Checkpoint 5 — complete frozen v3 backend path (2026-11-14)

Implemented candidate/site/history filtering, sourced growth/economic/soil/risk coefficients,
actual-day machine operations and farm resource expansion. Baseline dates are retained even
off the regular sample grid. Limits fail explicitly. A separate source-to-coefficient audit
checks traces, provenance identity, resource conversions and coefficients before Gurobi.

`POST /rotation-optimizer/v3/runs` now uses the existing idempotent task service, frozen
inputs, cancellation, retry and publication controls. The worker dispatches by snapshot
version. Baselines and distinct alternatives are independently checked; all enabled metric
preferences are explored within a shared budget and primary gap ceiling. Diagnostics retain
remedies; optional unknown metrics stay null. Saved v3 plans and comparisons preserve actual
weights and immutable evidence; v2 remains supported. No database migration was needed.

Fresh verification: **530 backend tests passed, 0 skipped**, dedicated disposable test DB;
5 pre-existing PDF/SWIG warnings. Scoped Ruff passed and mypy passed 22 source files. Real
PostgreSQL tests include concurrent idempotency, frozen-field mutation isolation, actual job
execution, save/reopen, six-metric comparison, account guards and null optional deltas.

`output/evidence/fields-bot-v3/v3-real-weather-execution.json` contains the complete frozen
engineering input and actual Gurobi result using the public 365-day NASA POWER release:
6 candidates, 2 distinct zero-gap alternatives (requested priorities and soil emphasis),
verified coefficients and schedules. All operating values are explicit engineering
assumptions; this is an offline proof, not an actual farm recommendation or a UI journey.

Remaining: frontend v3 contracts/forms/readiness/results/history, bot/knowledge/evaluation,
prepared-raster parity, active Temporal/browser farmer journey, account/race/retry/restart
acceptance, final audit and real-region calibration checklist. Overall goal remains ACTIVE.
