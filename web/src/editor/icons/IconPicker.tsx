import { useEffect, useMemo, useState } from "react";

import { useEditorStore } from "../store";
import {
  getCachedIcon,
  loadIcon,
  preloadCategory,
} from "./loader";
import {
  ICON_CATEGORIES,
  ICON_REGISTRY,
  type IconCategory,
  type IconRegistryEntry,
} from "./registry";

const PLACEMENT = { x: 80, y: 80 };

/**
 * Vertical accordion. Film opens by default; the rest fetch their PNGs
 * the first time they expand. A search box across the top filters every
 * category by label and forces lazy preload of any category that has a
 * matching hit so the user sees thumbnails, not blanks.
 */
export function IconPicker(): JSX.Element {
  const addElement = useEditorStore((s) => s.addElement);
  const [openCategories, setOpenCategories] = useState<Set<IconCategory>>(
    () => new Set(["film"]),
  );
  const [loaded, setLoaded] = useState<Set<IconCategory>>(() => new Set());
  const [query, setQuery] = useState("");

  // Eagerly preload film on mount so the first interaction is instant.
  useEffect(() => {
    void preloadCategory("film").then(() =>
      setLoaded((prev) => new Set(prev).add("film")),
    );
  }, []);

  // Whenever a category is toggled open, kick off its preload.
  useEffect(() => {
    for (const c of openCategories) {
      if (loaded.has(c)) continue;
      void preloadCategory(c).then(() =>
        setLoaded((prev) => new Set(prev).add(c)),
      );
    }
  }, [openCategories, loaded]);

  // Search hits force a load of every category that contains a match.
  const matches = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.trim().toLowerCase();
    return ICON_REGISTRY.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!matches) return;
    const cats = new Set<IconCategory>();
    for (const e of matches) cats.add(e.category);
    for (const c of cats) {
      if (loaded.has(c)) continue;
      void preloadCategory(c).then(() =>
        setLoaded((prev) => new Set(prev).add(c)),
      );
    }
  }, [matches, loaded]);

  const onAdd = (entry: IconRegistryEntry) => {
    // Make sure the icon is in the cache before the rasteriser tries to
    // draw it. The rasteriser is sync so a load-after-add miss would
    // briefly show paper-on-paper. Fire-and-forget is fine here — the
    // user can click again if the network's slow.
    void loadIcon(entry.id);
    addElement("icon", PLACEMENT, { src: entry.id });
  };

  const toggle = (cat: IconCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div
      style={{
        border: "1px solid #ccc",
        background: "#fafafa",
        padding: 8,
        minWidth: 260,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Icons</div>
      <input
        type="search"
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", padding: "4px 6px", marginBottom: 8 }}
      />
      {matches !== null ? (
        <IconGrid entries={matches} onAdd={onAdd} loadedFlag={loaded} />
      ) : (
        ICON_CATEGORIES.map((c) => {
          const isOpen = openCategories.has(c.id);
          const entries = ICON_REGISTRY.filter((e) => e.category === c.id);
          return (
            <div key={c.id} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 6px",
                  background: isOpen ? "#eef" : "transparent",
                  border: "1px solid #ccc",
                  borderRadius: 3,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {isOpen ? "▾" : "▸"} {c.label}{" "}
                <span style={{ color: "#888", fontWeight: 400 }}>
                  ({entries.length})
                </span>
              </button>
              {isOpen ? (
                <div style={{ marginTop: 4 }}>
                  <IconGrid
                    entries={entries}
                    onAdd={onAdd}
                    loadedFlag={loaded}
                  />
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function IconGrid({
  entries,
  onAdd,
  loadedFlag,
}: {
  entries: IconRegistryEntry[];
  onAdd: (e: IconRegistryEntry) => void;
  loadedFlag: Set<IconCategory>;
}): JSX.Element {
  if (entries.length === 0) {
    return <div style={{ color: "#888", padding: 4 }}>No matches.</div>;
  }
  return (
    <div
      style={{
        display: "grid",
        // Auto-fill at a fixed 28 px cell (≈1/4 of the original 5-col
        // tile width) so the picker stays compact alongside the
        // properties / layer panels.
        gridTemplateColumns: "repeat(auto-fill, 31px)",
        gap: 3,
      }}
    >
      {entries.map((e) => {
        const ready =
          loadedFlag.has(e.category) || getCachedIcon(e.id) !== undefined;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onAdd(e)}
            title={e.label}
            style={{
              width: 31,
              height: 31,
              padding: 2,
              background: "white",
              border: "1px solid #ccc",
              borderRadius: 3,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {ready ? (
              <img
                src={e.src}
                alt={e.label}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
                draggable={false}
              />
            ) : (
              <span style={{ color: "#bbb", fontSize: 11 }}>…</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
