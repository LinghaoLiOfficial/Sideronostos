# Local assistant knowledge demo

The local chat can be exercised without an AI or embedding credential. It uses the bundled, bilingual Field Shift product help as a clearly labelled mock release in PostgreSQL, deterministic hash vectors for the staging contract, lexical retrieval at answer time, and the local mock answerer when `AI_WORKFLOW_MODE=mock` and no model key is configured.

From `sideronostos-backend`, run:

```sh
uv run alembic upgrade heads
uv run python -m sideronostos_backend.modules.knowledge.cli mock-bootstrap
```

The bootstrap command is idempotent for its release ID. It publishes only `product-help-v2.md`; it does not ingest arbitrary files or write farmer data. Replace it with the reviewed source manifest and a real embedding provider before using the KB as agronomic evidence.

At query time, each specialist uses a fixed web-search preset limited to public NASA, FAO, or extension-service domains. Search snippets remain transient citations and are not promoted into the reviewed database release. The request removes email addresses, exact coordinates, dates, UUIDs, and phone-like strings before sending a query to DuckDuckGo. Network failures return no web hits and preserve database retrieval.

Offline tests use HTTPX `MockTransport`; they verify domain scoping, source URLs, identifier stripping, and graceful network failure without calling a search provider.

## Live browser smoke

Use a **dedicated database whose name contains `test`**. Apply all Alembic heads,
then run `mock-bootstrap` against that database with
`KNOWLEDGE_EMBEDDING_MODE=mock`. Start the test-only backend from
`sideronostos-backend`:

```sh
FIELD_SHIFT_TEST_DATABASE_URL='postgresql+asyncpg://foundation:foundation@localhost:55432/sideronostos_assistant_live_test' \
CORS_ALLOWED_ORIGINS='http://127.0.0.1:4174' KNOWLEDGE_EMBEDDING_MODE=mock \
uv run uvicorn live_assistant_app:app --app-dir tests --host 127.0.0.1 --port 8009
```

In `sideronostos-frontend`, start the frontend and run the desktop Chrome test:

```sh
NEXT_PUBLIC_API_BASE_URL='http://127.0.0.1:8009' pnpm exec next dev --hostname 127.0.0.1 --port 4174
ASSISTANT_LIVE_BACKEND=1 PLAYWRIGHT_PORT=4174 PLAYWRIGHT_CHANNEL=chrome \
pnpm exec playwright test e2e/assistant-live.spec.ts --project=desktop
```

The browser calls real assistant, knowledge, field, remote-sensing, and rotation
HTTP handlers. Only the verified test identity is synthetic. The test writes
sample fields and conversations to the dedicated test database and saves
screenshots under `sideronostos-frontend/output/playwright`.
