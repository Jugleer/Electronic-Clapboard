// @vitest-environment jsdom

import "./testSetup";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ImagePrepareModal } from "./ImagePrepareModal";
import { paletteFor } from "./themeStore";

const PALETTE = paletteFor("light");

function fakeFile(name: string): File {
  return new File(["bytes"], name, { type: "image/png" });
}

afterEach(cleanup);

describe("ImagePrepareModal", () => {
  it("renders one row per file with the filename stem as default name", () => {
    render(
      <ImagePrepareModal
        files={[fakeFile("studio-blue.png"), fakeFile("warehouse.jpeg")]}
        palette={PALETTE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/name for studio-blue\.png/i) as HTMLInputElement)
        .value,
    ).toBe("studio-blue");
    expect(
      (screen.getByLabelText(/name for warehouse\.jpeg/i) as HTMLInputElement)
        .value,
    ).toBe("warehouse");
  });

  it("defaults every row to FS-dither", () => {
    render(
      <ImagePrepareModal
        files={[fakeFile("a.png"), fakeFile("b.png")]}
        palette={PALETTE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const fsRadios = screen.getAllByLabelText(/dither \(Floyd-Steinberg\)/i);
    expect(fsRadios.length).toBe(2);
    fsRadios.forEach((r) => expect((r as HTMLInputElement).checked).toBe(true));
  });

  it("emits per-file decisions on confirm", () => {
    const onConfirm = vi.fn();
    const a = fakeFile("a.png");
    const b = fakeFile("b.png");
    render(
      <ImagePrepareModal
        files={[a, b]}
        palette={PALETTE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    // Switch row B to threshold; rename row A.
    fireEvent.change(screen.getByLabelText(/name for a\.png/i), {
      target: { value: "renamed-a" },
    });
    fireEvent.click(
      screen.getAllByLabelText(/threshold \(no dither\)/i)[1],
    );
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const decisions = onConfirm.mock.calls[0][0];
    expect(decisions).toEqual([
      { file: a, name: "renamed-a", algorithm: "fs" },
      { file: b, name: "b",         algorithm: "threshold" },
    ]);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ImagePrepareModal
        files={[fakeFile("a.png")]}
        palette={PALETTE}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("trims names to the 32-char wire-side limit", () => {
    const onConfirm = vi.fn();
    render(
      <ImagePrepareModal
        files={[fakeFile("a.png")]}
        palette={PALETTE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/name for a\.png/i) as HTMLInputElement;
    // The input has maxLength=32 — the browser enforces; also the
    // emitted decision should never carry > 32 chars.
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: /^upload all$/i }));
    expect(onConfirm.mock.calls[0][0][0].name.length).toBeLessThanOrEqual(32);
  });

  it("renders nothing when there are no files", () => {
    const { container } = render(
      <ImagePrepareModal
        files={[]}
        palette={PALETTE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("disables 'Upload all' when any name is empty", () => {
    const onConfirm = vi.fn();
    render(
      <ImagePrepareModal
        files={[fakeFile("a.png")]}
        palette={PALETTE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name for a\.png/i), {
      target: { value: "" },
    });
    const upload = screen.getByRole("button", { name: /^upload all$/i }) as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    fireEvent.click(upload);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a thumbnail preview for each file via URL.createObjectURL", () => {
    // jsdom doesn't ship URL.createObjectURL, so the modal guards
    // its preview behind a typeof check. We polyfill it here so we
    // can assert the <img> renders with the blob URL — which is the
    // only thing the modal does with the File at preview time.
    const orig = URL.createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = vi.fn(() => "blob:fake-url");
    try {
      render(
        <ImagePrepareModal
          files={[fakeFile("a.png")]}
          palette={PALETTE}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const thumb = screen.getByAltText(/preview for a\.png/i) as HTMLImageElement;
      expect(thumb.src).toBe("blob:fake-url");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = orig;
    }
  });
});
