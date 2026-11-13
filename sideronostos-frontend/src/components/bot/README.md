# Reusable bot UI / 通用 Bot 组件

`grok_bot` contains this directory, `src/lib/bot.ts` and `src/lib/dictation.ts` (plus tests). React and lucide-react are the only UI dependencies. No map, NASA data, RAG service, model provider or API key is required.

- `Bot.tsx`: controlled desktop-pet launcher and persistent non-modal chat; hover previews, click pins, minimize collapses.
- `BotComposer.tsx`: controlled text draft, long-press dictation and an accessible microphone toggle.
- `BotAnswer.tsx`: conversational paragraphs, optional progressive reveal, collapsed citations/facts.
- `lib/bot.ts`: standalone presentation types. `lib/dictation.ts`: framework-independent browser speech lifecycle.
- [DESIGN.md](./DESIGN.md): researched references, exact motion/gesture parameters, accessibility and speech limitations.

```tsx
const [mode, setMode] = useState<BotMode>("collapsed");
const [draft, setDraft] = useState("");
<Bot
  identity={{ id: "rotation", name: "轮作助手", description: "一起想清下一茬" }}
  mode={mode}
  onModeChange={setMode}
>
  <YourConversation />
  <BotComposer
    active={mode === "chat"}
    label="给轮作助手留言"
    value={draft}
    onChange={setDraft}
    onSend={() => send(draft)}
    language="zh-CN"
  />
</Bot>;
```

Use a positioned host with a usable height. Give each bot its own position or select one active identity; do not stack launchers at identical coordinates. The integrated product enables the rotation bot. `BotMode` is only `collapsed | chat`; the former `dataView` API and full-screen state are removed.

Chat children stay mounted. The caller owns draft/messages, HTTP requests, errors, history and account isolation; pass `active` to the composer so collapsing cancels voice input. Switching owner must reset private state. Hidden children still run effects, so guard business operations in the adapter. Voice updates the draft only and never calls `onSend` automatically. Browser recognition support and network access vary; typed input and system dictation remain usable.

`BotAnswer` reveals already validated text, not live provider tokens. History/reduced motion render immediately. Keep stable message keys and one complete-answer live announcement; do not announce every character.

In `integrated`, `components/rotation/assistant-dock.tsx` supplies history, preferences, context and transport. Selected-area data remains in the workspace sidebar. Those business concerns stay outside this reusable directory.

Run Vitest against `src/components/bot` and `src/lib/dictation.test.ts`. Test doubles cover browser speech callbacks; rendered acceptance and real-device speech checks are distinct.
