import { beforeEach, describe, expect, it } from "vitest";

import { createEditorStore, type EditorStore } from "./store";
import { cssFontFamily } from "./types";
import type { LineElement, RectElement, TextElement } from "./types";

let useStore: ReturnType<typeof createEditorStore>;
const get = (): EditorStore => useStore.getState();

beforeEach(() => {
  useStore = createEditorStore();
});

describe("addElement — icon", () => {
  it("appends an icon at the click position with defaults", () => {
    const id = get().addElement("icon", { x: 80, y: 80 });
    const els = get().elements;
    expect(els).toHaveLength(1);
    const el = els[0];
    expect(el.type).toBe("icon");
    expect(el.id).toBe(id);
    expect(el.x).toBe(80);
    expect(el.y).toBe(80);
    expect(el.w).toBe(64);
    expect(el.h).toBe(64);
    if (el.type === "icon") {
      expect(el.src).toBe("film/movie");
      expect(el.invert).toBe(false);
    }
  });

  it("respects an explicit src option", () => {
    get().addElement("icon", { x: 0, y: 0 }, { src: "arrows/arrow-up" });
    const el = get().elements[0];
    if (el.type !== "icon") throw new Error("expected icon");
    expect(el.src).toBe("arrows/arrow-up");
  });

  it("updateIcon patches src and invert; rejects non-icon ids", () => {
    const iconId = get().addElement("icon", { x: 0, y: 0 });
    const rectId = get().addElement("rect", { x: 0, y: 0 });
    get().updateIcon(iconId, { invert: true, src: "symbols/star" });
    const icon = get().elements.find((e) => e.id === iconId);
    if (!icon || icon.type !== "icon") throw new Error("expected icon");
    expect(icon.invert).toBe(true);
    expect(icon.src).toBe("symbols/star");
    // No-op on a rect.
    get().updateIcon(rectId, { invert: true });
    const rect = get().elements.find((e) => e.id === rectId);
    if (!rect || rect.type !== "rect") throw new Error("expected rect");
    expect((rect as unknown as { invert?: boolean }).invert).toBeUndefined();
  });

  it("duplicate copies src and invert", () => {
    const id = get().addElement("icon", { x: 50, y: 50 });
    get().updateIcon(id, { invert: true, src: "emoji/mood-smile" });
    get().selectElement(id);
    const [copyId] = get().duplicateSelected();
    const copy = get().elements.find((e) => e.id === copyId);
    if (!copy || copy.type !== "icon") throw new Error("expected icon");
    expect(copy.src).toBe("emoji/mood-smile");
    expect(copy.invert).toBe(true);
    expect(copy.x).toBe(60);
    expect(copy.y).toBe(60);
  });
});

describe("addElement", () => {
  it("appends a text element with defaults at the click position", () => {
    const id = get().addElement("text", { x: 100, y: 200 });
    const els = get().elements;
    expect(els).toHaveLength(1);
    const el = els[0] as TextElement;
    expect(el.id).toBe(id);
    expect(el.type).toBe("text");
    expect(el.x).toBe(100);
    expect(el.y).toBe(200);
    expect(el.fontSize).toBe(24);
    expect(el.text).toBe("Text");
    expect(el.bold).toBe(false);
    expect(el.italic).toBe(false);
  });

  it("appends rect and line with their defaults", () => {
    const r = get().addElement("rect", { x: 10, y: 20 });
    const l = get().addElement("line", { x: 30, y: 40 });
    const els = get().elements;
    expect(els).toHaveLength(2);
    expect(els[0].type).toBe("rect");
    expect(els[1].type).toBe("line");
    expect((els[0] as RectElement).filled).toBe(false);
    expect((els[1] as LineElement).strokeWidth).toBe(2);
    expect(r).not.toBe(l);
  });

  it("auto-selects the newly added element", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    expect(get().selectedIds).toEqual([id]);
  });
});

