// @vitest-environment jsdom

import "../editor/testSetup";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { paletteFor } from "../editor/themeStore";
import { useEditorStore } from "../editor/store";
import { ScreensaverPanel } from "./Screensaver";
import type { Manifest } from "./manifest";

const PALETTE = paletteFor("light");

const FRESH_MANIFEST: Manifest = {
  ok: true,
  enabled: false,
  cycle_interval_s: 300,
  min_cycle_interval_s: 60,
  max_cycle_interval_s: 604800,
  max_slots: 50,
  picker_mode: "round_robin",
  picker_mode_actual: "round_robin",
  rtc_synced: false,
  current_slot: null,
  last_tick_ms: null,
  next_tick_ms: null,
  slots: [],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function manifestWith(overrides: Partial<Manifest>): Manifest {
  return { ...FRESH_MANIFEST, ...overrides };
}

// Mock the dither + pack pipeline so tests don't depend on a real
// image decoder. The panel calls renderScreensaverImageToBytes(url)
// which under the hood does loadImage()+canvas+FS+pack — heavy and
// mostly orthogonal to the panel logic. The vi.mock returns a
// deterministic 48000-byte buffer so we can assert content-length.
vi.mock("./sendImage", () => ({
  renderScreensaverImageToBytes: vi.fn(async () => new Uint8Array(48000)),
}));

beforeEach(() => {
  useEditorStore.getState().loadLayout([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Manifest fetch + render -----------------------------------------------

describe("ScreensaverPanel — initial fetch", () => {
  it("renders empty-list copy when no slates are populated", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByText(/upload images to get started/i);
    expect(screen.getByText(/0 slates/i)).toBeTruthy();
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe("http://x/screensaver/manifest");
  });

  it("renders the slot list when slates are populated", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        manifestWith({
          enabled: true,
          slots: [
            { slot: 0, name: "studio-blue", bytes: 48000, updated_at_ms: 100 },
            { slot: 5, name: "penrose",     bytes: 48000, updated_at_ms: 200 },
          ],
          current_slot: 5,
        }),
      ),
    );
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByTestId("slot-0");
    expect(screen.getByText("studio-blue")).toBeTruthy();
    expect(screen.getByText("penrose")).toBeTruthy();
    const slot5 = screen.getByTestId("slot-5");
    expect(slot5.textContent ?? "").toMatch(/now playing/i);
    const slot0 = screen.getByTestId("slot-0");
    expect(slot0.textContent ?? "").not.toMatch(/now playing/i);
  });

  it("shows the wallclock-hybrid fallback warning when configured but unsynced", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        manifestWith({
          picker_mode: "wallclock_hybrid",
          picker_mode_actual: "round_robin",
          rtc_synced: false,
        }),
      ),
    );
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toMatch(/round-robin/i);
    expect(screen.getByRole("status").textContent).toMatch(/NTP/i);
  });

  it("does NOT show the warning when wallclock_hybrid is fully running", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        manifestWith({
          picker_mode: "wallclock_hybrid",
          picker_mode_actual: "wallclock_hybrid",
          rtc_synced: true,
        }),
      ),
    );
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByText(/cycle every/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces a network error and offers retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    await screen.findByText(/upload images to get started/i);
  });
});

// --- Upload images ---------------------------------------------------------

function fakeFile(name: string): File {
  // Minimal File — content doesn't matter, the panel calls the
  // mocked renderScreensaverImageToBytes which returns a fixed
  // 48 000-byte buffer regardless of source.
  return new File(["fake-image-bytes"], name, { type: "image/png" });
}

