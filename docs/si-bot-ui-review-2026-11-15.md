# `/si` Bot interface review — 2026-11-15

Scope: shared Bot controls, chat navigation and result presentation. The four `/si` module pages remain their existing placeholders. `/si/fields` wraps the existing Field Shift workspace solely as a temporary, owned field result page.

| Priority | Finding in the previous UI | Correction | Verification |
| --- | --- | --- | --- |
| P0 | Field results sent farmers to the duplicate `/field-shift` surface; remote and rotation actions could link to an unfinished module page. | Field results now open `/si/fields`; other operations use the owned `/si/multi-agent/results/[workflowId]` viewer until a real module result page exists. Legacy field links in old messages are normalized on display. | URL mapping tests and production route build pass. Live authenticated result navigation needs the backend running. |
| P1 | Domain symbol replaced the Bot's face, so the companion appeared static and no longer reacted to the pointer. | All variants share a seed-like body, two blinking eyes, a small smile and sprout. Pointer movement changes gaze; hover/focus tilts the body. A small corner crest indicates the specialty. Motion stops for reduced-motion users. | Component test checks common face, crest and gaze; rendered desktop inspection confirmed eyes and animation names. |
| P1 | Water and soil avatars had unrelated colors despite belonging to the same module. | Bot identity color comes from one `modulePalette`; all remote-sensing specialists share the same blue. Field, knowledge and rotation retain distinct module families. | Catalog test checks the remote color set has one value; rendered inspection checked the computed water avatar color. |
| P1 | The chat draft could be white on a white composer background. | Composer text and caret use a dark ink color and an explicit light color scheme. | CSS inspection and prior browser draft check; live chat inspection currently blocked by the stopped backend. |
| P1 | Language appeared beside the Bot title, making the header uneven. | The multi-agent header uses a flexible title group and places the language control at the far right. | Component tests and source review; live loaded workspace inspection is blocked by the stopped backend. |
| P2 | History rows repeated the Bot name, so multiple conversations looked identical. | Each row now includes the Bot name, creation date and a short stable conversation ID. | Conversation title test passes. |
| P2 | The module Bot dock occupied more width than necessary and could cover page controls. | Collapsed avatars overlap; a drag handle and keyboard arrows move the dock, with per-module position stored locally. Expanded state reveals labels. | Pointer/keyboard component test and rendered collapsed/expanded inspection. Collision with future module content must be rechecked when those pages are implemented. |

## Verification and limits

### Subsequent visual refinement

The shared face now uses only two small eyes and a sprout; the smile and decorative orbit were removed. Hover tilt, float, blink, pointer gaze, and the corner specialty icon remain. Water, soil, and weather now have distinct blue-green tones with nearby hues, all set in the central `modulePalette`. A mobile selector specificity fix hides the expanded text label at narrow widths so all three avatars fit. The earlier table records the first visual pass; this refinement supersedes its face and exact-color choices.

- Frontend: 64 test files, 383 tests passed in the final standalone run; TypeScript and production build passed. ESLint has no errors and three warnings, two in unrelated existing files and one for an in-memory business result image. A concurrent test/build run timed out in two unrelated suites; both passed when rerun alone and in the final full run.
- Backend: Ruff passed; all 43 focused action and rotation tests passed against a disposable local pgvector PostgreSQL database, including real HTTP calls, confirmation and job completion. The temporary database and container were removed after verification.
- Browser: the Bot dock and avatar were inspected on the existing `/si/remote-sensing` placeholder, including an expanded dock at 400 CSS px after the visual refinement. The server had only the frontend listening; opening a conversation showed its failure state. Therefore this review does **not** claim a fresh authenticated end-to-end conversation or screenshot service result.
- The module pages are intentionally untouched. Final page layout and dock collision avoidance require the future published module UI.
