/**
 * Phase 15b: CAN field wrapping tests.
 *
 * These mirror test/test_text_fit/test_text_fit.cpp case for case, because
 * canField.ts is a deliberate duplicate of src/text_fit.h and the duplication
 * is only worth anything if the two stay in step. If the editor's preview
 * and the panel disagree about where a line breaks, the preview is worse than
 * useless — it looks authoritative and is wrong.
 *
 * Unlike the firmware suite these run against the REAL generated metrics
 * rather than a fabricated fixture, so they also catch a fontMetrics.ts
 * regeneration that changes a font's advances.
 */

import { describe, expect, it } from "vitest";

import { MAX_LINES, fit, measure, vBlockBaseline, wrap } from "./canField";
import { GFX_FONTS } from "./fontMetrics";
import type { CanFontId } from "./types";

// FontId 6 = FreeMonoBold18pt7b. Monospace deliberately: every character has
// the same advance, so "a box `measure('AAAA')` wide holds exactly four
// characters" is true for any four characters. With a proportional font the
// same assertion silently depends on which letters the fixture happens to
// use, and a test that fails because 'B' is wider than 'A' teaches nothing.
// The firmware suite uses a flat 10 px fixture table for the same reason.
const F: CanFontId = 6;

function texts(text: string, w: number, h: number, font: CanFontId = F): string[] {
  return wrap(text, w, h, font).lines.map((l) => l.text);
}

describe("generated metrics", () => {
  it("has one entry per firmware FontId with a full advance table", () => {
    expect(GFX_FONTS).toHaveLength(8);
    for (const f of GFX_FONTS) {
      expect(f.advances).toHaveLength(95);
      expect(f.ascent).toBeGreaterThan(0);
      expect(f.lineHeight).toBeGreaterThan(0);
    }
  });

  it("keeps ascent+descent within the line height for every font", () => {
    // wrap() derives its line cap from `maxHeight / lineHeight`, which is
    // only conservative if a single line's real extent never exceeds the
    // line advance. A font violating this would overflow its box vertically
    // without wrap() noticing.
    for (const f of GFX_FONTS) {
      expect(f.ascent + f.descent).toBeLessThanOrEqual(f.lineHeight);
    }
  });
});

