import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Surface, useSurface, useSurfaceAppearance } from "./surface";
import { Card, CardContent, CardDescription, CardTitle } from "./card";
import { Button } from "./button";
import { Input } from "./input";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";

afterEach(cleanup);
beforeEach(() => {
  // jsdom has no scrolling/layout; Radix Select focuses its selected option.
  Element.prototype.scrollIntoView = vi.fn();
});

function Probe({ label }: { label: string }) {
  return <output aria-label={label}>{useSurface()}</output>;
}

function MaterialProbe() {
  const { tone, material } = useSurfaceAppearance();
  return <output aria-label="appearance">{tone}/{material}</output>;
}

describe("local surfaces", () => {
  it("marks explicit nested glass for a single blur layer", () => {
    render(<Surface material="glass"><Surface material="glass" aria-label="nested glass"><Card material="glass">panel</Card></Surface></Surface>);
    expect(screen.getByLabelText("nested glass").getAttribute("data-material-nested")).toBe("true");
    expect(screen.getByText("panel").getAttribute("data-material-nested")).toBe("true");
  });
  it("opts into smoky glass locally and keeps nested controls solid", () => {
    render(<Surface tone="light"><Card material="glass"><MaterialProbe /><Input aria-label="玻璃输入" /><Card><Probe label="solid child" /></Card></Card><Card><Probe label="cream sibling" /></Card></Surface>);
    const appearance = screen.getByLabelText("appearance");
    expect(appearance.textContent).toBe("dark/glass");
    expect(appearance.closest('[data-slot="card"]')?.getAttribute("data-material")).toBe("glass");
    expect(screen.getByLabelText("solid child").closest('[data-slot="card"]')?.getAttribute("data-material")).toBe("solid");
    expect(screen.getByLabelText("cream sibling").textContent).toBe("light");
    expect(screen.getByLabelText("玻璃输入").hasAttribute("data-material")).toBe(false);
  });

  it("updates material context without changing the surrounding palette", () => {
    const { rerender } = render(<Surface material="solid"><MaterialProbe /></Surface>);
    rerender(<Surface material="glass"><MaterialProbe /></Surface>);
    expect(screen.getByLabelText("appearance").textContent).toBe("dark/glass");
    rerender(<Surface tone="light"><MaterialProbe /></Surface>);
    expect(screen.getByLabelText("appearance").textContent).toBe("light/solid");
  });
  it("defaults to dark, inherits light, and restores nested dark cards", () => {
    render(<><Card><Probe label="root" /></Card><Surface tone="light">
      <Card><CardTitle>米白卡片</CardTitle><CardDescription>辅助信息</CardDescription><CardContent><Probe label="light" /><Input aria-label="标题" /><Button>保存</Button></CardContent></Card>
      <Card surface="dark"><Probe label="nested dark" /></Card>
    </Surface></>);
    for (const [label, tone] of [["root", "dark"], ["light", "light"], ["nested dark", "dark"]]) {
      const probe = screen.getByLabelText(label);
      expect(probe.textContent).toBe(tone);
      expect(probe.closest('[data-slot="card"]')?.getAttribute("data-surface")).toBe(tone);
    }
    expect(screen.getByLabelText("标题").closest('[data-surface]')?.getAttribute("data-surface")).toBe("light");
  });

  it("updates descendants when a local surface changes", () => {
    const { rerender } = render(<Surface tone="light"><Card><Probe label="tone" /></Card></Surface>);
    rerender(<Surface tone="dark"><Card><Probe label="tone" /></Card></Surface>);
    expect(screen.getByLabelText("tone").textContent).toBe("dark");
  });

  it.each([{ tone: "dark", material: "solid" }, { tone: "light", material: "solid" }, { tone: "dark", material: "glass" }] as const)("preserves $tone / $material on all portaled content", async ({ tone, material }) => {
    const examples = [
      { slot: "dialog-content", element: <Dialog defaultOpen><DialogContent><DialogTitle>弹窗</DialogTitle><DialogDescription>说明</DialogDescription><Probe label="portal" /></DialogContent></Dialog> },
      { slot: "sheet-content", element: <Sheet defaultOpen><SheetContent><SheetTitle>侧栏</SheetTitle><SheetDescription>说明</SheetDescription><Probe label="portal" /></SheetContent></Sheet> },
      { slot: "popover-content", element: <Popover defaultOpen><PopoverTrigger>打开</PopoverTrigger><PopoverContent><Probe label="portal" /></PopoverContent></Popover> },
      { slot: "select-content", element: <Select defaultOpen><SelectTrigger aria-label="集合"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">研究</SelectItem></SelectContent></Select> },
      { slot: "dropdown-menu-content", element: <DropdownMenu defaultOpen><DropdownMenuTrigger>打开</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>保存</DropdownMenuItem><DropdownMenuSub open><DropdownMenuSubTrigger>更多</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>导出</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu> },
      { slot: "tooltip-content", element: <TooltipProvider><Tooltip open><TooltipTrigger>帮助</TooltipTrigger><TooltipContent>使用帮助</TooltipContent></Tooltip></TooltipProvider> },
      { slot: "combobox-content", element: <Combobox items={["研究"]} defaultOpen><ComboboxInput aria-label="主题" /><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox> },
    ];
    for (const example of examples) {
      const { container, unmount } = render(<Surface tone={tone} material={material}>{example.element}</Surface>);
      const content = await waitFor(() => {
        const element = document.querySelector(`[data-slot="${example.slot}"]`);
        expect(element).toBeTruthy();
        return element!;
      });
      expect(content.getAttribute("data-surface")).toBe(tone);
      expect(content.getAttribute("data-material")).toBe(material);
      expect(content.hasAttribute("data-surface-overlay")).toBe(true);
      expect(container.contains(content)).toBe(false);
      if (example.slot === "dropdown-menu-content") {
        await waitFor(() => expect(document.querySelector('[data-slot="dropdown-menu-sub-content"]')?.getAttribute("data-surface")).toBe(tone));
        expect(document.querySelector('[data-slot="dropdown-menu-sub-content"]')?.getAttribute("data-material")).toBe(material);
      }
      unmount();
    }
  });

  it.each(["solid", "glass"] as const)("keeps nested %s dialog controls usable and restores focus on Escape", async (material) => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <Card surface="light" material={material}><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button>新建</Button></DialogTrigger><DialogContent><DialogTitle>新建条目</DialogTitle><DialogDescription>设置标题</DialogDescription><Input aria-label="新标题" /></DialogContent></Dialog></Card>;
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "新建" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").getAttribute("data-surface")).toBe(material === "glass" ? "dark" : "light");
    expect(screen.getByRole("dialog").getAttribute("data-material")).toBe(material);
    const input = screen.getByLabelText("新标题");
    fireEvent.change(input, { target: { value: "研究笔记" } });
    expect((input as HTMLInputElement).value).toBe("研究笔记");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
