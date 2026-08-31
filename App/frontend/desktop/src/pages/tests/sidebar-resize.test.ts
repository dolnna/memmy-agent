import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  resolveConstrainedSidebarMaxWidth,
} from "../sidebar-resize.js";

describe("sidebar resize constraints", () => {
  it("limits the navigation sidebar without violating its minimum", () => {
    expect(resolveConstrainedSidebarMaxWidth(240, 520, 360)).toBe(360);
    expect(resolveConstrainedSidebarMaxWidth(240, 520, 180)).toBe(240);
    expect(resolveConstrainedSidebarMaxWidth(240, 520, 800)).toBe(520);
    expect(clampSidebarWidth(500, 240, 360)).toBe(360);
  });
});
