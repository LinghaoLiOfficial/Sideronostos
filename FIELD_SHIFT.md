# Field Shift implementation and evidence

## Current Rotation v2 entry point

The map/RAG/MILP implementation on `grok_bot` is documented in [ROTATION_V2.md](ROTATION_V2.md), based on `0271351`. The remaining content below is the preserved v1 implementation record and its original authority; it does not describe the v2 architecture or current workspace.

## Authority and scope

Authority: the user goal at `/Users/fanysmacpro/.codex/attachments/10adc810-353c-426d-9774-ba15f92de629/goal-objective.md`, the conversation's farmer-centered rotation plan, and the research in the parent NASAappChallenge directory. Baseline: `6c6edcc`. Worktree: `codex/field-shift`.

Deliver the complete journey: define a field and history → inspect environment and limitations → set goals/constraints → generate feasible rotations → compare baseline and alternatives → change assumptions and save evidence-backed plans. Preserve Agrisata branding and existing account/workspace features. Do not push or deploy.

At the inspected baseline, agricultural routes were showcase pages without a field/rotation domain or agricultural API. The isolated worktree now contains the deterministic Field Shift domain, API and frontend, with the complete farmer journey verified locally using the production frontend build. The existing AI workflow remains a separate text-processing demo; no language model may bypass feasibility or invent outcomes. This is a verified local demonstration product, not a deployed service or locally calibrated agronomic recommendation system.

## Product decisions

- New operational route `/field-shift`; existing agricultural showcases link to it.
- Reuse existing verified-user authentication and PostgreSQL. Every field, analysis and saved plan is private to its owner.
- First configurable profile: explicitly **demonstration**, temperate annual cropping, one main crop per year, three planning years. This does not claim suitability for a confirmed pilot region. Profile rules/calendar/parameters are versioned JSON, not constants embedded in UI.
- Field: name, area in ha, latitude/longitude, optional soil texture, irrigation availability, historical year/crop records. Location is a point for regional climate context, not a surveyed boundary.
- Farmer chooses allowed crops, maximum estimated seasonal irrigation (mm), annual input budget (USD/ha), annual labor limit (days/ha), and water/cover/diversity/cost priority weights. Numerical crop parameters in the initial profile are transparent demonstration assumptions.
- Compare the same three-year horizon: current practice (farmer-selected baseline) plus up to two representative feasible alternatives. Keep an infeasible baseline visible with its violations; never label it recommended. Show the highest weighted score first, then prefer the highest-scoring different crop combination with distinct metrics; explain any equal-metric or same-combination fallback honestly. These are representative choices, not necessarily the globally top two scores.
- NASA POWER daily regional weather, aggregated to monthly values for a complete historical reference year. Live data, dated cached real data, synthetic demo fallback, estimates and future scenarios remain distinguishable. No live HLS/SMAP/soil-test claims without access.
- Calculate a transparent climate-based water-demand estimate, coverage days and input/labor estimates. Do not claim measured irrigation savings, profitability, yield gain, soil-carbon gain, or validated disease reduction.
- Saved plans include the exact field, input, profile, environment, scenario, calculated metrics and evidence snapshots. Reload and API restart must preserve them.

## Component necessity pass

1. My fields: select/create an actual saved field; show empty/loading/error/retry states.
2. Field setup: only data needed for feasibility and climate lookup; history is editable. Persist before proceeding.
3. Environment: monthly temperature/rainfall chart, date/source/scale, fallback and missing soil/vegetation facts; details expanded on demand.
4. Plan setup: baseline timeline, allowed crops, resource limits and priority controls; retain input during errors.
5. Comparison: baseline + alternatives, planting timeline, aligned metric bars, specific reasons, violated rules and missing evidence. A scenario adjustment triggers explicit recalculation.
6. Saved plan: immutable evidence snapshot, title/notes, export, reopen. A save is successful only after server confirmation.

No generic statistics dashboard, decorative fake map or unsupported outcome percentages. Desktop has contextual navigation and a wide comparison; mobile stacks controls/cards and uses horizontal timeline scrolling only where necessary. All actions keyboard-operable with named controls and visible focus.

## Shared API contract v1 (frontend/backend agents)

All paths start `/field-shift`. Authentication uses the existing Bearer/refresh mechanism. Standard errors keep request_id.

### Types

`Crop`: `{id,name,family,sow_month,sow_day,duration_days,kc,estimated_cost_usd_ha,estimated_labor_days_ha,allowed_soils,source_ids}`.

