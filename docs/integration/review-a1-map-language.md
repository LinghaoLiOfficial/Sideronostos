# A1: farmer map entry and language on the review stack

Base: `review/v3-daily-planner-ui` / PR #5 at `8d08c0f`.

## Purpose and scope

Port the farmer interface slice from PR #2 onto the reviewed farm, daily API and
planner stack. A first visit starts in English. The explicit Chinese selection
persists in a cookie and local storage, updates `html.lang`, and does not remount
the farmer's form. `/` redirects to `/fields`; the status page is at `/status`.

Map, field details, daily planning/results and authentication share that language.
The assistant captures the UI language when sending and updates a restored
conversation's preference before submitting the message. A failed preference
update preserves the question and prevents a message in the wrong language.
The mobile farm drawer has an explicit close button and restores trigger focus.

Conflicts were resolved against the clean stack. NASA analysis/backtest links,
v2 CSV export, farm deletion, and the existing data-read paths were preserved.
No backend, science-raster retry implementation, AI knowledge release, or old
development-branch history was imported. The map's v3 saved-plan binding remains
the next A2 slice.

## Verification (2026-11-14)

- Baseline: 21 authentication/assistant tests passed before the port.
- Full frontend regression: 56 files, 321 tests passed.
- Language regression was run against the original assistant implementation:
  all three cases failed on language/preferences behavior; the port passes all three.
- TypeScript and production build passed. Conflict markers and `git diff --check`
  were checked before commit.
- Production UI inspected at 1440×900 and 390×844: default English, explicit
  Chinese, persistence after refresh, mobile drawer close/focus recovery, and no
  horizontal document overflow. Deep-link parameters remain in the login return
  URL. The English/Chinese auth and planner flows also have component regressions.

The first regression run had a test-helper import typo (320 passed, 1 failed).
It was corrected and the full suite rerun successfully. A subsequent focused
run verifies the final label and merge-resolution changes.

## Verification boundary

The browser used a fresh anonymous session and a deterministic 401 response for
`/users/me`, because this slice does not configure the integration backend.
No existing authenticated farmer session was transferred. MapTiler was not
configured; the visible fallback map remained usable. Screenshots are retained
locally in `output/playwright/a1-*` and excluded from the code commit.

This is a basic functional UI slice, not the real database/worker integration
acceptance. Real login, sync, readiness, generation, comparison, saved-plan
restoration and the v3 bot evidence path remain A2/B gates. NASA multi-year v3
adaptation and the existing AI semantic-quality failures are also unresolved.

## Review order

Review PR #3 → #4 → #5 → this slice. PR #1 is the kernel included by #4.
PR #2 records the source patch on the old development branch; this port is the
clean-stack version. Retarget and rerun affected checks when prerequisites merge.