describe("ScreensaverPanel — upload flow", () => {
  it("opens the prepare modal when files are chosen via the input", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByText(/upload images to get started/i);
    const input = screen.getByLabelText(/upload images/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("studio-blue.png")] } });
    // Modal renders with the file's stem prefilled.
    await screen.findByRole("dialog", { name: /prepare images/i });
    expect(
      (screen.getByLabelText(/name for studio-blue\.png/i) as HTMLInputElement)
        .value,
    ).toBe("studio-blue");
  });

  it("after Upload-all in the modal, POSTs with the chosen name (FS default)", async () => {
    let pushed = false;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.includes("/screensaver/frame?")) {
        pushed = true;
        return jsonResponse({
          ok: true, slot: 0, bytes: 48000, name: "studio-blue",
        });
      }
      if (pushed) {
        return jsonResponse(
          manifestWith({
            slots: [{ slot: 0, name: "studio-blue", bytes: 48000, updated_at_ms: 1 }],
          }),
        );
      }
      return jsonResponse(FRESH_MANIFEST);
    });
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const input = (await screen.findByLabelText(
      /upload images/i,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("studio-blue.png")] } });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));

    await waitFor(() => {
      const pushCall = fetchImpl.mock.calls.find(
        ([u]) => typeof u === "string" && u.includes("/screensaver/frame?"),
      );
      expect(pushCall).toBeTruthy();
    });
    const pushCall = fetchImpl.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/screensaver/frame?"),
    )!;
    const [pushUrl] = pushCall;
    expect(pushUrl).toBe("http://x/screensaver/frame?slot=0&name=studio-blue");
  });

  it("cancel from the modal aborts: no POST, no slate added", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const input = (await screen.findByLabelText(
      /upload images/i,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("studio-blue.png")] } });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Modal goes away.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // No POST happened.
    const posts = fetchImpl.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(0);
  });

  it("uploads multiple files sequentially, auto-assigning around occupied slots", async () => {
    // Manifest starts with slot 1 already occupied. Three uploads
    // should land on slots 0, 2, 3 in order — each push refreshes
    // the manifest before the next assignment.
    let pushedSlots: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.includes("/screensaver/frame?")) {
        const parsed = new URL(url);
        const slot = Number(parsed.searchParams.get("slot"));
        pushedSlots.push(slot);
        return jsonResponse({
          ok: true,
          slot,
          bytes: 48000,
          name: parsed.searchParams.get("name") ?? "",
        });
      }
      // Manifest reflects whatever slots have been pushed so far,
      // plus the original slot 1 that was there from the start.
      const occupied = new Set<number>([1, ...pushedSlots]);
      const slots = Array.from(occupied)
        .sort((a, b) => a - b)
        .map((s) => ({
          slot: s,
          name: s === 1 ? "pre-existing" : "x",
          bytes: 48000,
          updated_at_ms: 1,
        }));
      return jsonResponse(manifestWith({ slots }));
    });

    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );

    await screen.findByTestId("slot-1");

    const input = screen.getByLabelText(/upload images/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [fakeFile("a.png"), fakeFile("b.png"), fakeFile("c.png")] },
    });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));

    await waitFor(() => expect(pushedSlots).toEqual([0, 2, 3]));
  });

  it("threshold choice in the modal flows through to renderScreensaverImageToBytes", async () => {
    // The mock returns a fixed buffer regardless of input, but we
    // assert it was called with algorithm='threshold'.
    const renderMock = (await import("./sendImage"))
      .renderScreensaverImageToBytes as unknown as ReturnType<typeof vi.fn>;
    renderMock.mockClear();
    let pushed = false;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.includes("/screensaver/frame?")) {
        pushed = true;
        return jsonResponse({ ok: true, slot: 0, bytes: 48000, name: "raw" });
      }
      return pushed
        ? jsonResponse(
            manifestWith({
              slots: [{ slot: 0, name: "raw", bytes: 48000, updated_at_ms: 1 }],
            }),
          )
        : jsonResponse(FRESH_MANIFEST);
    });
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const input = (await screen.findByLabelText(/upload images/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("logo.png")] } });
    await screen.findByRole("dialog");
    // Switch to threshold for the (sole) row.
    fireEvent.click(
      screen.getByLabelText(/threshold \(no dither\) for logo\.png/i),
    );
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledWith(
        expect.any(File),
        "threshold",
      );
    });
  });

  it("refuses upload when all 50 slots are occupied", async () => {
    const fullSlots = Array.from({ length: 50 }, (_, i) => ({
      slot: i,
      name: `slate-${i}`,
      bytes: 48000,
      updated_at_ms: 1,
    }));
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(manifestWith({ slots: fullSlots })),
    );
    const onSent = vi.fn();
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        onSent={onSent}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByTestId("slot-49");

    const input = screen.getByLabelText(/upload images/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("nope.png")] } });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));

    await waitFor(() => {
      expect(onSent).toHaveBeenCalledWith(
        expect.stringMatching(/upload/i),
        false,
        expect.stringMatching(/all 50 slots/i),
      );
    });
    const posts = fetchImpl.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(0);
  });

  it("does NOT have a 'Push current canvas' button anymore", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByText(/upload images to get started/i);
    expect(screen.queryByLabelText(/slot index/i)).toBeNull();
    expect(screen.queryByText(/push current canvas/i)).toBeNull();
  });
});

// --- Cycle config -----------------------------------------------------------

