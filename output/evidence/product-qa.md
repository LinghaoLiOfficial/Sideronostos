# Field Shift product verification

Scope: the farmer journey required by `FIELD_SHIFT.md`, implemented in the isolated `codex/field-shift` checkout. Verification date: 2026-11-12 Asia/Shanghai. This is local development/product verification, not production certification or farmer usability research.

## Evidence boundaries

- Real integrations: Chromium browser, Next frontend, FastAPI, PostgreSQL, existing authentication, Temporal email delivery, local Mailpit, and NASA POWER daily API.
- Controlled failure: one browser-intercepted HTTP 503 during plan saving. This proves frontend recovery, not provider failure behavior.
- Provider failures, incomplete data, invalid coordinates, permissions and concurrent edits are also covered by automated tests. Their mocked-weather cases are not presented as live NASA traffic.
- All sample fields and accounts were created for local testing. No main checkout changes, remote push or deployment.

## Completed farmer journey

1. Registered and verified a local farmer through the UI and delivered verification email. A separate new account exercised the fixed `next=/field-shift` return path from login through registration, a new-tab email verification, and login back into Field Shift. See `backend-verification.md`.
2. Created **西田 · 试点样例**, 8.5 ha, 42 / -93.5, loam, irrigation enabled, with 2026 maize history, through the field form.
3. Retrieved actual NASA POWER 2025 regional weather. The UI exposed monthly values, historical year, retrieval date, coarse spatial scale and unconnected soil/vegetation/yield sources. The recorded provider response contains 365 valid days and 914.10 mm annual rainfall.
4. Generated a three-year comparison using all six demo crops, 300 mm seasonal irrigation, 1,500 USD/ha annual input, 30 days/ha annual labor and weights 4/3/3/2. There were 48 feasible sequences. Continuous maize remained visible as a conflicting baseline. Two displayed alternatives had different crop mixtures and metrics.
5. Changed rainfall by −20% and temperature by +2°C. Before recalculation the UI marked old results and disabled saving. Recalculation produced 38 feasible sequences; baseline estimated irrigation gap changed from 666.31 to 989.36 mm, with explicit scenario wording. These are model estimates, not measured benefits.
6. Saved the pea → sunflower → spring-wheat option with a title and notes. An injected 503 retained both fields and exposed retry. Retrying saved the plan successfully, then the detail page and JSON export contained the complete field, profile, climate, constraints, scenario and metrics.
7. Reloaded the browser, changed the current field area to 9 ha, restarted the API, and reopened the original saved plan. Its original 8.5 ha, version 1 and full evidence remained intact. Browser exports before and after were deeply equal; see `restart-persistence.json` and `saved-plan-after-restart.json`.
8. On a 390 × 844 viewport, set water/cost/labor limits to zero. The UI showed no feasible alternative, retained baseline violations and offered constraint editing without inventing a recommendation.
9. Edited area without saving, reloaded, and observed the restored 9 ha draft with a clear unsaved-input message before saving. The field's authoritative header remained 8.5 ha until that save.

## Production-build journey

After `next build` and `next start`, created a second field through the UI: **南田 · 正式构建验收**, 6.2 ha, loam, irrigation available, 42 / −93.5, history 2025 soybean and 2026 maize. Its current field version is 1. This reused the same demonstration location; it does not establish the team's pilot region.

The default three-year calculation produced 37 feasible sequences. Keyboard range controls changed the scenario to −10% rainfall / +1°C; the old-result notice appeared and saving was disabled until recalculation. There were still 37 feasible sequences, with the baseline's estimated three-year irrigation gap changing from 666.31 to 805.77 mm. The saved pea → sunflower → spring-wheat option has a 292.51 mm estimate. These values reflect configured assumptions only.

Saved **南田三年轮作 · 少雨暖化情景** with notes, reloaded at mobile width, and exported the complete result to [`production-saved-plan.json`](production-saved-plan.json). It contains both history records, version 1, exact scenario/limits/weights, full six-crop profile and dated historical environment. Repeating save for the same analysis/option returned the original plan ID and preserved its original title/notes. The initial field's API-restart evidence remains separate in `restart-persistence.json`.

- Field: `2722dbd6-48cf-4e2f-a08b-4986c3506edb`
- Baseline analysis: `4a149d6d-a858-451c-9e3f-da10237899d5`
- Scenario analysis: `50a3fea9-3b8a-41f1-a206-f7732b755962`
- Saved plan: `ca986abe-ba15-4766-b14c-3cd62b7f091f`

