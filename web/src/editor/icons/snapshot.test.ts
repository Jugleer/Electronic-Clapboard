// @vitest-environment jsdom
//
// Visual-regression snapshot for icons. The render path runs through
// the production rasteriser plus packFrame, so any drift in
// `ctx.drawImage` scaling, threshold-binarisation, or the underlying
// PNG masters changes the bytes and fails this test. CI also runs
// `git diff --exit-code` against the fixture so the snapshot can't be
// silently regenerated. Set `UPDATE_ICON_SNAPSHOT=1` locally to refresh.

import "../testSetup";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeAll } from "vitest";

import { packFrame } from "../../packFrame";
import { rasterizeElements } from "../renderToCanvas";
import type { IconElement } from "../types";
import { WIDTH, HEIGHT } from "../../frameFormat";
import { seedAllIconsFromDisk } from "./testIconLoader";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, "../../__fixtures__/icon_movie_64.bin");

const CANONICAL: IconElement = {
  id: "snapshot-canonical",
  type: "icon",
  x: 100,
  y: 100,
  w: 64,
  h: 64,
  rotation: 0,
  locked: false,
  groupId: null,
  src: "film/movie",
  invert: false,
};

function renderToBytes(): Uint8Array {
  const canvas = rasterizeElements([CANONICAL]);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return packFrame(img);
}

beforeAll(async () => {
  await seedAllIconsFromDisk();
});

describe("icon visual snapshot — film/movie at 64×64 @ (100,100)", () => {
  it("matches the committed binary fixture byte-for-byte", () => {
    const actual = renderToBytes();

    if (process.env.UPDATE_ICON_SNAPSHOT === "1") {
      writeFileSync(FIXTURE_PATH, actual);
      // eslint-disable-next-line no-console
      console.log(`[snapshot] wrote ${FIXTURE_PATH} (${actual.length} bytes)`);
      return;
    }

    expect(
      existsSync(FIXTURE_PATH),
      `fixture missing — re-run with UPDATE_ICON_SNAPSHOT=1`,
    ).toBe(true);
    const expected = readFileSync(FIXTURE_PATH);
    expect(actual.length).toBe(expected.length);
    expect(Buffer.from(actual).equals(expected)).toBe(true);
  });
});
