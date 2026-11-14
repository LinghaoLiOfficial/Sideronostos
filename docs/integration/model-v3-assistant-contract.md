# Daily v3 assistant evidence contract

Status: deterministic projection/validation implemented; real v17 semantic evaluation and
v3 vector release are NOT VERIFIED. A working model call alone is insufficient acceptance.

## Responsibilities and immutable identity

`field_shift` owns saved fields/history. `agri_data` owns prepared observations/weather.
`rotation_optimizer` computes and independently verifies results. `farm_assistant` explains
owned frozen facts; `knowledge` supplies versioned supporting passages. The bot has no write
actions for farms or saved plans. Changed conditions require a new deterministic calculation.

`context.py` enforces ownership, freezes the run's original field versions and dispatches
v3 evidence through `daily_evidence.py`. Shared `rotation_optimizer/comparison.py` supplies
both the API and bot with the same compatibility and nullable-delta rules. The frontend's
`use-rotation-snapshots.ts` loads a saved plan's run; a stray URL run ID cannot replace it.

## What the bot can cite

- Six raw metrics: estimated profit USD, net irrigation m³, rotation-transition score,
  soil-contribution proxy score·ha, weather/irrigation-exposure proxy score·ha, bare ha-days.
- Only complete, independently scientifically verified options expose numeric result facts.
  Failed/cancelled/pending/no-incumbent runs cannot expose stale option numbers as results.
  A hard-invalid baseline may have scientifically checked metrics but remains non-actionable.
- Disabled optional metrics remain null with their reason. Actual zero stays zero.
- Resource gap cost/count and, for the selected option, the first 12 stored positive gap rows
  with date, resource, used/capacity/gap/unit, remedy and original input evidence. The shown
  count and full count are explicit; all rows remain in the result/export. Do not imply that
  the bounded explanation contains every gap.
- Model/profile/weather versions and hashes, engineering scope, historical-weather basis and
  independent dry initial-root-zone policy. This is not continuous multiseason soil-water
  simulation, a measured saving, future weather, guaranteed profit or implementation approval.

`implementation_ready` is always false for these modeled scenarios. Zero modeled resource
gaps cannot prove actual bookings, water rights or local crop calibration. Positive gaps are
conditional diagnostic plans. Hard constraints are not converted into remedies. Proven
optimality also requires both lexicographic solver proof flags and a valid feasible option.

Cross-run comparison requires identical frozen field IDs/versions, dates, profile ID/hash
and weather hash. Deltas are second minus first and remain null for unavailable metrics.
Actual objective weights/scales determine score comparability. Within-run alternatives carry
raw facts and server-computed change directions; the model must not invent numeric deltas.

## Retrieval and answer validation

Prompt candidate: `farmer-evidence-bound-20261114-v17-daily-diagnostics`. New workflows and daily runs use
HELPV3. Old v1/v2 results retain compatible product help. V3 excludes HELPV2; old results
exclude HELPV3/MODELV3/DATAV3 before lexical/vector rankings. The visible projection and
citation binding repeat this scope so hidden/incompatible passages cannot become citations.

Existing ownership, numeric placeholders, evidence IDs, allowed read-only actions and quote
validation remain. The validator also rejects affirmative implementation-ready claims when
the supplied daily evidence says otherwise. Lexical guards do not prove semantic correctness;
source entailment and comprehension need the unchanged evaluation rubric.

`library-manifest-v3.json` preserves all prior sources plus the v3 product reader and exact
NASA modeling/data-requirement docs at commit 8c498cf. These product/model documents are
implementation authority, not independent agronomic validation. Source hashes and original
URLs remain attached. The offline bundle is 47 sources / 4,911 chunks / 28 reviewed claims.
The CLI's existing default manifest is unchanged; use the explicit v3 manifest for preparation
and publication. No vector activation or real generation evaluation is claimed here.

## Required next evidence

Freeze daily development, exposed regression and protected case identities and source/fixture
hashes before candidate outputs. Cover six-metric interpretation, null/zero, positive gaps,
hard failure, unavailable data, old-version compatibility, changed drafts, comparison,
source entailment and owner isolation. Review development/regression before a protected run;
preserve previous v1/v2/v3 scores and untouched protected expectations. Record provider/model,
configuration, source hash, retrieval release, real costs/errors and human semantic judgment
separately. Current real-region calibration and independent agronomic review remain absent.


## Preparation failures and frozen inputs

Blocked daily preparation now adds sourced facts for the preparation stage, error total,
bounded shown-error count, affected field/crop/baseline date and recorded per-reason candidate
counts. These are diagnostics for that frozen generated set, not validated schedule metrics
or proof that all agronomic choices fail. Rejection reasons may overlap and cannot be added
into a distinct-candidate count. Chat can suggest reviewing actual form inputs but cannot
relax hard limits or add irrigation infrastructure. The actual rainfed browser run supplies
the regression: nine rejected candidates, no plan metric, no nonexistent option request.

Prompt v17 and the failure adapter are unevaluated semantic candidates. The v5 input archive
preserves the original 26 case expectations and changes only the two failed-run contexts
(7 added bound facts each). The other 24 contexts are byte-equivalent as JSON values.
The v4 archive remains immutable. See `ai-diagnostics-fixture-update.json` for both hashes.
All seven current owner/version gates and compact/full projection equivalence checks pass.
No provider calls or held-out answer evaluations were made for this change.
