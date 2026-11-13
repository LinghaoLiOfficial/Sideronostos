# Daily v3 computation contract and progress

Status: **kernel and profile/data-preflight API implemented; solver application integration pending**. This document does not
claim a working v3 farmer journey. Existing run/job dispatch still uses v2 as of this
checkpoint; old results have not been reinterpreted.

## Authority and versioning

`docs/NASA-modeling.md` governs the daily model. The external-data requirement table
specifies evidence and missing-data boundaries. `rotation_optimizer/v3/` separates the
new scientific and mathematical contracts from existing v2 snapshots:

| File | Responsibility |
|---|---|
| `contracts.py` | Strict finite scientific values, recipe-paired phenology, stage Kc/root/cover, six weights |
| `science.py` | First GDD maturity day, stage interpolation, effective rain, root water and trace |
| `scientific_verify.py` | Independently reconstruct maturity, Kc, roots, NIR and cover from frozen inputs |
| `readiness.py` | Values, units, sources, quality, confirmation, region/time and blocked features |
| `profiles.py`, `inputs.py` | Sourced regional releases and bounded incomplete farmer drafts |
| `preflight.py`, `weather.py` | Server-owned operating requirements, raw weather QA and calendar policy |
| `service.py` | Owned current fields/farms and read-only data-preflight snapshots |
| `model.py` | Validated frozen fields/candidates, periods, capacities and objective scales |
| `milp.py` | Single-path daily Gurobi model and two explicit priorities |
| `verify.py` | Independent chronology, all-pair gaps, resource totals, raw metrics and score |
| `solver.py` | Real Gurobi execution, cancellation/deadline/failure and verified publication candidate |

Versions: `rotation-milp-v3.0`, `daily-root-zone-v3.0`. Readiness output is
`rotation-readiness-v3.0`. The v3 profile and input snapshots now have their own contracts. See
`model-v3-data-contract.md`; published results still need their v3 dispatcher.

## Daily conventions

- Local agricultural dates, inclusive sowing/harvest. Occupied through harvest plus
  turnaround; the following sowing must be strictly later. Cover is a separate Boolean
  series across occupancy, and cannot silently count the whole turnaround as covered.
- Cultivar ID identifies seed/economic inputs; species ID controls adjacent-crop
  exclusion; family ID controls every conflicting candidate pair, including pairs with
  an intervening crop. Historical latest-possible end and precision remain explicit.
- The default draft GDD recipe applies its documented one-sided temperature bounds.
  `bounded_both_v1` is also representable but must be paired with its own maturity
  threshold; the recipe cannot silently change. Climate suitability still needs the
  subsequent profile/preparation layer; maturity alone never proves suitability.
- All daily capacities are explicit for every planning day. Seed/market periods partition
  the full horizon without overlap or gaps. No missing capacity becomes zero or infinity.
- Model bounds currently remain 10 selected fields, 240 candidates and 1200 edges.
  Excess is rejected, never truncated. The UI still needs a clear explanation of the
  difference from the map's larger partition count.

## Root water and the independent-candidate limitation

For a fixed rooting volume the implementation follows the source document's recursion:
`pre = max(0, prior_depletion + Kc × ET0 − effective_rain)`,
`NIR = max(0, pre − RAW)`, `end_depletion = pre − NIR`.
`TAW = 1000 × (FC − WP) × root_depth`, `RAW = p × TAW`.
Root depth is capped by measured effective soil depth. The Kc stage uses each day's
midpoint within the GDD-derived growing duration; root depth increases linearly over the
development stage, then stays constant. Stage fractions and depletion factors are inputs.

The first supported policy, `independent_wilting_point_v1`, requires explicit confirmation
and an evidence ID. Each candidate starts at wilting-point depletion, and no initial
available-water credit is granted repeatedly. When the root domain grows, its newly
explored volume is also assumed at wilting point. Before the daily recursion, the carried
depletion is increased by `1000 × (FC − WP) × change_in_root_depth`. This is an explicit
**conservative domain-expansion assumption**, not an added NASA observation. For a fixed
root depth this adjustment is zero. Root contraction is rejected until a separate recipe
is validated. Excess effective rainfall is recorded as same-day drainage.

