# SI module bot dock

This UI slice mounts `MultiBotDock` on the four placeholder `/si` module pages. Its shared catalog is `src/lib/bot-catalog.ts`. The catalog gives each specialist a stable ID, module, EN/ZH name, avatar variant, hue, intended capability scope, planned backend preset, and honest fallback text.

| Module | Specialist IDs | Planned preset |
| --- | --- | --- |
| Field management | `field-guide` | `field_management` |
| Remote sensing | `remote-water`, `remote-soil`, `remote-weather` | `remote_sensing` |
| Local knowledge | `local-knowledge-guide` | `local_agriculture` |
| Rotation recommendation | `rotation-guide` | `rotation` |

The current `main` backend accepts only `rotation`, and this SI dock does not call it. No module page has a conversation adapter yet. The panel reuses the familiar `Bot` shell but shows a localized unavailable state without a composer or send action. The functional rotation assistant in the existing planning workspace remains unchanged. The pending conversation branch adds four module presets, but its single `remote_sensing` preset does not itself enforce water, soil, and weather specialization. Integration must bind each catalog ID to a validated server-side scope before enabling chat.

The dock keeps one panel open at a time. Pointer hover expands the cluster; the count button provides explicit expansion on touch. Focus also reveals avatars, Escape collapses and restores focus, and the fixed host lets clicks pass through to the page outside the dock. CSS handles the small layout and avatar transitions, including `prefers-reduced-motion`.

Rendered checks used the current placeholder pages at desktop and 390 × 844 mobile width in EN/ZH. The pages have no map yet, so future map interaction needs an integrated check after real module content lands. Real touch hardware, 200% zoom, and assistive technology were not exercised in this UI-only slice.
