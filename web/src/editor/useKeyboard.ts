/**
 * Document-level keyboard shortcuts. Suppressed while a textarea or
 * input has focus so we don't eat the user's typing.
 */

import { useEffect } from "react";

import { useEditorStore } from "./store";

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function useKeyboardShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editing =
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (editing) return;

      const store = useEditorStore.getState();
      const cmd = e.ctrlKey || e.metaKey;

      // Undo / redo. Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y.
      if (cmd && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (cmd && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        store.redo();
        return;
      }

      // Duplicate.
      if (cmd && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }

      // Select all.
      if (cmd && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        store.selectMany(store.elements.map((el) => el.id));
        return;
      }

      // Group / ungroup.
      if (cmd && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) store.ungroupSelected();
        else store.groupSelected();
        return;
      }

      if (e.key === "Escape") {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.clearSelection();
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.deleteSelected();
        }
        return;
      }

      const dir = ARROWS[e.key];
      if (dir) {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.nudgeSelected(dir, e.shiftKey);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