This can overestimate irrigation: wet subsoil, off-season recharge, capillary rise and
water remaining after a prior crop are not credited. It is **not** a linked multiseason
soil-water simulation, a measured initial condition or an irrigation prescription.
The UI, result limitations and bot must retain that distinction. A future measured-state
or continuous-balance model needs a new recipe and cannot reset a measured reservoir for
every candidate.

FAO-56 defines root-zone available water, depletion and the need for an initial state;
those definitions support the water-state bookkeeping. The dry expansion policy above is
our disclosed engineering choice, not a claim that FAO prescribes dry soil:
[FAO-56 chapter 8](https://www.fao.org/4/X0490E/x0490e0e.htm).
Existing FAO-56 ET0 calculation remains in `agri_data/recipes.py`; weather ingestion and
its raw unit/QA/provenance verification now feeds v3 data preflight and still needs
to be connected to candidate generation and the queued job snapshot.

## Objectives, capacities and diagnosis

Raw units are profit `USD`, net irrigation `m³`, rotation score, soil score × ha,
risk score × ha and bare `ha-days`. Conversion is `10 × ha × mm = m³`. Daily water
capacities use **net root-zone volume**, not gross pump diversion. A gross input needs
an explicitly sourced efficiency conversion in the preparation layer.

Available metrics require positive scales. Weights sum to one with positive water weight.
Unavailable optional profit/rotation/soil/risk metrics require zero weight and a reason;
their reported raw value is `null`, not a fabricated zero. Yield remains required for
market capacity even when the profit objective is disabled. Bare caps can be disabled
with an explicit reason while the bare metric remains available.

The MILP includes one start and end per field, per-candidate predecessor/successor balance,
occupancy, hard suitability, irrigation infrastructure, historical/all-pair family gaps,
and species adjacency. Water variables equal the minimal required NIR. This removes
strictly dominated over-irrigation from the source model's lower-bound formulation;
positive water weight and nonnegative resource burdens preserve its optimal schedules.
Zero-demand water days need no variables, but remain explicit zeroes in verified results.

Remediable water/machine/seed/market/bare capacities have positive, sourced unit gap cost
and a proposed remedy. Hard capacities have no slack. Priority 2 minimizes total gap cost;
priority 1 maximizes the normalized signed six-metric score, with objective degradation
and MIP optimality-gap tolerances set to zero. See
[Gurobi multiobjective documentation](https://docs.gurobi.com/projects/optimizer/en/current/features/multiobjective.html).
Numerical feasibility checks still have explicit finite tolerances.

Every result is independently checked from the selected schedule, not Gurobi expressions.
Positive gaps mark a diagnostic result. `resource_feasible` only concerns frozen operating
constraints; it is not proof of local agronomic calibration. Timeout incumbents never
claim proven priority optima. Excess incumbent slack can be reduced to the actual minimum
needed by that fixed selection and is labelled accordingly. No solver/license fallback
fabricates a result. Full v3 service publication still needs to call both independent
verifiers before an option can reach the UI or assistant.

## Readiness boundary

Readiness reports preserve the supplied value, actual/expected unit, source records,
observation dates separately from applicability dates, region, quality, confirmation,
assumptions, missing reason and affected features. A confirmed zero is usable; unknown,
wrong units, rejected QA, missing provenance or inapplicable source scope blocks use.
Engineering assumptions require explicit acceptance and stay labelled as uncalibrated.

`assess_readiness` is a reusable engine. Its requirements and enabled features must be
constructed by the server-owned profile/preparation policy, never chosen arbitrarily by
an API client. That server policy is now exposed through the v3 data-preflight API;
the farmer-facing v3 input flow and candidate-level checks remain pending.

## Verification so far

Small synthetic fixtures include hand-calculated root balances, corrupted trace rejection,
strict input/readiness boundaries, all five resource gaps, direct-successor benefits,
intervening-species family conflicts, historical adjacency, actual Gurobi cancellation,
license failure and tiny deadline behavior. A two-field cross-product enumerator computes
its own objective/resource oracle and agrees with the actual Gurobi optimum.

Remaining: suitability/economic/risk coefficient preparation and candidate-level checks,
service/job/version dispatch with frozen active farm partition/resource snapshots,
frontend planning/results, assistant/knowledge extension, frozen/live AI evaluation and
the full real-browser saved-plan journey. A kernel test passing is not completion.
