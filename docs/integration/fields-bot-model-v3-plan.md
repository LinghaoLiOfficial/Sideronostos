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
The table records the initial implementation plan. Its NOT VERIFIED entries are baseline
statuses; the dated checkpoints and current acceptance ledger below record subsequent evidence.

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

Stages 1–3 are implemented. Stage 4 now has v3 planning/results and deterministic bot
evidence integration, with live knowledge/AI acceptance still pending. Stage 5 has a real
engineering browser/job/save/reopen, account/recovery/race and compatibility evidence plus
a completed data/requirements handoff. Full acceptance remains incomplete solely at the live
knowledge/AI evaluation gate; see [acceptance-and-handoff.md](acceptance-and-handoff.md).
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

## Frontend v3 implementation sequence

1. Add `src/lib/api/daily-types.ts` and `daily.ts` for versioned v3 input/readiness/result
   contracts and owner-bound requests. Keep legacy v2 API consumers readable; common history
   views will dispatch explicitly by frozen model version.
2. Add `src/components/rotation/daily-model.ts` for incomplete sourced drafts, active farm
   partition selection, bounded periods/resources, owner/profile-scoped restoration and exact
   uncertain-submission recovery. Missing numeric values stay null. No engine assumptions
   are applied until the user explicitly chooses the engineering-fixture action.
3. Add focused evidence/site/resource editors and a daily planner; reuse `HistoryEditor`
   via a small catalogue interface. Require current field versions, persisted history,
   source review and a fresh readiness report before submission. Editing invalidates readiness.
4. Extend `planner-form.tsx`, `results.tsx` and `workspace.tsx` as version dispatch boundaries;
   preserve legacy results, add v3 six-metric/gap/source/timeline comparison and saved views.
   Keep navigation and assistant context shared, including dirty operating-condition state.
5. Verify forms, stale/late requests, account boundaries, immutable results and actual browser
   journey before migrating map routes. Separate prepared-raster parity and bot v3 support
   remain required; neither is implied by form/component tests.


## Checkpoint 6 — sourced daily planner components (2026-11-14)

Added frontend v3 contracts and owner-bound API wrappers, active farm-partition filtering,
source-bearing drafts, explicit engineering setup, precise-history reuse, soil/site inputs,
shared daily water/equipment with date exceptions, period seed/market capacities, baseline,
optional objectives, six normalized preferences and readiness explanations. Sources retain
kind/time/quality/confirmation; edits to source identity invalidate confirmation. Empty
operating numbers remain unknown; explicitly entered zero remains a sourced zero.

The controller persists owner/profile-specific drafts and exact pending submissions, fences
late readiness by input basis, invalidates readiness on saved field-version changes, blocks
unsaved history, and prevents callbacks from an unmounted account. A completed older request
cannot clear another request's pending record. The server independently repeats readiness.
The existing HistoryEditor now accepts a minimal catalogue interface. A real integration bug
was reproduced and fixed: field persistence now validates precise history against published
v2 or v3 crop catalogues; current managed geometry and ownership guards are retained.

Fresh proof:
- **286 frontend tests / 48 files passed**, TypeScript passed, scoped ESLint has no errors
  or warnings in the new modules. No frontend dependency or lockfile was changed; Prettier
  was run as a temporary formatter.
- **531 backend tests passed / 0 skipped**, dedicated test DB, 5 existing PDF/SWIG warnings.
  Scoped Ruff passed; mypy passed 23 source files. New real-API history save + readiness
  coverage includes a valid managed polygon and field-version update.
- `frontend-contract-v3.json`: a request generated by the actual TypeScript model was
  validated by Python, independently compiled and solved by real Gurobi using public NASA
  historical weather. It produced 9 candidates and a verified zero-gap primary schedule.
  All operating inputs were explicitly chosen engineering assumptions. This is an offline
  cross-language check, not a browser or live Temporal journey.

