import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useI18n } from "./provider";
import { translate } from "./translate";
import { LanguageSwitch } from "@/components/language-switch";
function Screen({ page = "map" }: { page?: string }) {
  const { t } = useI18n();
  return <><LanguageSwitch /><h1>{t("轮作规划")}</h1><input aria-label="draft" defaultValue="" /><span>{page}</span></>;
}
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }); document.cookie = "agrisata-locale=; Max-Age=0; Path=/"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("farmer language preference", () => {
  it("starts in English and switches without losing the farmer's input", () => {
    render(<LocaleProvider><Screen /></LocaleProvider>);
    expect(screen.getByRole("heading").textContent).toBe("Rotation planning");
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "West field" } });
    fireEvent.change(screen.getByRole("combobox", { name: /language/i }), { target: { value: "zh" } });
    expect(screen.getByRole("heading").textContent).toBe("轮作规划");
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("West field");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.cookie).toContain("agrisata-locale=zh");
  });
  it("keeps the chosen language across route changes and refresh/remount", () => {
    const view = render(<LocaleProvider><Screen /></LocaleProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: /language/i }), { target: { value: "zh" } });
    view.rerender(<LocaleProvider><Screen page="planner" /></LocaleProvider>);
    expect(screen.getByRole("heading").textContent).toBe("轮作规划");
    view.unmount();
    render(<LocaleProvider><Screen /></LocaleProvider>);
    expect(screen.getByRole("heading").textContent).toBe("轮作规划");
  });
  it("accepts only supported values from storage events", () => {
    render(<LocaleProvider><Screen /></LocaleProvider>);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "agrisata-locale", newValue: "zh" })));
    expect(screen.getByRole("heading").textContent).toBe("轮作规划");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "agrisata-locale", newValue: "bad" })));
    expect(screen.getByRole("heading").textContent).toBe("轮作规划");
  });
  it("preserves field names and interpolated values rather than translating user content", () => {
    expect(translate("en", "已选择 {count} 块地", { count: 2 })).toBe("2 fields selected");
    expect(translate("zh", "West field 2026")).toBe("West field 2026");
  });
});
