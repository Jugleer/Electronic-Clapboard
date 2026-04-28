/**
 * Shared UI primitives + design tokens.
 *
 * The editor's chrome accumulated ad-hoc inline styles across a dozen
 * components — every panel had its own border + padding + font-size,
 * every button reinvented padding + radius + hover, etc. This file
 * consolidates the shared visual language so every surface looks
 * like it belongs to the same product.
 *
 * Tokens:
 *   `space`  — 4 / 8 / 12 / 16 / 24 px scale.
 *   `fs`     — 11 (caption) / 13 (body) / 14 (label/button) / 18 (h2) / 22 (h1).
 *   `radius` — 3 (default) / 6 (panels).
 *   `shadow` — light-mode panel elevation (none in dark — shadows on
 *              dark surfaces look muddy).
 *
 * Components:
 *   `<Button>`   — single button family (default / primary / ghost /
 *                  toggle variants), consistent hover/active/disabled.
 *   `<Input>`    — themed text/number input.
 *   `<Select>`   — themed select.
 *   `<Panel>`    — bordered surface for floating sections.
 *   `<HStack>` / `<VStack>` — flex helpers with the standard gap scale.
 *
 * No external dep, no CSS-in-JS lib. Inline styles + the existing
 * `usePalette` hook. Components accept a `style` prop for one-off
 * tweaks but default styling should cover ~90% of call sites.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { usePalette } from "./themeStore";
import { fs, panelShadow, radius, space } from "./ui-tokens";

// ─── Button ────────────────────────────────────────────────────────

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Visually selected (toggle-pressed) state. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", active = false, style, children, ...rest },
  ref,
) {
  const palette = usePalette();
  const padding =
    size === "sm" ? "3px 8px" : size === "lg" ? "8px 16px" : "5px 12px";
  const fontSize =
    size === "sm" ? fs.body : size === "lg" ? fs.button + 2 : fs.button;
  const fontWeight = size === "lg" ? 600 : 500;

  let bg = palette.buttonBg;
  let color = palette.text;
  let border = palette.buttonBorder;
  if (variant === "primary") {
    bg = palette.link;
    color = "#ffffff";
    border = palette.link;
  } else if (variant === "ghost") {
    bg = "transparent";
    border = "transparent";
  } else if (variant === "danger") {
    color = palette.statusError;
  }
  if (active) {
    bg = palette.buttonBgActive;
    border = palette.link;
  }

  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      style={{
        padding,
        fontSize,
        fontWeight,
        background: bg,
        color,
        border: `1px solid ${border}`,
        borderRadius: radius.default,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        transition: "background 80ms ease, border-color 80ms ease",
        lineHeight: 1.2,
        fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

// ─── Input / Select ────────────────────────────────────────────────

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { style, ...rest },
  ref,
) {
  const palette = usePalette();
  return (
    <input
      ref={ref}
      {...rest}
      style={{
        padding: "4px 8px",
        fontSize: fs.body,
        background: palette.inputBg,
        color: palette.text,
        border: `1px solid ${palette.inputBorder}`,
        borderRadius: radius.default,
        fontFamily: "inherit",
        ...style,
      }}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ style, children, ...rest }, ref) {
    const palette = usePalette();
    return (
      <select
        ref={ref}
        {...rest}
        style={{
          padding: "3px 6px",
          fontSize: fs.body,
          background: palette.inputBg,
          color: palette.text,
          border: `1px solid ${palette.inputBorder}`,
          borderRadius: radius.default,
          fontFamily: "inherit",
          ...style,
        }}
      >
        {children}
      </select>
    );
  },
);

// ─── Panel ─────────────────────────────────────────────────────────

export interface PanelProps {
  title?: ReactNode;
  /** Right-aligned action(s) in the title row, e.g. add / import buttons. */
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

export function Panel({ title, actions, children, style }: PanelProps): JSX.Element {
  const palette = usePalette();
  return (
    <div
      style={{
        background: palette.panelBg,
        color: palette.text,
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: radius.panel,
        padding: space.md,
        boxShadow: panelShadow(palette),
        fontSize: fs.body,
        ...style,
      }}
    >
      {title !== undefined ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: space.sm,
            marginBottom: space.sm,
          }}
        >
          <span style={{ fontWeight: 600, color: palette.textHeading, fontSize: fs.label }}>
            {title}
          </span>
          {actions ? (
            <div style={{ display: "flex", gap: space.xs }}>{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ─── Stack helpers ─────────────────────────────────────────────────

export interface StackProps {
  gap?: keyof typeof space;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}

export function HStack({
  gap = "sm",
  align = "center",
  justify,
  wrap = false,
  children,
  style,
}: StackProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: align,
        justifyContent: justify,
        gap: space[gap],
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function VStack({
  gap = "sm",
  align,
  justify,
  children,
  style,
}: StackProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: justify,
        gap: space[gap],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Caption (small muted text) ────────────────────────────────────

export function Caption({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  const palette = usePalette();
  return (
    <span style={{ fontSize: fs.caption, color: palette.textMuted, ...style }}>
      {children}
    </span>
  );
}
