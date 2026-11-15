import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MindMapFilePage from "./page";

const api = vi.hoisted(() => ({
  getUserContext: vi.fn(),
  getWorkspaceFile: vi.fn(),
  saveWorkspaceFileContent: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => {
  const router = { replace: api.replace };
  return {
    useParams: () => ({ fileId: "file-1" }),
    useRouter: () => router,
    useSearchParams: () => api.searchParams,
  };
});

vi.mock("@/lib/api/client", () => ({
  getUserContext: api.getUserContext,
  getWorkspaceFile: api.getWorkspaceFile,
  saveWorkspaceFileContent: api.saveWorkspaceFileContent,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("kanx-mindmap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("kanx-mindmap")>();
  return {
    ...actual,
    MindMapEditor: ({ value, onChange }: { value: import("kanx-mindmap").Tree; onChange: (tree: import("kanx-mindmap").Tree) => void }) => (
      <>
        <output>{value.nodes[value.rootId].text}</output>
        <button type="button" onClick={() => onChange({
          rootId: value.rootId,
          nodes: {
            ...value.nodes,
            child: { id: "child", parentId: value.rootId, children: [], kind: "text", text: "新增主题", collapsed: false },
            [value.rootId]: { ...value.nodes[value.rootId], children: [...value.nodes[value.rootId].children, "child"] },
          },
        })}>
          编辑导图
        </button>
      </>
    ),
  };
});

afterEach(cleanup);

describe("mindmap file page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.searchParams = new URLSearchParams();
    api.getUserContext.mockResolvedValue({ organizations: [{ id: "personal-1", kind: "personal" }] });
    api.getWorkspaceFile.mockResolvedValue({
      id: "file-1",
      name: "研究路线图",
      type: "mindmap",
      content: {
        version: 2,
        tree: {
          rootId: "root",
          nodes: { root: { id: "root", parentId: null, children: [], kind: "text", text: "中心主题", collapsed: false } },
        },
      },
    });
    api.saveWorkspaceFileContent.mockResolvedValue({});
  });

  it("loads a saved document and persists controlled edits as a v2 document", async () => {
    render(<MindMapFilePage />);

    expect(await screen.findByRole("heading", { name: "研究路线图" })).toBeTruthy();
    expect(screen.getByText("中心主题")).toBeTruthy();
    expect(api.getWorkspaceFile).toHaveBeenCalledWith("personal-1", "file-1");

    fireEvent.click(screen.getByRole("button", { name: "编辑导图" }));

    await waitFor(() => expect(api.saveWorkspaceFileContent).toHaveBeenCalledWith("personal-1", "file-1", {
      version: 2,
      tree: {
        rootId: "root",
        nodes: {
          root: { id: "root", parentId: null, children: ["child"], kind: "text", text: "中心主题", collapsed: false },
          child: { id: "child", parentId: "root", children: [], kind: "text", text: "新增主题", collapsed: false },
        },
      },
    }), { timeout: 2000 });
  });

  it("uses the initial tree when the file has no saved content", async () => {
    api.getWorkspaceFile.mockResolvedValueOnce({
      id: "file-1",
      name: "空白导图",
      type: "mindmap",
      content: null,
    });

    render(<MindMapFilePage />);

    expect(await screen.findByRole("heading", { name: "空白导图" })).toBeTruthy();
    expect(screen.getByText("中心主题")).toBeTruthy();
  });

  it("keeps the group organization and return location for a shared mindmap", async () => {
    api.searchParams = new URLSearchParams("organization=group-1&returnTo=%2Fworkspace%2Fgroups%2Fgroup-1%3Ftab%3Dfiles");

    render(<MindMapFilePage />);

    expect(await screen.findByRole("heading", { name: "研究路线图" })).toBeTruthy();
    expect(api.getWorkspaceFile).toHaveBeenCalledWith("group-1", "file-1");
    const backLink = screen.getByRole("link", { name: "返回文件管理" });
    expect(backLink.getAttribute("href")).toBe("/workspace/groups/group-1?tab=files");
  });

  it("returns to the originating group if a shared mindmap cannot load", async () => {
    api.searchParams = new URLSearchParams("organization=group-1&returnTo=%2Fworkspace%2Fgroups%2Fgroup-1%3Ftab%3Dfiles");
    api.getWorkspaceFile.mockRejectedValueOnce(new Error("not found"));

    render(<MindMapFilePage />);

    await waitFor(() => expect(api.replace).toHaveBeenCalledWith("/workspace/groups/group-1?tab=files"));
  });

  it.each([null, "group-1"])("opens a vocabulary library in organization %s and saves before returning", async (organization) => {
    if (organization) api.searchParams = new URLSearchParams(`organization=${organization}`);
    api.getWorkspaceFile.mockResolvedValueOnce({ id: "file-1", name: "我的词汇库", type: "vocabulary", content: { version: 1, entries: [] } });
    render(<MindMapFilePage />);
    expect(await screen.findByTestId("vocabulary-editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加词汇" }));
    fireEvent.change(screen.getByLabelText("词汇"), { target: { value: "run" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("link", { name: "返回文件管理" }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(organization ? `/workspace/groups/${organization}?tab=files` : "/workspace/files"));
    expect(api.saveWorkspaceFileContent).toHaveBeenCalledWith(organization ?? "personal-1", "file-1", { version: 1, entries: [{ id: expect.any(String), word: "run", senses: [] }] });
  });

  it("stays on the vocabulary page when return-time saving fails, then retries", async () => {
    api.getWorkspaceFile.mockResolvedValueOnce({ id: "file-1", name: "词汇库", type: "vocabulary", content: { version: 1, entries: [{ id: "word", word: "run", senses: [] }] } });
    api.saveWorkspaceFileContent.mockRejectedValueOnce(new Error("offline"));
    render(<MindMapFilePage />);
    await screen.findByTestId("vocabulary-editor");
    fireEvent.click(screen.getByRole("button", { name: "修改词汇" }));
    fireEvent.change(screen.getByLabelText("词汇"), { target: { value: "walk" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("link", { name: "返回文件管理" }));
    await screen.findByText("保存失败");
    expect(api.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("已保存");
    expect(api.saveWorkspaceFileContent).toHaveBeenLastCalledWith("personal-1", "file-1", { version: 1, entries: [{ id: "word", word: "walk", senses: [] }] });
  });

  it("restores all saved vocabulary meanings and examples", async () => {
    api.getWorkspaceFile.mockResolvedValueOnce({ id: "file-1", name: "词汇库", type: "vocabulary", content: { version: 1, entries: [{ id: "word", word: "run", senses: [{ id: "sense", definition: "跑步", partOfSpeech: "动词", examples: [{ id: "example", text: "I run." }] }] }] } });
    render(<MindMapFilePage />);
    expect(await screen.findByText("I run.")).toBeTruthy();
    expect(screen.getByText("跑步")).toBeTruthy();
    expect(screen.getByText("动词")).toBeTruthy();
    expect(api.saveWorkspaceFileContent).not.toHaveBeenCalled();
  });
});