**Not yet routed:** the new DailyPlannerForm is implemented and component-tested, but
`workspace.tsx`, `planner-form.tsx`, `results.tsx` still use the v2 page path. Next work must
add v3 results/saved/comparison rendering and version-aware shared history, then switch new
planning to v3, wire bot/knowledge, and verify the real desktop/mobile journey. Prepared
raster parity, legacy map redirect, production checks and final AI evaluation also remain.
Do not report this checkpoint as a completed product integration. Goal remains ACTIVE.


## Checkpoint 7 — routed results, daily assistant evidence and actual journey (2026-11-14)

New planning now uses the sourced daily form; `planner-form.tsx` and `results.tsx` dispatch
explicitly by version. `daily-results.tsx` renders six original metrics, null optional
metrics, frozen sources/calendar, resource remedies, objective weights and solver proof.
Alternatives and baseline have a direct raw-metric comparison table; incomparable preference
scores are not ranked. A scientifically verified but hard-invalid baseline stays labelled
and cannot be saved. Diagnostic plans have explicit save wording. Historical v2 views remain
readable; a withdrawn or revised daily profile does not silently replace the run's profile.

Shared `use-rotation-snapshots.ts` loads the saved plan first and obtains its immutable run,
even for plan-only URLs or conflicting URL run IDs. Draft metadata is scoped by run.
Draft comparison ignores JSON key order and only documented optional-null defaults, while
preserving actual numeric/unknown differences. Map return links retain run, option and field.
MapLibre restores the selected field's camera without dispatching drawing events that would
clear historical context. Timeline area formatting no longer exposes floating-point noise.

`farm_assistant/daily_evidence.py` projects verified six-metric results, execution limits,
selected positive gaps/remedies and their input sources. Shared `comparison.py` is used by
both API and bot. Versioned help retrieval excludes incompatible product documents before
ranking and before binding. Numeric values remain server-owned; the assistant cannot write
a farm or plan. Prompt `farmer-evidence-bound-20261114-v16-daily` is an **unevaluated candidate**,
not a semantic-quality release. See `model-v3-assistant-contract.md`.

The v3 knowledge manifest has 47 sources and 28 reviewed claims. All source hashes verified;
the offline bundle prepared 4,911 chunks. No v3 vector release was activated and no new real
chat/embedding evaluation was run in this checkpoint. Existing protected v3 cases remain
unchanged. The current goal authorizes subsequent real evaluation; the previous offline-only
restriction belongs to an earlier stage and must not be mistaken for current authorization.

Actual running-system evidence:
- UI incomplete readiness reported 316 checks. Repetitive checks now appear in four actionable
  groups while all detailed paths/sources remain inspectable.
- A real form submission entered the dedicated `fields-v3-journey` Temporal queue. The rainfed
  test field rejected nine candidates for missing irrigation. A structured-error rendering
  crash was reproduced, fixed and frozen as a regression; the page now explains field/date
  and rejection reason without inventing a feasible option.
- Through the map form, the engineering test field was explicitly changed to irrigated and
  saved as version 2. The planner required adopting that version and reconfirming conditions.
- A second UI submission completed a real worker/job attempt with public NASA POWER historical
  weather: nine candidates, two verified zero-gap alternatives. The UI compared and saved the
  primary option. The saved input snapshot equals the run's exported snapshot exactly.
- A new browser session followed the plan-only link, logged in, returned to that plan and
  recovered the same run/option/field. Mobile map/companion views retain historical context.
  This does not yet prove a real LLM answer or prepared-raster equivalence.

Fresh automated checkpoint: 305 frontend tests / 52 files passed, TypeScript passed;
focused ESLint passed after cleanup. Backend checkpoint: 545 passed / 0 skipped, five existing
PDF/SWIG warnings; scoped Ruff and mypy passed. Evidence and exact IDs are in
`output/evidence/fields-bot-v3/browser-journey-checkpoint.json`, the two browser-run exports,
and `output/playwright/fields-v3-*.png`. Tests cover the real structured failure, optional
metrics, frozen saves, key/default normalization, old-profile fallback prevention and
cross-run/plan-only owner context. This is a checkpoint, not full-goal completion.

