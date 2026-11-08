import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback } from "./avatar";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card } from "./card";
import { Alert } from "./alert";
import { PaginationLink } from "./pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

describe("Agrisata theme", () => {
  it("defines the shared dark palette and optional light surface", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--brand-start: #bdff72; --brand-end: #bdff72;");
    expect(css).toContain("--background: #090a0a; --foreground: #f5f6f3;");
    expect(css).toMatch(/--secondary: #303330;/);
    expect(css).toMatch(/--popover: #1c1e1d;/);
    expect(css).toContain(".glass-surface");
    expect(css).toContain(".glass-popover");
    expect(css).toContain(".glass-field");
    expect(css).toContain(".brand-gradient-soft");
  });

  it("reserves lime for primary controls and keeps supporting elements neutral", () => {
    render(<><Button>新建</Button><Badge>进行中</Badge><Badge variant="secondary">更新</Badge><Badge variant="outline">筛选</Badge>
      <Avatar><AvatarFallback>YL</AvatarFallback></Avatar></>);
    expect(screen.getByRole("button", { name: "新建" }).className).toContain("brand-gradient-control");
    expect(screen.getByText("进行中").className).toContain("brand-gradient-control");
    expect(screen.getByText("进行中").className).toContain("border-0!");
    expect(screen.getByText("更新").className).toContain("bg-secondary");
    expect(screen.getByText("筛选").className).toContain("border-border");
    expect(screen.getByText("YL").className).toContain("bg-secondary");
  });

  it("uses neutral surfaces and semantic hover states for reusable panels", () => {
    render(<><Card interactive>卡片</Card><Alert>提示</Alert><Button variant="secondary">次级操作</Button></>);
    expect(screen.getByText("卡片").className).toContain("bg-card");
    expect(screen.getByText("卡片").getAttribute("data-surface")).toBe("dark");
    expect(screen.getByText("卡片").getAttribute("data-interactive")).toBe("true");
    expect(screen.getByText("卡片").className).toContain("cursor-pointer");
    expect(screen.getByText("卡片").className).toContain("hover:bg-accent!");
    expect(screen.getByText("卡片").className).not.toContain("hover:-translate-y");
    expect(screen.getByRole("alert").className).toContain("glass-surface");
    expect(screen.getByRole("button", { name: "次级操作" }).className).toContain("bg-secondary");
  });

  it("keeps legacy glass aliases opaque and glass material opt-in with a solid fallback", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.glass-surface\s*{\s*background-color: var\(--card\);/);
    expect(css).toContain('[data-material="glass"]');
    expect(css).toContain("backdrop-filter: blur(14px)");
    expect(css).toContain("background-color: #242626ad");
    expect(css).toContain("background-color: #242626eb");
    expect(css).toContain("@supports not ((backdrop-filter:");
  });

  it("highlights selected navigation in the same palette", () => {
    render(<><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">最近</TabsTrigger></TabsList></Tabs>
      <PaginationLink href="#" isActive>1</PaginationLink></>);
    expect(screen.getByRole("tab", { name: "最近" }).className).toContain("data-active:bg-primary/20");
    expect(screen.getByRole("link", { name: "1" }).className).toContain("brand-gradient-control");
  });

  it("supports connected card tabs as a reusable variant", () => {
    render(<Tabs variant="card" defaultValue="overview"><TabsList><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="activity">活动</TabsTrigger></TabsList><TabsContent value="overview">概览内容</TabsContent></Tabs>);
    const tabs = screen.getByRole("tab", { name: "概览" }).closest('[data-slot="tabs"]');
    expect(tabs?.getAttribute("data-variant")).toBe("card");
    expect(screen.getByRole("tablist").className).toContain("flex-wrap");
    expect(screen.getByRole("tab", { name: "概览" }).className).toContain("group-data-[variant=card]");
    expect(screen.getByText("概览内容").className).toContain("group-data-[variant=card]/tabs:glass-surface");
  });
});
