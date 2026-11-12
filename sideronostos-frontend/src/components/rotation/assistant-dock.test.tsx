import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AssistantContext,
  AssistantMessage,
} from "@/lib/api/rotation-types";
import { AssistantDock } from "./assistant-dock";

const api = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  listConversations: vi.fn(),
  getMessageSource: vi.fn(),
}));
vi.mock("@/lib/api/rotation", () => api);
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const context: AssistantContext = {
  page: "map",
  revision: 1,
  fields: [{ id: "field-a", expected_version: 1 }],
};

it("keeps late replies bound to their original field and disables their navigation actions", async () => {
  const user = userEvent.setup();
  let finish!: (value: AssistantMessage) => void;
  const pending = new Promise<AssistantMessage>((resolve) => {
    finish = resolve;
  });
  api.createConversation.mockResolvedValue({
    id: "chat-a",
    language: "zh",
    detail: "brief",
  });
  api.getConversation.mockResolvedValue({
    id: "chat-a",
    language: "zh",
    detail: "brief",
    messages: [],
    next_before_sequence: null,
  });
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.sendMessage.mockReturnValue(pending);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onAction = vi.fn();
  const view = (ctx: AssistantContext) => (
    <QueryClientProvider client={client}>
      <AssistantDock
        ownerId="owner-a"
        context={ctx}
        contextLabel={ctx.revision === 1 ? "北田" : "南田"}
        onAction={onAction}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view(context));
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "解释当前地块",
  );
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
  rerender(
    view({
      ...context,
      revision: 2,
      fields: [{ id: "field-b", expected_version: 1 }],
    }),
  );
  await act(async () =>
    finish({
      id: "message-a",
      sequence: 1,
      client_message_id: "request-a",
      status: "complete",
      text: "解释当前地块",
      context,
      context_labels: {
        fields: [{ id: "field-a", name: "北田", version: 1 }],
        selection_kind: null,
        run_id: null,
        option_id: null,
      },
      response: {
        paragraphs: [{ text: "这是北田的说明。", evidence_ids: [] }],
        actions: ["open_planner"],
        needs_clarification: false,
      },
      facts: [],
      error_code: null,
      created_at: "2026-11-12T10:00:00Z",
      completed_at: "2026-11-12T10:00:01Z",
    }),
  );
  expect(await screen.findByText("这是北田的说明。")).toBeInTheDocument();
  expect(screen.getByText(/基于之前的选择/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开轮作规划" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "打开轮作助手" })).toHaveFocus();
});

it("closes a loading source without reopening on its late response and keeps citation numbers stable", async () => {
  const user = userEvent.setup();
  sessionStorage.setItem("field-shift:assistant:owner-a", "chat-source");
  const message: AssistantMessage = {
    id: "source-message",
    sequence: 1,
    client_message_id: "source-client",
    status: "complete",
    text: "轮作的依据",
    context,
    context_labels: {
      fields: [],
      selection_kind: null,
      run_id: null,
      option_id: null,
    },
    response: {
      paragraphs: [
        { text: "第一段", evidence_ids: ["K3", "K4"] },
        { text: "第二段", evidence_ids: ["K4"] },
      ],
      actions: [],
      needs_clarification: false,
    },
    facts: [],
    error_code: null,
    created_at: "2026-11-12T10:00:00Z",
    completed_at: "2026-11-12T10:00:01Z",
  };
  api.getConversation.mockResolvedValue({
    id: "chat-source",
    language: "zh",
    detail: "brief",
    messages: [message],
    next_before_sequence: null,
  });
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  let finish!: (value: unknown) => void;
  api.getMessageSource.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssistantDock
        ownerId="owner-a"
        context={context}
        contextLabel="北田"
        onAction={() => {}}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await screen.findByText("第一段");
  expect(screen.getByRole("button", { name: "查看依据 K4" })).not.toBeVisible();
  await user.click(screen.getByText("依据与数据"));
  expect(
    screen
      .getAllByRole("button", { name: "查看依据 K4" })
      .map((e) => e.textContent),
  ).toEqual(["2"]);
  const origin = screen.getByRole("button", { name: "查看依据 K3" });
  await user.click(origin);
  await user.click(screen.getByRole("button", { name: "关闭依据" }));
  await act(async () =>
    finish({
      id: "K3",
      key: "test",
      label: "迟到来源",
      display: "旧内容",
      value: null,
      unit: "",
      source: {},
      limitations: [],
    }),
  );
  expect(screen.queryByLabelText("回答依据")).not.toBeInTheDocument();
  expect(origin).toHaveFocus();
});

it("serializes preference edits and ignores a late failure after switching conversations", async () => {
  sessionStorage.setItem("field-shift:assistant:owner-a", "chat-a");
  api.getConversation.mockResolvedValue({
    id: "chat-a",
    language: "zh",
    detail: "brief",
    messages: [],
    next_before_sequence: null,
  });
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.listConversations.mockResolvedValue({ items: [] });
  let reject!: (e: Error) => void;
  api.setPreferences.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssistantDock
        ownerId="owner-a"
        context={context}
        contextLabel="北田"
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.click(screen.getByRole("button", { name: "回答偏好" }));
  await user.selectOptions(screen.getByLabelText(/语言/), "en");
  expect(screen.getByLabelText(/解释程度/)).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "历史对话" }));
  await user.click(screen.getByRole("button", { name: "开始新对话" }));
  await act(async () => {
    reject(new Error("Old preference update failed"));
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("clears an interrupted submission after the server confirms its terminal reply", async () => {
  const key = "field-shift:assistant:owner-a";
  sessionStorage.setItem(key, "chat-restored");
  sessionStorage.setItem(
    `${key}:pending`,
    JSON.stringify({
      conversation: "chat-restored",
      body: { client_message_id: "restored-request", text: "解释", context },
    }),
  );
  api.getConversation.mockResolvedValue({
    id: "chat-restored",
    language: "zh",
    detail: "brief",
    next_before_sequence: null,
    messages: [
      {
        id: "restored-message",
        sequence: 1,
        client_message_id: "restored-request",
        status: "complete",
        text: "解释",
        context,
        context_labels: {
          fields: [],
          selection_kind: null,
          run_id: null,
          option_id: null,
        },
        response: {
          paragraphs: [{ text: "已恢复的回答", evidence_ids: [] }],
          actions: [],
          needs_clarification: false,
        },
        facts: [],
        error_code: null,
        created_at: "2026-11-12T10:00:00Z",
        completed_at: "2026-11-12T10:00:01Z",
      },
    ],
  });
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AssistantDock
        ownerId="owner-a"
        context={context}
        contextLabel="北田"
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "打开轮作助手" }));
  await screen.findByText("已恢复的回答");
  await waitFor(() =>
    expect(sessionStorage.getItem(`${key}:pending`)).toBeNull(),
  );
  expect(api.sendMessage).not.toHaveBeenCalled();
});

