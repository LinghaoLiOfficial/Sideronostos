import { expect, test } from "@playwright/test"

async function loadDemoFarm(page: import("@playwright/test").Page, mobile: boolean) {
  const demo = page.getByRole("button", { name: "Load demo farm" })
  if (mobile && !(await demo.isVisible())) await page.getByRole("button", { name: "Farms", exact: true }).click()
  await demo.click()
  await expect(page.getByText("Demo farm 1").last()).toBeVisible()
  await expect(page.getByText("Field 1").last()).toBeVisible()
}

test("generates and confirms a complete farm partition", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile"
  await page.goto("/fields")
  await expect(page.getByRole("heading", { name: "Farm partition map" })).toBeVisible()
  await expect(page.getByTestId("field-map")).toBeVisible()
  await loadDemoFarm(page, mobile)

  if (mobile) {
    await page.getByRole("button", { name: "Close panel" }).click()
    await page.getByRole("button", { name: "Details", exact: true }).click()
  }
  const count = page.getByRole("slider", { name: "Target field count" })
  await expect(count).toHaveValue("4")
  await page.getByRole("button", { name: "Regular grid" }).click()
  await expect(page.getByRole("button", { name: "Regular grid" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Map axes" }).click()
  await expect(page.getByRole("button", { name: "Map axes" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Grid layout").last()).toBeVisible()
  await count.fill("6")
  await page.getByRole("button", { name: "Regenerate candidates" }).click()
  await expect(page.getByText("Generated fields").last().locator("..").getByText("6", { exact: true })).toBeVisible()

  await page.reload()
  if (mobile) {
    await page.getByRole("button", { name: "Farms", exact: true }).click()
    await page.getByRole("button", { name: /^Demo farm 1 / }).click()
    await page.getByRole("button", { name: "Close panel" }).click()
    await page.getByRole("button", { name: "Details", exact: true }).click()
  } else {
    await page.getByRole("button", { name: /^Demo farm 1 / }).click()
  }
  await expect(page.getByRole("button", { name: "Regular grid" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Map axes" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Grid layout").last()).toBeVisible()
  await page.getByRole("button", { name: "Confirm all" }).click()
  await expect(page.getByRole("status")).toContainText("All candidate fields confirmed")

  await page.reload()
  if (mobile) await page.getByRole("button", { name: "Farms", exact: true }).click()
  await expect(page.getByText("Demo farm 1").last()).toBeVisible()
  await expect(page.getByText("Field 6").last()).toBeVisible()
})

test("draws a farm boundary and automatically creates candidates", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "desktop drawing check")
  await page.goto("/fields")
  await page.getByRole("button", { name: "Draw farm boundary" }).first().click()
  const canvas = page.locator(".maplibregl-canvas")
  await expect(canvas).toHaveCSS("cursor", "crosshair")
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  const points = [[0.35, 0.35], [0.62, 0.36], [0.61, 0.62], [0.36, 0.61]]
  for (const [x, y] of points) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
    await page.waitForTimeout(120)
  }
  await canvas.focus()
  await canvas.press("Enter")
  await expect(page.getByText("Farm 1").last()).toBeVisible()
  await expect(page.getByText("Field 4").last()).toBeVisible()
})

test("renders mobile controls without horizontal overflow", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "mobile-only layout check")
  await page.goto("/fields")
  await expect(page.getByRole("button", { name: "Farms", exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test("shows NASA analysis with spatial layers and responsive charts", async ({ page }, testInfo) => {
  await page.goto("/fields")
  await page.getByRole("tab", { name: /NASA/ }).click()
  await expect(page.getByRole("heading", { name: "NASA data analysis" })).toBeVisible()
  await expect(page.getByText("2022-01-01 — 2024-12-31")).toBeVisible()
  await expect(page.getByRole("img", { name: /Precipitation and reference ET/ })).toBeVisible()
  await expect(page.getByTestId("nasa-analysis-map")).toBeVisible()
  await page.getByRole("button", { name: "SRTM terrain" }).click()
  await expect(page.getByText(/SRTM elevation image/)).toBeVisible()
  if (testInfo.project.name === "mobile") {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
  }
  await page.getByRole("tab", { name: "Map" }).click()
  await expect(page.getByRole("heading", { name: "Farm partition map" })).toBeVisible()
})

test("confirms farm deletion and preserves data when cancelled", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile"
  await page.goto("/fields")
  await loadDemoFarm(page, mobile)

  const deleteButton = page.getByRole("button", { name: "Delete Demo farm 1" })
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Demo farm 1")
  await expect(dialog).toContainText("4 associated fields")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText("Demo farm 1").last()).toBeVisible()
  await expect(page.getByText("Field 1").last()).toBeVisible()

  await page.getByRole("button", { name: "Add demo farm" }).click()
  await expect(page.getByText("Demo farm 2").last()).toBeVisible()
  await page.getByRole("button", { name: /^Demo farm 1 / }).click()
  await deleteButton.click()
  await dialog.getByRole("button", { name: "Delete farm" }).click()
  await expect(page.getByText("Demo farm 1", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Demo farm 2").last()).toBeVisible()
  await expect(page.getByText("Field 4").last()).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Demo farm 1 and its 4 fields were deleted")
})

test("imports and exports farm GeoJSON without removed SMAP layers", async ({ page }) => {
  const mobile = test.info().project.name === "mobile"
  await page.goto("/fields")
  if (mobile) await page.getByRole("button", { name: "Farms", exact: true }).click()
  const polygon = {
    type: "Feature",
    properties: { name: "Imported test farm" },
    geometry: {
      type: "Polygon",
      coordinates: [[[-103.81, 36.69], [-103.80, 36.69], [-103.80, 36.68], [-103.81, 36.68], [-103.81, 36.69]]],
    },
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "farm.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(polygon)),
  })
  await expect(page.getByRole("status")).toContainText("1 farm imported and partitioned")
  await expect(page.getByRole("button", { name: /Imported test farm/ })).toBeVisible()

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export", exact: true }).click()
  expect((await download).suggestedFilename()).toBe("field-shift-farms-and-fields.geojson")

  await expect(page.getByText("SMAP soil moisture · day", { exact: true })).toHaveCount(0)
  await expect(page.getByText("SMAP soil moisture · night", { exact: true })).toHaveCount(0)
  if (mobile) await expect(page.getByRole("button", { name: "Layers", exact: true })).toHaveCount(0)
})
