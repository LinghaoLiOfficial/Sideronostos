import { expect, test } from "@playwright/test";

test("switching to English translates the rotation form and current results", async ({ page }) => {
  await page.goto("/si/rotation-recommendation");
  await page.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("menuitemradio", { name: "Simplified Chinese" }).click();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模型诊断" })).toBeVisible();

  await page.getByRole("button", { name: "语言：简体中文" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.getByText("Annual resource limits by field", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Show weather scenario" }).check();
  await expect(page.getByRole("spinbutton", { name: "Temperature change (°C)" })).toBeVisible();
  const plan = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Rotation plan 1", exact: true }) });
  await plan.getByText("View full option visualization", { exact: true }).click();
  await expect(plan.getByRole("heading", { name: "Annual resource use" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model diagnostics" })).toBeVisible();
  await plan.getByText("Annual resources and calculation basis", { exact: true }).click();
  await page.getByText("Data versions and limitations", { exact: true }).click();
  await expect(page.getByRole("main")).not.toHaveText(/\p{Script=Han}/u, { useInnerText: true });

  await plan.getByRole("button", { name: "Save this plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Save rotation plan" });
  await expect(dialog).not.toHaveText(/\p{Script=Han}/u, { useInnerText: true });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Resource preset" })).toBeVisible();
});
