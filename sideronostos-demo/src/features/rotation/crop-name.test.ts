import { describe, expect, it } from "vitest";
import { englishCropName } from "./crop-name";

describe("englishCropName", () => {
  it("removes localized crop names while keeping English notes", () => {
    expect(englishCropName("Maize / 玉米（110-day hybrid example）")).toBe("Maize (110-day hybrid example)");
    expect(englishCropName("Spring oat / 春燕麦（benchmark）")).toBe("Spring oat (benchmark)");
    expect(englishCropName("Dry field pea / 干籽豌豆（benchmark）")).toBe("Dry field pea (benchmark)");
  });
});
