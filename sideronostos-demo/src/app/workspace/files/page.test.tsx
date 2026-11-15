import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import WorkspacePage from "./page";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserContext: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));
vi.mock("@/components/workspace/shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/workspace/files-manager", () => ({
  WorkspaceFilesManager: () => <p>文件管理器</p>,
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/client")>(),
  getCurrentUser: mocks.getCurrentUser,
  getUserContext: mocks.getUserContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.getUserContext.mockResolvedValue({
    user: { id: "user-1" },
    organizations: [{ id: "personal-1", kind: "personal" }],
  });
});

afterEach(cleanup);

describe("workspace files authentication", () => {
  it("keeps the user on the page when loading fails temporarily", async () => {
    mocks.getUserContext.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<WorkspacePage />);

    expect(await screen.findByText("个人文件空间加载失败")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects to login when the API confirms the session is unauthorized", async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new ApiError(401, {
      code: "http_401", message: "Unauthorized", request_id: "test", details: null,
    }));

    render(<WorkspacePage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(
      "/login?next=/workspace/files&authRequired=1",
    ));
  });
});
