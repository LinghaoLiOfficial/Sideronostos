# SI module bot dock

`MultiBotDock` mounts on the four placeholder `/si` module pages. It uses the
shared `src/lib/bot-catalog.ts` registry with `/si/multi-agent`. The registry
defines stable IDs, module, preset, EN/ZH names, avatar, color, and a bounded
capability description.

| Module | Bot IDs | Conversation preset |
| --- | --- | --- |
| Field management | `field-guide` | `field_management` |
| Remote sensing | `remote-water`, `remote-soil`, `remote-weather` | `remote_sensing` |
| Local knowledge | `local-knowledge-guide` | `local_agriculture` |
| Rotation recommendation | `rotation-guide` | `rotation` |

The dock requires an authenticated farmer before loading history or sending a
message. It creates conversations with `bot_id` and accepts a listed or loaded
conversation only when both its preset and bot ID match the selected identity.
The server persists and validates that identity, scopes the remote specialists'
facts and retrieval, and rejects actions outside their specialties. Weather
answers use historical observations and must not claim a forecast. The dock
supports chat, source viewing, voice draft entry, and persisted language;
guided field and remote-sensing actions live in `/si/multi-agent`.

Only one dock chat is open at a time. Pointer hover expands the cluster; the
count button provides explicit expansion on touch. Expanded avatars show short
names. Focus and Escape behavior restore the launcher, and the fixed host lets
clicks pass through outside the dock. CSS handles mobile safe areas and
reduced motion. The four module pages themselves still contain no underlying
module workflow or map.

The integrated branch passed 278 frontend tests and scoped ESLint checks.
Rendered checks covered desktop and a 390 × 844 mobile viewport with a local
API stub. Real touch hardware, 200% zoom, a deployed backend, and assistive
technology were not exercised for this dock.