`Profile`: `{id,name,version,is_demo,description,assumptions:string[],crops:Crop[],rules:Rule[],sources:Evidence[]}`. `Rule`: `{id,name,description,kind,parameters}`. `Evidence`: `{id,title,url:string|null,kind:"rule"|"observation"|"estimate"|"farmer_input"|"demonstration",detail}`.

`FieldInput`: `{name,area_ha,latitude,longitude,soil_texture:"unknown"|"sand"|"loam"|"clay",irrigation_available:boolean,profile_id,history:{year:number,crop_id:string}[]}`.

`Field`: `FieldInput & {id,version:number,created_at,updated_at}`.

`EnvironmentMonth`: `{month:number,rainfall_mm:number|null,tmin_c:number|null,tmax_c:number|null,reference_et_mm:number|null,valid_days:number,expected_days:number}`.

`Environment`: `{status:"live"|"cached"|"demo"|"unavailable",source_name,source_url:string|null,reference_year:number,fetched_at:string|null,spatial_resolution:string,months:EnvironmentMonth[],limitations:string[],evidence:Evidence[],fingerprint:string}`. Missing observations stay null, never zero. `reference_et_mm` is a Hargreaves estimate, not a NASA-observed variable. `live` means retrieved now, not current-weather forecast.

`PlanningInputs`: `{start_year:number,baseline_crop_ids:string[3],allowed_crop_ids:string[],max_irrigation_mm:number,max_cost_usd_ha:number,max_labor_days_ha:number,weights:{water:number,cover:number,diversity:number,cost:number},scenario:{rainfall_change_pct:number,temperature_change_c:number},accept_demo_assumptions:boolean}`. Limits are per planning year/season, comparison totals are for all three years. Weights 0–5, at least one positive. Rain scenario -50…50%, temperature -3…5°C. Zero water budget is valid. Engine must honor irrigation_available=false even if request's water budget is positive.

`PlanSeason`: `{year:number,crop_id,crop_name,family,sow_date,harvest_date,water_demand_mm:number,irrigation_gap_mm:number,cover_days:number,cost_usd_ha:number,labor_days_ha:number}`.

`PlanMetrics`: `{irrigation_gap_mm:number,water_demand_mm:number,cover_days:number,diversity:number,cost_usd_ha:number,labor_days_ha:number}` (three-year totals; diversity = distinct families).

`RotationOption`: `{id,label,is_baseline:boolean,feasible:boolean,seasons:PlanSeason[],metrics:PlanMetrics,reasons:string[],violations:{rule_id,message}[],evidence:Evidence[]}`.

`Analysis`: `{id,field_id,field_version,created_at,profile:{id,name,version,is_demo},profile_snapshot:Profile,inputs:PlanningInputs,environment:Environment,baseline:RotationOption,alternatives:RotationOption[],feasible_count:number,rejected_count:number,rejection_summary:{rule_id,message,count:number}[],limitations:string[],elapsed_ms:number}`.

`SavedPlan`: `{id,title,notes,created_at,field_id,field_name,option:RotationOption,analysis:Analysis,field_snapshot:Field}`.

### Endpoints

- `GET /profiles` → `{items:Profile[]}` (public rule catalogue).
- `GET /fields` → `{items:Field[]}`.
- `POST /fields` FieldInput → Field (201).
- `GET /fields/{id}` → Field.
- `PATCH /fields/{id}` `{...FieldInput,expected_version:number}` → Field; 409 on stale version.
- `GET /fields/{id}/environment?refresh=false` → Environment; persistent cache, explicit refresh.
- `POST /fields/{id}/analyses` `{...PlanningInputs,expected_field_version:number}` → Analysis (201). Read authoritative field and environment; generate/filter before rank; persist snapshot. No client-supplied recommendation metrics.
- `GET /analyses/{id}` → Analysis (owner protected).
- `GET /plans?field_id=...` → `{items:SavedPlan[]}`.
- `POST /plans` `{analysis_id,option_id,title,notes}` → SavedPlan (201); deduplicate same user's analysis+option save, return existing saved plan rather than duplicate.
- `GET /plans/{id}` → SavedPlan. UI can export this snapshot to JSON and a printable plan.

Field validation: name 1–120 chars, area >0 and <=100000, lat/lon valid and finite, history unique years before planning start, known crops for the chosen profile. Pydantic rejects extras/NaN. History may be empty but is explicitly a limitation. Domain engine rejects invalid IDs rather than dropping them.

