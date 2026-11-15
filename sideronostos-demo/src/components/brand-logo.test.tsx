import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandLogo } from "@/components/brand-logo";

afterEach(cleanup);

describe("BrandLogo", () => {
  it("renders the Agrisata banner by default", () => {
    render(<BrandLogo />);

    const logo = screen.getByRole("img", { name: "Agrisata" });
    expect(logo.getAttribute("src")).toContain("app-logo-banner.png");
    expect(logo.getAttribute("width")).toBe("1254");
    expect(logo.getAttribute("height")).toBe("303");
  });

  it("uses the colored compact icon on light surfaces", () => {
    render(<BrandLogo variant="icon" surface="light" alt="" />);

    const logo = screen.getByRole("presentation");
    expect(logo.getAttribute("src")).toContain("app-logo-colored.png");
    expect(logo.className).not.toContain("brightness-0");
  });

  it("uses dark banner artwork on light surfaces", () => {
    render(<BrandLogo surface="light" />);

    const logo = screen.getByRole("img", { name: "Agrisata" });
    expect(logo.getAttribute("src")).toContain("app-logo-banner.png");
    expect(logo.className).toContain("brightness-0");
  });
});
