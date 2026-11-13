# Backend verification — 2026-11-12

Implementation checkout: `codex/field-shift`. Main repository source was not modified by this verification. No commit or deployment performed.

## Results

| Requirement | Result | Evidence |
| --- | --- | --- |
| Complete backend regression suite | PASS | `DATABASE_URL=<dedicated-test-db> FIELD_SHIFT_TEST_DATABASE_URL=<dedicated-test-db> .venv/bin/python -m pytest -q --tb=short`: **166 passed in 2.99s**. |
| Changed/new Python source, tests and migration Ruff | PASS | `ruff check` for Field Shift, changed auth/core files, new tests and migration: **All checks passed**. |
| Changed/new source typing | PASS | `mypy` for Field Shift, changed auth/core files with `--follow-imports=silent`: **no issues in 15 source files**. |
| Patch whitespace | PASS | `git diff --check`: exit 0. |
| Clean migration installation | PASS | All Alembic migrations installed on the dedicated `field_shift_test` database with `alembic upgrade head`. |
| New migration rollback and restoration | PASS | `alembic downgrade -1` reached `foundation_0011_group_schedule`; only three Field Shift tables disappeared, and `users`, `organizations`, `auth_tokens` remained. A subsequent `alembic upgrade head` succeeded. |
| New tables match metadata | PASS | Alembic autogenerate comparison found no differences for Field Shift tables. |
| Whole-repository Ruff | BASELINE FAIL | 51 unchanged issues: 50 E501 and 1 I001. A read-only check of the main checkout reproduced exactly the same 51 issues. |
| Whole-repository mypy | BASELINE FAIL | 7 errors in unchanged `ai/graph.py` and `ai/gradio_console.py`; 91 source files checked. |
| Whole-repository Alembic metadata check | BASELINE FAIL | Existing redundant unique constraints on `group_invitations.token_digest`, `organizations.slug`, and `users.normalized_email` are absent from current model metadata. No Field Shift difference. |

## What the persistence/API tests prove

The tests use real PostgreSQL sessions and the real API/service/rotation engine. Only the external weather request and the authenticated identity dependency are controlled fixtures. Real browser authentication is verified separately; these tests do not substitute for it.

- Fields, analyses and saved plans are scoped to the authenticated owner; another owner receives 404 and cannot read, edit or save them.
- Concurrent field edits produce one success and one 409, preserving the winner and incrementing the field version once.
- Invalid profiles, unknown crop IDs, duplicate history years, invalid coordinates/area, blank names and forged ownership fields are rejected before persistence.
- Weather caches are bound to exact coordinates and reference year; changed coordinates fetch again. Demo fallbacks retain their demo status and retry after a short cache lifetime.
- A failed refresh preserves matching real observations, original fingerprint and `fetched_at`, and adds an explicit failure limitation. Changed coordinates cannot reuse that cache.
- In-flight weather cannot be attached to a field edited during its fetch; a version conflict returns 409.
- Analysis metrics are computed on the server. Client-supplied metrics are rejected. Field edits, subsequent weather refreshes and scenario recomputations do not mutate earlier analysis or saved-plan snapshots.
- Saved plans contain the exact field, analysis, environment and full profile assumptions. Concurrent duplicate saves return one durable plan identity.
- Unknown/infeasible options cannot be saved.
- Registration and verification-resend preserve allowed relative `next` paths, including query/hash, in the actual rendered email. Unsafe/external paths are rejected with 422. Omitting `next` preserves previous link behavior.

## Scope and isolation

The dedicated database was `field_shift_test` on local PostgreSQL port 55439. It was exclusively reserved for this run. The application database `field_shift` was not read, reset or migrated by this verification. The test fixture resets only the three `field_shift_*` tables. No production provider traffic is claimed by the mocked-weather persistence tests; separate live NASA evidence is in this evidence directory.

Existing baseline lint/type/schema discrepancies were reported and left unchanged. No new blocking backend defect was found during ownership, versioning, immutable-snapshot and concurrency review.

## Browser authentication round-trip

**PASS — real browser, public APIs, background email delivery and local Mailpit.** Independent Playwright CLI session `fieldshift-auth`, desktop viewport 1440 × 1000, approximately 2026-11-12 00:13–00:17 Asia/Shanghai.

Fixture: `farmer.returnpath@example.com`, display name `Return Path Farmer`. No database edits, token bypass, service restart or mocked browser response was used. Only this fixture's email was read. One-time verification tokens were redacted from command output and are absent from this report.

1. Opened `/login?next=/field-shift`; the registration link was `/register?next=%2Ffield-shift`.
2. Registered the fixture through the rendered form. The resulting URL was `/verify-email?email=farmer.returnpath%40example.com&next=%2Ffield-shift`.
3. Read the delivered fixture email from local Mailpit on port 8049. Its verification link targeted the local frontend `/verify-email` and preserved `next=/field-shift`.
4. Opened that email link in a new browser tab. The UI displayed `邮箱验证成功，请前往登录`; both login links preserved `/login?next=%2Ffield-shift`.
5. Logged in with the verified account through the rendered form. Final route: **`/field-shift`**. Title: **`Field Shift · Agrisata 轮作规划`**. The logged-in farmer name and initial planning form were visible.
6. Desktop snapshots across login, registration and verification showed Agrisata / Field Shift copy. The final DOM assertion confirmed `agrisataVisible=true`, `knowledgeOSVisible=false`, `farmerVisible=true`, and `hasPlanningForm=true`.

Visual evidence: [successful farmer return, desktop](../playwright/field-shift-auth-return-desktop.png). The screenshot was visually inspected: Agrisata header, farmer identity, navigation and initial field form render correctly without overlaps at the tested viewport.

The browser logged expected unauthenticated `GET /users/me` 401 responses before login and development HMR messages. No additional error was observed after successful login.