## Current acceptance ledger

| Boundary | Current evidence | Remaining acceptance |
|---|---|---|
| Owned field/farm synchronization | Real DB regressions; same-browser A→B→A isolation; actual partial farm progress; committed-response loss, reload and identical retry; real second-client field conflict and explicit review | Remaining delayed-response browser race and batch mixed-item checks |
| v3 scientific/math/task execution | Enumerated oracle, independent checks, real Gurobi and real Temporal attempt | Final requirement audit and production configuration checks |
| Daily form/readiness/results/save | 314 frontend regressions; actual two-field shared resources, year-precision history, readiness, worker solve, compare/save; diagnostic/null metric/cross-run comparison/mobile/save; print/export | Final requirement audit and delayed-response acceptance |
| Bot numeric/evidence boundaries | Deterministic and owned DB tests; saved context on mobile | Frozen daily cases, real retrieval/generation, semantic rubric and held-out gate |
| Knowledge v3 | Manifest/readers validated, 4,911 chunks prepared offline | Versioned vector publication and retrieval/generation evaluation |
| Unified map | Actual prepared SMAP parity, AOI camera restoration, error/retry, mobile evidence sheet, old URL redirect and planner without duplicate map | Broader account/race/restart journey remains |
| Real-region use | Explicit sourcing/readiness and uncalibrated-engineering labels | Pilot, crop/soil/operations calibration and farmer/agronomist review |

Goal remains ACTIVE. No push, remote merge or deployment was performed.

## Checkpoint 8a — frozen daily AI cases; provider access HOLD

Created `cases-v4-daily.json`: 26 bilingual cases, 13 development and 13 protected,
SHA256 `913f3fe3ac7868b9314a3ce1ac1befc383291f77593bbaf7ff9b9168289ada53`.
No candidate chat outputs have been seen. Prior v1/v2/v3 cases, expectations and scores
remain unchanged. The 90% recall/clarity targets and zero wrong-field/number/source gate
are retained. New cases cover six metrics, null versus zero, actual diagnostic gaps,
hard failure, independent soil-water initialization, changed drafts, comparison,
GIBS boundaries, guarantees, unsupported writes and timeout without an incumbent.

`evaluation/prepare_daily.py` reads owned actual API/Temporal/Gurobi runs without changing
them. It verifies foreign-owner rejection and version conflict, and compacts redundant
solver proofs only after proving identical model-visible projections for every question.
The controlled timeout is explicitly labelled. All seven owner/version gates passed.
The frozen fixture is archived as `eval-fixtures-v4-daily.json.gz`; its uncompressed SHA256
is `2d0e39511afde7324736cd7199d523c2db836ddacee16173930957e7202c9bb3`.
This is input preparation, not semantic acceptance.

A real queued diagnostic fixture (`c10b3fa4-fa9b-4074-b623-d7f86041713d`) has a positive
verified water-resource gap, one distinct option and null profit (explicitly disabled).
No resource booking was made. It uses the same frozen field/version/profile/weather as
the successful browser run, so cross-run comparison has a real compatible input basis.

The isolated knowledge release `field-shift-knowledge-20261114-v5-daily` is STAGING,
not active. Exact public-source embedding input hashes and provider identity allowed
reuse of 4,877 unique vectors from the immutable prior published release. New material
requires 33 embeddings (9 HELPV3, 17 MODELV3, 7 DATAV3). The original database and all
conversations remain untouched. A normal incremental embedding request and one minimal
public-text diagnostic both returned OpenRouter HTTP 403 / PermissionDeniedError.
No further provider retry is justified until configuration/access changes. Failure costs
are unreported, not assumed zero. The incomplete release was not activated.

Evidence: `knowledge-cache-reuse.json`, `ai-evaluation-preparation.json` and the frozen
fixture archive in `output/evidence/fields-bot-v3/`. The reusable freezer passes Ruff/mypy
and was executed successfully against real owned records. Live retrieval/generation,
semantic review and held-out acceptance remain **NOT VERIFIED**. The external-access
question is pending; remaining product verification can proceed independently.