describe("wrap", () => {
  it("breaks at word boundaries", () => {
    const width = measure("SCENE", F) + 2;
    expect(texts("SCENE FOUR TAKE", width, GFX_FONTS[F].lineHeight * 3))
      .toEqual(["SCENE", "FOUR", "TAKE"]);
  });

  it("swallows the space at a break rather than indenting the next line", () => {
    const width = measure("AB", F) + 2;
    expect(texts("AB CD", width, GFX_FONTS[F].lineHeight * 2)).toEqual(["AB", "CD"]);
  });

  it("only ellipsises once BOTH dimensions are exhausted", () => {
    // The headline requirement. Same string, same width, different heights.
    const width = measure("AAAA", F) + 2;
    const lh = GFX_FONTS[F].lineHeight;
    const s = "AAAA BBBB CCCC DDDD";

    const tall = wrap(s, width, lh * 6, F);
    expect(tall.overflowed).toBe(false);
    expect(tall.lines).toHaveLength(4);
    expect(tall.lines.some((l) => l.ellipsis)).toBe(false);

    const short = wrap(s, width, lh * 2, F);
    expect(short.overflowed).toBe(true);
    expect(short.lines).toHaveLength(2);
    expect(short.lines[0].ellipsis).toBe(false);
    expect(short.lines[1].ellipsis).toBe(true);
  });

  it("breaks an over-long word mid-word rather than dropping it", () => {
    const width = measure("SUPER", F) + 2;
    const out = texts("SUPERCALIFRAGILISTIC", width, GFX_FONTS[F].lineHeight * 2);
    expect(out[0]).toBe("SUPER");
    expect(out).toHaveLength(2);
  });

  it("treats an explicit newline as a break, not as a '?' glyph", () => {
    expect(texts("AB\nCD", 400, GFX_FONTS[F].lineHeight * 3)).toEqual(["AB", "CD"]);
    expect(wrap("AB\nCD", 400, GFX_FONTS[F].lineHeight * 3, F).overflowed).toBe(false);
  });

  it("does not report trailing whitespace as an overflow", () => {
    const r = wrap("AB   ", 400, GFX_FONTS[F].lineHeight, F);
    expect(r.overflowed).toBe(false);
    expect(r.lines[0].text).toBe("AB");
    // Trailing spaces must not widen the line, or centring drifts right.
    expect(r.lines[0].width).toBe(measure("AB", F));
  });

  it("still produces one line when the box is shorter than the font", () => {
    expect(wrap("HELLO", 400, 1, F).lines).toHaveLength(1);
  });

  it("never lets a line exceed the box width, except for a sub-glyph box", () => {
    // The one documented exception: when the box is narrower than a single
    // glyph, wrap() emits that glyph anyway. Zero characters would either
    // spin the loop forever or render the field blank, and blank reads as
    // "no data" — a false statement rather than an incomplete one. The
    // renderer's clip rect stops the glyph escaping its region.
    const s = "The quick brown fox jumps over the lazy dog";
    // Widest advance in the font, not `measure("M")`. FreeMonoBold18pt7b is
    // not quite monospaced — 'q' is 22 px against 21 for everything else,
    // and the sweep string contains one.
    const widestGlyph = Math.max(...GFX_FONTS[F].advances);
    for (let w = 4; w <= 400; w += 7) {
      for (const line of wrap(s, w, 400, F).lines) {
        expect(line.width).toBeLessThanOrEqual(Math.max(w, widestGlyph));
      }
    }
  });

  it("emits one clipped glyph per line when the box is narrower than a glyph", () => {
    // Note the short height. With a tall box every character simply gets its
    // own line and nothing overflows at all — which is correct, and worth
    // pinning separately from the truncation case.
    const tall = wrap("HELLO", 4, 400, F);
    expect(tall.lines.map((l) => l.text)).toEqual(["H", "E", "L", "L", "O"]);
    expect(tall.overflowed).toBe(false);

    const short = wrap("HELLO", 4, GFX_FONTS[F].lineHeight * 2, F);
    expect(short.lines).toHaveLength(2);
    expect(short.overflowed).toBe(true);
  });

  it("terminates and caps line count on a pathologically narrow box", () => {
    const r = wrap("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456", 4, 100000, F);
    expect(r.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(r.overflowed).toBe(true);
  });

  it("reports a block height matching the line count", () => {
    const { ascent, descent, lineHeight } = GFX_FONTS[F];
    const width = measure("AAAA", F) + 2;
    const r = wrap("AAAA BBBB CCCC", width, lineHeight * 4, F);
    expect(r.lines).toHaveLength(3);
    expect(r.blockHeight).toBe(ascent + descent + 2 * lineHeight);
  });

  it("returns no lines for empty text", () => {
    const r = wrap("", 400, 100, F);
    expect(r.lines).toHaveLength(0);
    expect(r.overflowed).toBe(false);
    expect(r.blockHeight).toBe(0);
  });
});

describe("vBlockBaseline", () => {
  it("positions a two-line block for each vertical alignment", () => {
    const { ascent, descent, lineHeight } = GFX_FONTS[F];
    const blockH = ascent + descent + lineHeight;
    expect(vBlockBaseline(200, "top", F, 2)).toBe(ascent);
    expect(vBlockBaseline(200, "middle", F, 2)).toBe(
      Math.floor((200 - blockH) / 2) + ascent,
    );
    expect(vBlockBaseline(200, "bottom", F, 2)).toBe(200 - blockH + ascent);
  });
});

describe("fit (single line, still used for the one-line case)", () => {
  it("agrees with wrap when the box is exactly one line tall", () => {
    // Both paths must ellipsise identically, or a one-line field previews
    // differently depending on which helper the caller happened to use.
    const s = "SCENE FOUR TAKE FIVE";
    const w = 120;
    const single = fit(s, w, F);
    const wrapped = wrap(s, w, GFX_FONTS[F].lineHeight, F);
    expect(wrapped.lines).toHaveLength(1);
    expect(wrapped.lines[0].ellipsis).toBe(single.ellipsis);
    expect(wrapped.overflowed).toBe(single.overflowed);
  });
});
