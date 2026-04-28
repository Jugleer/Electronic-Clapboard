import { useEditorStore } from "./store";
import type { ElementType } from "./types";
import { Button, HStack } from "./ui";

const ADD_BUTTONS: { type: ElementType; label: string }[] = [
  { type: "text", label: "+ Text" },
  { type: "rect", label: "+ Rectangle" },
  { type: "line", label: "+ Line" },
];

const PLACEMENT = { x: 80, y: 80 };

export function Toolbar(): JSX.Element {
  const addElement = useEditorStore((s) => s.addElement);
  return (
    <HStack gap="sm" wrap>
      {ADD_BUTTONS.map((b) => (
        <Button key={b.type} onClick={() => addElement(b.type, PLACEMENT)}>
          {b.label}
        </Button>
      ))}
    </HStack>
  );
}
