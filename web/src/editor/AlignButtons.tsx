import { useEditorStore } from "./store";
import type { AlignSide, DistributeAxis } from "./store";
import { Button, HStack } from "./ui";

const ALIGN_BUTTONS: { side: AlignSide; label: string; title: string }[] = [
  { side: "left", label: "⫷", title: "Align left" },
  { side: "center-x", label: "⇔", title: "Align horizontal centers" },
  { side: "right", label: "⫸", title: "Align right" },
  { side: "top", label: "⊤", title: "Align top" },
  { side: "center-y", label: "⇕", title: "Align vertical centers" },
  { side: "bottom", label: "⊥", title: "Align bottom" },
];

const DISTRIBUTE_BUTTONS: {
  axis: DistributeAxis;
  label: string;
  title: string;
}[] = [
  { axis: "horizontal", label: "↔", title: "Distribute horizontally" },
  { axis: "vertical", label: "↕", title: "Distribute vertically" },
];

const ICON_STYLE: React.CSSProperties = { minWidth: 32 };

export function AlignButtons(): JSX.Element {
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const alignSelected = useEditorStore((s) => s.alignSelected);
  const distributeSelected = useEditorStore((s) => s.distributeSelected);
  const alignDisabled = selectedCount < 2;
  const distributeDisabled = selectedCount < 3;

  return (
    <HStack gap="xs" wrap>
      {ALIGN_BUTTONS.map((b) => (
        <Button
          key={b.side}
          size="sm"
          onClick={() => alignSelected(b.side)}
          disabled={alignDisabled}
          title={b.title}
          style={ICON_STYLE}
        >
          {b.label}
        </Button>
      ))}
      <span style={{ width: 8 }} />
      {DISTRIBUTE_BUTTONS.map((b) => (
        <Button
          key={b.axis}
          size="sm"
          onClick={() => distributeSelected(b.axis)}
          disabled={distributeDisabled}
          title={b.title}
          style={ICON_STYLE}
        >
          {b.label}
        </Button>
      ))}
    </HStack>
  );
}
