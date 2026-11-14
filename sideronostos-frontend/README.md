# Agrisata

Independent Next.js frontend for the generated `custom` profile.

```bash
pnpm install
pnpm dev
```

The application runs at http://localhost:3000 and calls the backend directly at the URL in
`NEXT_PUBLIC_API_BASE_URL`. The backend must allow `NEXT_PUBLIC_APP_URL` as a credentialed CORS
origin. Keep `.env` local and commit only `.env.example`.

## Run the SI pages locally

Use Node.js 20.9 or later and pnpm 10.15.0. Clone and start the branch:

```bash
git clone --branch codex/si-pages-local-media https://github.com/qiongwenz748-odie/Sideronostos.git
cd Sideronostos
cd sideronostos-frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open [SI home](http://localhost:3000/si), [rotation overview](http://localhost:3000/si/rotation-recommendation),
or [model layers](http://localhost:3000/si/rotation-recommendation/layers). The eight original MP4s
are downloaded from the [SI media release](https://github.com/qiongwenz748-odie/Sideronostos/releases/tag/si-media-v1)
before the first `pnpm dev` or `pnpm build` (about 621 MB total). Each download is verified
against its SHA-256 checksum and saved to `public/videos/si`. To fetch them separately, run
`pnpm media:sync`. Subsequent starts reuse the verified local files. The background images,
posters and headline font are included in the branch. The login screen is at [Login](http://localhost:3000/login).

For sign-in, notifications and account management, run the API on port 8000 using the
[backend setup](../sideronostos-backend/README.md). The frontend defaults match that local
address. If you change either port, copy `.env.example` to `.env.local`, set the application
and API origins, and allow the frontend origin in the backend CORS settings. Sign in using
an account created on that backend. The frontend uses the account and notification data
returned by that API.

The component gallery is available at http://localhost:3000/components. Reusable shadcn/ui
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
