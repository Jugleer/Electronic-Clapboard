/**
 * Editor state store. Zustand was the Phase-0 default; Phase 4 actually
 * needs cross-component subscriptions (canvas + layer panel + properties
 * panel reading different slices) so it earns its keep here.
 *
 * The store factory `createEditorStore()` returns a fresh store each call,
 * which keeps tests fully isolated. The app uses a single module-level
 * instance exported as `useEditorStore`.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";

import { HEIGHT, WIDTH } from "../frameFormat";
import { useGridStore } from "./gridStore";
import {
  defaultsFor,
  type Element,
  type ElementId,
  type ElementType,
  type GroupId,
  type IconElement,
  type ImageElement,
  type LineElement,
  type RectElement,
  type TextElement,
} from "./types";

export interface EditorState {
  elements: Element[];
  selectedIds: ElementId[];
  // When set, group-expansion is suppressed for this groupId: clicking
  // a member selects only that member, not the whole group. Double-
  // clicking a grouped element in the canvas (or its label in the
  // layer panel) enters this "isolated edit" state for the group.
  // Cleared on Escape, on stage-blank-click, or on selecting an
  // element outside the isolated group.
  isolatedGroupId: GroupId | null;
}

export type NudgeDirection = "up" | "down" | "left" | "right";
export type LayerMove = "up" | "down" | "top" | "bottom";
export type AlignSide =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export interface EditorActions {
  addElement: (
    type: ElementType,
    position: { x: number; y: number },
    options?: { src?: string; dataUrl?: string; w?: number; h?: number },
  ) => ElementId;
  selectElement: (id: ElementId, additive?: boolean) => void;
  selectMany: (ids: ElementId[]) => void;
  clearSelection: () => void;
  moveElement: (id: ElementId, position: { x: number; y: number }) => void;
  resizeElement: (
    id: ElementId,
    box: { x: number; y: number; w: number; h: number },
  ) => void;
  rotateElement: (id: ElementId, rotation: number) => void;
  moveGroup: (groupId: GroupId, dx: number, dy: number) => void;
  groupSelected: () => GroupId | null;
  ungroupSelected: () => void;
  isolateGroup: (groupId: GroupId | null) => void;
  deleteElement: (id: ElementId) => void;
  deleteSelected: () => void;
  duplicateSelected: () => ElementId[];
  nudgeSelected: (direction: NudgeDirection, large: boolean) => void;
  setLocked: (id: ElementId, locked: boolean) => void;
  reorderLayer: (id: ElementId, move: LayerMove) => void;
  alignSelected: (side: AlignSide) => void;
  distributeSelected: (axis: DistributeAxis) => void;
  loadLayout: (elements: Element[]) => void;
  updateText: (id: ElementId, patch: Partial<Omit<TextElement, "id" | "type">>) => void;
  updateRect: (id: ElementId, patch: Partial<Omit<RectElement, "id" | "type">>) => void;
  updateLine: (id: ElementId, patch: Partial<Omit<LineElement, "id" | "type">>) => void;
  updateIcon: (id: ElementId, patch: Partial<Omit<IconElement, "id" | "type">>) => void;
  updateImage: (id: ElementId, patch: Partial<Omit<ImageElement, "id" | "type">>) => void;
  // Undo/redo (history middleware-style; see commitHistory in store body).
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export type EditorStore = EditorState & EditorActions;

let idCounter = 0;
function nextId(): ElementId {
  idCounter += 1;
  return `el_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

const NUDGE_SMALL = 1;
const NUDGE_LARGE = 10;

// Lines store their endpoints as (x,y) and (x+w, y+h); w/h can be
// negative for an upward / leftward segment. Other elements have a
// strictly positive (w, h). The bbox helpers normalise so alignment
// math works on every type without special-casing.
/**
 * Clamp an element's position and size so its bounding box stays
 * inside the *outer* edge of the staging frame. The legal placement
 * region is `[-border, WIDTH + border]` × `[-border, HEIGHT + border]`,
 * where `border` is the gridStore's `borderWidth` (0 = no border, the
 * frame itself is the boundary). Lines have their endpoints clamped
 * independently; other elements have their bbox clamped, and a width
 * or height larger than the legal region is shrunk to fit.
 *
 * Reads the current border width from `useGridStore` directly. This
 * couples the editor store to the grid store but is cheap (a single
 * synchronous read) and keeps the clamp helper a pure function of
 * the input element.
 */
