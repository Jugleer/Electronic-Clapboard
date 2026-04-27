import { describe, expect, it } from "vitest";

import {
  clampBorder,
  clampGrid,
  DEFAULT_BORDER_WIDTH,
  MAX_BORDER,
  MIN_BORDER,
  snap,
} from "./gridStore";

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

describe("clampBorder", () => {
  it("treats anything ≤ 0 as off", () => {
    expect(clampBorder(0)).toBe(0);
    expect(clampBorder(-50)).toBe(0);
    expect(clampBorder(NaN)).toBe(0);
  });

  it("snaps small positive values up to MIN_BORDER", () => {
    expect(clampBorder(1)).toBe(MIN_BORDER);
    expect(clampBorder(MIN_BORDER - 1)).toBe(MIN_BORDER);
  });

  it("clamps to MAX_BORDER and rounds floats", () => {
    expect(clampBorder(MAX_BORDER + 1000)).toBe(MAX_BORDER);
    expect(clampBorder(20.4)).toBe(20);
    expect(clampBorder(20.6)).toBe(21);
  });

  it("default border width matches MIN_BORDER", () => {
    expect(DEFAULT_BORDER_WIDTH).toBe(MIN_BORDER);
  });
});