it("treats persisted JSON object key ordering as the same selected context", async () => {
  const user = userEvent.setup();
  const current: AssistantContext = {
    ...context,
    selection: { id: "selection-a", revision: 2 },
    dates: { start: "2026-11-07", end: "2026-11-07" },
  };
  const stored: AssistantContext = {
    ...current,
    dates: { end: "2026-11-07", start: "2026-11-07" },
    selection: { revision: 2, id: "selection-a" },
    fields: [{ expected_version: 1, id: "field-a" }],
  };
  sessionStorage.setItem("field-shift:assistant:owner-a", "chat-order");
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.getConversation.mockResolvedValue({
    id: "chat-order",
    language: "zh",
    detail: "brief",
    next_before_sequence: null,
    messages: [
      {
        id: "order-message",
        sequence: 1,
        client_message_id: "order-client",
        status: "complete",
        text: "解释读数",
        context: stored,
        context_labels: {
          fields: [{ id: "field-a", name: "北田", version: 1 }],
          selection_kind: "point",
          run_id: null,
          option_id: null,
        },
        response: {
          paragraphs: [{ text: "当前选择的说明。", evidence_ids: [] }],
          actions: ["open_planner"],
          needs_clarification: false,
        },
        facts: [],
        error_code: null,
        created_at: "2026-11-13T00:00:00Z",
        completed_at: "2026-11-13T00:00:01Z",
      },
    ],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AssistantDock
        ownerId="owner-a"
        context={current}
        contextLabel="北田"
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  expect(await screen.findByText("当前选择的说明。")).toBeInTheDocument();
  expect(screen.queryByText(/基于之前的选择/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开轮作规划" })).toBeEnabled();
});

function chatFixture() {
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.createConversation.mockResolvedValue({
    id: "chat-live",
    language: "zh",
    detail: "brief",
  });
  api.getConversation.mockResolvedValue({
    id: "chat-live",
    language: "zh",
    detail: "brief",
    messages: [],
    next_before_sequence: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssistantDock
        ownerId="owner-a"
        context={context}
        contextLabel="北田"
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
function completedReply(clientId: string): AssistantMessage {
  return {
    id: "live-message",
    sequence: 1,
    client_message_id: clientId,
    status: "complete",
    text: "现在需要浇水吗？",
    context,
    context_labels: {
      fields: [],
      selection_kind: null,
      run_id: null,
      option_id: null,
    },
    response: {
      paragraphs: [
        {
          text: "先别只凭这张图决定浇水。它反映的是附近区域的表层土壤，还需要看看地里的实际情况。",
          evidence_ids: [],
        },
      ],
      actions: [],
      needs_clarification: false,
    },
    facts: [],
    error_code: null,
    created_at: "2026-11-13T00:00:00Z",
    completed_at: "2026-11-13T00:00:01Z",
  };
}
it("shows the submitted message immediately, clears the composer, and reconciles without duplicating it", async () => {
  let create!: (value: unknown) => void;
  let finish!: (value: AssistantMessage) => void;
  chatFixture();
  api.createConversation.mockReturnValue(
    new Promise((resolve) => {
      create = resolve;
    }),
  );
  api.sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  const input = screen.getByRole("textbox", { name: "给轮作助手留言" });
  await user.type(input, "现在需要浇水吗？");
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  expect(
    within(screen.getByRole("log")).getByText("现在需要浇水吗？"),
  ).toBeVisible();
  expect(input).toHaveValue("");
  await act(async () =>
    create({ id: "chat-live", language: "zh", detail: "brief" }),
  );
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
  await act(async () =>
    finish(completedReply(api.sendMessage.mock.calls[0][1].client_message_id)),
  );
  expect(
    within(screen.getByRole("log")).getAllByText("现在需要浇水吗？"),
  ).toHaveLength(1);
});
it("progressively presents a validated new reply and lets the reader reveal it immediately", async () => {
  let finish!: (value: AssistantMessage) => void;
  chatFixture();
  api.sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "现在需要浇水吗？",
  );
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();
  const response = completedReply(
    api.sendMessage.mock.calls[0][1].client_message_id,
  );
  await act(async () => finish(response));
  expect(
    screen.queryByText(response.response!.paragraphs[0].text),
  ).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(200));
  const log = screen.getByRole("log");
  expect(log).toHaveTextContent("先别只凭");
  expect(log).not.toHaveTextContent("实际情况。");
  fireEvent.click(screen.getByRole("button", { name: "显示完整回答" }));
  expect(
    within(log).getByText(response.response!.paragraphs[0].text),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "显示完整回答" }),
  ).not.toBeInTheDocument();
});
it("respects reduced motion and displays the validated reply immediately", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  chatFixture();
  api.sendMessage.mockImplementation(async (_chat, body) =>
    completedReply(body.client_message_id),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "现在需要浇水吗？",
  );
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  expect(
    await within(screen.getByRole("log")).findByText(
      completedReply("unused").response!.paragraphs[0].text,
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "显示完整回答" }),
  ).not.toBeInTheDocument();
});

it("announces the complete reply once, without reading each partial word", async () => {
  let finish!: (value: AssistantMessage) => void;
  chatFixture();
  api.sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "现在需要浇水吗？",
  );
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();
  const reply = completedReply(
    api.sendMessage.mock.calls[0][1].client_message_id,
  );
  await act(async () => finish(reply));
  act(() => vi.advanceTimersByTime(150));
  expect(
    screen
      .getAllByRole("status")
      .some((el) => el.textContent?.includes("先别")),
  ).toBe(false);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByRole("status")).toHaveTextContent(
    reply.response!.paragraphs[0].text,
  );
  expect(
    within(screen.getByRole("log")).getByText(
      reply.response!.paragraphs[0].text,
    ),
  ).toBeVisible();
});

