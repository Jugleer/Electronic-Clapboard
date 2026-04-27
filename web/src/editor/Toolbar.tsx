import { useEditorStore } from "./store";
import type { ElementType } from "./types";

const ADD_BUTTONS: { type: ElementType; label: string }[] = [
  { type: "text", label: "+ Text" },
  { type: "rect", label: "+ Rectangle" },
  { type: "line", label: "+ Line" },
];

const PLACEMENT = { x: 80, y: 80 };

export function Toolbar(): JSX.Element {
  const addElement = useEditorStore((s) => s.addElement);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {ADD_BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          onClick={() => addElement(b.type, PLACEMENT)}
          style={{ padding: "6px 12px", fontSize: 14 }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
