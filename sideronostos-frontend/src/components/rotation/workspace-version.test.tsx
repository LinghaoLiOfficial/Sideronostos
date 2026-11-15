import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RotationWorkspace } from "./workspace";
import { emptyDailyDraft } from "./daily-model";
const state = vi.hoisted(() => ({
  search: new URLSearchParams(),
  daily: false,
  currentProfile: false,
  assistant: null as null | {
    context: { run_id?: string | null; draft?: { dirty: boolean } };
    contextPending: boolean;
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => state.search,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./use-workspace-session", () => ({
  useWorkspaceSession: () => ({
    ready: true,
    session: {
      data: { id: "owner-a", email_verified: true, display_name: "Farmer" },
    },
  }),
}));
vi.mock("./map-canvas", () => ({ MapCanvas: () => <div>Map</div> }));
vi.mock("./assistant-dock", () => ({
  AssistantDock: (props: NonNullable<typeof state.assistant>) => {
    state.assistant = props;
    return <div>Assistant</div>;
  },
}));
vi.mock("@/lib/api/field-shift", () => ({
  listFields: async () => ({ items: [] }),
}));
vi.mock("@/lib/api/farms", () => ({ listFarms: async () => ({ items: [] }) }));
vi.mock("@/lib/api/rotation", () => ({
  listRotationProfiles: async () => ({ items: [{ id: "legacy" }] }),
  listLayers: async () => ({ items: [] }),
  listRotationPlans: async () => ({ items: [] }),
  listRuns: async () => ({ items: [] }),
  getRun: async () => ({
    id: "old-run",
    request: { profile_id: "legacy" },
    field_snapshots: [],
    status: "optimal",
    result: {},
  }),
}));
vi.mock("@/lib/api/daily", () => ({
  listDailyProfiles: async () => ({
    items: [
      {
        ...JSON.parse(
          readFileSync(
            "../sideronostos-backend/src/sideronostos_backend/modules/rotation_optimizer/v3/data/profiles/iowa-engineering-v3-20261114.json",
            "utf8",
          ),
        ),
        sha256: "current",
      },
    ],
  }),
  listAllRuns: async () => ({ items: [] }),
  listAllPlans: async () => ({ items: [] }),
  getAnyRun: async () => ({
    id: "old-run",
    request: {
      ...emptyDailyDraft({
        ...JSON.parse(
          readFileSync(
            "../sideronostos-backend/src/sideronostos_backend/modules/rotation_optimizer/v3/data/profiles/iowa-engineering-v3-20261114.json",
            "utf8",
          ),
        ),
        sha256: "current",
      }),
      scenario: { temperature_change_c: 0, rainfall_change_pct: 0 },
      profile_id: state.currentProfile
        ? "iowa-engineering-v3-20261114"
        : "withdrawn-profile",
      model_version: state.daily ? "rotation-milp-v3.0" : "rotation-milp-v2.0",
      start: "2027-01-01",
      end: "2028-12-31",
    },
    provenance: {
      profile_id: state.currentProfile
        ? "iowa-engineering-v3-20261114"
        : "withdrawn-profile",
      profile_sha256: state.currentProfile ? "current" : "old",
      weather_sha256: "weather",
      weather_release_id: "past",
      limitations: [],
      sources: {},
    },
    field_snapshots: [],
    status: "optimal",
    result: {},
  }),
}));
beforeEach(() => {
  state.search = new URLSearchParams();
  state.daily = false;
  state.currentProfile = false;
  state.assistant = null;
  localStorage.clear();
});
afterEach(cleanup);
function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <RotationWorkspace mode="rotation" />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
it("opens new planning with the sourced daily model", async () => {
  open();
  expect(
    await screen.findByRole("region", { name: "逐日轮作规划" }),
  ).toBeInTheDocument();
});
it("keeps legacy runs readable without silently changing their inputs to v3", async () => {
  state.search = new URLSearchParams("run=old-run");
  open();
  expect(await screen.findByText("withdrawn-profile")).toBeInTheDocument();
  expect(await screen.findByText(/旧版 v2/)).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "逐日轮作规划" }),
  ).not.toBeInTheDocument();
});

it("shows frozen daily results without substituting another published profile", async () => {
  state.daily = true;
  state.search = new URLSearchParams("run=old-run");
  open();
  expect(
    await screen.findByText(/当时的逐日参数包已不可用或已更新/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "逐日轮作规划" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/withdrawn-profile/)).toBeInTheDocument();
});

it("does not carry edited daily conditions into a different legacy run", async () => {
  state.daily = true;
  state.currentProfile = true;
  state.search = new URLSearchParams("run=current-run");
  const view = open();
  await screen.findByRole("region", { name: "逐日轮作规划" });
  fireEvent.change(screen.getByLabelText("规划开始"), {
    target: { value: "2027-02-01" },
  });
  await waitFor(() => expect(state.assistant?.context.draft?.dirty).toBe(true));
  state.daily = false;
  state.currentProfile = false;
  state.search = new URLSearchParams("run=legacy-run");
  view.refresh();
  await screen.findByText(/旧版 v2/);
  await waitFor(() =>
    expect(state.assistant?.context.draft?.dirty).toBe(false),
  );
});
