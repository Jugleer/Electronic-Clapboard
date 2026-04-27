import { describe, expect, it } from "vitest";

import { clampGrid, snap } from "./gridStore";

describe("snap", () => {
  it("returns the input unchanged when disabled", () => {
    expect(snap(13, 10, false)).toBe(13);
  });

  it("rounds to the nearest multiple when enabled", () => {
    expect(snap(13, 10, true)).toBe(10);
    expect(snap(15, 10, true)).toBe(20); // half rounds up (Math.round)
    expect(snap(-3, 10, true)).toBe(-0); // Math.round(-3/10)*10 → 0; sign of zero allowed
    expect(snap(7, 4, true)).toBe(8);
  });

  it("is a no-op for non-positive spacing", () => {
    expect(snap(13, 0, true)).toBe(13);
    expect(snap(13, -10, true)).toBe(13);
  });
});

describe("clampGrid", () => {
  it("rounds and clamps to [MIN_GRID, MAX_GRID]", () => {
    expect(clampGrid(10.4)).toBe(10);
    expect(clampGrid(0)).toBe(2);
    expect(clampGrid(99999)).toBe(200);
    expect(clampGrid(NaN)).toBe(10);
  });
});
