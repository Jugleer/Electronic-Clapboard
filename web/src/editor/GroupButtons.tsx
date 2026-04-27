import { useEditorStore } from "./store";

export function GroupButtons(): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const groupSelected = useEditorStore((s) => s.groupSelected);
  const ungroupSelected = useEditorStore((s) => s.ungroupSelected);

  const canGroup = selectedIds.length >= 2;
  const canUngroup = elements.some(
    (el) => selectedIds.includes(el.id) && el.groupId !== null,
  );

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={() => groupSelected()}
        disabled={!canGroup}
        title="Group selected (Ctrl+G)"
        style={{ padding: "6px 12px", fontSize: 14 }}
      >
        Group
      </button>
      <button
        type="button"
        onClick={ungroupSelected}
        disabled={!canUngroup}
        title="Ungroup selected (Ctrl+Shift+G)"
        style={{ padding: "6px 12px", fontSize: 14 }}
      >
        Ungroup
      </button>
    </div>
  );
}
