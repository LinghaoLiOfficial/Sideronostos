import { afterEach, expect, it, vi } from "vitest";
import * as client from "./client";

afterEach(() => { client.setAccessToken(null); vi.unstubAllGlobals(); });

it("fetches protected raster data with auth and cancellation, without encoding tokens in URLs", async () => {
  const signal = new AbortController().signal;
  let options: RequestInit | undefined;
  let address = "";
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    address = url.toString(); options = init;
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  });
  client.setAccessToken("session-secret");
  const blob = await client.apiBlob("/agri-data/layers/sample/tiles/3/1/2", { signal });
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBe(4);
  expect(options?.signal).toBe(signal);
  expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer session-secret");
  expect(address).not.toContain("session-secret");
});

it("never sends a session to an external tile address", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); client.setAccessToken("private");
  for (const url of ["https://external.invalid/tile", "//external.invalid/tile"]) {
    await expect(client.apiBlob(url)).rejects.toThrow(/origin|relative/i);
  }
  expect(fetch).not.toHaveBeenCalled();
});
