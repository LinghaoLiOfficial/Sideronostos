# Farmer assistant integration acceptance

Date: 2026-11-15. Branch: `feat/agent-bot-catalog-integration`.

## Delivered flow

- A single chat path accepts farmer text, server-owned conversation context and an idempotent message ID. The offline planner selects only registered OpenAPI operation IDs; the existing business router and service execute the operation. A `general-guide` conversation can use all three operational domains. The six specialists retain their domain scope; soil and weather results are further filtered by metric and layer product.
- The field creation demo gathers the required details over three turns, freezes a proposed summary and writes through `field.create` only after explicit confirmation. It returns the saved field URL and a private screenshot of the loaded field page. The pending state and completed message survive reload; the same confirmation cannot create a second field.
- Other chat writes persist missing inputs and an awaiting-confirmation summary. Reads execute directly. A 202 rotation response stays pending and the client polls the existing owned run endpoint before presenting a completed result and screenshot. A failed screenshot leaves the business result and original URL available.
- Result pages are server-owned, access-checked and rendered from the returned business payload. The screenshot service accepts only a validated field URL or its own result-viewer path, routes browser requests only to the configured frontend/API origins, stores PNG bytes privately and serves them only after owner verification.
- Knowledge documents, owned structured facts, published observations and preset web search remain distinct evidence inputs. The local knowledge specialist has no invented operation API.

## Verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Farmer questions across general + six specialists, including Chinese requests, three-turn create, decline, missing data and recovery | 35/35 message completions and expected operation/status checks | [`farmer-agent-v2-results.json`](evidence/farmer-agent-v2-results.json) |
| Prior farmer question regression | 36/36 completions | [`farmer-dialogue-v2-results.json`](evidence/farmer-dialogue-v2-results.json) |
| Registered chat operation selection and required-input boundary | 39/39 | [`farmer-agent-operation-matrix.json`](evidence/farmer-agent-operation-matrix.json) |
| Assistant HTTP, tool dispatch, ownership, async refresh and dialogue regression | 72 passed | `tests/test_agent_actions_http.py`, `tests/test_agent_module_tools.py`, `tests/test_farmer_dialogue_suite.py` |
| Existing field/observation/rotation service tests | 138 field and observation; 32 rotation API/worker tests passed | Backend test modules named in the test record below |
| Actual browser, desktop and mobile | 12/12 passed | [three-turn desktop](evidence/agent-three-turn-chat-desktop.png), [three-turn mobile](evidence/agent-three-turn-chat-mobile.png), [general desktop](evidence/general-bot-cross-module-desktop.png), [general mobile](evidence/general-bot-cross-module-mobile.png) |
| Openable result pages | Field and generic viewer loaded and carried business data | [same-field result preview](evidence/final-field-result-preview.png), [field result desktop](evidence/agent-three-turn-result-desktop.png), [generic result desktop](evidence/general-bot-result-viewer-desktop.png), [generic result mobile](evidence/general-bot-result-viewer-mobile.png) |

The 39-operation matrix sends real chat HTTP requests to the synthetic local application. Zero-input reads reach the real business route; input-bearing operations stop at the follow-up boundary and do not write. A separate simulated ASGI transport test dispatches all 39 registered route shapes, including JSON and binary image handling. These checks **do not establish successful completion of every one of the 39 business operations with valid production inputs**. Existing module tests verify representative field, observation, rotation, export, worker and persistence behavior, while the chat HTTP tests verify representative writes, reads, image handling and 202 completion.

## Farmer answer review and repairs

The first evaluation revealed that a SMAP definition question asked for a map without explaining the measurement; field-help copy still directed the farmer to a form even though chat now creates fields; operation replies exposed labels such as “list fields” and raw `body.profile_id`. The response router and tool-result composer were corrected, then the full 35-case suite was rerun. The full browser run also caught an information question about creating a field being misread as a create command. A regression test now requires that question to return setup information without opening a write workflow.

## Test environment and limits

- Synthetic verified owner, isolated PostgreSQL with pgvector, published observation fixtures, mock knowledge release and offline model path. The screenshots show the actual result pages for that synthetic account.
- No real model credential, live NASA acquisition or external search response was provided for this run. Production LLM tool selection, current external data quality and all 39 successful business outcomes remain unverified. The offline planner is deterministic and deliberately conservative on ambiguous natural language; it does not yet plan arbitrary multi-step mixed-domain requests in one turn.
- The local preview uses Chrome via `ASSISTANT_RESULT_BROWSER_CHANNEL=chrome`; Playwright's bundled Chromium is absent on this workstation. The frontend/API origins for this run are `http://127.0.0.1:4188` and `http://127.0.0.1:8018`. Local result links depend on those preview processes and the synthetic account remaining available.

## Repeat commands

Run the assistant tests against a dedicated PostgreSQL database whose name contains `test` and has pgvector enabled:

```sh
FIELD_SHIFT_TEST_DATABASE_URL="$DEDICATED_PGVECTOR_TEST_URL" .venv/bin/pytest tests/test_agent_actions_http.py tests/test_agent_module_tools.py tests/test_farmer_dialogue_suite.py -q
```

Run the live questions and browser suite only against the `tests.live_assistant_app` synthetic identity:

```sh
.venv/bin/python tests/run_farmer_dialogue_eval.py --base-url http://127.0.0.1:8018 --cases tests/fixtures/farmer_agent_v2.json --output ../docs/integration/evidence/farmer-agent-v2-results.json
.venv/bin/python tests/run_agent_tool_matrix.py --base-url http://127.0.0.1:8018 --output ../docs/integration/evidence/farmer-agent-operation-matrix.json
ASSISTANT_LIVE_BACKEND=1 PLAYWRIGHT_PORT=4188 PLAYWRIGHT_CHANNEL=chrome pnpm exec playwright test e2e/assistant-live.spec.ts --project=desktop --project=mobile
```