### Module ownership

- Engine agent: `modules/field_shift/{schemas.py,profiles.py,engine.py,data/profiles/*.json}`, `tests/test_field_shift_engine.py`.
- API agent: module init/model/router/service, core registration, migration, API/integration tests. Imports engine and environment behind their contracts.
- Root: environment adapter (`environment.py` + climate fixtures/tests), dev setup, evidence/docs, integrations and review.
- Frontend agent: new `/field-shift` route/components/API types/client and focused tests; small existing agricultural entry links. Preserve other features and design tokens.

Engine public boundary: `generate_options(field:Field, profile:Profile, environment:Environment, inputs:PlanningInputs) -> EngineResult` with baseline/alternatives/counts/rejection_summary/limitations/elapsed_ms. `get_profiles() -> list[Profile]`, `get_profile(id) -> Profile`. Environment adapter: `async fetch_environment(latitude:float,longitude:float,reference_year:int=2025) -> Environment`; service owns persistence/cache. Engine recalculates scenario ET from monthly temperature/latitude and reference weather (same documented method) rather than treating future assumptions as measurements.

## Decision method and limits actually implemented

- Profile `temperate-demo`, version `1.0.0`, contains six named annual crops in `sideronostos-backend/src/sideronostos_backend/modules/field_shift/data/profiles/temperate-demo-v1.json`. Crop names are Chinese/English; Latin botanical family identifiers remain stable. Calendars, fixed Kc, soil compatibility, crop/family intervals, effective rainfall, costs and labor are explicit demonstration parameters with source/assumption metadata. Neither NASA nor the cited papers validates these numerical local choices.
- Each candidate has exactly three annual planting slots. The engine enumerates allowed crop sequences, checks known history and configured crop/family return intervals, calendar fit, known soil compatibility and each year's water/cost/labor limits, then ranks only passing candidates. No-irrigation fields use a zero irrigation limit regardless of a positive requested budget. Missing history/soil is reported as unverified context, not silently inferred.
- `feasible_count + rejected_count = len(allowed_crop_ids) ** 3`. The feasible count includes the baseline only when that sequence belongs to the allowed catalogue and passes its checks. The baseline is excluded from the alternative cards. Rejection counts count each rejected sequence once per violated rule, so rule counts may overlap.
- Ranking normalizes four metrics across feasible alternatives: lower irrigation gap and cost, higher scheduled growing days and botanical-family diversity. User weights affect rank only. Candidate sequence IDs provide a stable tie-break. The first card is the highest-scoring feasible alternative. The second is the highest-scoring different crop multiset with different aggregate metrics if one exists, otherwise a different crop multiset with tied metrics, otherwise another order of the same crops. Equal aggregate estimates and calendar-only differences are explicitly explained; no extra benefit is invented.
- Monthly Hargreaves reference ET uses monthly mean daily minimum/maximum temperatures and daily extraterrestrial radiation at the entered latitude. Radiation is converted from MJ/m²/day to equivalent evaporation with `0.408`; method version is `monthly-hargreaves-v1`. For each crop/month overlap, demand is `reference ET × overlap fraction × configured Kc`; effective rain is `monthly rain × scenario factor × overlap fraction × configured effective-rain fraction`. Positive monthly deficits are summed. Temperature scenarios recalculate reference ET; rain scenarios alter rain. The same historical reference year is repeated across planning years.
- Water is reported in mm; cost in USD/ha and labor in days/ha. Limits apply to each year, while comparison metrics total the same three years. Area is stored but does not silently multiply per-hectare metrics. `cover_days` is scheduled crop duration, not measured canopy cover. It is not a soil-health or carbon score.
- “Feasible” means passes the supplied-data/configured checks only. The pilot region and cultivars are unconfirmed. Local temperature suitability, frost, specific pests/diseases, soil-water storage, runoff, drainage, irrigation efficiency and stage-specific crop responses are not modeled. There is no validated prediction of yield, profit, nitrogen gain, soil carbon or disease reduction. Farmer/local agronomist review remains necessary.
- NASA POWER values are regional reanalysis history, not surveyed field measurements or forecasts. The adapter validates requested year/UTC dates, variable units, finite numeric non-boolean coordinates and location, daily missing/fill values and temperature ordering. Incomplete monthly variables stay null. Unusable observations cannot drive a recommendation. An explicit synthetic fallback has `status=demo`, zero observed days and no observation timestamp; it is never labeled NASA data.
- Every analysis carries `profile_snapshot: Profile` in addition to the compact profile summary. Saved plans retain the analysis, selected server-calculated option and exact field snapshot, so export need not re-read current rules or current field state. Persistence/restart verification is tracked separately below.

