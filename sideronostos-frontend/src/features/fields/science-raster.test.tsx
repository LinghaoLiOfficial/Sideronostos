import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LayerManifest } from "@/lib/api/rotation-types";
import { ScienceRaster } from "./science-raster";

const transport = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  blob: vi.fn(),
}));
vi.mock("maplibre-gl", () => ({
  addProtocol: transport.add,
  removeProtocol: transport.remove,
}));
vi.mock("react-map-gl/maplibre", () => ({
  Source: ({ children }: { children: ReactNode }) => <>{children}</>,
  Layer: () => null,
}));
vi.mock("@/lib/api/client", () => ({ apiBlob: transport.blob }));
const layer = {
  id: "release:am",
  tiles: ["/agri-data/layers/release:am/tiles/{z}/{x}/{y}"],
  tile_size: 256,
  minzoom: 0,
  maxzoom: 12,
  bounds: [-180, -85, 180, 85],
} as LayerManifest;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function registered() {
  const [scheme, handler] = transport.add.mock.calls.at(-1)!;
  return {
    scheme,
    handler,
    url: `${scheme}:///agri-data/layers/release:am/tiles/2/1/1`,
  };
}
it("distinguishes a failed scientific tile from transparent missing observations and supports retry", async () => {
  transport.blob.mockRejectedValue(new Error("HTTP 503"));
  render(<ScienceRaster layer={layer} />);
  const first = registered();
  await act(async () => {
    await expect(
      first.handler({ url: first.url }, new AbortController()),
    ).rejects.toThrow("503");
  });
  expect(screen.getByRole("alert")).toHaveTextContent("科学图层加载失败");
  expect(screen.getByRole("alert")).toHaveTextContent("不代表没有有效观测");
  fireEvent.click(screen.getByRole("button", { name: "重试科学图层" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(registered().scheme).not.toBe(first.scheme);
  expect(transport.remove).toHaveBeenCalledWith(first.scheme);
});
it("aborts in-flight tiles on removal and rejects a late decoded tile", async () => {
  let finish!: (data: ArrayBuffer) => void;
  transport.blob.mockResolvedValue({
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  const view = render(<ScienceRaster layer={layer} />);
  const { handler, url } = registered(),
    controller = new AbortController();
  const pending = handler({ url }, controller);
  await act(async () => {
    await Promise.resolve();
  });
  view.unmount();
  expect(controller.signal.aborted).toBe(true);
  const rejected = expect(pending).rejects.toThrow(/closed|abort/i);
  finish(new ArrayBuffer(1));
  await rejected;
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("does not report an ordinary viewport cancellation as a failure or forward external paths", async () => {
  transport.blob.mockRejectedValue(new DOMException("Aborted", "AbortError"));
  render(<ScienceRaster layer={layer} />);
  const { handler, url, scheme } = registered(),
    controller = new AbortController();
  controller.abort();
  await act(async () => {
    await expect(handler({ url }, controller)).rejects.toThrow();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  transport.blob.mockClear();
  await expect(
    handler(
      { url: `${scheme}://https://example.com/tile` },
      new AbortController(),
    ),
  ).rejects.toThrow("Unexpected");
  expect(transport.blob).not.toHaveBeenCalled();
});
