# Companion bot design · 2026-11-13

The latest user decision replaces the selected-area full-screen experience. The map remains the working surface; the bot is a small companion beside it. This document is the visual source of truth for the reusable component.

## References and decisions

Reviewed current official sources on 2026-11-13. These are established first-party examples, not a claimed popularity ranking.

| Reference                                                                                                                                                                        | Adopted direction                                                                        | Product decision                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Grok Bot](https://x.ai/bot), [messaging and dictation](https://docs.x.ai/grok-bot/chat-and-collaboration)                                                                       | Distinct simple bot identities; messaging feels conversational; dictation edits a draft. | An original two-eye soft shape, compact identity header, plain chat paragraphs. No copied artwork or Grok integration.                                    |
| [Google Material motion](https://m3.material.io/styles/motion)                                                                                                                   | Expressive spatial response; restrained effects.                                         | A small overshoot on the pet and panel, opacity settles separately. CSS easing approximates a spring; it is not a physics simulation.                     |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) | Purposeful transitions, content clarity, accessible alternatives.                        | Translucency only on the small pet label. Chat stays opaque over complex satellite imagery.                                                               |
| [Microsoft Fluent motion](https://fluent2.microsoft.design/motion)                                                                                                               | Functional, natural, consistent, quick.                                                  | One transition vocabulary; no constant bobbing, roaming, particle effects or full-screen takeovers.                                                       |
| [Doubao input](https://srf.doubao.com/pc)                                                                                                                                        | Low-friction speech input, compact transcription feedback.                               | The user's requested long-press-on-textbox gesture, plus an accessible microphone toggle. The official page does not establish the exact textbox gesture. |

## Visual and interaction contract

- A 62 px lavender character sits within a 72 px map-corner hit target. A soft ground shadow gives separation; an eight-second eye blink gives life without moving the map or constantly bouncing.
- Hover/focus raises the character 3 px with a small tilt; mouse movement shifts its eyes by at most 3 × 2 px. The label identifies the bot and disappears while chat is open.
- Fine-pointer hover waits 350 ms. Leaving allows 400 ms to cross the gap into the panel. A preview never steals map focus. Clicking the pet, focusing chat, or interacting inside pins it open.
- Explicit collapse suppresses hover until the pointer leaves, restores launcher focus, and retains messages/draft. Escape is scoped to the chat; a source popover or active voice input handles its own Escape first.
- Chat opens above the pet: 448 px wide, up to 630 px high, with 26 px corners. Entry is 340 ms (18 px travel, scale 0.94 → 1), exit 180 ms. No backdrop, body-scroll lock, modal focus trap, full-screen button or data slot.
- Mobile uses 12 px side gutters and a bounded floating card. The pet remains on the map; hover is disabled for coarse pointers. Text entry uses 16 px type to avoid iOS zoom. VisualViewport shifts the card above an opened software keyboard. Verify the software keyboard on real devices before calling mobile dictation production-ready.
- Reduced motion removes animation, transitions and gaze movement. Reduced transparency makes the label opaque. Hidden chat is inert and excluded from the accessibility tree while remaining mounted.
- Motion tokens live in `bot.module.css`; composer styles live in `composer.module.css`. Both scope colors locally so chat remains readable over map tiles in either app theme.

## Voice contract

450 ms hold starts microphone acquisition. A short tap remains text editing; moving more than 10 px before the threshold leaves text selection alone. After listening starts, release requests transcription; sliding upward 64 px marks cancellation. Pointer cancellation, Escape, collapsing, account unmount, leaving the page, or hiding the document aborts capture. The microphone button offers start/stop without holding.

The draft is read-only while recognition is active. Interim text appears only in the voice status. Final text is inserted at the captured caret/selection; existing text is preserved, length limits cannot split a surrogate pair, and no message is automatically submitted. A changed external draft invalidates the old speech session. Limits: 60 s listening, 15 s startup, 8 s finishing. A decorative waveform indicates listening, not measured volume.

[Web Speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) has limited browser support and may send audio to the browser vendor's online speech service. This implementation does not call OpenRouter, OpenAI or a paid STT API, does not store audio, and does not promise offline operation or Doubao-level recognition quality. HTTPS/localhost and microphone permission are required by supported environments. Unsupported/denied/network/no-speech cases retain the typed draft and explain recovery. The UI says that browser services perform transcription before activation.

## Verification boundaries

Unit tests exercise hover intent, focus, draft retention, speech cancellation, permission/error handling and service timeouts with a browser speech test double. Browser acceptance must separately cover actual layout, pointer gestures, keyboard focus, reduced motion and live capability detection. A simulated transcript proves UI wiring, not real microphone recognition quality. See the integrated acceptance record for measured results.

### Acceptance observed in this workspace

Integrated frontend: 213 tests pass; generic export: 19 tests pass and independently builds. Both integrated production and generic Webpack production builds pass. Changed-code lint has no errors (two preexisting effect-cleanup warnings remain in the domain adapter/workspace). Desktop 1440×900 and mobile 390×844 were rendered; hover focus, draft retention, removal of full-screen controls, cancellation, permission recovery, reduced motion and simulated VisualViewport keyboard placement were checked. Browser speech callback tests made zero assistant-message POSTs.

A separate Chrome session used a synthesized Mandarin WAV as its fake microphone. Native recognition entered `start` and `audio-start`, then returned `no-speech`; no transcript was obtained. Therefore real microphone transcription accuracy and real iOS/Android behavior remain unverified. This does not change the typed-chat fallback or cancellation guarantees. The test never captured the user's live microphone and used no paid model API.