## Engine and environmental evidence recorded 2026-11-12 (Asia/Shanghai)

### Repeatable checks completed

From `sideronostos-backend`:

```sh
.venv/bin/python -m pytest tests/test_field_shift_engine.py tests/test_field_shift_environment.py -q
```

Observed result at `2026-11-11T16:05:45Z`: **71 passed** (30 engine, 41 environment). Coverage includes constraints before ranking, zero water/no irrigation, missing history/soil, unknown IDs, invalid calendars, configurable gaps, annual units and three-year totals, scenario/priority changes, empty alternatives, representative crop-mix selection and honest ties. Environmental checks include complete and partial months, units/dates/location, Hargreaves conversion, finite polar behavior, explicit provider failure, and malformed/NaN/infinite/boolean coordinates. These are domain/adapter checks, not a claim that the whole browser journey has passed.

Targeted Ruff and mypy checks passed for schemas/profiles/engine and, separately, environment. Tests were added before the respective behavior/fixes: absent domain, duplicate-metric alternatives and invalid provider-coordinate acceptance were observed failing before implementation.

### Captured NASA response and reproducibility

- Raw provider response: [`output/evidence/nasa-power-raw.json`](output/evidence/nasa-power-raw.json).
- Processed capture: [`output/evidence/nasa-power-live.json`](output/evidence/nasa-power-live.json), recorded fetch timestamp `2026-11-11T15:49:48.938904Z`.
- NASA POWER Daily API `v2.10.3`; reference year **2025**, UTC, location **42° N, 93.5° W**. This is a demonstration lookup, not a confirmed team pilot region.
- Variables: `T2M_MIN`, `T2M_MAX` (°C) and `PRECTOTCORR` (mm/day). The captured response has **365 complete valid days**; the twelve monthly precipitation totals sum to **914.10 mm**.
- Current-code offline reprocessing of that raw response reproduced fingerprint `07fe6aa14dbbc839c69ccb4f98ba4742f4b513905a1a8c264b6261b310f5be00` exactly. Raw-file SHA-256: `06a8be45f187345321ba97a713b6a5710d00c33b9288d908ded8c32a9133fdac`.
- This proves one captured response can be parsed and reproduced by the current adapter. It does not prove provider uptime, every region's coverage, local crop suitability, or future weather. No new network request was made by this offline reprocessing check.

### Limited engine performance measurement

Using that reprocessed weather, the six-crop profile, three planning years, no supplied history, loam soil, irrigation available, permissive resource limits and equal weights: **216 candidates**, **88 passing**, **128 rejected**. Across 50 in-process generations: median **5.26 ms**, empirical P95 **5.42 ms**; serialized `EngineResult` approximately **14,900 bytes**. This excludes HTTP, authentication, database, provider latency and browser rendering. Separate local API measurements follow below.

### Authenticated local API verification

Credential-free evidence: [`output/evidence/runtime-api.json`](output/evidence/runtime-api.json). The check used real `/auth/login` authentication, then the running loopback API at `http://127.0.0.1:8040` with its PostgreSQL database. **56/56 assertions passed**. It read the existing field/history, baseline analysis, scenario analysis and saved plan, then created ten additional analysis records only; it did not modify any existing field or plan or restart a service. Exact original field, plan and analysis snapshots were re-read and remained unchanged.

The saved plan contains the selected feasible server option, exact scenario analysis, full six-crop profile with rules/sources/assumptions, field/history/version and environmental snapshot. Both scenarios retain the same 2025 historical observations, fingerprint, 12 months and 365 valid days. For the same planting sequences, changing only the scenario to **−20% rainfall / +2°C** increases three-year estimated irrigation gap by **323.05 mm** for continuous maize, **155.54 mm** for the first alternative and **178.75 mm** for the second. Crop cover duration, diversity, cost and labor remain unchanged. Alternatives pass the annual resource limits; displayed metric totals sum the same three years. The baseline stays visible with its violations.

| Local endpoint measurement | Successful requests | Median | P95 (nearest rank) | JSON response bytes |
|---|---:|---:|---:|---:|
| Cached environment GET | 10/10 | 3.681 ms | 4.885 ms | 3,249 |
| Persisted analysis POST | 10/10 | 14.236 ms | 18.883 ms | 24,538 |

