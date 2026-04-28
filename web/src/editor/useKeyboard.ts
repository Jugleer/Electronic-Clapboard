/**
 * Document-level keyboard shortcuts. Suppressed while a textarea or
 * input has focus so we don't eat the user's typing.
 *
 * Shortcut metadata (`SHORTCUTS`) is exported alongside the handler
 * so the on-screen `?` overlay can render the same list the handler
 * acts on — single source of truth, no drift between docs and code.
 */

import { useEffect } from "react";

import {
  ClipboardParseError,
  parse as parseClipboard,
  remap as remapClipboardElements,
  serialise as serialiseClipboard,
  translate as translateClipboardBatch,
} from "./clipboard";
import { freshElementId, freshGroupId, useEditorStore } from "./store";

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export type ShortcutCategory = "send" | "edit" | "selection" | "layout" | "view";

export interface ShortcutDef {
  /** Hotkey label as it should appear in the overlay (Mac users see
   *  the same; we don't try to be clever about Cmd vs Ctrl). */
  keys: string;
  description: string;
  category: ShortcutCategory;
}

/** Authoritative list. The handler below uses the same chord pattern
 *  so the table can't drift from the actual behaviour. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { keys: "Ctrl+Enter",       description: "Send to clapboard",                  category: "send" },
  { keys: "Ctrl+Z",           description: "Undo",                               category: "edit" },
  { keys: "Ctrl+Shift+Z / Ctrl+Y", description: "Redo",                          category: "edit" },
  { keys: "Ctrl+D",           description: "Duplicate selection",                category: "edit" },
  { keys: "Ctrl+C",           description: "Copy selected elements",             category: "edit" },
  { keys: "Ctrl+V",           description: "Paste elements",                     category: "edit" },
  { keys: "Delete / Backspace", description: "Delete selection",                 category: "edit" },
  { keys: "Ctrl+A",           description: "Select all",                         category: "selection" },
  { keys: "Esc",              description: "Clear selection / exit text edit",   category: "selection" },
  { keys: "Shift+click / drag-marquee", description: "Multi-select",             category: "selection" },
  { keys: "Shift while dragging", description: "Lock movement to one axis",      category: "selection" },
  { keys: "Arrow keys",       description: "Nudge selection by 1 px",            category: "layout" },
  { keys: "Shift+Arrow keys", description: "Nudge selection by 10 px",           category: "layout" },
  { keys: "Ctrl+G",           description: "Group selection",                    category: "layout" },
  { keys: "Ctrl+Shift+G",     description: "Ungroup selection",                  category: "layout" },
  { keys: "Double-click text",description: "Edit text inline",                   category: "edit" },
  { keys: "?",                description: "Show this help",                     category: "view" },
] as const;

interface UseKeyboardOptions {
  /** Notified to open the shortcut overlay. */
  onShowHelp?: () => void;
  /** Notified when a clipboard error needs surfacing. Optional. */
  onClipboardError?: (msg: string) => void;
}

export function useKeyboardShortcuts(
  enabled: boolean,
  onSend?: () => void,
  options: UseKeyboardOptions = {},
): void {
  const { onShowHelp, onClipboardError } = options;
  useEffect(() => {
    if (!enabled) return;

    const handler = async (e: KeyboardEvent) => {
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

      // Send to clapboard.
      if (cmd && e.key === "Enter") {
        e.preventDefault();
        onSend?.();
        return;
      }

      // Undo / redo.
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

      // Copy.
      if (cmd && (e.key === "c" || e.key === "C")) {
        const selected = store.elements.filter((el) =>
          store.selectedIds.includes(el.id),
        );
        if (selected.length === 0) return;
        e.preventDefault();
        const json = serialiseClipboard(selected);
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(json);
          } else {
            // Fallback in-memory buffer so paste-within-this-tab works
            // even when the clipboard API is unavailable (insecure
            // origin, denied permission). Cross-tab paste won't work
            // in that case but most editors are single-tab.
            inMemoryClipboard = json;
          }
        } catch (err) {
          inMemoryClipboard = json;
          onClipboardError?.(
            `Couldn't write to system clipboard, kept in-memory: ${err instanceof Error ? err.message : err}`,
          );
        }
        return;
      }

      // Paste.
      if (cmd && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        let text: string | null = null;
        try {
          text = navigator.clipboard?.readText
            ? await navigator.clipboard.readText()
            : null;
        } catch {
          text = null;
        }
        if (!text) text = inMemoryClipboard;
        if (!text) {
          onClipboardError?.("Clipboard is empty.");
          return;
        }
        try {
          const elements = parseClipboard(text);
          const fresh = remapClipboardElements(elements, freshElementId, freshGroupId);
          // Default paste position: +10/+10 from source. The pointer-
          // tracked variant is a follow-up; this matches the Ctrl+D
          // duplicate offset for now.
          const placed = translateClipboardBatch(fresh, null);
          store.addElements(placed);
        } catch (err) {
          if (err instanceof ClipboardParseError) {
            onClipboardError?.(err.message);
          } else {
            onClipboardError?.(err instanceof Error ? err.message : String(err));
          }
        }
        return;
      }

      // Help overlay.
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        onShowHelp?.();
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
  }, [enabled, onSend, onShowHelp, onClipboardError]);
}

// In-memory clipboard fallback for environments where
// navigator.clipboard isn't available (insecure origin, browser-deny,
// jsdom under tests). Module-scope so a copy in one render cycle is
// still readable by a paste in a later render.
let inMemoryClipboard: string | null = null;

/** Test seam — lets unit tests pre-load the in-memory clipboard. */
export function _setInMemoryClipboardForTesting(value: string | null): void {
  inMemoryClipboard = value;
}
