import { describe, expect, it } from "vitest";
import { isLiveConfigView } from "./view.js";

describe("extension view routing", () => {
  it("routes only the documented live-config query to Live Config", () => {
    expect(isLiveConfigView("?view=live-config")).toBe(true);
    expect(isLiveConfigView("?view=viewer")).toBe(false);
    expect(isLiveConfigView("")).toBe(false);
  });
});
