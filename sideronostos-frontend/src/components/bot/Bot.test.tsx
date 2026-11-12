import "./dialog-test-setup";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { BotMode } from "@/lib/bot";
import { Bot } from "./Bot";
afterEach(cleanup);
it("works with an unrelated identity and retains child state across all modes", async () => {
  const user = userEvent.setup();
  function Example() {
    const [mode, setMode] = useState<BotMode>("collapsed");
    return (
      <Bot
        identity={{ id: "soil", name: "土壤助手", description: "聊聊土壤" }}
        mode={mode}
        onModeChange={setMode}
        dataView={{ label: "数据", content: <p>区域观测</p> }}
      >
        <textarea aria-label="消息" defaultValue="" />
      </Bot>
    );
  }
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "打开土壤助手" }));
  await user.type(screen.getByRole("textbox"), "明年种什么？");
  await user.click(screen.getByRole("button", { name: "全屏查看选区数据" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  expect(screen.getByText("区域观测")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("textbox")).toHaveValue("明年种什么？");
  await user.click(screen.getByRole("button", { name: "收起土壤助手" }));
  expect(screen.getByRole("button", { name: "打开土壤助手" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "打开土壤助手" }));
  expect(screen.getByRole("textbox")).toHaveValue("明年种什么？");
});
it("disables full screen without selected data and exits if that data is removed", () => {
  const onModeChange = vi.fn();
  const identity = { id: "a", name: "助手", description: "测试" };
  const view = render(
    <Bot
      identity={identity}
      mode="data"
      onModeChange={onModeChange}
      dataView={{ label: "数据", content: <p>选区</p> }}
    >
      聊天
    </Bot>,
  );
  expect(document.body.style.overflow).toBe("hidden");
  view.rerender(
    <Bot identity={identity} mode="data" onModeChange={onModeChange}>
      聊天
    </Bot>,
  );
  expect(onModeChange).toHaveBeenCalledWith("chat");
  expect(
    screen.getByRole("button", { name: "全屏查看选区数据" }),
  ).toBeDisabled();
  expect(document.body.style.overflow).not.toBe("hidden");
});
