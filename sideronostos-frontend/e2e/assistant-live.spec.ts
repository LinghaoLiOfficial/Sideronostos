import { expect, test } from "@playwright/test";

test.skip(!process.env.ASSISTANT_LIVE_BACKEND, "Requires the dedicated live assistant test app and seeded test database");

test("uses real HTTP handlers for knowledge, field creation, result link, and screenshot", async ({ page }) => {
  await page.goto("/si/multi-agent");
  await page.getByRole("button", { name: "Field guide" }).click();
  await page.getByRole("button", { name: "New chat" }).click();
  const composer = page.getByRole("textbox", { name: "Message Field guide" });
  await expect(composer).toBeVisible();
  await composer.fill("What can I do when planning a field?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/For your farm planning/).first()).toBeVisible();
  await page.screenshot({ path: "output/playwright/assistant-live-answer.png", fullPage: true });
  await page.getByRole("button", { name: /View source/ }).first().click();
  await expect(page.getByRole("link", { name: "Open source" })).toBeVisible();
  await page.getByRole("button", { name: "Close source" }).click();

  await page.getByText(/Module operations/).click();
  const operations = page.getByRole("combobox", { name: "Choose an API operation" });
  await operations.selectOption("create_field_field_shift_fields_post");
  const name = `Live browser field ${Date.now()}`;
  await page.getByRole("textbox", { name: "JSON request body" }).fill(JSON.stringify({
    name, area_ha: 4, latitude: 42, longitude: -93.5,
    soil_texture: "loam", irrigation_available: true,
    profile_id: "temperate-demo", history: [],
  }));
  await page.getByRole("button", { name: "Run operation" }).click();
  const receipt = page.getByRole("region", { name: "Operation result" });
  const link = receipt.getByRole("link", { name: "Open result" });
  await expect(link).toHaveAttribute("href", /\/field-shift\?field=[^&]+&step=field/);
  await expect(receipt.getByText(name, { exact: true })).toBeVisible();
  const screenshot = receipt.getByRole("img", { name: "Completed task screenshot" });
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "output/playwright/assistant-live.png", fullPage: true });
  await page.reload();
  await page.getByText(/Module operations/).click();
  await expect(link).toHaveAttribute("href", /\/field-shift\?field=/);
  await link.click();
  await expect(page).toHaveURL(/\/field-shift\?field=/);
  await expect(page.getByText(name).last()).toBeVisible();
  await page.screenshot({ path: "output/playwright/assistant-live-result-page.png", fullPage: true });
});

test("runs the other module assistants against real HTTP handlers", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/si/multi-agent");
  for (const bot of [
    { name: "Water specialist", question: "What can the satellite map tell me?", operation: "layers_agri_data_layers_get", href: /\/field-shift\/map/ },
    { name: "Rotation guide", question: "How do I prepare a rotation?", operation: "profiles_rotation_optimizer_profiles_get", href: /\/field-shift\/rotation/ },
  ]) {
    await page.getByRole("button", { name: bot.name }).click();
    await page.getByRole("button", { name: "New chat" }).click();
    const composer = page.getByRole("textbox", { name: `Message ${bot.name}` });
    await expect(composer).toBeVisible();
    await composer.fill(bot.question);
    const completed = page.waitForResponse((response) => response.url().includes("/farm-assistant/conversations/") && response.url().endsWith("/messages") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send message" }).click();
    const response = await completed;
    expect(response.status()).toBe(200);
    expect((await response.json()).response.paragraphs.length).toBeGreaterThan(0);
    await page.getByText(/Module operations/).click();
    await page.getByRole("combobox", { name: "Choose an API operation" }).selectOption(bot.operation);
    await page.getByRole("button", { name: "Run operation" }).click();
    const receipt = page.getByRole("region", { name: "Operation result" });
    await expect(receipt.getByRole("link", { name: "Open result" })).toHaveAttribute("href", bot.href);
    await expect(receipt.getByRole("img", { name: "Completed task screenshot" })).toBeVisible();
    await page.screenshot({ path: `output/playwright/assistant-live-${bot.name.toLowerCase().replaceAll(" ", "-")}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Local knowledge" }).click();
  await page.getByRole("button", { name: "New chat" }).click();
  const composer = page.getByRole("textbox", { name: "Message Local knowledge" });
  await composer.fill("What should I check before planning a field?");
  const completed = page.waitForResponse((response) => response.url().endsWith("/messages") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send message" }).click();
  expect((await completed).status()).toBe(200);
  await page.getByText(/Module operations/).click();
  await expect(page.getByText("This assistant has no operational APIs. Ask it a question to search its knowledge base.")).toBeVisible();
  await page.screenshot({ path: "output/playwright/assistant-live-local-knowledge.png", fullPage: true });
});

test("executes a field operation from its own module dock", async ({ page }) => {
  await page.goto("/si/field-management");
  await page.getByRole("button", { name: "Open Field guide" }).click();
  await page.getByRole("button", { name: "Use module tools" }).click();
  await page.getByText(/Module operations/).click();
  await page.getByRole("combobox", { name: "Choose an API operation" }).selectOption("create_field_field_shift_fields_post");
  const name = `Dock field ${Date.now()}`;
  await page.getByRole("textbox", { name: "JSON request body" }).fill(JSON.stringify({
    name, area_ha: 2.5, latitude: 42, longitude: -93.5,
    soil_texture: "loam", irrigation_available: true,
    profile_id: "temperate-demo", history: [],
  }));
  await page.getByRole("button", { name: "Run operation" }).click();
  const result = page.getByRole("region", { name: "Operation result" });
  await expect(result.getByRole("link", { name: "Open result" })).toHaveAttribute("href", /\/field-shift\?field=/);
  await expect(result.getByRole("img", { name: "Completed task screenshot" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/assistant-live-module-dock.png", fullPage: true });
});

test("opens real remote and rotation results from their module docks and answers local knowledge", async ({ page }) => {
  for (const item of [
    { route: "/si/remote-sensing", bot: "Water specialist", operation: "layers_agri_data_layers_get", href: /\/field-shift\/map/ },
    { route: "/si/rotation-recommendation", bot: "Rotation guide", operation: "profiles_rotation_optimizer_profiles_get", href: /\/field-shift\/rotation/ },
  ]) {
    await page.goto(item.route);
    await page.getByRole("button", { name: `Open ${item.bot}` }).click();
    await page.getByRole("button", { name: "Use module tools" }).click();
    await page.getByText(/Module operations/).click();
    await page.getByRole("combobox", { name: "Choose an API operation" }).selectOption(item.operation);
    await page.getByRole("button", { name: "Run operation" }).click();
    const result = page.getByRole("region", { name: "Operation result" });
    await expect(result.getByRole("link", { name: "Open result" })).toHaveAttribute("href", item.href);
    await expect(result.getByRole("img", { name: "Completed task screenshot" })).toBeVisible();
  }
  await page.goto("/si/local-knowledge");
  await page.getByRole("button", { name: "Open Local knowledge" }).click();
  await expect(page.getByRole("button", { name: "Use module tools" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message Local knowledge" }).fill("What should I check before planning a field?");
  const response = page.waitForResponse((event) => event.url().endsWith("/messages") && event.request().method() === "POST");
  await page.getByRole("button", { name: "Send message" }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText(/For your farm planning/).first()).toBeVisible();
});
