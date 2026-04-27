import {
  clampBorder,
  clampGrid,
  DEFAULT_BORDER_WIDTH,
  MAX_BORDER,
  MAX_GRID,
  MIN_BORDER,
  MIN_GRID,
  useGridStore,
} from "./gridStore";

const PRESETS = [4, 8, 10, 16, 20, 32, 50];

export function GridControls(): JSX.Element {
  const spacing = useGridStore((s) => s.spacing);
  const snapEnabled = useGridStore((s) => s.snapEnabled);
  const visible = useGridStore((s) => s.visible);
  const borderWidth = useGridStore((s) => s.borderWidth);
  const setSpacing = useGridStore((s) => s.setSpacing);
  const setSnapEnabled = useGridStore((s) => s.setSnapEnabled);
  const setVisible = useGridStore((s) => s.setVisible);
  const setBorderWidth = useGridStore((s) => s.setBorderWidth);

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(e) => setSnapEnabled(e.target.checked)}
        />
        snap
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        show grid
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        spacing{" "}
        <input
          type="number"
          min={MIN_GRID}
          max={MAX_GRID}
          step={1}
          list="grid-presets"
          value={spacing}
          onChange={(e) => setSpacing(clampGrid(Number(e.target.value)))}
          style={{ width: 60 }}
        />{" "}
        px
        <datalist id="grid-presets">
          {PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label
        style={{ display: "flex", alignItems: "center", gap: 4 }}
        title="Adds a staging area outside the rasterised frame. Elements
in the inner frame are dimmed to 50% opacity for clarity."
      >
        <input
          type="checkbox"
          checked={borderWidth > 0}
          onChange={(e) =>
            setBorderWidth(e.target.checked ? DEFAULT_BORDER_WIDTH : 0)
          }
        />
        border
      </label>
      {borderWidth > 0 ? (
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          width{" "}
          <input
            type="number"
            min={MIN_BORDER}
            max={MAX_BORDER}
            step={1}
            value={borderWidth}
            onChange={(e) => setBorderWidth(clampBorder(Number(e.target.value)))}
            style={{ width: 60 }}
          />{" "}
          px
        </label>
      ) : null}
    </div>
  );
}
