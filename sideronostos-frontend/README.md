# Agrisata

Independent Next.js frontend for the generated `custom` profile.

```bash
pnpm install
pnpm dev
```

The application runs at http://localhost:3000 and calls the backend directly at the URL in
`NEXT_PUBLIC_API_BASE_URL`. The backend must allow `NEXT_PUBLIC_APP_URL` as a credentialed CORS
origin. Keep `.env` local and commit only `.env.example`.

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


## Farmer workspace (v3 integration)

Use `/fields` to draw/import a farm, confirm partitions, complete field/history details
and explicitly synchronize them to the signed-in account. Anonymous drafts remain local
until explicitly imported. Confirmation and synchronization do not imply calculation readiness.
Use the Data panel for separate point/polygon/viewport science queries. GIBS display dates,
scientific observation dates and planning dates are independent. Prepared SMAP pixels retain
native support; missing observations are transparent and load failures offer a retry.

Open `/field-shift/rotation` for sourced daily conditions, readiness, calculation, comparison,
save/export/print and the companion. Return to the map with the same field/run/option/AOI.
Old `/field-shift/map?...` links redirect to `/fields?...`. Saved plans use frozen inputs;
editing current fields cannot change them. Iowa is an explicitly uncalibrated engineering
benchmark. Real farms require a locally sourced parameter pack and operating conditions.

See [acceptance and handoff](../docs/integration/acceptance-and-handoff.md) for engineering usage, real-farm data preparation and current limits; [implementation checkpoints](../docs/integration/fields-bot-model-v3-plan.md) record the validation and open AI gate.
Live AI semantic acceptance is pending provider access; a visible chat panel is not proof
of validated answers.