function currentBorder(): number {
  if (typeof useGridStore.getState !== "function") return 0;
  return Math.max(0, Math.round(useGridStore.getState().borderWidth));
}

export function clampToFrame(el: Element, border = currentBorder()): Element {
  // `-0 || 0` normalises the signed zero JS produces from unary minus
  // on 0 — without this, a `border = 0` clamp can return `-0` and
  // surprise callers that use `Object.is`.
  const minX = -border || 0;
  const minY = -border || 0;
  const maxX = WIDTH + border;
  const maxY = HEIGHT + border;
  if (el.type === "line") {
    // Clamp both endpoints, recompute (x, y, w, h) from clamped points.
    const x1 = clamp(el.x, minX, maxX);
    const y1 = clamp(el.y, minY, maxY);
    const x2 = clamp(el.x + el.w, minX, maxX);
    const y2 = clamp(el.y + el.h, minY, maxY);
    if (x1 === el.x && y1 === el.y && x2 === el.x + el.w && y2 === el.y + el.h) {
      return el;
    }
    return { ...el, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  // Non-line: shrink w/h first if they exceed the frame, then clamp x/y.
  const maxW = maxX - minX;
  const maxH = maxY - minY;
  const w = Math.max(1, Math.min(el.w, maxW));
  const h = Math.max(1, Math.min(el.h, maxH));
  const x = clamp(el.x, minX, maxX - w);
  const y = clamp(el.y, minY, maxY - h);
  if (x === el.x && y === el.y && w === el.w && h === el.h) return el;
  return { ...el, x, y, w, h };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function bboxLeft(el: Element): number {
  if (el.type === "line") return Math.min(el.x, el.x + el.w);
  return el.x;
}
function bboxRight(el: Element): number {
  if (el.type === "line") return Math.max(el.x, el.x + el.w);
  return el.x + el.w;
}
function bboxTop(el: Element): number {
  if (el.type === "line") return Math.min(el.y, el.y + el.h);
  return el.y;
}
function bboxBottom(el: Element): number {
  if (el.type === "line") return Math.max(el.y, el.y + el.h);
  return el.y + el.h;
}

function patchElement(
  state: EditorState,
  id: ElementId,
  patch: (el: Element) => Element | null,
): EditorState {
  const idx = state.elements.findIndex((e) => e.id === id);
  if (idx < 0) return state;
  const next = patch(state.elements[idx]);
  if (!next) return state;
  const elements = state.elements.slice();
  elements[idx] = next;
  return { ...state, elements };
}

interface HistorySnapshot {
  elements: Element[];
  selectedIds: ElementId[];
}

const HISTORY_LIMIT = 100;

export function createEditorStore(): UseBoundStore<StoreApi<EditorStore>> {
  // Snapshot history lives outside zustand's reactive state because
  // re-rendering on every undo-pointer change would be wasteful and
  // most consumers don't read it. canUndo/canRedo are functions, not
  // values, for the same reason.
  const past: HistorySnapshot[] = [];
  const future: HistorySnapshot[] = [];

  return create<EditorStore>((set, get) => {
    /**
     * Wrap a state-mutating action so the *prior* state is pushed onto
     * the undo stack and the redo stack is cleared. Read-only actions
     * (selection, undo/redo themselves) bypass this.
     */
    const commit = (
      mutate: (state: EditorStore) => Partial<EditorStore> | EditorStore,
    ) => {
      set((state) => {
        const next = mutate(state);
        // Only record history if elements actually changed; selection-
        // only changes are not undoable.
        const elementsChanged =
          "elements" in next && (next.elements as Element[]) !== state.elements;
        if (elementsChanged) {
          past.push({
            elements: state.elements,
            selectedIds: state.selectedIds,
          });
          if (past.length > HISTORY_LIMIT) past.shift();
          future.length = 0;
        }
        return next;
      });
    };

    const dropFromSelection = (state: EditorStore, removed: Set<ElementId>) =>
      state.selectedIds.some((id) => removed.has(id))
        ? state.selectedIds.filter((id) => !removed.has(id))
        : state.selectedIds;

    return {
      elements: [],
      selectedIds: [],
      isolatedGroupId: null,

      addElement: (type, position, options) => {
        const id = nextId();
        commit((state) => {
          const el: Element = clampToFrame({
            ...defaultsFor(type, position, options),
            id,
          });
          return { elements: [...state.elements, el], selectedIds: [id] };
        });
        return id;
      },

      selectElement: (id, additive = false) =>
        set((state) => {
          const target = state.elements.find((e) => e.id === id);
          const targetGroup = target?.groupId ?? null;
          // Inside an isolated group, clicks select members individually.
          // Selecting outside the isolated group clears isolation.
          const isolated = state.isolatedGroupId;
          const inIsolation =
            isolated !== null && targetGroup === isolated;
          const idsForGroup = (gid: GroupId | null): ElementId[] =>
            gid && !inIsolation
              ? state.elements.filter((e) => e.groupId === gid).map((e) => e.id)
              : [id];
          const ids = idsForGroup(targetGroup);

          let nextIsolation = isolated;
          if (isolated !== null && targetGroup !== isolated) {
            nextIsolation = null;
          }

          if (!additive) return { selectedIds: ids, isolatedGroupId: nextIsolation };
          const current = new Set(state.selectedIds);
          const allInGroupSelected = ids.every((i) => current.has(i));
          if (allInGroupSelected) {
            return {
              selectedIds: state.selectedIds.filter((i) => !ids.includes(i)),
              isolatedGroupId: nextIsolation,
            };
          }
          for (const i of ids) current.add(i);
          return {
            selectedIds: Array.from(current),
            isolatedGroupId: nextIsolation,
          };
        }),

      selectMany: (ids) =>
        set((state) => {
          const requested = new Set(ids);
          // Inside an isolated group, do not auto-expand to siblings.
          if (state.isolatedGroupId === null) {
            const groups = new Set<GroupId>();
            for (const el of state.elements) {
              if (requested.has(el.id) && el.groupId) groups.add(el.groupId);
            }
            if (groups.size > 0) {
              for (const el of state.elements) {
                if (el.groupId && groups.has(el.groupId)) requested.add(el.id);
              }
            }
          }
          return { selectedIds: Array.from(requested) };
        }),

      isolateGroup: (groupId) =>
        set((state) => {
          if (groupId === null) return { isolatedGroupId: null };
          // Sanity: only isolate groups that actually exist.
          const exists = state.elements.some((e) => e.groupId === groupId);
          return { isolatedGroupId: exists ? groupId : null };
        }),

      clearSelection: () => set({ selectedIds: [], isolatedGroupId: null }),

      moveElement: (id, position) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.locked
              ? null
              : clampToFrame({ ...el, x: position.x, y: position.y }),
          ),
        ),

      resizeElement: (id, box) =>
        commit((state) =>
          patchElement(state, id, (el) => {
            if (el.locked) return null;
            return clampToFrame({
              ...el,
              x: box.x,
              y: box.y,
              w: Math.max(1, box.w),
              h: Math.max(1, box.h),
            });
          }),
        ),

      rotateElement: (id, rotation) =>
        commit((state) =>
          patchElement(state, id, (el) => (el.locked ? null : { ...el, rotation })),
        ),

      moveGroup: (groupId, dx, dy) =>
        commit((state) => {
          if (dx === 0 && dy === 0) return state;
          let mutated = false;
          const elements = state.elements.map((el) => {
            if (el.groupId !== groupId || el.locked) return el;
            mutated = true;
            return clampToFrame({ ...el, x: el.x + dx, y: el.y + dy });
          });
          return mutated ? { ...state, elements } : state;
        }),

      groupSelected: () => {
        if (get().selectedIds.length < 2) return null;
        const groupId = `g_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
        commit((state) => {
          const ids = new Set(state.selectedIds);
          let mutated = false;
          const elements = state.elements.map((el) => {
            if (!ids.has(el.id)) return el;
            mutated = true;
            return { ...el, groupId };
          });
          return mutated ? { ...state, elements } : state;
        });
        return groupId;
      },

      ungroupSelected: () =>
        commit((state) => {
          if (state.selectedIds.length === 0) return state;
          const ids = new Set(state.selectedIds);
          const groupIds = new Set<GroupId>();
          for (const el of state.elements) {
            if (ids.has(el.id) && el.groupId) groupIds.add(el.groupId);
          }
          if (groupIds.size === 0) return state;
          let mutated = false;
          const elements = state.elements.map((el) => {
            if (!el.groupId || !groupIds.has(el.groupId)) return el;
            mutated = true;
            return { ...el, groupId: null };
          });
          if (!mutated) return state;
          // If the isolated group just dissolved, drop isolation.
          const nextIsolation =
            state.isolatedGroupId !== null && groupIds.has(state.isolatedGroupId)
              ? null
              : state.isolatedGroupId;
          return { ...state, elements, isolatedGroupId: nextIsolation };
        }),

      deleteElement: (id) =>
        commit((state) => {
          const target = state.elements.find((e) => e.id === id);
          if (!target || target.locked) return state;
          const removed = new Set([id]);
          return {
            ...state,
            elements: state.elements.filter((e) => e.id !== id),
            selectedIds: dropFromSelection(state, removed),
          };
        }),

      deleteSelected: () =>
        commit((state) => {
          if (state.selectedIds.length === 0) return state;
          const removed = new Set<ElementId>();
          for (const id of state.selectedIds) {
            const t = state.elements.find((e) => e.id === id);
            if (t && !t.locked) removed.add(id);
          }
          if (removed.size === 0) return state;
          return {
            ...state,
            elements: state.elements.filter((e) => !removed.has(e.id)),
            selectedIds: state.selectedIds.filter((id) => !removed.has(id)),
          };
        }),

      duplicateSelected: () => {
        const newIds: ElementId[] = [];
        commit((state) => {
          if (state.selectedIds.length === 0) return state;
          const copies: Element[] = [];
          for (const id of state.selectedIds) {
            const src = state.elements.find((e) => e.id === id);
            if (!src) continue;
            const copy = clampToFrame({
              ...src,
              id: nextId(),
              x: src.x + 10,
              y: src.y + 10,
              locked: false,
            });
            copies.push(copy);
            newIds.push(copy.id);
          }
          if (copies.length === 0) return state;
          return {
            ...state,
            elements: [...state.elements, ...copies],
            selectedIds: newIds,
          };
        });
        return newIds;
      },

      nudgeSelected: (direction, large) =>
        commit((state) => {
          if (state.selectedIds.length === 0) return state;
          const step = large ? NUDGE_LARGE : NUDGE_SMALL;
          const dx = direction === "left" ? -step : direction === "right" ? step : 0;
          const dy = direction === "up" ? -step : direction === "down" ? step : 0;
          const ids = new Set(state.selectedIds);
          let mutated = false;
          const elements = state.elements.map((el) => {
            if (!ids.has(el.id) || el.locked) return el;
            mutated = true;
            return clampToFrame({ ...el, x: el.x + dx, y: el.y + dy });
          });
          return mutated ? { ...state, elements } : state;
        }),

      setLocked: (id, locked) =>
        commit((state) => patchElement(state, id, (el) => ({ ...el, locked }))),

      alignSelected: (side) =>
        commit((state) => {
          if (state.selectedIds.length < 2) return state;
          const sel = state.elements.filter((e) =>
            state.selectedIds.includes(e.id),
          );
          // The shared edge / centerline is computed from the union of
          // every selected element (including locked ones, since they
          // anchor the alignment), then movable members are nudged to
          // that line. Lines use their bounding box so axis-aligned
          // segments still pull along the orthogonal axis.
          const unionLeft = Math.min(...sel.map((e) => bboxLeft(e)));
          const unionRight = Math.max(...sel.map((e) => bboxRight(e)));
          const unionTop = Math.min(...sel.map((e) => bboxTop(e)));
          const unionBottom = Math.max(...sel.map((e) => bboxBottom(e)));
          const cx = (unionLeft + unionRight) / 2;
          const cy = (unionTop + unionBottom) / 2;
          const ids = new Set(state.selectedIds);
          let mutated = false;
          const elements = state.elements.map((el) => {
            if (!ids.has(el.id) || el.locked) return el;
            const w = bboxRight(el) - bboxLeft(el);
            const h = bboxBottom(el) - bboxTop(el);
            const dx =
              side === "left"
                ? unionLeft - bboxLeft(el)
                : side === "right"
                  ? unionRight - bboxRight(el)
                  : side === "center-x"
                    ? cx - (bboxLeft(el) + w / 2)
                    : 0;
            const dy =
              side === "top"
                ? unionTop - bboxTop(el)
                : side === "bottom"
                  ? unionBottom - bboxBottom(el)
                  : side === "center-y"
                    ? cy - (bboxTop(el) + h / 2)
                    : 0;
            if (dx === 0 && dy === 0) return el;
            mutated = true;
            return { ...el, x: el.x + dx, y: el.y + dy };
          });
          return mutated ? { ...state, elements } : state;
        }),

      loadLayout: (elements) =>
        commit((state) => {
          // Wipe selection + isolation so a freshly loaded layout
          // doesn't carry stale ids over from the previous session.
          // History is preserved (the load itself is undoable).
          void state;
          return {
            elements: elements.slice(),
            selectedIds: [],
            isolatedGroupId: null,
          } as Partial<EditorStore>;
        }),

      distributeSelected: (axis) =>
        commit((state) => {
          if (state.selectedIds.length < 3) return state;
          const ids = new Set(state.selectedIds);
          const sel = state.elements
            .filter((e) => ids.has(e.id))
            .slice()
            .sort((a, b) =>
              axis === "horizontal" ? bboxLeft(a) - bboxLeft(b) : bboxTop(a) - bboxTop(b),
            );
          // Even-gap distribution: total span − sum of widths/heights →
          // gap = remainder / (count − 1). Endpoints stay anchored.
          const totalSpan =
            axis === "horizontal"
              ? bboxRight(sel[sel.length - 1]) - bboxLeft(sel[0])
              : bboxBottom(sel[sel.length - 1]) - bboxTop(sel[0]);
          const summed = sel.reduce(
            (acc, e) =>
              acc +
              (axis === "horizontal" ? bboxRight(e) - bboxLeft(e) : bboxBottom(e) - bboxTop(e)),
            0,
          );
          const totalGap = totalSpan - summed;
          const gap = totalGap / (sel.length - 1);
          let cursor =
            axis === "horizontal"
              ? bboxLeft(sel[0]) + (bboxRight(sel[0]) - bboxLeft(sel[0]))
              : bboxTop(sel[0]) + (bboxBottom(sel[0]) - bboxTop(sel[0]));
          // sel[0] doesn't move; sel[last] doesn't move. Middle members
          // get planted at `cursor + gap` and cursor advances by their
          // span.
          const targets = new Map<ElementId, number>();
          for (let i = 1; i < sel.length - 1; i++) {
            const e = sel[i];
            const startTarget = cursor + gap;
            targets.set(e.id, startTarget);
            cursor =
              startTarget +
              (axis === "horizontal" ? bboxRight(e) - bboxLeft(e) : bboxBottom(e) - bboxTop(e));
          }
          if (targets.size === 0) return state;
          let mutated = false;
          const elements = state.elements.map((el) => {
            const target = targets.get(el.id);
            if (target === undefined || el.locked) return el;
            const dx = axis === "horizontal" ? target - bboxLeft(el) : 0;
            const dy = axis === "vertical" ? target - bboxTop(el) : 0;
            if (dx === 0 && dy === 0) return el;
            mutated = true;
            return { ...el, x: el.x + dx, y: el.y + dy };
          });
          return mutated ? { ...state, elements } : state;
        }),

      reorderLayer: (id, move) =>
        commit((state) => {
          const idx = state.elements.findIndex((e) => e.id === id);
          if (idx < 0) return state;
          const elements = state.elements.slice();
          const [el] = elements.splice(idx, 1);
          let target = idx;
          if (move === "top") target = elements.length;
          else if (move === "bottom") target = 0;
          else if (move === "up") target = Math.min(elements.length, idx + 1);
          else if (move === "down") target = Math.max(0, idx - 1);
          elements.splice(target, 0, el);
          return { ...state, elements };
        }),

      updateText: (id, patch) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.type === "text" ? { ...el, ...patch } : null,
          ),
        ),

      updateRect: (id, patch) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.type === "rect" ? { ...el, ...patch } : null,
          ),
        ),

      updateLine: (id, patch) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.type === "line" ? { ...el, ...patch } : null,
          ),
        ),

      updateIcon: (id, patch) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.type === "icon" ? { ...el, ...patch } : null,
          ),
        ),

      updateImage: (id, patch) =>
        commit((state) =>
          patchElement(state, id, (el) =>
            el.type === "image" ? { ...el, ...patch } : null,
          ),
        ),

      undo: () => {
        const snap = past.pop();
        if (!snap) return;
        const state = get();
        future.push({ elements: state.elements, selectedIds: state.selectedIds });
        if (future.length > HISTORY_LIMIT) future.shift();
        set({ elements: snap.elements, selectedIds: snap.selectedIds });
      },
      redo: () => {
        const snap = future.pop();
        if (!snap) return;
        const state = get();
        past.push({ elements: state.elements, selectedIds: state.selectedIds });
        if (past.length > HISTORY_LIMIT) past.shift();
        set({ elements: snap.elements, selectedIds: snap.selectedIds });
      },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
    };
  });
}

export const useEditorStore = createEditorStore();
