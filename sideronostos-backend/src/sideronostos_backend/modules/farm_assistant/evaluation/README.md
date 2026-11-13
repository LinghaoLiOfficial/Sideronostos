# Rotation evaluation: real runs and offline replay

The real evaluator is `run.py`. The offline diagnostic is `replay.py`; it reads an archived report and its exact frozen fixture, with no database, embedding or model calls. They answer different questions.

## Offline review without provider allowance

From `sideronostos-backend`, using the installed virtual environment:

```sh
make replay-assistant ARGS='--report ../output/evidence/rotation-v2/eval-regression-v5-mini.json --fixtures ../output/evidence/rotation-v2/eval-fixtures-v2-status.json --output ../output/evidence/rotation-v2/my-offline-review.json'
```

The output must be a new filename. Fixture SHA256 and case identity must match the original report exactly. The tool never updates inputs, original scores, questions or semantic reviews. Reports contain IDs, hashes and rejection reasons, without copying answer prose or retrieved literature. It checks the current context projection, generation schema, numeric binding, source IDs, actions and supported optimality claims. It does not establish semantic entailment or comprehension.

| Archived report | Matching fixture | Current offline result |
|---|---|---|
| `eval-regression-v5-mini.json` | `eval-fixtures-v2-status.json` | 96 accepted, 2 rejected, 98 total |
| `eval-regression-v5-new-cases-mini.json` | `eval-fixtures-v3-acceptance.json` | 32 accepted, 32 total |
| `eval-regression-v6-new-cases-mini-medium.json` | `eval-fixtures-v3-acceptance.json` | 8 accepted, 24 without replayable output |

The two rejections are the previously observed Arabic-Indic year and circled inline citation. An accepted result can still be wrong: the medium report includes the confirmed drought-severity/disease-severity substitution in `acceptance-v2-04/1`. This proves why local guards and semantic review are separate gates.

## Frozen case identities

- v1: 60 original cases; SHA256 `41985bfa558fb7a58108b44bd0440e050c7d3d5b5ebc4888acf7ae1fec7a6134`. Its first test split is already exposed; later runs are regression.
- v2: 20 formerly prospective cases; SHA256 `1982a654fbda9dd680246f6bd0a11e7801fe4ce4b8b005870cfe1ecb0d333afa`. Its first score remains 16/20; later 19/20 is regression.
- v3: 20 prospective cases; SHA256 `a6b6514e1d5768a9fda7f431a112704ec44e8651b8d6afc0a5b68310630b095c`. No generation run yet. Preserve its expectations and do not tune on output before the protected run.

Prompt v15 is a candidate prepared from a confirmed failure: paraphrases must preserve the phenomenon, outcome, population and qualifiers in the cited passage. It also requests direct conversational wording without report headings by default. These changes have **no real generation result**. Replay does not execute a prompt and cannot demonstrate that v15 improves answers. The default configured model remains Nano; no new model choice is implied.

## Resuming real evaluation later

Real evaluation, embedding preparation and new assistant messages use provider allowance.
The subsequent 2026-11-14 integration goal explicitly requires real AI/end-to-end evaluation
and supersedes the earlier offline-only stage. No v16 real generation result is recorded yet.
Preserve the historical reports above; freeze daily cases and fixtures before candidate
outputs and use an isolated evaluation database/release.

Next: restart the backend with the intended candidate, record the model/reasoning configuration and source hash, and run development plus exposed-case regression into new report files. Review the unchanged 90% rubric and numeric/source/owner hard gates. Source entailment includes preserving the type of outcome; a citation ID match alone is insufficient. Only a completed `promote_to_held_out` review permits the prospective v3 run. Neither partial medium batches nor replay results qualify.

The existing real runner accepts `--split dev|test|regression`, `--cases`, `--fixtures`, `--output`, and `--dev-review`. Consult its `--help` for syntax, then use a unique output path. Reviewers must preserve all original scores and report paid costs, provider failures and source limitations separately. The current comparison is not independently validated by an agronomist or farmer.


## Daily v3 candidate (2026-11-14)

Current prompt is `farmer-evidence-bound-20261114-v16-daily`. Daily metric/gap projection,
shared nullable comparisons and compatible versioned help retrieval have deterministic tests.
The 47-source v3 manifest has been validated and prepared offline; vector activation and
semantic acceptance remain pending. See `docs/integration/model-v3-assistant-contract.md`.
The protected v3 case set above is unchanged and unrun. New daily cases must have a distinct
version and frozen hash; existing protected cases must not be silently rewritten for v3.