## Checkpoint 9 — unified map and actual plan artifacts (2026-11-14)

Published an isolated journey SMAP release from the existing actual 2026-11-07 HDF5.
AM/PM derivative hashes exactly match the previously prepared public source. No private
source records or production releases were modified. MapLibre native raster requests
returned actual PNGs; API pixel checks match the source value's color/alpha exactly.
The Iowa point has QA-rejected observations (null, transparent), while a separately named
regional AOI has AM 0.27163422107696533 m³/m³. The regional query never substitutes for the
operating field: its ID, version 2 and geometry stay unchanged. Future observation windows
return no historical values; polygon/viewport queries explicitly lack prepared area statistics.

Fixed the manifest's missing title/release identity, request cancellation on removal,
late tile decoding and a missing visible failure/retry state. A browser-controlled 503
verified the warning; after removing the interception, retry returned an actual 200.
`use-map-focus.ts` restores an AOI independently of delayed field loading and returns to
the field when cleared. These behaviors have focused regression coverage.

Only after this parity check, `/field-shift/map` became a server redirect to `/fields`,
preserving all query values. The planning route now displays conditions/results at full
width and retains a fixed companion; it mounts no Leaflet or MapLibre canvas. Legacy map
component code is retained but no current page URL renders it. Desktop 1440 px and mobile
390 px views were inspected. The saved run/option/field and independent AOI remain bound.

A real browser download of the saved v3 plan equals the authenticated server plan exactly,
including the entire frozen snapshot. Chromium print output initially touched paper edges;
14 mm page margins, compact print spacing and unbroken evidence panels corrected it.
The inspected one-page PDF retains six metrics, dates and engineering/scientific limits.
This verifies browser print rendering, not a physical printer or user operating-system dialog.

Evidence: `science-map-parity.json`, `map-migration-and-plan-export.json`, and the named
screenshots/PDF in `output/playwright/`. Fresh frontend suite: 312 passed / 55 files;
TypeScript and focused ESLint pass. Backend agri persistence: 3 passed; Ruff/mypy pass.
No live AI calls were retried. Provider access and semantic acceptance remain HOLD;
other product checks continue. The overall goal remains ACTIVE.


## Checkpoint 10 — failure evidence and local production restart (2026-11-14)

Actual rainfed-run evidence exposed a bot gap: only generic failure status was available.
`daily_evidence.py` now binds stage/error counts, bounded affected field/crop/date details
and per-reason candidate rejection counts. It never creates a schedule or inferred metric.
Prompt candidate v17 distinguishes these explicit preparation checks from global agronomic
infeasibility, and warns against adding overlapping rejection counts. A real-run regression
failed before the adapter change and passes afterward; truncation preserves totals.

The original frozen v4 inputs and all 26 expectations are unchanged. A new v5 archive changes
only two failed-run contexts, adding seven facts each; the other 24 contexts match exactly.
All seven owner/version checks and model-projection equivalence checks pass. Provider access
has not changed, so no embeddings/generation request was retried and no semantic score exists.

Full backend suite: 548 passed / 0 skipped, five existing PDF/SWIG deprecations. Frontend
production build passes TypeScript and produces all routes. The development server was
replaced by local `next start`; after restarting the API, the actual browser reopened the
same immutable saved plan and returned to its field/AOI/science layer. A direct old map URL
returns HTTP 307 with all parameters retained. Real tiles render; canceled offscreen tiles
do not trigger an error banner. This is a local production-mode smoke, not a deployment.

Evidence: `ai-diagnostics-fixture-update.json`, `eval-fixtures-v5-daily.json.gz`,
`production-build-and-restart.json` and production screenshots. Remaining work includes
multi-field/diagnostic UI, the broader account/conflict/retry matrix, final requirements
handoff and live semantic evaluation after access is restored. Goal remains ACTIVE.


## Checkpoint 11 — account round trip, two-field planning and diagnostic UI (2026-11-14)

