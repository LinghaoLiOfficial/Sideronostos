import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { VocabularyEditor } from "./editor";
import { PARTS_OF_SPEECH, parseVocabularyDocument, type VocabularyDocument } from "./document";

afterEach(cleanup);

function Harness({ initial = { version: 1, entries: [] } }: { initial?: VocabularyDocument }) {
  const [value, setValue] = useState(initial);
  return <><VocabularyEditor value={value} onChange={setValue} /><output data-testid="document">{JSON.stringify(value)}</output></>;
}
function submit(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "确认", exact: true }));
}
function document() { return JSON.parse(screen.getByTestId("document").textContent!) as VocabularyDocument; }

describe("vocabulary editor", () => {
  it("adds, selects, edits and deletes words, senses and plain-text examples", () => {
    render(<Harness />);
    expect(screen.getByText("暂无词汇")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加词汇", exact: true }));
    expect(screen.getByRole("button", { name: "确认", exact: true }).hasAttribute("disabled")).toBe(true);
    submit("词汇", "  run  ");
    const wordId = document().entries[0].id;
    expect(screen.getByRole("button", { name: "run", exact: true }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "添加释义", exact: true }));
    expect(within(screen.getByLabelText("词性")).getAllByRole("option").map((option) => option.textContent)).toEqual([...PARTS_OF_SPEECH]);
    fireEvent.change(screen.getByLabelText("词性"), { target: { value: "动词" } });
    submit("释义", "跑步");
    const senseId = document().entries[0].senses[0].id;
    fireEvent.click(screen.getByRole("button", { name: "添加例句", exact: true }));
    submit("例句正文", "I run every day.");
    const exampleId = document().entries[0].senses[0].examples[0].id;
    fireEvent.click(screen.getByRole("button", { name: "修改例句：I run every day." }));
    submit("例句正文", "I run every morning.");
    expect(document().entries[0].senses[0].examples[0]).toEqual({ id: exampleId, text: "I run every morning." });
    fireEvent.click(screen.getByRole("button", { name: "修改释义：跑步" }));
    submit("释义", "奔跑");
    expect(document().entries[0].senses[0].id).toBe(senseId);
    fireEvent.click(screen.getByRole("button", { name: "修改词汇" }));
    submit("词汇", "running");
    expect(document().entries[0].id).toBe(wordId);
    fireEvent.click(screen.getByRole("button", { name: "删除例句：I run every morning." }));
    expect(screen.getByText("暂无例句")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除释义：奔跑" }));
    expect(screen.getByText(/所有例句会一并删除/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    expect(document().entries[0].senses).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "删除释义：奔跑" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(document().entries[0].senses).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "添加词汇", exact: true }));
    submit("词汇", "walk");
    fireEvent.click(screen.getByRole("button", { name: "running", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "删除词汇" }));
    expect(screen.getByText(/所有释义和例句会一并删除/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(screen.getByRole("heading", { name: "walk" })).toBeTruthy();
  });

  it("keeps multiple meanings and examples separate and allows duplicate words", () => {
    const initial: VocabularyDocument = { version: 1, entries: [{ id: "w1", word: "a-long-word-to-truncate", senses: [
      { id: "s1", definition: "奔跑", partOfSpeech: "动词", examples: [{ id: "e1", text: "They run." }] },
      { id: "s2", definition: "一次运行", partOfSpeech: "名词", examples: [{ id: "e2", text: "A test run." }] },
    ] }] };
    render(<Harness initial={initial} />);
    expect(screen.getByRole("button", { name: initial.entries[0].word }).getAttribute("title")).toBe(initial.entries[0].word);
    expect(screen.getByText("They run.").closest("article")?.textContent).toContain("奔跑");
    expect(screen.getByText("A test run.").closest("article")?.textContent).toContain("一次运行");
    fireEvent.click(screen.getByRole("button", { name: "添加词汇", exact: true }));
    submit("词汇", initial.entries[0].word);
    expect(document().entries).toHaveLength(2);
    expect(new Set(document().entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("rejects malformed saved content instead of replacing it with an empty library", () => {
    expect(parseVocabularyDocument(null)).toEqual({ version: 1, entries: [] });
    expect(() => parseVocabularyDocument({ version: 1, entries: [{ id: "w", word: "run", senses: [{ id: "s", definition: "跑", partOfSpeech: "custom", examples: [] }] }] })).toThrow();
    expect(() => parseVocabularyDocument({ version: 1, entries: [{ id: "w", word: " ", senses: [] }] })).toThrow();
  });
});
