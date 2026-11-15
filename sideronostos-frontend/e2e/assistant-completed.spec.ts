import { expect, test } from "@playwright/test";

test("completes a mock assistant chat and opens its knowledge citation", async ({ page }) => {
  const chat = {
    id: "browser-chat-1",
    preset: "field_management",
    bot_id: "field-guide",
    language: "en",
    detail: "brief",
    kb_release_id: "local-mock-product-help-v1",
    created_at: "2026-11-14T08:00:00Z",
    updated_at: "2026-11-14T08:00:00Z",
  };
  await page.route("**/users/me", (route) => route.fulfill({ json: {
    id: "browser-farmer-1", email: "farmer@example.test", display_name: "Ava", email_verified: true,
  } }));
  await page.route("**/farm-assistant/conversations", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 201, json: chat });
  });
  await page.route("**/field-shift/profiles", (route) => route.fulfill({ json: { items: [{ id: "temperate-demo", name: "Temperate crop example", is_demo: true, crops: [] }] } }));
  await page.route("**/farm-assistant/conversations/browser-chat-1/actions", (route) => route.fulfill({ json: {
    status: "succeeded", action: "field.create", text: "Field saved.", missing_fields: [], pending: null,
    result: { id: "north", name: "North meadow" }, href: "/field-shift?field=north&step=field",
  } }));
  await page.route("**/farm-assistant/conversations/browser-chat-1/messages", (route) =>
    route.fulfill({ status: 200, json: {
      id: "browser-message-1",
      sequence: 1,
      client_message_id: "browser-client-1",
      status: "complete",
      text: "How should I prepare my soil?",
      context: { page: "map", revision: 1 },
      context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
      response: {
        paragraphs: [{ text: "A soil test can guide field preparation.", evidence_ids: ["K1"] }],
        actions: [],
        needs_clarification: false,
      },
      facts: [],
      error_code: null,
      created_at: "2026-11-14T08:00:00Z",
      completed_at: "2026-11-14T08:00:01Z",
    } }));
  await page.route("**/farm-assistant/conversations/browser-chat-1/messages/browser-message-1/sources/K1", (route) =>
    route.fulfill({ json: {
      id: "K1",
      release_id: "local-mock-product-help-v1",
      chunk_id: "mock-section-soil",
      page: 1,
      excerpt: "Soil testing helps identify nutrient and pH needs before planting.",
      source: {
        id: "product-help-soil",
        title: "Agrisata field guide",
        url: "https://example.org/agrisata/field-guide",
        access_scope: "public",
        locator_type: "section",
        regions: [],
        limitations: ["Locally seeded mock knowledge source."],
        sha256: "mock-hash",
      },
      claims: [],
    } }));

  await page.goto("/si/multi-agent");
  const composer = page.getByRole("textbox", { name: "Message Field guide" });
  await expect(composer).toBeVisible();
  await composer.fill("How should I prepare my soil?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("A soil test can guide field preparation.")).toBeVisible();
  await page.getByRole("button", { name: "View source K1" }).click();
  await expect(page.getByRole("link", { name: "Open source" })).toHaveAttribute(
    "href",
    "https://example.org/agrisata/field-guide",
  );
  await page.getByRole("button", { name: "Close source" }).click();
  await page.getByRole("button", { name: "Add a field", exact: true }).click();
  await page.getByLabel("Field name", { exact: true }).fill("North meadow");
  await page.getByLabel("Area (ha)").fill("4");
  await page.getByLabel("Latitude").fill("42");
  await page.getByLabel("Longitude").fill("-93.5");
  await page.getByLabel("Crop settings").selectOption("temperate-demo");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open saved field" })).toHaveAttribute("href", "/field-shift?field=north&step=field");
  const receipt = page.getByRole("region", { name: "Farm tasks" });
  await expect(receipt.getByText("North meadow has been added.")).toBeVisible();
  const screenshot = receipt.getByRole("img", { name: "Completed task screenshot" });
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(receipt.getByRole("link", { name: "Download screenshot" })).toHaveAttribute("download", /\.png$/);
  await page.screenshot({ path: "output/playwright/assistant-completed.png", fullPage: true });
});
