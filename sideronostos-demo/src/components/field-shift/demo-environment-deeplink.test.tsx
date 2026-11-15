import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@/test/render-zh";
import { FieldShiftWorkspace } from "./workspace";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("field=iowa-nasa-benchmark-v1-field-1&step=environment"),
  useRouter: () => ({ replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("opens the demo field conditions directly from the assistant link", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><FieldShiftWorkspace basePath="/si/fields" /></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: /2024.*NASA POWER/ })).toBeInTheDocument();
  expect(screen.getByText(/regional point and 0.1-degree precipitation grid/)).toBeInTheDocument();
  client.clear();
});
