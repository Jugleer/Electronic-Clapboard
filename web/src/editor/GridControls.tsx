import { clampGrid, MAX_GRID, MIN_GRID, useGridStore } from "./gridStore";

const PRESETS = [4, 8, 10, 16, 20, 32, 50];

export function GridControls(): JSX.Element {
  const spacing = useGridStore((s) => s.spacing);
  const snapEnabled = useGridStore((s) => s.snapEnabled);
  const visible = useGridStore((s) => s.visible);
  const setSpacing = useGridStore((s) => s.setSpacing);
  const setSnapEnabled = useGridStore((s) => s.setSnapEnabled);
  const setVisible = useGridStore((s) => s.setVisible);

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
    </div>
  );
}
