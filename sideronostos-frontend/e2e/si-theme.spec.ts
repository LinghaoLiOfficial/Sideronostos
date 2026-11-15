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