A second engineering account was registered and verified through the actual local email
worker and Mailpit. In the same browser, A→B→A sign-out/login preserves each account's
workspace. Both directions reject foreign farm/field/run/plan records with 404; the first
account's original field remains version 2 and its immutable plan is unchanged. An inaccessible
AOI previously had only retry and held the assistant context pending. A failing regression
now guards a visible clear action that preserves the field and observation dates.

Through the actual MapLibre import/confirmation/form flow, the second account saved a
3.68 ha engineering farm with two fields. While only one was saved the UI showed 1 / 2.
For the second field, a controlled browser route let the real API commit, then replaced
its acknowledgement with a single 503. Reload retained the durable request. The visible
retry sent the exact original key and payload, recovered the same field/version, and made
no duplicate. A separate real API client then updated that field: the stale UI submission
returned an item conflict, retained the local input, and required explicit latest-version
review before saving version 3. This is a controlled local fault test, not a production outage.

Readiness correctly blocked two legacy history catalogues and missing machine membership
for the added field. Its generic messages and wrong correction target obscured those actions;
a failing UI regression now requires specific explanations and a shared-resources link.
The user flow explicitly linked each known 2026 pea record to the current catalogue while
retaining **year precision**. Saved field versions became 4 and 2; the planner required
adopting and reconfirming them. Both fields were explicitly assigned the same water,
tractor and harvester groups. No dates or actual-farm data were invented.

Actual UI submission `e8823ed8-eab5-4e95-ac0a-e7566955e1cd` completed through Temporal
and Gurobi with 12 candidates, two distinct zero-gap options and the original baseline.
The UI displayed both timelines and six original metrics. Saved plan
`7847c28a-e6bc-4491-8f99-834a7e84c861` exactly matches the selected option and the run's
exported input snapshot. The 390 px mobile page has document width 390 px.

The existing actual diagnostic run was also inspected through desktop/mobile UI: 30 positive
water-gap rows, 369.2760942213342 USD verified remedy cost, and null profit shown as 未计算.
Cross-run comparison with the compatible zero-gap run shows profit as 无法比较 and explicitly
avoids comparing scores under different weights. All 30 gaps can be expanded. The diagnostic
save dialog states its status; plan `47b5a6c2-49d7-4b2c-bc6b-2a5fd0f764d3` reopens after
reload with the same snapshot, remedies and limits. The mobile assistant receives its context;
no generation or resource-booking action was sent.

Evidence: `account-switch-checkpoint.json`, `multifield-sync-and-planning.json`, the compressed
actual run/plan archive, `diagnostic-ui-and-comparison.json`, and named screenshots. Frontend
suite: **314 passed / 56 files**, scoped ESLint passes. Backend was not changed in this phase;
the prior full 548-test result remains applicable. Fresh production build and TypeScript checks pass; the saved diagnostic plan reopens under
`next start`. `production-readiness-race.json` records a real readiness response held until
a draft edit: the old ready=true request is aborted, no stale report is rendered and submission
remains disabled. A fresh response reports missing equipment, and the rendered correction link
points to shared resources. The original draft was then explicitly restored from its run. Live AI provider access remains HOLD. Outstanding work is the
remaining delayed-response/batch acceptance, final requirements and data handoff audit, and
live knowledge/semantic evaluation after access is restored. Goal remains ACTIVE.


## Checkpoint 12 — mixed batch recovery, stale context and handoff (2026-11-14)

A two-item real API batch returned one conflict and one success. Preparation used two clearly
controlled pre-write 422 responses to retain edited forms; a separate API client advanced the
west field before the batch. Exact replay returned the same receipt without changing either
server field. The UI correctly showed 1 / 2, but lacked an immediate batch-conflict review
button. A failing regression now guards explicit latest-version review and disabled submission.
After review, only the west field was retried with expected version 5 and saved version 6;
the successful east sibling stayed at version 3. The UI recovered to 2 / 2.

