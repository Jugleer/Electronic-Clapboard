// @vitest-environment jsdom

import "./testSetup";
import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LayoutButtons } from "./LayoutButtons";
import {
  _clearAllForTests,
  _resetStoreForTests,
  saveLayout,
} from "./layoutStore";
import { useEditorStore } from "./store";
import { defaultsFor } from "./types";

class MockStorage {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetStoreForTests();
  // Use mock localStorage so the migration check is a clean no-op
  // unless the test wires up a v2 blob explicitly.
  (globalThis as unknown as { localStorage: MockStorage }).localStorage =
    new MockStorage();
  // Reset the editor store so each test starts with a clean canvas.
  useEditorStore.getState().loadLayout([]);
});

afterEach(async () => {
  cleanup();
  await _clearAllForTests().catch(() => {});
});

function seedCanvas() {
  const rect = { ...defaultsFor("rect", { x: 10, y: 20 }), id: "r" };
  useEditorStore.getState().loadLayout([rect]);
}

describe("LayoutButtons (empty state)", () => {
  it("renders the empty hint when no layouts exist", async () => {
    render(<LayoutButtons />);
    await screen.findByText(/no saved layouts yet/i);
    expect(screen.getByRole("button", { name: /\+ new/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /import/i })).toBeTruthy();
  });

  it("disables + new when the canvas is empty", async () => {
    render(<LayoutButtons />);
    await screen.findByText(/no saved layouts yet/i);
    const button = screen.getByRole("button", { name: /\+ new/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LayoutButtons (save + list)", () => {
  it("lists saved layouts after a save", async () => {
    await saveLayout({
      name: "Doc shoot",
      elements: [{ ...defaultsFor("rect", { x: 0, y: 0 }), id: "x" }],
      thumbnail: null,
    });
    render(<LayoutButtons />);
    await screen.findByText("Doc shoot");
  });

  it("orders multiple layouts newest first", async () => {
    await saveLayout({ name: "old", elements: [], thumbnail: null });
    await new Promise((r) => setTimeout(r, 5));
    await saveLayout({ name: "newer", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    await screen.findByText("newer");
    const names = Array.from(document.querySelectorAll("div")).filter(
      (el) => el.textContent === "old" || el.textContent === "newer",
    );
    expect(names[0].textContent).toBe("newer");
    expect(names[1].textContent).toBe("old");
  });
});

describe("LayoutButtons (load)", () => {
  it("restores elements into the editor store on load", async () => {
    const rect = { ...defaultsFor("rect", { x: 1, y: 2 }), id: "rr" };
    await saveLayout({ name: "to-load", elements: [rect], thumbnail: null });
    render(<LayoutButtons />);
    await screen.findByText("to-load");
    fireEvent.click(screen.getByTitle("Restore to-load"));
    await waitFor(() => {
      expect(useEditorStore.getState().elements).toHaveLength(1);
      expect(useEditorStore.getState().elements[0].id).toBe("rr");
    });
  });
});

describe("LayoutButtons (delete)", () => {
  it("removes a layout after confirmation", async () => {
    await saveLayout({ name: "doomed", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    await screen.findByText("doomed");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTitle("Delete doomed"));
    await waitFor(() => {
      expect(screen.queryByText("doomed")).toBeNull();
    });
    confirmSpy.mockRestore();
  });

  it("keeps the layout if the user cancels confirm", async () => {
    await saveLayout({ name: "kept", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    await screen.findByText("kept");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTitle("Delete kept"));
    // Give the click handler a tick to finish.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.queryByText("kept")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("LayoutButtons (rename)", () => {
  it("commits the rename on Enter", async () => {
    await saveLayout({ name: "old-name", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    const label = await screen.findByText("old-name");
    fireEvent.click(label);
    const input = await screen.findByDisplayValue("old-name");
    fireEvent.change(input, { target: { value: "new-name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("new-name");
  });

  it("aborts the rename on Escape", async () => {
    await saveLayout({ name: "still-old", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    const label = await screen.findByText("still-old");
    fireEvent.click(label);
    const input = await screen.findByDisplayValue("still-old");
    fireEvent.change(input, { target: { value: "ignored" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await screen.findByText("still-old");
    expect(screen.queryByText("ignored")).toBeNull();
  });
});

describe("LayoutButtons (search filter)", () => {
  it("hides the search input when there are fewer than the threshold", async () => {
    await saveLayout({ name: "only-one", elements: [], thumbnail: null });
    render(<LayoutButtons />);
    await screen.findByText("only-one");
    expect(screen.queryByPlaceholderText("filter…")).toBeNull();
  });

  it("filters by name once the search input appears", async () => {
    for (let i = 0; i < 6; i++) {
      // Force unique savedAt so the ordering is deterministic.
      await saveLayout({
        name: i === 0 ? "alpha" : `other-${i}`,
        elements: [],
        thumbnail: null,
      });
      await new Promise((r) => setTimeout(r, 1));
    }
    render(<LayoutButtons />);
    const input = await screen.findByPlaceholderText("filter…");
    fireEvent.change(input, { target: { value: "alpha" } });
    await screen.findByText("alpha");
    expect(screen.queryByText("other-1")).toBeNull();
  });
});

describe("LayoutButtons (save-as-new)", () => {
  it("prompts for a name and saves the current canvas", async () => {
    seedCanvas();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Fresh");
    render(<LayoutButtons />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /\+ new/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ new/i }));
    await screen.findByText("Fresh");
    promptSpy.mockRestore();
  });

  it("aborts when prompt returns empty", async () => {
    seedCanvas();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("");
    render(<LayoutButtons />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /\+ new/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ new/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.queryByText(/no saved layouts yet/i)).toBeTruthy();
    promptSpy.mockRestore();
  });
});

describe("LayoutButtons (legacy migration on mount)", () => {
  it("imports a v2 localStorage blob into the IDB picker", async () => {
    const ms = new MockStorage();
    ms.setItem(
      "clapboard.layout.slots",
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          { name: "Migrated", savedAt: 1, elements: [], thumbnail: null },
          null,
          null,
        ],
      }),
    );
    (globalThis as unknown as { localStorage: MockStorage }).localStorage = ms;
    render(<LayoutButtons />);
    await screen.findByText("Migrated");
    expect(ms.getItem("clapboard.layout.slots")).toBeNull();
  });
});
