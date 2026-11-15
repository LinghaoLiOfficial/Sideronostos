import { afterEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "./client"
import { getFieldWorkspace, restoreFieldWorkspaceSample, saveFieldWorkspace } from "./field-workspace"

afterEach(() => { setAccessToken(null); vi.unstubAllGlobals() })

describe("account field workspace API", () => {
  it("uses authenticated versioned workspace routes", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = []
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      requests.push({
        method: init.method ?? "GET",
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(JSON.stringify({
        version: 3, farms: [], fields: [], initialized_from: "iowa-four-fields-v1",
        created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z",
      }))
    })
    setAccessToken("account-token")
    await getFieldWorkspace()
    await saveFieldWorkspace(2, [], [], "iowa-four-fields-v1")
    await restoreFieldWorkspaceSample()
    expect(requests).toEqual([
      { method: "GET", path: "/field-shift/workspace", body: null },
      { method: "PUT", path: "/field-shift/workspace", body: { expected_version: 2, farms: [], fields: [], initialized_from: "iowa-four-fields-v1" } },
      { method: "POST", path: "/field-shift/workspace/sample", body: null },
    ])
  })
})