The successful batch item also retained its acknowledged session draft, misleading the assistant
into reporting unsaved input. A separate failing regression now guards reconciliation of equal
editable values and preservation of newer/different input. Production reload clears the stale
notice and assistant dirty state without another server write. Full frontend suite: 317 passed
in 56 files; changed-file ESLint and the rebuilt production TypeScript/build checks pass.
Backend code is unchanged since its complete 548-test pass.

A real AOI creation response was held until switching fields. The client aborted it with
net::ERR_ABORTED; releasing it and rapidly switching east/west did not attach the old selection
or disable the new field's composer. The previously saved two-field plan remains byte-for-byte
equivalent as parsed JSON to its original archive, retaining east v2 / west v4 and their old
names after current fields became v3 / v6. Browser result and assistant labels use old names.

Existing actual v1 and v2 saved records were replayed read-only in the current production UI.
Their original metrics, timeline and limitations render correctly; routes were removed after
inspection. V2 was exported through a database-enforced READ ONLY transaction, with no original
application DB migration or mutation. These replay checks establish renderer compatibility,
not authorization; real DB regressions separately cover owner/legacy persistence boundaries.
The native voice capability and control are still present. No user microphone was recorded,
and no speech-accuracy claim or new AI generation was made.

Evidence: `mixed-batch-recovery.json`, `selection-race-and-immutable-context.json`,
`legacy-result-rendering.json`, `legacy-v2-readonly-snapshot.json.gz` and named screenshots.
`acceptance-and-handoff.md` supplies A engineering steps, B actual-farm data responsibilities,
current requirement/math mapping, migration boundaries and the per-file change inventory.

The remaining required gate is live knowledge/AI semantic acceptance. The same embeddings
HTTP 403 has persisted across checkpoints 8–12; no permission/configuration change was reported,
so no further paid-provider retry was made. The staging release stays inactive; 26 daily cases
and their frozen expectations are unchanged. Once access is restored, resume the documented
embedding/publication/development/protected evaluation procedure. Do not claim overall completion,
regional calibration, push, merge or deployment from the engineering evidence.


## Checkpoint 13 — replacement credential, real AI development and evidence guards (2026-11-14)

The user supplied a replacement key. It is installed only in ignored mode-0600 `.env.local`;
no key/share link enters this branch. A real embedding probe and chat batches work. All
4,911 vectors are present and the v5-daily knowledge release is active only in the isolated
journey database. The original/default database is untouched.

Real dev outputs exposed missed “both options” routing, daily gaps presented as horizon
shortage, missing option clarification, and a false rejection of a negated English readiness
claim. Reproduced failing tests precede each projection/validation fix. A vocabulary expansion
raises annotated dev source recall from 3/4 to 4/4, with no case/source pinning. Separate reports
retain each boundary change. Nano still turns drought severity into disease severity despite
correct retrieval; Mini was then evaluated with a process-only override. V18 adds explicit
scope decision order, improving gap explanations but leaving qualification omissions. None
is promoted; protected tests remain untouched. Original expected properties are not relaxed.

Full backend regression: 554 passed, zero skipped, five existing PDF/SWIG warnings. Ruff and
mypy pass (mypy required --no-incremental after a cache internal error). API health/live and
health/ready are 200 after the local acceptance API reloads the new key. The API loaded v17;
v18 source and Mini evaluation are not an accepted deployment.

Browser login was not submitted: automatic approval rejected use of a plaintext password and
insufficient account authorization. Prior committed evidence confirms this is the local
synthetic second engineering account. Explicit user authorization has been requested; while
pending, continue non-login AI work. No UI chat success is claimed from direct model calls.

Evidence: `provider-and-knowledge-recovery.json`, `ai-dev-input-provenance.json`, six immutable
`eval-daily-*` reports, baseline rejection, retrieval diagnostic, and
`ai-development-recovery-checkpoint.json`. A new legacy fixture is clearly labelled refrozen
because the old exact archives were unavailable; historical scores remain historical.
Goal remains ACTIVE: semantic completion, exposed regressions, protected evaluation and final
live UI chat still remain. No push, remote merge or deployment.
