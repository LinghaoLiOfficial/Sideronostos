# Daily v3 data preparation contract

Status: v3 profile, readiness, candidate preparation, frozen jobs, frontend planning/results,
immutable saves and deterministic assistant evidence are implemented. Single- and two-field
engineering browser journeys have been verified. Live AI semantic acceptance remains HOLD.
`POST /rotation-optimizer/runs` remains the legacy v2 endpoint; new planning uses `/v3/runs`.

## Available API

The endpoints use the existing verified-user dependency:

- `GET /rotation-optimizer/v3/profiles`: server-owned regional releases, content hash,
  structured crop parameters, source records and flattened value/unit/source audit.
- `POST /rotation-optimizer/v3/readiness`: an incomplete `PlanningDraft`, checked against
  owned, current-partition field records and the published weather release. Optional
  `X-Workspace-Owner` rejects a request whose captured account differs from authentication.
  The response includes blocked features, per-value issues, field/farm versions, weather
  provenance and a fingerprint of the exact input snapshot.

- `POST /rotation-optimizer/v3/runs`: repeat readiness under farm/field locks, capture the
  exact source-bearing snapshot, then submit through the existing idempotent job service.
  Incomplete inputs return 422 with `planning_data_not_ready` and create no job.
- Shared run, cancel, retry, export, comparison and plan endpoints dispatch by frozen
  model version. New saved snapshots use `rotation-saved-v3.0`; v2 remains readable.

A foreign field returns 404; a field in an archived partition returns 409. An old expected
field version is reported as a blocking readiness issue. Missing operating values and
unavailable weather are normal readiness results, not automatic substitutions. The
preview is read-only; computation submission must repeat these checks while locking farms
before fields. No readiness receipt authorizes a later run to reuse changed live data.

`ready: true`, `stage: data_preflight` means input and weather checks passed. It does not
promise that a suitable candidate exists, a feasible sequence can be found, or a farmer
can implement a plan. Those checks belong to the next preparation/solver stages.

## Source and regional contract

The release `iowa-engineering-v3-20261114` is explicitly an engineering benchmark. Generic
crop names stand for synthetic cultivar proxies. Its yield, prices, costs, thresholds,
root parameters, component scores, operations and scale references are assumptions,
not locally calibrated recommendations. Every executable leaf has a unit and a source;
longest matching origin-prefix resolves provenance without duplicating its value.
A profile hash includes source metadata and limitations, not only coefficients.

The profile has a region, weather centre/radius, agricultural timezone, selected GDD
recipes, crop/species/family identities, sowing windows, soil/climate rules, machine
operations, soil/risk component weights, transition scores and six positive scales.
Profiles can declare compatible historical catalogue releases; undeclared legacy
catalogues fail explicitly. Year/month history retains its latest-possible end and
precision. No prior cropping is a separate sourced declaration with a reason; unknown
history cannot be made usable by merely ticking a review checkbox.

The published profile and its requirements are server owned. Clients cannot submit MILP
coefficients or disable required features. Only profit/rotation/soil/risk objectives may
be disabled, with zero weight and a nonblank reason. Required yield and climate suitability
inputs remain required even if their associated optional objective is disabled.

## Farmer operating inputs

`field_conditions[field_id]` contains evidence-bearing scalar records for FC/WP, depth,
pH, salinity, drainage, slope, aspect, terrain position, mechanical access, effective rainfall, initial-water policy,
history/management review and baseline confirmation. A record has `value`, `unit`,
`source_ids`, and `missing_reason` when null. Values remain null when unknown; zero is
usable only when explicitly supplied and sourced. Malformed/nonfinite public scalar
values are rejected. Source entries preserve observation dates separately from planning
applicability dates, region, quality, confirmation and limitations.

`farm_resources[farm_id]` includes:

| Input | Unit and rule |
|---|---|
| Daily water calendar | `m3/day`; declared net or gross basis; gross needs sourced efficiency in `(0,1]` |
| Daily machine calendar | `h/day`; typed machine and explicit within-farm field membership |
| Date exceptions | Replace that day's declared normal capacity; never silently imply availability |
| Period seed capacity | `kg` for each selected crop and every planning period |
| Period market capacity | `kg` of output for each selected crop and every planning period |
| Field bare-day cap | `day`, or an explicit reason for not imposing a cap |
| Remediable limit | Strictly positive `USD/m3`, `USD/h`, `USD/kg` or `USD/day` cost, plus sourced remedy |
| Hard limit | No soft cost/remedy; an explicitly confirmed zero remains a hard prohibition |