describe("ScreensaverPanel — cycle config", () => {
  it("clamps the cycle interval to the manifest bounds on blur", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const intervalInput = (await screen.findByLabelText(
      /cycle interval seconds/i,
    )) as HTMLInputElement;
    fireEvent.change(intervalInput, { target: { value: "10" } });
    fireEvent.blur(intervalInput);
    await waitFor(() => expect(intervalInput.value).toBe("60"));
    fireEvent.change(intervalInput, { target: { value: "9999999" } });
    fireEvent.blur(intervalInput);
    await waitFor(() => expect(intervalInput.value).toBe("604800"));
  });

  it("sends the apply request to /screensaver/config", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.endsWith("/screensaver/config")) {
        return jsonResponse(manifestWith({ enabled: true, cycle_interval_s: 120 }));
      }
      return jsonResponse(FRESH_MANIFEST);
    });
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByText(/upload images to get started/i);

    const intervalInput = screen.getByLabelText(/cycle interval seconds/i);
    fireEvent.change(intervalInput, { target: { value: "120" } });
    fireEvent.blur(intervalInput);
    fireEvent.click(screen.getByLabelText(/^enabled$/i));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      const configCall = fetchImpl.mock.calls.find(
        ([u]) => typeof u === "string" && u.endsWith("/screensaver/config"),
      );
      expect(configCall).toBeTruthy();
    });
    const configCall = fetchImpl.mock.calls.find(
      ([u]) => typeof u === "string" && u.endsWith("/screensaver/config"),
    )!;
    const init = configCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      enabled: true,
      cycle_interval_s: 120,
      picker_mode: "round_robin",
    });
  });

  it("changes picker mode and serialises wallclock_hybrid", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.endsWith("/screensaver/config")) {
        return jsonResponse(manifestWith({ picker_mode: "wallclock_hybrid" }));
      }
      return jsonResponse(FRESH_MANIFEST);
    });
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    const select = (await screen.findByLabelText(/picker mode/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "wallclock_hybrid" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      const configCall = fetchImpl.mock.calls.find(
        ([u]) => typeof u === "string" && u.endsWith("/screensaver/config"),
      );
      expect(configCall).toBeTruthy();
    });
    const configCall = fetchImpl.mock.calls.find(
      ([u]) => typeof u === "string" && u.endsWith("/screensaver/config"),
    )!;
    const init = configCall[1] as RequestInit;
    expect(JSON.parse(init.body as string).picker_mode).toBe("wallclock_hybrid");
  });
});

// --- Rename + delete -------------------------------------------------------

describe("ScreensaverPanel — rename and delete", () => {
  it("commits a rename via /screensaver/rename", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === "string" && url.includes("/screensaver/rename?")) {
        return jsonResponse({ ok: true, slot: 0, name: "new-name" });
      }
      return jsonResponse(
        manifestWith({
          slots: [{ slot: 0, name: "old", bytes: 48000, updated_at_ms: 1 }],
        }),
      );
    });
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByTestId("slot-0");

    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    const renameInput = screen.getByLabelText(/rename slot 0/i);
    fireEvent.change(renameInput, { target: { value: "new-name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const renameCall = fetchImpl.mock.calls.find(
        ([u]) => typeof u === "string" && u.includes("/screensaver/rename?"),
      );
      expect(renameCall).toBeTruthy();
    });
    const renameCall = fetchImpl.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/screensaver/rename?"),
    )!;
    expect(renameCall[0]).toBe(
      "http://x/screensaver/rename?slot=0&name=new-name",
    );
  });

  it("issues DELETE /screensaver/frame after a confirmation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (
        typeof url === "string" &&
        url.includes("/screensaver/frame?") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      ) {
        return jsonResponse({ ok: true, slot: 0, remaining: 0 });
      }
      return jsonResponse(
        manifestWith({
          slots: [{ slot: 0, name: "to-delete", bytes: 48000, updated_at_ms: 1 }],
        }),
      );
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByTestId("slot-0");

    fireEvent.click(screen.getByLabelText(/delete slot 0/i));
    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() => {
      const del = fetchImpl.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(del).toBeTruthy();
    });
  });

  it("does NOT delete when the user dismisses the confirmation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        manifestWith({
          slots: [{ slot: 0, name: "n", bytes: 48000, updated_at_ms: 1 }],
        }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ScreensaverPanel
        host="x"
        palette={PALETTE}
        apiOptionsOverride={{ fetchImpl, sleep: async () => {} }}
      />,
    );
    await screen.findByTestId("slot-0");
    fireEvent.click(screen.getByLabelText(/delete slot 0/i));
    const del = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(del).toBeUndefined();
  });
});