Measurements use serial HTTP requests in a persistent client, timing complete responses; POST includes authentication checks, database work, cached environment, engine and serialization. Ten samples make nearest-rank P95 the maximum observed value. The ten newly created analyses reproduce the original inputs/profile/decisions/metrics. This is a local warm-cache observation, not deployed capacity, cold-provider latency, browser performance, concurrent-load behavior or restart-persistence proof.

## Local runbook

Use the isolated worktree, not the original checkout. The verified local configuration is in ignored `.env.local` files. Keep credentials in those files and do not copy them into evidence or command output. Backend `APP_ENV=local` loads `.env` then `.env.local`; this runbook assumes the existing configuration is retained. A fresh machine must configure equivalent isolated services and secrets first.

| Component | This verification environment |
|---|---|
| Compose project / application slug | `field-shift-dev` |
| PostgreSQL | `127.0.0.1:55439`, database `field_shift` |
| Temporal | `127.0.0.1:7249`, namespace and task queue `field-shift-dev` |
| S3-compatible local storage | `http://127.0.0.1:9049`, bucket `field-shift-dev` |
| Local email SMTP / inbox UI | `127.0.0.1:1049` / `http://localhost:8049` |
| API / frontend | `http://localhost:8040` / `http://localhost:3040` |

In `sideronostos-backend`, install locked dependencies and bring up the isolated infrastructure, then migrate its database. Do not run destructive volume-reset commands.

```sh
uv sync --extra full --frozen
docker compose --project-name field-shift-dev --env-file .env.local --profile workflow --profile identity --profile saas up -d
.venv/bin/alembic upgrade head
```

Start each host process in a separate terminal from `sideronostos-backend`. Workers support the retained workspace features; the deterministic Field Shift calculation itself is synchronous and does not require an LLM key.

```sh
.venv/bin/uvicorn sideronostos_backend.app:app --host 127.0.0.1 --port 8040
```

```sh
.venv/bin/python -m sideronostos_backend.modules.temporal.worker
```

```sh
.venv/bin/python -m sideronostos_backend.modules.jobs.dispatcher
```

In `sideronostos-frontend`, use the pinned **pnpm 10.15.0**. Its ignored local configuration uses `NEXT_PUBLIC_APP_URL=http://localhost:3040` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:8040`; backend CORS and auth origins must include that frontend origin. Public Next.js values are captured at build time. Do not substitute a different major pnpm version: the existing lockfile includes a package patch.

```sh
npx --yes pnpm@10.15.0 install --frozen-lockfile
npx --yes pnpm@10.15.0 exec next dev --hostname 127.0.0.1 --port 3040
```

For a production-build check, stop only that frontend development process before starting a separate production server on the same port:

```sh
npx --yes pnpm@10.15.0 build
npx --yes pnpm@10.15.0 exec next start --hostname 127.0.0.1 --port 3040
```

Open `http://localhost:3040/field-shift`, sign in to a locally verified account, and follow the six steps. A new account can be verified through the local inbox UI. Preserve the browser session and saved plan ID when testing reload/API restart; compare the reopened field/history and full exported snapshot with the earlier evidence. The commands above reproduce the verified local configuration. Production-build and runtime evidence is recorded below; this does not establish deployment readiness or successful installation on every fresh machine.

## Acceptance/evidence matrix

Final status: **PASS within the stated local demonstration scope; no open critical finding.** The root verifier completed the final production-build/browser/print gates and reported 166 frontend and 166 backend tests passing. The independent review's separately executed 25-test check is dated and scoped in its own report. No remote push or deployment was performed.

