/**
 * Interactive scene graph. Konva is responsible for hit-testing, drag,
 * the resize Transformer (text/rect), and the endpoint anchors (line).
 * The bytes-on-the-wire path does NOT come through here — it goes
 * through `rasterizeElements()` against a separate offscreen 2D canvas.
 */

import Konva from "konva";
import { useEffect, useRef, useState } from "react";
import {
  Circle as KCircle,
  Layer,
  Line as KLine,
  Rect as KRect,
  Stage,
  Text as KText,
  Transformer,
} from "react-konva";

import { HEIGHT, WIDTH } from "../frameFormat";
import { snap, useGridStore } from "./gridStore";
import { useEditorStore } from "./store";
import { TextEditorOverlay } from "./TextEditorOverlay";
import { cssFontFamily } from "./types";
import type { Element, LineElement, RectElement, TextElement } from "./types";

interface EditorCanvasProps {
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}

const ANCHOR_RADIUS = 6;

interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function EditorCanvas({
  stageRef,
  containerRef,
  editingId,
  setEditingId,
}: EditorCanvasProps): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectMany = useEditorStore((s) => s.selectMany);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const resizeElement = useEditorStore((s) => s.resizeElement);
  const updateLine = useEditorStore((s) => s.updateLine);
  const gridSpacing = useGridStore((s) => s.spacing);
  const snapEnabled = useGridStore((s) => s.snapEnabled);
  const gridVisible = useGridStore((s) => s.visible);
  const snapXY = (p: { x: number; y: number }) => ({
    x: snap(p.x, gridSpacing, snapEnabled),
    y: snap(p.y, gridSpacing, snapEnabled),
  });

  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const selected = elements.filter((e) => selectedIds.includes(e.id));
  const lineSelected =
    selected.length === 1 && selected[0].type === "line" ? selected[0] : null;

  // Attach the Transformer to every selected non-line node. Lines use
  // their own endpoint anchors instead.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (editingId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes: Konva.Node[] = [];
    for (const el of selected) {
      if (el.locked || el.type === "line") continue;
      const n = nodeRefs.current.get(el.id);
      if (n) nodes.push(n);
    }
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, editingId, elements, selected]);

  const onStageMouseDown: NonNullable<
    React.ComponentProps<typeof Stage>["onMouseDown"]
  > = (e) => {
    if (e.target !== e.target.getStage()) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    if (!e.evt.shiftKey) {
      clearSelection(); // also clears isolatedGroupId
    }
    setEditingId(null);
    marqueeStartRef.current = pos;
    setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const onStageMouseMove: NonNullable<
    React.ComponentProps<typeof Stage>["onMouseMove"]
  > = (e) => {
    if (!marqueeStartRef.current) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const start = marqueeStartRef.current;
    setMarquee({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    });
  };

  const onStageMouseUp: NonNullable<
    React.ComponentProps<typeof Stage>["onMouseUp"]
  > = () => {
    if (!marqueeStartRef.current) return;
    const m = marquee;
    marqueeStartRef.current = null;
    setMarquee(null);
    if (!m || (m.w < 3 && m.h < 3)) return;
    const hits = elements
      .filter((el) => {
        const r = boundingBox(el);
        return (
          r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y
        );
      })
      .map((el) => el.id);
    if (hits.length > 0) selectMany(hits);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        border: "1px solid #888",
        background: "white",
        maxWidth: "100%",
      }}
    >
      <Stage
        ref={stageRef}
        width={WIDTH}
        height={HEIGHT}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onTouchStart={(e) => onStageMouseDown(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onTouchMove={(e) => onStageMouseMove(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onTouchEnd={() => onStageMouseUp({} as Konva.KonvaEventObject<MouseEvent>)}
      >
        {gridVisible ? (
          <Layer listening={false}>
            <GridDots spacing={gridSpacing} />
          </Layer>
        ) : null}
        <Layer>
          {elements.map((el) => (
            <ElementNode
              key={el.id}
              el={el}
              isSelected={selectedIds.includes(el.id)}
              isEditing={el.id === editingId}
              registerRef={(node) => {
                if (node) nodeRefs.current.set(el.id, node);
                else nodeRefs.current.delete(el.id);
              }}
              onSelect={(additive) => selectElement(el.id, additive)}
              onMoveCommit={(rawPos) => {
                const store = useEditorStore.getState();
                // Snap the dragged element's *target* position, then apply
                // the SAME integer delta to every co-mover. This avoids
                // (a) fractional-pixel drift from Konva's float
                // `node.x()` when snap is off, and (b) every-mover-
                // independently-snapping to its own grid line, which
                // would drift the group's relative geometry.
                const snappedTarget = snapXY(rawPos);
                const dx = Math.round(snappedTarget.x - el.x);
                const dy = Math.round(snappedTarget.y - el.y);
                if (dx === 0 && dy === 0) return;
                const movers = computeMovers(
                  store.elements,
                  store.selectedIds,
                  el.id,
                );
                for (const id of movers) {
                  const m = store.elements.find((e) => e.id === id);
                  if (!m || m.locked) continue;
                  store.moveElement(m.id, { x: m.x + dx, y: m.y + dy });
                }
              }}
              onResizeCommit={(box) =>
                resizeElement(el.id, {
                  x: snap(box.x, gridSpacing, snapEnabled),
                  y: snap(box.y, gridSpacing, snapEnabled),
                  w: snap(box.w, gridSpacing, snapEnabled),
                  h: snap(box.h, gridSpacing, snapEnabled),
                })
              }
              onRotateCommit={(rotation) =>
                useEditorStore.getState().rotateElement(el.id, rotation)
              }
              onBeginEdit={() => {
                if (el.type === "text" && !el.locked) setEditingId(el.id);
              }}
              onIsolateMember={() => {
                // Double-click on a grouped element on the canvas →
                // enter isolation for its group and select just it.
                if (!el.groupId) return;
                const store = useEditorStore.getState();
                store.isolateGroup(el.groupId);
                store.selectElement(el.id);
              }}
            />
          ))}
          {lineSelected && !lineSelected.locked ? (
            <LineEndpoints
              line={lineSelected}
              onMoveStart={(pos) => {
                const p = snapXY(pos);
                updateLine(lineSelected.id, p);
              }}
              onMoveEnd={(pos) => {
                const p = snapXY(pos);
                updateLine(lineSelected.id, {
                  w: p.x - lineSelected.x,
                  h: p.y - lineSelected.y,
                });
              }}
            />
          ) : null}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={3}
            rotateAnchorOffset={28}
            keepRatio={false}
            ignoreStroke
            anchorSize={10}
            borderStroke="#0a7"
            anchorStroke="#0a7"
            anchorFill="#fff"
            boundBoxFunc={(_oldBox, newBox) => ({
              ...newBox,
              width: Math.max(1, newBox.width),
              height: Math.max(1, newBox.height),
            })}
          />
          {marquee ? (
            <KRect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              stroke="#0a7"
              strokeWidth={1}
              dash={[4, 4]}
              fill="rgba(0, 170, 119, 0.07)"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
      {editingId ? (
        <TextEditorOverlay
          elementId={editingId}
          stageRef={stageRef}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}

function GridDots({ spacing }: { spacing: number }): JSX.Element {
  // Draw grid intersections as 1 px dots. At small spacings this gets
  // dense (10 px → 38400 dots) but Konva handles it; the layer is
  // listening:false so it doesn't affect hit-testing.
  const cols = Math.floor(WIDTH / spacing);
  const rows = Math.floor(HEIGHT / spacing);
  const points: number[] = [];
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      points.push(i * spacing, j * spacing);
    }
  }
  // Render via a single Path of `M x y h 1` — but Konva.Line's
  // dotted-points rendering is overkill. Use small KCircles batched
  // through a Konva.Shape sceneFunc for efficiency.
  return (
    <KLine
      points={points}
      stroke="#bbb"
      strokeWidth={0.5}
      lineCap="round"
      lineJoin="round"
      // Drawing per-point dots: use the points list with a custom
      // sceneFunc would be cleanest, but `points` of length 2 = a
      // single segment. Instead, scatter via Konva.Group of dots is
      // overkill for thousands. The dotted-line trick: use a closed
      // path through every point with 0-length segments doesn't render.
      // Simpler & cheap enough at 800x480 grid sizes: visible only.
      tension={0}
      // Hack: forcing dash pattern of [0, spacing*2] effectively shows
      // a dot every other point; not what we want. Use sceneFunc.
      sceneFunc={(ctx, shape) => {
        ctx.fillStyle = "#bbb";
        for (let i = 0; i < points.length; i += 2) {
          ctx.fillRect(points[i], points[i + 1], 1, 1);
        }
        ctx.fillStrokeShape(shape);
      }}
    />
  );
}

function computeMovers(
  elements: Element[],
  selectedIds: string[],
  draggedId: string,
): string[] {
  // The dragged element itself, plus any element that's either
  // multi-selected with it or shares its group.
  const result = new Set<string>([draggedId]);
  const dragged = elements.find((e) => e.id === draggedId);
  if (selectedIds.includes(draggedId)) {
    for (const id of selectedIds) result.add(id);
  }
  if (dragged?.groupId) {
    for (const el of elements) if (el.groupId === dragged.groupId) result.add(el.id);
  }
  return Array.from(result);
}

function boundingBox(el: Element): { x: number; y: number; w: number; h: number } {
  if (el.type === "line") {
    const x1 = el.x;
    const y1 = el.y;
    const x2 = el.x + el.w;
    const y2 = el.y + el.h;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(el.w) || 1,
      h: Math.abs(el.h) || 1,
    };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

interface ElementNodeProps {
  el: Element;
  isSelected: boolean;
  isEditing: boolean;
  registerRef: (node: Konva.Node | null) => void;
  onSelect: (additive: boolean) => void;
  onMoveCommit: (pos: { x: number; y: number }) => void;
  onResizeCommit: (box: { x: number; y: number; w: number; h: number }) => void;
  onRotateCommit: (rotation: number) => void;
  onBeginEdit: () => void;
  onIsolateMember: () => void;
}

function ElementNode({
  el,
  isSelected,
  isEditing,
  registerRef,
  onSelect,
  onMoveCommit,
  onResizeCommit,
  onRotateCommit,
  onBeginEdit,
  onIsolateMember,
}: ElementNodeProps): JSX.Element {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const setRef = (node: Konva.Node | null) => {
    if (node) registerRef(node);
    else registerRef(null);
  };

  const common = {
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    draggable: !el.locked,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect(e.evt.shiftKey);
    },
    onTouchStart: (e: Konva.KonvaEventObject<TouchEvent>) => {
      e.cancelBubble = true;
      onSelect(false);
    },
    onDragStart: () => {
      dragStartRef.current = { x: el.x, y: el.y };
    },
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      const start = dragStartRef.current;
      if (!start) return;
      // Shift held: lock movement to the dominant axis.
      if (e.evt.shiftKey) {
        const dx = Math.abs(e.target.x() - start.x);
        const dy = Math.abs(e.target.y() - start.y);
        if (dx >= dy) e.target.y(start.y);
        else e.target.x(start.x);
      }
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      dragStartRef.current = null;
      // Konva leaves the node at the raw drag-stop position, which
      // can be fractional. Round here so the store sees integers and
      // the multi-mover delta math is exact.
      const x = Math.round(e.target.x());
      const y = Math.round(e.target.y());
      e.target.x(x);
      e.target.y(y);
      onMoveCommit({ x, y });
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const rotation = node.rotation();
      node.scaleX(1);
      node.scaleY(1);
      if (el.locked) {
        node.x(el.x);
        node.y(el.y);
        node.rotation(el.rotation);
        node.getLayer()?.batchDraw();
        return;
      }
      const newW = Math.max(1, el.w * scaleX);
      const newH = Math.max(1, el.h * scaleY);
      onResizeCommit({ x: node.x(), y: node.y(), w: newW, h: newH });
      if (rotation !== el.rotation) onRotateCommit(rotation);
    },
  };

  const onDblNonText = () => {
    // Grouped element double-clicked outside isolation → enter the group.
    const store = useEditorStore.getState();
    if (el.groupId && store.isolatedGroupId !== el.groupId) {
      onIsolateMember();
    }
  };

  if (el.type === "rect") {
    const r = el as RectElement;
    return (
      <KRect
        ref={setRef}
        {...common}
        width={r.w}
        height={r.h}
        fill={r.filled ? "black" : undefined}
        stroke={r.filled ? undefined : "black"}
        strokeWidth={r.filled ? 0 : r.strokeWidth}
        onDblClick={onDblNonText}
        onDblTap={onDblNonText}
      />
    );
  }
  if (el.type === "line") {
    const l = el as LineElement;
    return (
      <KLine
        ref={setRef}
        points={[l.x, l.y, l.x + l.w, l.y + l.h]}
        stroke="black"
        strokeWidth={l.strokeWidth}
        hitStrokeWidth={Math.max(12, l.strokeWidth + 8)}
        draggable={!l.locked}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          onSelect(e.evt.shiftKey);
        }}
        onTouchStart={(e) => {
          e.cancelBubble = true;
          onSelect(false);
        }}
        onDragStart={() => {
          dragStartRef.current = { x: 0, y: 0 };
        }}
        onDragMove={(e) => {
          const start = dragStartRef.current;
          if (!start) return;
          if (e.evt.shiftKey) {
            const dx = Math.abs(e.target.x() - start.x);
            const dy = Math.abs(e.target.y() - start.y);
            if (dx >= dy) e.target.y(start.y);
            else e.target.x(start.x);
          }
        }}
        onDragEnd={(e) => {
          const dx = Math.round(e.target.x());
          const dy = Math.round(e.target.y());
          e.target.x(0);
          e.target.y(0);
          dragStartRef.current = null;
          onMoveCommit({ x: l.x + dx, y: l.y + dy });
        }}
        onDblClick={onDblNonText}
        onDblTap={onDblNonText}
      />
    );
    // isSelected is consumed by the parent (LineEndpoints).
  }

  const t = el as TextElement;
  return (
    <KText
      ref={setRef}
      {...common}
      width={t.w}
      height={t.h}
      text={isEditing ? "" : t.text}
      fontSize={t.fontSize}
      fontFamily={cssFontFamily(t.fontFamily)}
      fontStyle={[t.bold ? "bold" : "", t.italic ? "italic" : ""].join(" ").trim() || "normal"}
      align={t.align}
      verticalAlign={t.verticalAlign}
      fill="black"
      onDblClick={() => {
        const store = useEditorStore.getState();
        if (el.groupId && store.isolatedGroupId !== el.groupId) {
          onIsolateMember();
          return;
        }
        onBeginEdit();
      }}
      onDblTap={() => {
        const store = useEditorStore.getState();
        if (el.groupId && store.isolatedGroupId !== el.groupId) {
          onIsolateMember();
          return;
        }
        onBeginEdit();
      }}
    />
  );
  void isSelected;
}

interface LineEndpointsProps {
  line: LineElement;
  onMoveStart: (pos: { x: number; y: number }) => void;
  onMoveEnd: (pos: { x: number; y: number }) => void;
}

function LineEndpoints({ line, onMoveStart, onMoveEnd }: LineEndpointsProps): JSX.Element {
  const constrain = (
    e: Konva.KonvaEventObject<DragEvent>,
    anchorX: number,
    anchorY: number,
  ): { x: number; y: number } => {
    let x = e.target.x();
    let y = e.target.y();
    if (e.evt.shiftKey) {
      const dx = Math.abs(x - anchorX);
      const dy = Math.abs(y - anchorY);
      if (dx >= dy) y = anchorY;
      else x = anchorX;
      e.target.x(x);
      e.target.y(y);
    }
    return { x, y };
  };

  return (
    <>
      <KCircle
        x={line.x}
        y={line.y}
        radius={ANCHOR_RADIUS}
        fill="#fff"
        stroke="#0a7"
        strokeWidth={2}
        draggable
        onDragMove={(e) => {
          const p = constrain(e, line.x + line.w, line.y + line.h);
          onMoveStart(p);
        }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
        }}
        onTouchStart={(e) => {
          e.cancelBubble = true;
        }}
      />
      <KCircle
        x={line.x + line.w}
        y={line.y + line.h}
        radius={ANCHOR_RADIUS}
        fill="#fff"
        stroke="#0a7"
        strokeWidth={2}
        draggable
        onDragMove={(e) => {
          const p = constrain(e, line.x, line.y);
          onMoveEnd(p);
        }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
        }}
        onTouchStart={(e) => {
          e.cancelBubble = true;
        }}
      />
    </>
  );
}
