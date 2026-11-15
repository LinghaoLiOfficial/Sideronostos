# Agrisata Demo

This directory is the isolated Vercel demo frontend. It runs the SI experience with
the Iowa benchmark, local remote-sensing fixtures, precomputed rotation results and
local assistant replies. It does not require the Sideronostos backend.

## Vercel

The Vercel project uses `sideronostos-demo` as its root directory and is connected
to this GitHub repository. Pushes to `main` create production deployments; pull
requests create preview deployments. Set `NEXT_PUBLIC_DEMO_MODE=true`. Optional `NEXT_PUBLIC_MAPTILER_KEY` enables
place search and a hosted basemap; without it, the MapLibre fallback still shows the
demo field boundaries. The demo includes the eight SI videos (about 622 MB) as public
assets locally and verifies them during local builds. The video files are excluded
from Git and Vercel uploads; the deployed app streams them from the public GitHub
release configured by `NEXT_PUBLIC_SI_MEDIA_BASE_URL`.

The SI assistant chats use Groq when `GROQ_API_KEY` is configured. Set `GROQ_API_KEY`
and `GROQ_BASE_API` as server-only environment variables in Vercel (Production and
Preview as needed); do not use the `NEXT_PUBLIC_` prefix. `GROQ_BASE_API` can be the
OpenAI-compatible base URL or the full `/chat/completions` endpoint. The default model
is `llama-3.3-70b-versatile`; override it with `GROQ_MODEL` if needed. Locally, put
these variables in `.env.local` and restart the dev server.

For local development:

```bash
pnpm install --frozen-lockfile
pnpm media:sync
pnpm dev
```

The demo runs at `http://localhost:3001`; port `3000` remains available for the
formal frontend. Demo mode defaults to enabled; set `NEXT_PUBLIC_DEMO_MODE=false`
only when intentionally testing against the backend.

The original full-stack frontend remains in `../sideronostos-frontend` and is not
modified by this demo application.

The demo is intentionally separate from the backend-backed application. Account, group,
notification and file-management routes are retained for visual continuity but are outside
the demo acceptance path.

The component gallery is available at http://localhost:3001/components. Reusable shadcn/ui
primitives live in `src/components/ui`; knowledge-specific compositions live in
`src/components/knowledge`. Import components directly from these modules. Theme colors and
surface styles are centralized in `src/app/globals.css`. Knowledge components receive data and
callbacks as props, so pages can connect them to their own queries without coupling the library
to the API client. The gallery uses local sample data and does not mutate backend state.

The design system uses a single dark theme with a lime action color. Every gallery category
has independent dark and light surface examples. Light is a local information surface, not
an application theme toggle. `Surface` scopes semantic CSS variables and provides the React
context used by portaled menus, dialogs, sheets, tooltips and searchable selects:

```tsx
import { Surface } from "@/components/ui/surface";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

<Surface tone="light">
  <Card><CardContent><Input aria-label="Title" /></CardContent></Card>
  <Card surface="dark"><CardContent>A nested dark panel</CardContent></Card>
</Surface>
```

`Card` inherits its containing surface; use `surface="light"` for a standalone light card.
Use semantic colors (`foreground`, `muted-foreground`, `border`, `accent-foreground`) inside
local surfaces. The older `glass-*` and `brand-gradient-*` CSS names remain compatibility
aliases for neutral surfaces and solid lime fills; they no longer add glass or gradients.

```bash
pnpm lint
pnpm test
pnpm build
```

Enabled capabilities are recorded in `capabilities.json`. Authentication keeps access tokens only
in memory and restores sessions through the backend refresh cookie. Production frontend and API
origins must use HTTPS. For browser uploads, configure the production S3 provider's bucket CORS to
allow the frontend origin and expose `ETag`.
