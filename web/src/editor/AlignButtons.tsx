import { useEditorStore } from "./store";
import type { AlignSide, DistributeAxis } from "./store";

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

export function AlignButtons(): JSX.Element {
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const alignSelected = useEditorStore((s) => s.alignSelected);
  const distributeSelected = useEditorStore((s) => s.distributeSelected);
  const alignDisabled = selectedCount < 2;
  const distributeDisabled = selectedCount < 3;

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={b.side}
          type="button"
          onClick={() => alignSelected(b.side)}
          disabled={alignDisabled}
          title={b.title}
          style={{ padding: "4px 8px", fontSize: 14, minWidth: 28 }}
        >
          {b.label}
        </button>
      ))}
      <span style={{ width: 8 }} />
      {DISTRIBUTE_BUTTONS.map((b) => (
        <button
          key={b.axis}
          type="button"
          onClick={() => distributeSelected(b.axis)}
          disabled={distributeDisabled}
          title={b.title}
          style={{ padding: "4px 8px", fontSize: 14, minWidth: 28 }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
