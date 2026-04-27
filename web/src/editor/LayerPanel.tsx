import type { MouseEvent as ReactMouseEvent } from "react";

import { findIcon } from "./icons/registry";
import { useEditorStore } from "./store";
import type { Element, GroupId } from "./types";

function describe(el: Element): string {
  if (el.type === "text") {
    const preview = el.text.split("\n")[0].slice(0, 20);
    return `Text — "${preview || "…"}"`;
  }
  if (el.type === "rect") return el.filled ? "Rect (filled)" : "Rect";
  if (el.type === "line") return "Line";
  if (el.type === "image") return el.invert ? "Image (inverted)" : "Image";
  const entry = findIcon(el.src);
  const label = entry?.label ?? el.src;
  return el.invert ? `Icon — ${label} (inverted)` : `Icon — ${label}`;
}

interface Row {
  kind: "group-header" | "member" | "loose";
  el?: Element;
  groupId?: GroupId;
  groupLabel?: string;
  groupMembers?: Element[];
}

/**
 * Build a top-down render list. The display order is z-order top-down
 * (last in `elements` = topmost). Groups are kept contiguous: each
 * group's first-encountered member (in top-down order) anchors a
 * "group header" row; the rest of the group's members render
 * immediately after that header, in their own top-down z-order.
 */
function buildRows(elements: Element[]): Row[] {
  const top = [...elements].reverse();
  const rows: Row[] = [];
  const seenGroups = new Set<GroupId>();
  // Stable group numbering: by first-appearance index in the original
  // (bottom-up) elements array, so "Group 1" is the first one created.
  const groupNumber = new Map<GroupId, number>();
  let nextNum = 1;
  for (const el of elements) {
    if (el.groupId && !groupNumber.has(el.groupId)) {
      groupNumber.set(el.groupId, nextNum++);
    }
  }
  for (const el of top) {
    if (!el.groupId) {
      rows.push({ kind: "loose", el });
      continue;
    }
    if (seenGroups.has(el.groupId)) continue;
    seenGroups.add(el.groupId);
    const members = top.filter((m) => m.groupId === el.groupId);
    rows.push({
      kind: "group-header",
      groupId: el.groupId,
      groupLabel: `Group ${groupNumber.get(el.groupId)}`,
      groupMembers: members,
    });
    for (const m of members) {
      rows.push({ kind: "member", el: m, groupId: el.groupId });
    }
  }
  return rows;
}

export function LayerPanel(): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const isolatedGroupId = useEditorStore((s) => s.isolatedGroupId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectMany = useEditorStore((s) => s.selectMany);
  const deleteElement = useEditorStore((s) => s.deleteElement);
  const setLocked = useEditorStore((s) => s.setLocked);
  const reorderLayer = useEditorStore((s) => s.reorderLayer);
  const isolateGroup = useEditorStore((s) => s.isolateGroup);
  const ungroupSelected = useEditorStore((s) => s.ungroupSelected);

  const rows = buildRows(elements);
  const selectedSet = new Set(selectedIds);

  return (
    <div
      style={{
        border: "1px solid #ccc",
        background: "#fafafa",
        padding: 8,
        minWidth: 280,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Layers</div>
      {rows.length === 0 ? (
        <div style={{ color: "#888" }}>No elements yet.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => {
            if (row.kind === "group-header") {
              const gid = row.groupId!;
              const isIsolated = isolatedGroupId === gid;
              const memberIds = row.groupMembers!.map((m) => m.id);
              const allSelected = memberIds.every((i) => selectedSet.has(i));
              return (
                <li
                  key={`g-${gid}`}
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                    padding: "4px 6px",
                    background: allSelected
                      ? "#cef"
                      : isIsolated
                        ? "#ffe9b8"
                        : "#eef",
                    borderRadius: 3,
                    cursor: "pointer",
                    fontWeight: 600,
                    borderLeft: "3px solid #58a",
                  }}
                  onClick={() => {
                    isolateGroup(null);
                    selectMany(memberIds);
                  }}
                  onDoubleClick={() => isolateGroup(gid)}
                  title="Click: select group. Double-click: enter group (edit members individually)."
                >
                  <span style={{ flex: 1 }}>
                    {row.groupLabel}
                    {isIsolated ? " — editing" : ""}
                  </span>
                  <button
                    type="button"
                    title="Ungroup"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectMany(memberIds);
                      ungroupSelected();
                    }}
                    style={{ padding: "0 6px" }}
                  >
                    ungroup
                  </button>
                </li>
              );
            }
            const el = row.el!;
            const isSelected = selectedSet.has(el.id);
            const isMember = row.kind === "member";
            return (
              <li
                key={el.id}
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  padding: "4px 6px",
                  paddingLeft: isMember ? 22 : 6,
                  background: isSelected ? "#def" : "transparent",
                  borderRadius: 3,
                  cursor: "pointer",
                  borderLeft: isMember ? "3px solid #cce" : undefined,
                }}
                onClick={(e: ReactMouseEvent) =>
                  selectElement(el.id, e.shiftKey || e.ctrlKey || e.metaKey)
                }
                onDoubleClick={() => {
                  // Double-click a grouped member → enter the group
                  // (isolation) and select just that member.
                  if (el.groupId) {
                    isolateGroup(el.groupId);
                    selectElement(el.id);
                  }
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {describe(el)}
                  {el.locked ? " (locked)" : ""}
                </span>
                <button
                  type="button"
                  title="Move up"
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderLayer(el.id, "up");
                  }}
                  style={{ padding: "0 6px" }}
                >
                  up
                </button>
                <button
                  type="button"
                  title="Move down"
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderLayer(el.id, "down");
                  }}
                  style={{ padding: "0 6px" }}
                >
                  dn
                </button>
                <button
                  type="button"
                  title={el.locked ? "Unlock" : "Lock"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocked(el.id, !el.locked);
                  }}
                  style={{ padding: "0 6px" }}
                >
                  {el.locked ? "unlock" : "lock"}
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteElement(el.id);
                  }}
                  style={{ padding: "0 6px" }}
                  disabled={el.locked}
                >
                  del
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {isolatedGroupId !== null ? (
        <div style={{ marginTop: 8, fontSize: 11, color: "#a60" }}>
          Editing group members individually — click outside the group, press
          Esc, or double-click the group header to exit.
        </div>
      ) : null}
    </div>
  );
}
