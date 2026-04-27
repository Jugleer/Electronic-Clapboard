/**
 * Konva.Text has no native input. The standard pattern is an HTML
 * `<textarea>` overlaid on the stage at the element's screen position
 * during edit mode, then blur-to-commit. The Konva.Text behind the
 * overlay is hidden (`text=""`) while editing so glyphs don't double-up.
 */

import Konva from "konva";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEditorStore } from "./store";
import { cssFontFamily } from "./types";
import type { TextElement } from "./types";

interface TextEditorOverlayProps {
  elementId: string;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  onClose: () => void;
}

export function TextEditorOverlay({
  elementId,
  stageRef,
  onClose,
}: TextEditorOverlayProps): JSX.Element | null {
  const element = useEditorStore((s) =>
    s.elements.find((e) => e.id === elementId && e.type === "text"),
  ) as TextElement | undefined;
  const updateText = useEditorStore((s) => s.updateText);

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState<string>(element?.text ?? "");

  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, []);

  useEffect(() => {
    if (element) setDraft(element.text);
    // Only re-sync on element id, not on every text edit.
  }, [elementId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!element) return null;
  const stage = stageRef.current;
  const scale = stage?.scaleX() ?? 1;

  const commit = () => {
    if (draft !== element.text) updateText(elementId, { text: draft });
    onClose();
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        left: element.x * scale,
        top: element.y * scale,
        width: element.w * scale,
        height: element.h * scale,
        margin: 0,
        padding: 0,
        border: "1px dashed #0a7",
        background: "rgba(255,255,255,0.95)",
        outline: "none",
        resize: "none",
        overflow: "hidden",
        fontSize: element.fontSize * scale,
        fontFamily: cssFontFamily(element.fontFamily),
        fontWeight: element.bold ? "bold" : "normal",
        fontStyle: element.italic ? "italic" : "normal",
        textAlign: element.align,
        lineHeight: 1.2,
        color: "black",
      }}
    />
  );
}
