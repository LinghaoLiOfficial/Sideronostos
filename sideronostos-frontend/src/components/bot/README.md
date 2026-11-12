# Reusable bot UI / 通用 Bot 组件

This directory and `src/lib/bot.ts` are the complete `grok_bot` feature. No map, NASA, RAG, model provider, or API key is required by these components. Existing React and lucide-react dependencies are sufficient.

- `Bot.tsx`: controlled floating launcher, chat panel, and optional full-screen data slot.
- `BotAnswer.tsx`: paragraph-first conversational replies, optional progressive reveal, collapsed citations and facts.
- `src/lib/bot.ts`: independent TypeScript contracts for identity, mode, answer and fact.
- CSS modules own visual styling. The caller owns message state, composer, transport, errors and selection.

```tsx
const [mode, setMode] = useState<BotMode>("collapsed");
<Bot
  identity={{ id: "rotation", name: "轮作助手", description: "一起想清下一茬" }}
  mode={mode}
  onModeChange={setMode}
  dataView={selectedArea ? { label: "选区数据", content: <YourDataView /> } : undefined}
>
  <YourConversation />
  <YourComposer />
</Bot>
```

The host container should be positioned (`position: relative`) with a usable height. Render each bot in its own positioned host or supply a selector controlling one active bot; do not stack identical absolute launchers at the same coordinates. Identity and accent are configurable; the integrated product currently enables only the rotation bot.

## State and accessibility

`collapsed → chat → data`; data is enabled only when the caller supplies a selected-area view. Minimize returns to the launcher. Escape returns from data to chat, and from chat to the launcher. The native modal dialog confines keyboard focus only in full-screen mode; the floating chat keeps the map usable. Chat children remain mounted, preserving draft state when switching modes. Removing the data slot while full screen returns to chat. Body scrolling is restored on exit/unmount.

Hidden children may still run effects. The adapter must cancel requests and clear private data when the owner changes, and must never reuse readings for a different selection/revision. Avoid other modal dialogs inside this component.

`BotAnswer` reveals already validated text; it is **not provider token streaming**. It supports reduced motion and an immediate full-answer button. Use a stable React key per message, `clientId`, and a single caller-owned live announcement region; do not announce every character. Transport streaming can be supplied independently later.

## Integration

On `integrated`, `components/rotation/assistant-dock.tsx` is the business adapter (history, preferences, context and API); `lib/api/rotation.ts` owns HTTP calls; `region-data-view.tsx` supplies the selected-area data slot. These are deliberately outside the reusable component directory.

Run the existing frontend Vitest command against `src/components/bot`. `dialog-test-setup.ts` is a jsdom shim, only imported by tests; actual modal focus and responsive layout also require browser verification.
