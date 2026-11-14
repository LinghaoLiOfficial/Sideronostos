# A2: saved daily v3 evidence in the map assistant

## Review boundary

This is a basic functional slice on `review/clean-map-language` (PR #6), after
#3 → #4 → #5. Review only this branch's diff against #6. The completed browser
journey with a dedicated database, Temporal worker and live model belongs to B.
No production deployment or AI quality promotion is claimed here.

## Contract and changes

- `/fields?plan=…` restores the owner-scoped saved plan, its run and its option
  through the existing versioned snapshot loader. A saved plan takes precedence
  over a conflicting run in the URL. Missing plans and options block assistant
  requests and expose a return-to-current-field action.
- Assistant references carry `plan_id`. The backend resolves it under the current
  owner, verifies explicit run/option bindings, and rejects snapshot disagreement.
  Saved title/time and their source identities become citable frozen facts.
- Historical messages retain their field versions, language, plan identity and
  source projection after current fields or conversation preferences change.
- Daily v3 facts cover all six metrics, schedules, resource gaps, independent
  verification, engineering limits, within-run alternatives and explicit cross-run
  comparisons. Missing values remain unavailable. V2 read-only projection remains.
- V3 contexts exclude V2 product help; V2 contexts exclude the three V3 sources
  before both lexical and vector ranking. Generated citations are restricted to
  the evidence visible to that request. This constrains identity, not semantic truth.
- A versioned manifest and three hashed readers provide V3 help/specification/data
  requirements. The existing manifest and V2 help are preserved.

## Fresh verification — 2026-11-14

| Check | Observed result |
| --- | --- |
| Backend affected regression | 125 passed, 0 skipped; five existing PyMuPDF deprecation warnings |
| Frontend full Vitest suite | 57 files, 327 tests passed |
| TypeScript | Passed, including the optional saved-plan message label |
| Production build | Passed; existing NASA terrain route tracing warning remains |
| Ruff and code whitespace checks | Passed for changed assistant/knowledge code and new tests; the frozen MODELV3 reader retains its original trailing blank lines to preserve its source hash |
| Offline knowledge preparation | 47 sources, 4,911 chunks, 28 claims; new packaged reader hashes match the manifest |

Backend tests use the dedicated local `sideronostos_review_stack_test` database,
never the journey or existing development database. Persistence tests exercise
the HTTP API, real Gurobi `run_job`, saving, owner isolation, stale/mismatched
references, message language/version freezing and source lookup. This does not
exercise Temporal dispatch or a live LLM.

Regression tests were observed failing before the relevant implementation:
14 daily projection cases, six map context cases, and the new saved-plan API
contract. The small projection fixture comes from a previously recorded v3
engineering execution; large weather/resource arrays were removed. It is not a
new scientific verification result. The preparation-failure fixture covers an
unavailable daily result.

The production frontend was inspected in a fresh Playwright session with explicit
API response fixtures at 1440×900. A plan-only URL showed `Frozen review field`,
an invalid option displayed its error and disabled sending despite a nonempty
draft, and reset removed the invalid context. No live login or model completion
is claimed by these screenshots. MapTiler was unavailable and the map fallback
was visible. Screenshots are local, untracked verification artifacts.

## Remaining gates

- B: fresh dedicated database and real worker; login → farm → confirmation →
  synchronization → readiness → generate/compare/save → refresh → same-field map
  → EN/ZH source/limits/difference questions, including mobile and failure paths.
- AI semantic/legacy/protected evaluation and paired comparison are still not
  passed. No paid broad evaluation was repeated for this slice. Deterministic
  schema/retrieval checks and successful UI states do not establish answer quality.
- Local agronomic calibration, implementation approval and the multiyear NASA
  adapter remain separate work. V3 results retain engineering limits.

After #6 merges, retarget this PR and rerun checks affected by the new base.
