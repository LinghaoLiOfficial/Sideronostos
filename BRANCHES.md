# Branch map / 分支说明

Baseline: `02713512f16013a23d28d193a48fedfbecd3110d` (original `grok_bot`). No existing shared commits are rewritten. `integrated` is the delivery branch; topic branches remain local unless separately published. The active checkout is `integrated`.

| Branch | Scope | Parent / dependency |
|---|---|---|
| `grok_bot` | Reusable bot UI: `src/lib/bot.ts`, `src/lib/dictation.ts`, `src/components/bot/` in the frontend. Pet launcher, hover/click chat, browser dictation, paragraph replies, tests and usage guide. | Original baseline plus shared local-artifact ignore rules. No RAG, map, solver or model credentials required. |
| `feature/knowledge-base` | Versioned literature manifest, ingestion/chunks/claims, hybrid retrieval/embeddings, pgvector, migration 0013, preparation CLI and tests. | Baseline plus the same ignore rules. |
| `feature/nasa-data` | SMAP QA/native-grid tiles/point facts, prepared historical weather, owned map selections, migration 0014 and tests. | `feature/knowledge-base` (migration chain). |
| `feature/rotation-optimizer` | Candidate generation, MILP/verifier/profiles, persisted runs/plans, worker lease protection, field history/boundary extensions, migration 0015 and tests. | `feature/nasa-data`. |
| `feature/bot-rag` | Conversation backend, trusted context/retrieval, validation, provider configuration, source access, persistence, evaluation/replay, migration 0016 and tests. | `feature/rotation-optimizer`. |
| `feature/field-shift-ui` | Map/planner/results routes, API adapter/types, Rotation conversation adapter, selected-area sidebar and integration documentation. | Merge of `grok_bot` and `feature/bot-rag`. |
| `integrated` | Complete product and delivery branch. | Initially the same commit as `feature/field-shift-ui`. |
| `backup/rotation-before-split-20261113` | Recovery snapshot of the uncommitted implementation before this split and bot extraction. | Original baseline. Keep until the split is accepted. |

The backend branches form a stack, **not independent replacement backends**. Their migrations are linear (0013 → 0014 → 0015 → 0016). Each branch only registers modules and declares preparation commands that exist at that stage. Python optional extras are split into `knowledge`, `science`, `optimizer`, then the `assistant` umbrella; matching lockfiles preserve the existing package versions. `full` includes the available feature extras.

## Review and continue

```sh
# Complete local product
git switch integrated

# Work only on reusable bot UI (no new product routes in this branch)
git switch grok_bot

# Review one backend category without earlier stack changes
git diff feature/knowledge-base..feature/nasa-data
git diff feature/nasa-data..feature/rotation-optimizer
git diff feature/rotation-optimizer..feature/bot-rag

# UI integration commit, excluding its already combined backend and bot parents
git diff 0af94663..feature/field-shift-ui
```

Build the frontend after switching branches; `.next` is ignored local build output and is not a branch snapshot. Do not downgrade the integration database to run an earlier stack branch: use a separate database for migration checks. Read `ROTATION_V2.md` for the full local setup; read `sideronostos-frontend/src/components/bot/README.md` for component-only use. Future topic changes can be merged upward through the stack and then into `integrated`.

## Verification and limits

- Generic bot export: component tests, TypeScript and production build pass. It imports no Rotation, NASA, optimization or provider modules.
- Backend branch exports: module import/registration and one Alembic head pass at each stage; targeted offline suites pass (knowledge 10, data 27, optimizer 29, RAG 90).
- Companion update: frontend 213 tests and the production build pass. The standalone bot export passes 19 tests and a production build. Backend code is unchanged; its prior 338-test baseline was not rerun.
- Earlier browser evidence includes the now-superseded full-screen view. Current companion/voice verification is recorded separately; see `sideronostos-frontend/src/components/bot/DESIGN.md` and the acceptance record.
- `.env.local`, downloaded scientific files, prepared literature/releases, evaluation output and screenshots remain local and ignored. Source manifests, recipes, authored help, schemas and tests are committed.
- Source prompt v15 is still an unvalidated candidate; AI semantic acceptance remains HOLD and the default remains Nano. No paid model/embedding calls or deployment were made during the branch split or companion update. The user subsequently requested pushing `integrated`.

## Selection navigation follow-up

A production-browser regression exposed a saved selection whose API response and requested navigation contained the new ID, while the router applied the previous URL. Same-page query updates now use native `history.replaceState`; map/rotation page changes still use `router.replace`. This keeps the URL, query cache and bot selection context synchronized without revisiting the prefetched page route. Next documents this integration with `useSearchParams` in [Native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api). The fix is confined to `feature/field-shift-ui` and `integrated`.

## Companion update (2026-11-13)

Forward commits remove full-screen mode from `grok_bot`, `feature/field-shift-ui` and `integrated`; these are the only branch tips containing that feature. The four backend topic branches and the pre-split recovery snapshot do not contain it and need no removal commit. The generic bot branch receives pet motion and browser dictation; the integration branches also remove the domain data-page adapter. No migrations, backend algorithms, scientific datasets or provider credentials change.
