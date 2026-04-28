import { useEditorStore } from "./store";
import { Button, HStack } from "./ui";

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
    <HStack gap="sm">
      <Button
        onClick={() => groupSelected()}
        disabled={!canGroup}
        title="Group selected (Ctrl+G)"
      >
        Group
      </Button>
      <Button
        onClick={ungroupSelected}
        disabled={!canUngroup}
        title="Ungroup selected (Ctrl+Shift+G)"
      >
        Ungroup
      </Button>
    </HStack>
  );
}