## Review and fixes

| Priority | Finding | Disposition |
|---|---|---|
| P1 | Current-user query could initially reuse a previous account's identity. | Fresh identity gate and account-scoped data; regression coverage. |
| P1 | Late analysis/save responses could navigate back to a previous context. | Captured request ownership/navigation and regressions. |
| P1 | Late environment refresh could populate another field's cache. | Final fix/review tracked in `adversarial-review.md`. |
| P1 | Form-to-next-step navigation retained a long page's scroll position. | Main-content focus and scroll on field/step changes; same-step recalculation preserves context. Actual mobile focus observed on `field-shift-main`. |
| P1 | Metrics used invalid description-list nesting. | Corrected `dl > div > dt + dd`; rerun axe had zero violations on the mobile no-feasible screen. |
| P1 | Refresh failure could replace matching real observations with demo climate. | Server preserves the dated real cache and adds an honest refresh-failure limitation; PostgreSQL regression coverage. |
| P2 | Baseline violations and metric/sorting explanations made comparison cards excessively long. | Visible conflict count and representative rules; full details remain expandable. |
| P2 | Saved limitations repeated climate/profile assumptions. | Display deduplicated; original exported snapshots remain unchanged. |
| P2 | Closed details omitted history and evidence from print output; initial paper layout inherited a dark page background and oversized page-break avoidance. | Expand for printing, use white paper and flowing print blocks, and restore disclosure state afterward. Four-page production output was visually inspected and all required text retained. |
| P2 | Malformed provider geometry could accept NaN or boolean coordinates. | Finite numeric/range validation with fallback regression cases. |
| P2 | Named planting-timeline divs lacked an accessible role. | Added `role="group"`; final production scans have no remaining timeline ARIA item. |
| P2 | Escape closed the controlled save dialog without returning focus. | Capture the initiating button and restore only in its original connected page context. Actual production Escape returned to that button; successful save retained main-content focus. Two regression cases pass. |

## Rendered coverage and accessibility

Desktop 1440 × 1000 and mobile 390 × 844 Chromium layouts were inspected, including field/draft, historical environment, comparison, save-error dialog, saved plan and no-feasible states. The mobile document width equaled 390 CSS pixels; no horizontal overflow was observed in those states. Navigation, form labels, named controls, explicit units, contrast, status text, dialog focus and responsive reading order were reviewed.

Axe-core 4.10.3, WCAG 2 A/AA + 2.1 AA rules, initially found two serious metric-list semantic rules. The list correction removed those violations. A remaining incomplete ARIA item was subsequently traced to timeline wrappers (not development tooling), fixed, and verified again. Final production comparison and mobile saved-plan scans have **0 violations and 0 incomplete items**, with 30 and 28 passing rules respectively. Field and planning scans also have no violations/incomplete items. See [`browser-quality.json`](browser-quality.json), which retains the earlier findings as well as final results.

The environment chart's SVG contrast required manual review: its actual text/background colors have **6.64:1** contrast. Dialog scanning required manual review of the Radix hidden background/focus guards and overlapping color layers. A full Tab cycle remained within the modal, Escape returned to the originating action after the fix, and successful save focused `field-shift-main`. Actual dialog description/placeholder contrast is at least **7.31:1**; input text is **15.51:1**. Keyboard arrow keys, Space, Tab and Enter exercised ranges, confirmation and submission. Saved-plan reflow at **320, 390 and 720 CSS pixels** had matching document widths. The 720-pixel check covers the equivalent layout space of a 1440-pixel window at 200%; it is not a browser-zoom or physical-device study.

Automated scans are not a claim of accessibility compliance. No screen-reader, real phone hardware or representative-farmer study was performed.

Final rendered evidence, opened and visually inspected:

- [Desktop comparison](../playwright/production-desktop-comparison.png): aligned planting timelines and comparable metrics, visible baseline conflicts, explicit scenario and data limitations.
- [Mobile option](../playwright/production-mobile-option.png) and [mobile saved-plan overview](../playwright/production-mobile-saved-top.png): readable single-column hierarchy, visible actions and focus indicator; [full saved detail](../playwright/production-mobile-saved.png) retains assumptions and evidence.
- [Printed production plan](production-saved-plan-print.pdf): four A4 pages, white paper, no missing history/source/assumption content or clipped text. Every page was rendered and inspected. A final-build re-export produced pixel-identical page PNGs to that inspected version. Five initially closed disclosures were again closed after printing. This is a browser print artifact, not a tagged accessible PDF certification.