it("reopens a received reply in full instead of replaying the animation", async () => {
  let finish!: (value: AssistantMessage) => void;
  chatFixture();
  api.sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "现在需要浇水吗？",
  );
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();
  const reply = completedReply(
    api.sendMessage.mock.calls[0][1].client_message_id,
  );
  await act(async () => finish(reply));
  fireEvent.click(screen.getByRole("button", { name: "收起轮作助手" }));
  fireEvent.click(screen.getByRole("button", { name: "打开轮作助手" }));
  expect(
    within(screen.getByRole("log")).getByText(
      reply.response!.paragraphs[0].text,
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "显示完整回答" }),
  ).not.toBeInTheDocument();
});

it("preserves an unsent draft when collapsed without exposing a full-screen action", async () => {
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AssistantDock
        ownerId="owner-a"
        context={context}
        contextLabel="北田"
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  await user.type(
    screen.getByRole("textbox", { name: "给轮作助手留言" }),
    "这片地适合种什么？",
  );
  expect(
    screen.queryByRole("button", { name: /全屏/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "收起轮作助手" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开轮作助手" }));
  expect(screen.getByRole("textbox", { name: "给轮作助手留言" })).toHaveValue(
    "这片地适合种什么？",
  );
  expect(api.sendMessage).not.toHaveBeenCalled();
});
