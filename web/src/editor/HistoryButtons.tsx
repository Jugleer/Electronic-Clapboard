/**
 * Undo/redo + duplicate toolbar. Reads from the store on each click
 * (rather than subscribing to history depth) because canUndo/canRedo
 * are not reactive — see store.ts comment on the snapshot stacks.
 * The buttons re-evaluate on every elements/selection change, which
 * covers the common case of "did we just commit something".
 */

import { useEditorStore } from "./store";

export function HistoryButtons(): JSX.Element {
  // Subscribe to elements/selectedIds to force re-renders when history
  // depth changes (since each commit also touches one of these).
  const elements = useEditorStore((s) => s.elements);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  void elements;

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo()}
        title="Undo (Ctrl+Z)"
        style={{ padding: "6px 12px", fontSize: 14 }}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo()}
        title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        style={{ padding: "6px 12px", fontSize: 14 }}
      >
        Redo
      </button>
      <button
        type="button"
        onClick={() => duplicateSelected()}
        disabled={selectedIds.length === 0}
        title="Duplicate selection (Ctrl+D)"
        style={{ padding: "6px 12px", fontSize: 14 }}
      >
        Duplicate
      </button>
    </div>
  );
}