Other screenshots without the `production-` prefix record earlier development iterations and specific failure/draft states; they should not be mistaken for the final comparison layout.

Component necessity audit: field picker/history supports ownership and agronomic input; weather chart/table establishes environmental context; constraints express actual farmer resources; comparison/timeline exposes tradeoffs; saved snapshots preserve evidence. The remove-one-thing pass moved repeated explanations into disclosure and removed duplicate limitations while preserving visible model/data caveats. No decorative map or invented outcome statistic was added.

## Provider contract

Reviewed on 2026-11-12: [NASA daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/), [NASA request guidance](https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/) and [FAO reference-ET methods](https://www.fao.org/4/x0490e/x0490e07.htm). Recorded response API version: **v2.10.3**, source MERRA2/POWER. A public single-point request uses AG, UTC, full-year start/end and only T2M_MIN, T2M_MAX, PRECTOTCORR. No credential, webhook or pagination is needed. Three parameters are below the documented single-point limit. Point/year caching avoids repeated background downloads; a user can explicitly refresh. Provider timeout, 429, invalid shape/units and missing values have explicit fallback/quality handling, with no retry storm. This small local sample does not verify load limits or deployment behavior.

Reference ET is a locally calculated Hargreaves approximation using astronomical radiation and the 0.408 energy-to-water conversion. It is clearly separate from NASA weather. Crop calendars, Kc, costs and labor remain demo parameters requiring local calibration.

## Performance and regression evidence

- Real API, 10 warm-cache samples each: climate GET median **3.681 ms**, P95 **4.885 ms**, 3,249 bytes; analysis POST median **14.236 ms**, P95 **18.883 ms**, 24,538 bytes. `runtime-api.json` records checks and measurements. These exclude browser and wide-area network latency.
- A real provider call took approximately 1.16 seconds in the recorded smoke; saved data retains its retrieval timestamp.
- Engine-only benchmark, 50 runs: median 5.26 ms, P95 5.42 ms. It is not used as a substitute for end-to-end timing.
- Backend: 166 tests pass, changed-source typing/lint pass, clean migration/rollback/re-upgrade pass. Whole-repository baseline static/schema differences remain documented in `backend-verification.md`.
- Frontend final full regression: **25 files / 166 tests passed**, 12.87 seconds. Whole frontend ESLint and TypeScript pass; optimized Next.js **16.2.9** production build succeeds. Three existing test files had unsupported Testing Library role-query `exact` options removed so the existing suite type-checks; no production behavior was changed by that compatibility correction.
- Production browser, five warm full navigations per state after one priming navigation: field readiness median **74 ms**, P95 **107 ms**; comparison **75 / 124 ms**; saved detail **74 / 126 ms**. Readiness means the data-bearing heading is visible plus two animation frames, including authentication/bootstrap and required data on this machine. [`browser-performance.json`](browser-performance.json) retains all samples and paint/navigation observations. Five samples make empirical P95 the maximum. No network/CPU throttling, physical mobile hardware, deployed endpoint or concurrent-load inference is made.
- Browser console during the final production run contained only the existing `GET /users/me` 401 → refresh bootstrap behavior on full navigation; no additional runtime error was observed. This flow is included in the measured readiness times.

## Final gate

**PASS for the agreed local demonstration scope.** The complete journey, owner/version boundaries, input recovery, no-feasible behavior, scenario recalculation, immutable persistence/restart, export/print, tested desktop/mobile layouts, keyboard behavior, relevant regressions and measured performance have evidence. Independent review's material findings were corrected and retested. No known open P0/P1 functional or usability issue remains in the agreed scope. Source/evidence audit found no credential files or raw browser logs included in the change.

Remaining boundaries: the pilot region is unconfirmed, all numerical crop/rule/calendar parameters need local validation, NASA data is coarse historical reanalysis, and this does not predict yield/profit/soil health or validate actual farming outcomes. Existing baseline backend-wide lint/type/schema discrepancies are listed in `backend-verification.md`; changed backend source passes its checks. The product has not been pushed, deployed, load-tested remotely or validated with representative farmers. No production-readiness claim is made.
