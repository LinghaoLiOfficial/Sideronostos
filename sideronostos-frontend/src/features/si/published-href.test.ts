import { expect, it } from "vitest";
import { publishedHref } from "./published-href";

it("keeps old field conversations on the published field page", () => {
  expect(publishedHref("/field-shift?field=abc&step=field")).toBe("/si/fields?field=abc&step=field");
  expect(publishedHref("/si/fields?field=abc&step=field")).toBe("/si/fields?field=abc&step=field");
});

it("uses an owned result page instead of unpublished or external destinations", () => {
  const owned = "/si/multi-agent/results/result-id?conversation=chat-id";
  expect(publishedHref("/field-shift/rotation?run=job", owned)).toBe(owned);
  expect(publishedHref("https://other.test/si/fields", owned)).toBe(owned);
  expect(publishedHref("//other.test/si/fields", owned)).toBe(owned);
  expect(publishedHref("/si/fields\\@other.test", owned)).toBe(owned);
});