describe("selectElement / clearSelection", () => {
  it("sets and clears single selection", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 50, y: 50 });
    get().selectElement(a);
    expect(get().selectedIds).toEqual([a]);
    get().selectElement(b);
    expect(get().selectedIds).toEqual([b]);
    get().clearSelection();
    expect(get().selectedIds).toEqual([]);
  });

  it("additive select adds to (or toggles off) the selection", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 50, y: 50 });
    const c = get().addElement("rect", { x: 100, y: 100 });
    get().selectElement(a);
    get().selectElement(b, true);
    expect(get().selectedIds).toEqual([a, b]);
    get().selectElement(c, true);
    expect(get().selectedIds).toEqual([a, b, c]);
    get().selectElement(b, true);
    expect(get().selectedIds).toEqual([a, c]);
  });

  it("selectMany replaces the selection wholesale", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    const c = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, c]);
    expect(get().selectedIds).toEqual([a, c]);
    expect(b).toBeTruthy();
  });
});

describe("moveElement", () => {
  it("updates absolute coordinates", () => {
    const id = get().addElement("rect", { x: 10, y: 20 });
    get().moveElement(id, { x: 100, y: 200 });
    const el = get().elements[0];
    expect(el.x).toBe(100);
    expect(el.y).toBe(200);
  });

  it("is a no-op when the element is locked", () => {
    const id = get().addElement("rect", { x: 10, y: 20 });
    get().setLocked(id, true);
    get().moveElement(id, { x: 999, y: 999 });
    const el = get().elements[0];
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
  });
});

describe("resizeElement", () => {
  it("updates w/h and optionally x/y from a transformer commit", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().resizeElement(id, { x: 5, y: 6, w: 200, h: 100 });
    const el = get().elements[0];
    expect(el.w).toBe(200);
    expect(el.h).toBe(100);
    expect(el.x).toBe(5);
    expect(el.y).toBe(6);
  });

  it("rejects locked elements", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().setLocked(id, true);
    get().resizeElement(id, { x: 0, y: 0, w: 999, h: 999 });
    expect(get().elements[0].w).toBe(120);
  });

  it("clamps width and height to a minimum of 1px", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().resizeElement(id, { x: 0, y: 0, w: 0, h: -5 });
    const el = get().elements[0];
    expect(el.w).toBe(1);
    expect(el.h).toBe(1);
  });
});

describe("deleteElement", () => {
  it("removes the element and drops it from selection if it was selected", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 50, y: 50 });
    get().selectElement(a);
    get().deleteElement(a);
    expect(get().elements).toHaveLength(1);
    expect(get().elements[0].id).toBe(b);
    expect(get().selectedIds).toEqual([]);
  });

  it("is a no-op when the element is locked", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().setLocked(id, true);
    get().deleteElement(id);
    expect(get().elements).toHaveLength(1);
  });
});

describe("nudgeSelected", () => {
  it("moves the selected element by 1 px (or 10 with shift)", () => {
    const id = get().addElement("rect", { x: 50, y: 50 });
    get().nudgeSelected("right", false);
    expect(get().elements[0].x).toBe(51);
    get().nudgeSelected("down", true);
    expect(get().elements[0].y).toBe(60);
    get().nudgeSelected("left", false);
    expect(get().elements[0].x).toBe(50);
    get().nudgeSelected("up", true);
    expect(get().elements[0].y).toBe(50);
    expect(id).toBeTruthy();
  });

  it("is a no-op with no selection", () => {
    get().addElement("rect", { x: 50, y: 50 });
    get().clearSelection();
    get().nudgeSelected("right", false);
    expect(get().elements[0].x).toBe(50);
  });

  it("moves all elements in a multi-selection together", () => {
    const a = get().addElement("rect", { x: 50, y: 50 });
    const b = get().addElement("rect", { x: 100, y: 200 });
    get().selectMany([a, b]);
    get().nudgeSelected("right", true);
    expect(get().elements[0].x).toBe(60);
    expect(get().elements[1].x).toBe(110);
  });

  it("skips locked members of a multi-selection", () => {
    const a = get().addElement("rect", { x: 50, y: 50 });
    const b = get().addElement("rect", { x: 100, y: 200 });
    get().setLocked(b, true);
    get().selectMany([a, b]);
    get().nudgeSelected("right", false);
    expect(get().elements[0].x).toBe(51);
    expect(get().elements[1].x).toBe(100);
  });
});