| ID | Required proof | Status |
|---|---|---|
| J1 | Create/edit field+history via browser; reload and API/database agree | PASS: actual browser creation/edit/history/reload and API snapshot checks; final production-build UI created another field and saved its complete plan. [Journey evidence](output/evidence/product-qa.md), [final exported plan](output/evidence/production-saved-plan.json). |
| J2 | Climate adapter real-provider smoke, dated cache, null quality handling, honest failure fallback | PASS: captured real NASA response/reprocessing, 41 adapter tests, authenticated cached GETs, persistent coordinate-bound cache and failed-refresh preservation tests. Real provider smoke is distinguished from mocked failure cases. [Backend evidence](output/evidence/backend-verification.md), [runtime API evidence](output/evidence/runtime-api.json). |
| J3 | Goals/constraints validated; zero/unknown distinct; inputs survive error | PASS: model/form/API validation, mobile zero-resource/no-feasible journey, reload-restored draft, save-failure retry and newer-draft protection regressions. [Product QA](output/evidence/product-qa.md), [independent review](output/evidence/adversarial-review.md). |
| J4 | Engine hard constraints precede ranking; history/calendar/soil/resources; no-feasible case | PASS within configured-rule scope: 30 engine tests plus API/browser no-feasible checks. No claim of local agronomic calibration. |
| J5 | Baseline + alternatives comparable on same horizon; explanations traceable | PASS: three-year totals, annual limits, representative crop combinations, visible conflicting baseline, source/rule explanations and full profile snapshot verified in API and rendered comparison. [Product QA](output/evidence/product-qa.md). |
| J6 | Scenario changes recalculate; saved evidence snapshot survives reload and restart | PASS: real scenario deltas, save/reopen/JSON export, browser reload and API restart; original 8.5 ha/version-1 snapshot remains unchanged after the current field becomes 9 ha. [Restart evidence](output/evidence/restart-persistence.json), [preserved original plan](output/evidence/saved-plan-after-restart.json). |
| Q1 | Desktop/mobile actual journey, screenshots inspected, keyboard/focus/contrast/touch | PASS in local Chromium scope: desktop/mobile production screenshots inspected, keyboard/dialog/focus and 320/390/720 CSS-pixel reflow checked. Final comparison and mobile saved-plan axe scans each have zero violations and zero incomplete items. Four-page print output visually checked. No real-device, screen-reader certification or farmer study claimed. [Browser quality](output/evidence/browser-quality.json), [product/print QA](output/evidence/product-qa.md). |
| Q2 | Unit/component/API/integration regressions and production build | PASS for this change: root reports final 166 frontend + 166 backend tests, frontend production build/lint/TypeScript and changed-backend lint/typing passing; migration install/rollback/re-upgrade verified. Existing whole-backend Ruff 51, mypy 7 and three schema discrepancies remain explicitly documented, not hidden as passing. [Backend evidence](output/evidence/backend-verification.md), [final product QA](output/evidence/product-qa.md). |
| Q3 | Measured API generation/cache/payload/browser navigation; fix material bottlenecks | PASS for bounded local measurement: API/cache/payload and engine samples above; five warm full navigations per state yield readiness median/P95 74/107 ms (field), 75/124 ms (comparison), 74/126 ms (saved). No deployment, WAN, concurrent-load or real-phone performance claim. [Browser timings and method](output/evidence/browser-performance.json). |
| Q4 | Fresh adversarial review; no open P0/P1 functional/usability findings | PASS: independent backend/UI/async-context review, reproduced race findings corrected, 25 focused tests independently rerun; root's final production/print checks completed. No open critical finding in the declared scope. [Independent review](output/evidence/adversarial-review.md), [final QA](output/evidence/product-qa.md). |

## Iteration log

- Baseline inspected; clean main at 6c6edcc. Native worktree tool cannot address nested repository (not a git repository at thread root); created sibling linked worktree under NASAappChallenge/.worktrees/field-shift. No source branch changes.
- Runtime dependencies and local Docker were initially absent. Pinned dependencies and an isolated `field-shift-dev` runtime were subsequently configured; local authentication/email, PostgreSQL, NASA retrieval, frontend and API journeys were exercised.

- Engine review found identical-metric permutations obscured comparison. The selection policy now prioritizes a different crop combination and describes remaining ties honestly; regression cases pass.
- Environmental review found NaN and boolean provider coordinates could pass equality checks. Coordinate type/finiteness/range validation and malformed-geometry fallback regressions now pass.
- Review identified that failed refresh could overwrite a usable real cache. The preserve-real-cache branch now passes real-PostgreSQL regression coverage with controlled weather failure; timestamps/fingerprint remain unchanged.
- Independent frontend review reproduced late refresh responses populating another field's cache and old submissions clearing a newer draft. Request ownership/context, version-monotonic field caching, conditional draft clearing and page-unmount navigation guards resolved these cases. The independent final focused rerun passed 25 tests; the root's later full frontend suite passed 166.
- Final production-build browser verification created and saved a new field/plan through the UI, exported its full JSON, inspected desktop/mobile states, and checked four printed pages. Final comparison/mobile saved-plan axe scans contain no violations or incomplete findings. The earlier original-plan reload/API-restart evidence remains intact. Final results and bounded performance measurements are linked in the matrix above.
