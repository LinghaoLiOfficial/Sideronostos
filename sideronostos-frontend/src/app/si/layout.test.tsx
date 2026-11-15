import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SiLayout from "./layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/si/fields" }));
vi.mock("@/features/si/si-header", () => ({ SiHeader: () => <header>SI navigation</header> }));
vi.mock("@/features/si/si-story-link", () => ({ SiStoryNavigation: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/features/si/si-shell", () => ({ SiShell: ({ children }: { children: React.ReactNode }) => <div><header>Module navigation</header>{children}</div> }));

it("lets the fields workspace own the only page header", () => {
  render(<SiLayout><header>Field Shift navigation</header></SiLayout>);
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  expect(screen.getByText("Field Shift navigation")).toBeInTheDocument();
});