describe("deleteSelected", () => {
  it("deletes every selected element that isn't locked", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    const c = get().addElement("rect", { x: 0, y: 0 });
    get().setLocked(b, true);
    get().selectMany([a, b, c]);
    get().deleteSelected();
    expect(get().elements.map((e) => e.id)).toEqual([b]);
    expect(get().selectedIds).toEqual([b]);
  });
});

describe("duplicateSelected", () => {
  it("duplicates each selected element with +10/+10 offset and unlocks copies", () => {
    const a = get().addElement("rect", { x: 50, y: 60 });
    get().setLocked(a, true);
    get().selectElement(a);
    const newIds = get().duplicateSelected();
    expect(newIds).toHaveLength(1);
    expect(get().elements).toHaveLength(2);
    const copy = get().elements[1];
    expect(copy.x).toBe(60);
    expect(copy.y).toBe(70);
    expect(copy.locked).toBe(false);
    expect(get().selectedIds).toEqual(newIds);
  });

  it("is a no-op with no selection", () => {
    const newIds = get().duplicateSelected();
    expect(newIds).toEqual([]);
  });
});

describe("grouping", () => {
  it("groupSelected assigns the same groupId to all selected elements", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 50, y: 50 });
    const c = get().addElement("rect", { x: 100, y: 100 });
    get().selectMany([a, b]);
    const groupId = get().groupSelected();
    expect(groupId).not.toBeNull();
    const els = get().elements;
    expect(els.find((e) => e.id === a)!.groupId).toBe(groupId);
    expect(els.find((e) => e.id === b)!.groupId).toBe(groupId);
    expect(els.find((e) => e.id === c)!.groupId).toBeNull();
  });

  it("groupSelected returns null with fewer than 2 selected", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    get().selectElement(a);
    expect(get().groupSelected()).toBeNull();
  });

  it("ungroupSelected clears groupId on every member, even if only one is selected", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, b]);
    get().groupSelected();
    // Now select only one member; ungroup should still clear the whole group.
    get().selectElement(a);
    get().ungroupSelected();
    const els = get().elements;
    expect(els.find((e) => e.id === a)!.groupId).toBeNull();
    expect(els.find((e) => e.id === b)!.groupId).toBeNull();
  });

  it("clicking one member selects every member of the group", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    const c = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, b]);
    get().groupSelected();
    get().clearSelection();
    get().selectElement(a);
    expect(new Set(get().selectedIds)).toEqual(new Set([a, b]));
    expect(c).toBeTruthy();
  });

  it("moveGroup translates every member by the same delta", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 100, y: 100 });
    get().selectMany([a, b]);
    const gid = get().groupSelected()!;
    get().moveGroup(gid, 10, 20);
    const els = get().elements;
    expect(els.find((e) => e.id === a)).toMatchObject({ x: 10, y: 20 });
    expect(els.find((e) => e.id === b)).toMatchObject({ x: 110, y: 120 });
  });

  it("isolateGroup suppresses group-expansion on click", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, b]);
    const gid = get().groupSelected()!;
    get().isolateGroup(gid);
    get().clearSelection(); // clearSelection also clears isolation
    // Re-isolate after clear.
    get().isolateGroup(gid);
    get().selectElement(a);
    expect(get().selectedIds).toEqual([a]);
  });

  it("clicking outside the isolated group exits isolation", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    const c = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, b]);
    const gid = get().groupSelected()!;
    get().isolateGroup(gid);
    get().selectElement(c);
    expect(get().isolatedGroupId).toBeNull();
    expect(get().selectedIds).toEqual([c]);
  });

  it("ungrouping the isolated group clears isolation", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    get().selectMany([a, b]);
    const gid = get().groupSelected()!;
    get().isolateGroup(gid);
    get().ungroupSelected();
    expect(get().isolatedGroupId).toBeNull();
  });

  it("moveGroup skips locked members", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 100, y: 100 });
    get().selectMany([a, b]);
    const gid = get().groupSelected()!;
    get().setLocked(b, true);
    get().moveGroup(gid, 10, 20);
    const els = get().elements;
    expect(els.find((e) => e.id === a)).toMatchObject({ x: 10, y: 20 });
    expect(els.find((e) => e.id === b)).toMatchObject({ x: 100, y: 100 });
  });
});

