import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.ASSISTANT_LIVE_BACKEND, "Requires the dedicated live assistant test app and seeded test database");

async function chooseBot(page: Page, name: string) {
  await expect(page.getByRole("textbox", { name: /^Message / })).toBeVisible();
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Open farm tasks", exact: true }).click();
}
async function addField(page: Page, name: string) {
  await page.getByRole("button", { name: "Add a field", exact: true }).click();
  await page.getByLabel("Field name", { exact: true }).fill(name);
  await page.getByLabel("Area (ha)", { exact: true }).fill("4");
  await page.getByLabel("Latitude", { exact: true }).fill("42");
  await page.getByLabel("Longitude", { exact: true }).fill("-93.5");
  await page.getByLabel("Crop settings", { exact: true }).selectOption("temperate-demo");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open saved field" })).toHaveAttribute("href", /field-shift\?field=/);
}

test("three turn farmer chat confirms a field and shows its actual result page", async ({ page }, testInfo) => {
  await page.goto("/si/multi-agent");
  await chooseBot(page, "Field guide");
  const composer = page.getByRole("textbox", { name: "Message Field guide" });
  await composer.fill("Please add a field for me.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/To add this field, please tell me/)).toBeVisible();
  const fieldName = `North field chat ${Date.now()}`;
  await composer.fill(`Call it ${fieldName}. It is 4 hectares at latitude 42 and longitude -93.5. Soil is loam, irrigation is available, no planting history. Use the temperate demo crop settings.`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Please confirm: should I create this field/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Please confirm: should I create this field/)).toBeVisible();
  await composer.fill("Yes, create the field.");
  await page.getByRole("button", { name: "Send message" }).click();
  const link = page.getByRole("link", { name: "Open saved field" });
  await expect(link).toHaveAttribute("href", /\/field-shift\?field=[a-f0-9-]+&step=field/);
  const preview = page.getByRole("img", { name: "Saved field result page" });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/playwright/agent-three-turn-chat-${testInfo.project.name}.png`, fullPage: true });
  await link.click();
  await expect(page).toHaveURL(/\/field-shift\?field=[a-f0-9-]+&step=field/);
  await expect(page.getByTestId("result-ready")).toHaveText(fieldName);
  await page.screenshot({ path: `output/playwright/agent-three-turn-result-${testInfo.project.name}.png`, fullPage: true });
});

test("creates an owned field, restores the server-confirmed result and opens the saved page", async ({ page }) => {
  await page.goto("/si/multi-agent");
  await chooseBot(page, "Field guide");
  const composer = page.getByRole("textbox", { name: "Message Field guide" });
  await composer.fill("What information do I need before creating a new field?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Open Farm tasks → Add a field/)).toBeVisible();
  await composer.fill("hi");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Hi! I’m your Field guide/)).toBeVisible();
  const name = `Farmer workflow ${Date.now()}`;
  await addField(page, name);
  await expect(page.getByRole("img", { name: "Completed task screenshot" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/farmer-field-completed.png", fullPage: true });
  await page.reload();
  const link = page.getByRole("link", { name: "Open saved field" });
  await expect(link).toHaveAttribute("href", /field-shift\?field=/);
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await page.getByRole("button", { name: "My fields", exact: true }).click();
  const record = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await record.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Area (ha)", { exact: true }).fill("5");
  const updated = page.waitForResponse((r) => r.url().endsWith("/operations") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save changes" }).click();
  const update = await (await updated).json();
  expect(update.status).toBe("succeeded");
  expect(update.result.area_ha).toBe(5);
  await link.click();
  await expect(page.getByText(name).last()).toBeVisible();
  await page.screenshot({ path: "output/playwright/farmer-field-saved-page.png", fullPage: true });
});

test("each observation specialist uses a saved field and reports unavailable data honestly", async ({ page }) => {
  await page.goto("/si/multi-agent");
  await chooseBot(page, "Field guide");
  const name = `Observation field ${Date.now()}`;
  await addField(page, name);
  for (const specialist of [
    { bot: "Water specialist", task: "Check water conditions", metric: "rainfall_total" },
    { bot: "Soil specialist", task: "Check soil moisture", metric: "surface_soil_moisture" },
    { bot: "Weather specialist", task: "Check past weather", metric: "rainfall_total" },
  ]) {
    await chooseBot(page, specialist.bot);
    await page.getByRole("button", { name: specialist.task }).click();
    const fields = page.getByLabel("Which field?");
    const value = await fields.locator("option").filter({ hasText: name }).getAttribute("value");
    await fields.selectOption(value!);
    await page.getByLabel("What would you like to check?").selectOption(specialist.metric);
    const response = page.waitForResponse((r) => r.url().endsWith("/actions") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Check observations" }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    const outcome = await result.json();
    expect(["succeeded", "unavailable"]).toContain(outcome.status);
    if (outcome.status === "succeeded") await expect(page.getByRole("link", { name: "Open observation map" })).toBeVisible();
    else { await expect(page.getByText(/No published observation is available/)).toBeVisible(); await expect(page.getByText("Task completed")).toHaveCount(0); }
    await expect(page.getByRole("textbox", { name: /selection_id|field_id/ })).toHaveCount(0);
    await page.screenshot({ path: `output/playwright/farmer-${specialist.metric}-${specialist.bot.split(" ")[0]}.png`, fullPage: true });
  }
});

test("opens named rotation records, the real planner and a local question with source limits", async ({ page }) => {
  await page.goto("/si/multi-agent");
  await chooseBot(page, "Rotation guide");
  await expect(page.getByRole("link", { name: "Plan the next seasons" })).toHaveAttribute("href", "/field-shift/rotation");
  await page.getByRole("button", { name: "My calculations" }).click();
  await expect(page.getByRole("button", { name: "Refresh progress" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/farmer-rotation.png", fullPage: true });
  await chooseBot(page, "Local knowledge");
  await page.getByRole("button", { name: "Ask about my area" }).click();
  await page.getByLabel("Region or nearest town").fill("Iowa, USA");
  await page.getByLabel("Crop", { exact: true }).fill("Maize");
  await page.getByLabel("Your question").fill("What local sources should I check before choosing a variety?");
  const response = page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Ask local knowledge" }).click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  const text = (await reply.json()).response.paragraphs.map((paragraph: { text: string }) => paragraph.text).join(" ");
  expect(text).not.toContain("Which crop, region");
  await expect(page.getByText(/For Maize near Iowa, USA:/).first()).toBeVisible();
  await page.screenshot({ path: "output/playwright/farmer-local-knowledge.png", fullPage: true });
});

test("the module docks expose the same farmer tasks for all six bots", async ({ page }) => {
  await page.goto("/si/field-management");
  await page.getByRole("button", { name: "Open Field guide" }).click();
  await page.getByRole("button", { name: "Farm tasks", exact: true }).click();
  // Open an existing task draft via All tasks if this conversation already has one.
  const back = page.getByRole("button", { name: "All tasks", exact: true });
  if (await back.isVisible()) await back.click();
  await addField(page, `Dock farmer field ${Date.now()}`);
  await page.screenshot({ path: "output/playwright/farmer-field-dock.png", fullPage: true });
  for (const entry of [
    { route: "/si/remote-sensing", bot: "Water specialist", task: "Check water conditions" },
    { route: "/si/remote-sensing", bot: "Soil specialist", task: "Check soil moisture" },
    { route: "/si/remote-sensing", bot: "Weather specialist", task: "Check past weather" },
    { route: "/si/rotation-recommendation", bot: "Rotation guide", task: "My saved plans" },
    { route: "/si/local-knowledge", bot: "Local knowledge", task: "Ask about my area" },
  ]) {
    await page.goto(entry.route);
    await page.getByRole("button", { name: `Open ${entry.bot}`, exact: true }).click();
    await page.getByRole("button", { name: "Farm tasks", exact: true }).click();
    if (await back.isVisible()) await back.click();
    await expect(page.getByRole("button", { name: entry.task, exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Choose a task" })).toHaveCount(0);
  }
});
