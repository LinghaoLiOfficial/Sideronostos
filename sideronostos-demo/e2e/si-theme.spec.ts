import { expect, test } from "@playwright/test";

const palette = {
  ink: "rgb(11, 18, 15)",
  cream: "rgb(232, 234, 214)",
  creamText: "rgb(35, 48, 31)",
  light: "rgb(250, 252, 247)",
};

test("keeps the model layer reference palette", async ({ page }) => {
  await page.goto("/si/introduction/layers/weather");
  await expect(page.getByRole("heading", { name: "NASA POWER" })).toBeVisible();

  const guide = page.locator("main");
  const drawer = page.locator("aside");
  await expect(guide).toHaveCSS("background-color", palette.ink);
  await expect(guide).toHaveCSS("color", palette.light);
  await expect(drawer).toHaveCSS("background-color", palette.cream);
  await expect(drawer).toHaveCSS("color", palette.creamText);
});

test("scopes the SI palette to field management without horizontal overflow", async ({ page }) => {
  await page.goto("/si/field-management");
  const theme = page.locator(".si-theme");
  await expect(theme).toHaveCSS("background-color", palette.ink);
  await expect(theme).toHaveCSS("color", palette.light);
  expect(await theme.evaluate((element) => getComputedStyle(element).getPropertyValue("--si-cream").trim())).toBe("#e8ead6");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("keeps the business module menu readable on its cream surface", async ({ page }) => {
  await page.goto("/si/field-management");
  const moduleButton = page.getByRole("button", { name: "Module", exact: true });
  test.skip(!(await moduleButton.isVisible()), "The compact mobile header hides the module menu");
  await moduleButton.click();

  const menu = page.locator(".landing-nav-popover");
  const item = page.getByRole("menuitem").first();
  await expect(menu).toHaveCSS("background-color", palette.cream);
  await expect(item).toHaveCSS("color", palette.creamText);
});

test("uses the same readable module menu on the SI home page", async ({ page }) => {
  await page.goto("/si");
  await page.getByRole("button", { name: "Module", exact: true }).click();

  const menu = page.locator(".si-header-menu");
  const item = menu.getByRole("menuitem").first();
  await expect(menu).toHaveCSS("background-color", palette.cream);
  await expect(item).toHaveCSS("color", palette.creamText);
  await expect(menu).toHaveCSS("width", "280px");
  await expect(item).toHaveCSS("font-size", "14px");
});

test("uses the same compact module menu size on business pages", async ({ page }) => {
  await page.goto("/si/field-management");
  const moduleButton = page.getByRole("button", { name: "Module", exact: true });
  test.skip(!(await moduleButton.isVisible()), "The compact mobile header hides the module menu");
  await moduleButton.click();

  const menu = page.locator(".landing-nav-popover");
  const item = menu.getByRole("menuitem").first();
  await expect(menu).toHaveCSS("width", "280px");
  await expect(item).toHaveCSS("font-size", "14px");
});

test("reaches the bottom of the crop parameters and rotation rules with the scroll wheel", async ({ page }) => {
  await page.goto("/si/local-knowledge");
  const views = page.getByRole("navigation", { name: "Knowledge base views" });
  await expect(page.getByRole("heading", { name: "Configuration" })).toHaveCSS("color", palette.creamText);
  for (const [tab, bottom] of [
    ["Crop parameters", "Parameter source bindings"],
    ["Rotation rules", "Rule parameter source bindings"],
  ]) {
    await views.getByRole("button", { name: tab, exact: true }).click();
    const end = page.getByText(bottom, { exact: true }).last();
    await expect(end).not.toBeInViewport();
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width * .65, viewport.height * .8);
    await page.mouse.wheel(0, 12000);
    await expect(end).toBeInViewport();
    await expect(page.getByRole("button", { name: "Module", exact: true })).toBeInViewport();
  }
});

test("keeps the transparent home header and shares the six modules across the app", async ({ page }) => {
  for (const route of ["/si", "/personal/account", "/si/field-management", "/si/remote-sensing", "/si/local-knowledge", "/si/rotation-recommendation"]) {
    await page.goto(route);
    const header = page.getByRole("banner");
    await expect(header).toHaveCSS("background-color", route === "/si" ? "rgba(0, 0, 0, 0)" : "rgba(0, 0, 0, 0.2)");
    await expect(header).toHaveCSS("border-bottom-width", "0px");
    const toggle = page.getByRole("button", { name: "Open menu" });
    if (await toggle.isVisible()) await toggle.click();
    await page.getByRole("button", { name: "Module", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Multi-Agent System",
      "Field Management",
      "Remote Sensing Analysis",
      "Local Agricultural Knowledge Base",
      "Crop Rotation Strategy Recommendation",
      "Explore the rotation model",
    ]);
    await expect(menu.getByRole("menuitem").last()).toHaveAttribute("href", "/si/introduction");
  }
  await page.getByRole("menuitem", { name: "Explore the rotation model" }).click();
  await expect(page).toHaveURL(/\/si\/introduction$/);
});