describe("undo / redo", () => {
  it("reverts and re-applies element changes", () => {
    const a = get().addElement("rect", { x: 50, y: 50 });
    expect(get().elements).toHaveLength(1);
    get().moveElement(a, { x: 100, y: 100 });
    expect(get().elements[0].x).toBe(100);
    get().undo();
    expect(get().elements[0].x).toBe(50);
    get().undo();
    expect(get().elements).toHaveLength(0);
    get().redo();
    expect(get().elements).toHaveLength(1);
    expect(get().elements[0].x).toBe(50);
    get().redo();
    expect(get().elements[0].x).toBe(100);
  });

  it("clears redo stack after a new mutation", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    get().moveElement(a, { x: 50, y: 50 });
    get().undo();
    expect(get().canRedo()).toBe(true);
    get().moveElement(a, { x: 99, y: 99 });
    expect(get().canRedo()).toBe(false);
  });

  it("selection-only changes don't enter the undo stack", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    get().clearSelection();
    get().selectElement(a);
    // Only the addElement call recorded history; undo reverses that.
    get().undo();
    expect(get().elements).toHaveLength(0);
  });
});

describe("rotateElement", () => {
  it("sets the rotation prop", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().rotateElement(id, 45);
    expect(get().elements[0].rotation).toBe(45);
    get().rotateElement(id, 0);
    expect(get().elements[0].rotation).toBe(0);
  });

  it("rejects rotation on locked elements", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().setLocked(id, true);
    get().rotateElement(id, 90);
    expect(get().elements[0].rotation).toBe(0);
  });
});

describe("line endpoint moves via updateLine", () => {
  it("updates x/y to reposition the start endpoint", () => {
    const id = get().addElement("line", { x: 100, y: 100 });
    // default w=120, h=0 → end at (220,100)
    get().updateLine(id, { x: 50, y: 60 });
    const el = get().elements[0];
    expect(el.x).toBe(50);
    expect(el.y).toBe(60);
    expect(el.w).toBe(120);
    expect(el.h).toBe(0);
  });

  it("updates w/h to reposition the end endpoint without moving the start", () => {
    const id = get().addElement("line", { x: 100, y: 100 });
    // Drag end endpoint to (300, 200) → w=200, h=100
    const start = { x: 100, y: 100 };
    const newEnd = { x: 300, y: 200 };
    get().updateLine(id, { w: newEnd.x - start.x, h: newEnd.y - start.y });
    const el = get().elements[0];
    expect(el.x).toBe(100);
    expect(el.y).toBe(100);
    expect(el.w).toBe(200);
    expect(el.h).toBe(100);
  });

  it("supports lines that go in any direction (negative w/h)", () => {
    const id = get().addElement("line", { x: 200, y: 200 });
    get().updateLine(id, { w: -100, h: -50 });
    const el = get().elements[0];
    expect(el.w).toBe(-100);
    expect(el.h).toBe(-50);
  });
});

describe("setLocked", () => {
  it("toggles the locked flag", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    expect(get().elements[0].locked).toBe(false);
    get().setLocked(id, true);
    expect(get().elements[0].locked).toBe(true);
    get().setLocked(id, false);
    expect(get().elements[0].locked).toBe(false);
  });
});