One field has at most its one declared water system. Shared equipment membership stays
within the farm, with exactly one resource per required machine type for each selected
field. Unknown/unselected/foreign resource links are blocked. Periods partition every
planning day. All source applicability checks for capacities, gap costs and remedies span
the planning horizon. Daily defaults and exceptions are expanded into immutable daily coefficients. Gross
water becomes net capacity once; stated gap costs are explicitly per net cubic metre.

## Weather and dates

The earlier repository POWER sample has only temperature and precipitation. It cannot
supply the full FAO-56 input set. A new public NASA POWER retrieval now contains daily
minimum/maximum temperature, dewpoint, 2 m wind, pressure, corrected precipitation and
shortwave radiation for the 2025 Iowa reference point. The existing POWER adapter validated
365/365 days. v3 recomputes FAO-56 ET0 from raw variables during historical replay, checks
variable units/ranges/QA, complete dates, location, release identity and hashes, and never
uses the old monthly Hargreaves approximation as daily FAO-56 ET0.

Planning dates use `America/Chicago` in this benchmark, but source aggregates are UTC.
The explicit `utc_daily_proxy_v1` policy requires engineering acknowledgement and reports
`utc_aggregate_not_local_day`. It does not claim UTC aggregates were converted into local
agricultural days. A calibrated profile requires a validated local-day release or upstream
hourly reaggregation. Historical replay and perturbations are not future forecasts.
Leap-day substitution remains explicitly labelled by the existing replay recipe.

Evidence: `output/evidence/fields-bot-v3/power-v3-validation.json`, raw download and prepared
series in the same directory. The real weather release was published **only** in the
isolated `sideronostos_fields_v3_journey_test` database. The application database was not
migrated or populated. `journey-data-readiness.json` records the saved engineering field's
missing-data response with no operating values automatically filled.

## Implementation map and remaining work

| File in `rotation_optimizer/v3/` | Implemented responsibility |
|---|---|
| `profiles.py`, `data/profiles/*.json` | Typed releases, compatibility, parameter audit and hash |
| `inputs.py` | Incomplete bounded farmer drafts and v3 run envelope |
| `preflight.py` | Server requirements, history, geometry coverage and resource membership |
| `weather.py` | Complete raw-variable QA, explicit calendar policy and FAO-56 replay |
| `service.py` | Owned current fields/farms, snapshot fingerprint and read-only readiness |
| `resources.py` | Daily expansion, net/gross conversion and period/bare resource contracts |
| `coefficients.py`, `prepare.py` | Site suitability, actual-day operations, six coefficients and bounded sampling |
| `preparation_verify.py` | Source-to-coefficient audit, independent growth and resource checks |
| `execution.py` | Frozen preparation, lexicographic solves and independently verified options |
| Parent `service.py`, `execution.py`, `router.py` | v3 submission, jobs, immutable saves and version-aware comparison |

## Candidate preparation and execution

The compiler includes all confirmed baseline dates, including dates off the normal sampling
step. It filters site, climate, management, history and individually impossible hard resource
conditions. Shared constraints remain in the MILP. Candidate, edge and sample limits fail
explicitly; the compiler never silently truncates a field or candidate list. Each field
needs a surviving confirmed baseline and a candidate before solving. A jointly invalid
baseline remains visible with violations and cannot be saved as a feasible plan.

Profit is profile yield × price − cost; soil is the declared weighted contribution score.
Risk combines historical heat/frost/excess-rain exposure and irrigation dependence. These
are estimates and proxies, not loss probabilities or measured soil changes. The full export
retains growth/water traces, operating evidence and profile hashes; normal run responses
omit the large problem/trace payload. The independent audit checks accepted coefficients,
metadata, calendars and resources, not completeness of the sampled search space.

The primary solve uses the user's six metric weights after minimizing resource gap cost.
Available metrics also receive declared 95% emphasis in bounded alternative searches,
with the primary gap cost as a ceiling. Duplicate schedules are removed. If needed, one
excluded-primary search looks for another schedule. No full Pareto frontier is claimed;
non-dominance is only among generated options. All solves together receive at most twice
the configured per-solve budget (preparation is separate and subject to the job deadline).
A time-limited incumbent never claims proven minimal gap or globally optimal score.

Independent verification distinguishes hard validity, zero resource gaps and diagnostics
requiring remedies. Saved plans include that label, the frozen inputs/profile/weather,
actual selected weights and all source evidence. Missing optional metrics remain null,
including comparison deltas. Different model releases cannot be directly compared.

The current `/field-shift/rotation` form uses v3. Legacy results dispatch to their original
readable views. See `acceptance-and-handoff.md` for the farmer workflow and actual data gaps;
real v17 generation and v3 knowledge activation still require provider access and evaluation.
