import { afterEach, describe, expect, it, vi } from "vitest"
import { demoApiResponse } from "./api"

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("demo assistant replies", () => {
  it("falls back to the local reply when Groq is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 502 })))

    const conversationResponse = await demoApiResponse("/farm-assistant/conversations", {
      method: "POST",
      body: { preset: "rotation", bot_id: "rotation-guide", language: "en", detail: "brief" },
    })
    const conversation = await conversationResponse.json() as { id: string }
    const messageResponse = await demoApiResponse(`/farm-assistant/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: { client_message_id: "client-1", text: "How should I rotate crops?" },
    })
    const message = await messageResponse.json() as { status: string; response?: { paragraphs?: Array<{ text?: string }> } }

    expect(messageResponse.status).toBe(200)
    expect(message.status).toBe("complete")
    expect(message.response?.paragraphs?.[0]?.text).toContain("Iowa benchmark")
  })
})

describe("demo local knowledge persistence", () => {
  it("saves draft changes to local storage and returns them on reload", async () => {
    const initialResponse = await demoApiResponse("/rotation-optimizer/local-knowledge")
    const initial = await initialResponse.json() as { draft: { profile: { name: string }; updated_at: string } }
    const profile = { ...initial.draft.profile, name: "Updated Iowa knowledge" }

    const saveResponse = await demoApiResponse("/rotation-optimizer/local-knowledge/draft", {
      method: "PUT",
      body: { profile, expected_updated_at: initial.draft.updated_at },
    })
    const saved = await saveResponse.json() as { profile: { name: string } }
    const reloadResponse = await demoApiResponse("/rotation-optimizer/local-knowledge")
    const reloaded = await reloadResponse.json() as { draft: { profile: { name: string } } }

    expect(saved.profile.name).toBe("Updated Iowa knowledge")
    expect(reloaded.draft.profile.name).toBe("Updated Iowa knowledge")
  })

  it("publishes the saved draft and increments the active revision", async () => {
    const response = await demoApiResponse("/rotation-optimizer/local-knowledge/publish", { method: "POST", body: {} })
    const catalogue = await response.json() as { active: { revision: number; status: string }; draft: { status: string } }

    expect(catalogue.active.revision).toBe(2)
    expect(catalogue.active.status).toBe("published")
    expect(catalogue.draft.status).toBe("draft")
  })
})