describe("reorderLayer", () => {
  it("moves up/down/top/bottom in z-order (last = topmost)", () => {
    const a = get().addElement("rect", { x: 0, y: 0 });
    const b = get().addElement("rect", { x: 0, y: 0 });
    const c = get().addElement("rect", { x: 0, y: 0 });
    expect(get().elements.map((e) => e.id)).toEqual([a, b, c]);
    get().reorderLayer(a, "top");
    expect(get().elements.map((e) => e.id)).toEqual([b, c, a]);
    get().reorderLayer(a, "bottom");
    expect(get().elements.map((e) => e.id)).toEqual([a, b, c]);
    get().reorderLayer(a, "up");
    expect(get().elements.map((e) => e.id)).toEqual([b, a, c]);
    get().reorderLayer(c, "down");
    expect(get().elements.map((e) => e.id)).toEqual([b, c, a]);
  });
});

describe("updateText / updateRect / updateLine", () => {
  it("patches text-specific props", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    get().updateText(id, { text: "Scene 1", fontSize: 36, align: "center" });
    const el = get().elements[0] as TextElement;
    expect(el.text).toBe("Scene 1");
    expect(el.fontSize).toBe(36);
    expect(el.align).toBe("center");
  });

  it("patches rect-specific props", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().updateRect(id, { filled: true, strokeWidth: 5 });
    const el = get().elements[0] as RectElement;
    expect(el.filled).toBe(true);
    expect(el.strokeWidth).toBe(5);
  });

  it("patches line-specific props", () => {
    const id = get().addElement("line", { x: 0, y: 0 });
    get().updateLine(id, { strokeWidth: 8 });
    const el = get().elements[0] as LineElement;
    expect(el.strokeWidth).toBe(8);
  });

  it("ignores updates targeted at the wrong element type", () => {
    const id = get().addElement("rect", { x: 0, y: 0 });
    get().updateText(id, { text: "should not apply" });
    expect((get().elements[0] as RectElement).type).toBe("rect");
  });

  it("accepts arbitrary fontFamily strings (system fonts)", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    get().updateText(id, { fontFamily: "Comic Sans MS" });
    expect((get().elements[0] as TextElement).fontFamily).toBe("Comic Sans MS");
  });

  it("accepts custom (non-preset) font sizes", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    get().updateText(id, { fontSize: 37 });
    expect((get().elements[0] as TextElement).fontSize).toBe(37);
  });

  it("patches verticalAlign on text", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    get().updateText(id, { verticalAlign: "middle" });
    expect((get().elements[0] as TextElement).verticalAlign).toBe("middle");
    get().updateText(id, { verticalAlign: "bottom" });
    expect((get().elements[0] as TextElement).verticalAlign).toBe("bottom");
  });

  it("toggles bold and italic independently", () => {
    const id = get().addElement("text", { x: 0, y: 0 });
    get().updateText(id, { bold: true });
    expect((get().elements[0] as TextElement).bold).toBe(true);
    expect((get().elements[0] as TextElement).italic).toBe(false);
    get().updateText(id, { italic: true });
    expect((get().elements[0] as TextElement).bold).toBe(true);
    expect((get().elements[0] as TextElement).italic).toBe(true);
    get().updateText(id, { bold: false });
    expect((get().elements[0] as TextElement).bold).toBe(false);
    expect((get().elements[0] as TextElement).italic).toBe(true);
  });
});

describe("cssFontFamily", () => {
  it("passes generic keywords through unquoted", () => {
    expect(cssFontFamily("sans-serif")).toBe("sans-serif");
    expect(cssFontFamily("monospace")).toBe("monospace");
  });

  it("passes simple identifier names through unquoted", () => {
    expect(cssFontFamily("Arial")).toBe("Arial");
  });

  it("quotes family names containing spaces", () => {
    expect(cssFontFamily("Comic Sans MS")).toBe('"Comic Sans MS"');
    expect(cssFontFamily("Courier New")).toBe('"Courier New"');
  });

  it("escapes embedded double quotes", () => {
    expect(cssFontFamily('Foo"Bar')).toBe('"Foo\\"Bar"');
  });

  it("falls back to sans-serif on empty input", () => {
    expect(cssFontFamily("")).toBe("sans-serif");
    expect(cssFontFamily("   ")).toBe("sans-serif");
  });
});
