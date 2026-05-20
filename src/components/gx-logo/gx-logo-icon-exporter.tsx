"use client";

import { useCallback, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import { Vector2 } from "three";

import { GxLogo } from "./gx-logo";
import type { LogoVariant } from "./constants";

const CAPTURE_SIZE = 1024;
const SETTLE_FRAMES = 90;

const FAVICON_X_MAX = 48;

export const ICON_EXPORT_SIZES = [
  { label: "favicon-16", size: 16 },
  { label: "favicon-32", size: 32 },
  { label: "favicon-48", size: 48 },
  { label: "apple-touch-icon", size: 180 },
  { label: "pwa-192", size: 192 },
  { label: "pwa-512", size: 512 },
  { label: "app-store", size: 1024 },
] as const;

export type IconExportBackground = "transparent" | "light" | "dark";

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function compositeWithBackground(
  source: HTMLCanvasElement,
  size: number,
  background: IconExportBackground,
): string {
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");

  if (background === "light") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
  } else if (background === "dark") {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, size, size);
  }

  ctx.drawImage(source, 0, 0, size, size);
  return out.toDataURL("image/png");
}

function SceneCaptureBridge({
  onReady,
}: {
  onReady: (capture: () => Promise<HTMLCanvasElement>) => void;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const frames = useRef(0);
  const notified = useRef(false);

  const capture = useCallback(async () => {
    const renderer = gl as WebGLRenderer;
    const prevSize = new Vector2();
    const prevPixelRatio = renderer.getPixelRatio();
    renderer.getSize(prevSize);

    renderer.setPixelRatio(1);
    renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);

    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_SIZE;
    canvas.height = CAPTURE_SIZE;
    canvas.getContext("2d")?.drawImage(renderer.domElement, 0, 0);

    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    invalidate();

    return canvas;
  }, [gl, scene, camera, invalidate]);

  useFrame(() => {
    if (notified.current) return;
    frames.current += 1;
    if (frames.current >= SETTLE_FRAMES) {
      notified.current = true;
      onReady(capture);
    }
  });

  return null;
}

function IconPreview({
  variant,
  label,
  onReady,
  previewSize,
}: {
  variant: LogoVariant;
  label: string;
  onReady: (capture: () => Promise<HTMLCanvasElement>) => void;
  previewSize: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <GxLogo
        variant={variant}
        pixelSize={previewSize}
        interactive={false}
        preserveDrawingBuffer
      >
        <SceneCaptureBridge onReady={onReady} />
      </GxLogo>
    </div>
  );
}

type GxLogoIconExporterProps = {
  compact?: boolean;
};

export function GxLogoIconExporter({ compact = false }: GxLogoIconExporterProps) {
  const captureGxRef = useRef<(() => Promise<HTMLCanvasElement>) | null>(null);
  const captureXRef = useRef<(() => Promise<HTMLCanvasElement>) | null>(null);
  const [readyGx, setReadyGx] = useState(false);
  const [readyX, setReadyX] = useState(false);
  const [busy, setBusy] = useState(false);
  const [background, setBackground] =
    useState<IconExportBackground>("transparent");

  const ready = readyGx && readyX;

  const captureForSize = useCallback((size: number) => {
    return size <= FAVICON_X_MAX ? captureXRef : captureGxRef;
  }, []);

  const exportSize = useCallback(
    async (size: number, label: string) => {
      const captureRef = captureForSize(size);
      const capture = captureRef.current;
      if (!capture) return;
      setBusy(true);
      try {
        const source = await capture();
        const prefix = size <= FAVICON_X_MAX ? "gx-x" : "gx";
        const suffix = background === "transparent" ? "" : `-${background}`;
        const dataUrl = compositeWithBackground(source, size, background);
        downloadDataUrl(dataUrl, `${prefix}-icon-${label}${suffix}.png`);
      } finally {
        setBusy(false);
      }
    },
    [background, captureForSize],
  );

  const exportAll = useCallback(async () => {
    for (const { label, size } of ICON_EXPORT_SIZES) {
      await exportSize(size, label);
      await new Promise((r) => setTimeout(r, 120));
    }
  }, [exportSize]);

  const previewSize = compact ? 160 : 200;
  const rootGap = compact ? "gap-5" : "gap-8";
  const panelClass = compact
    ? "grid grid-cols-2 gap-3 border border-zinc-200 p-3 dark:border-zinc-800"
    : "grid grid-cols-2 gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800";

  return (
    <div className={`mx-auto flex w-full max-w-lg flex-col ${rootGap}`}>
      <div
        className={panelClass}
        style={{
          backgroundColor:
            background === "light"
              ? "#ffffff"
              : background === "dark"
                ? "#0a0a0a"
                : undefined,
        }}
      >
        <IconPreview
          variant="icon"
          label="gx (48px+)"
          previewSize={previewSize}
          onReady={(fn) => {
            captureGxRef.current = fn;
            setReadyGx(true);
          }}
        />
        <IconPreview
          variant="iconX"
          label="x (≤48px)"
          previewSize={previewSize}
          onReady={(fn) => {
            captureXRef.current = fn;
            setReadyX(true);
          }}
        />
      </div>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {ready
          ? "Full gx for larger icons; chrome x only for 16–48px favicons."
          : "Loading environment maps…"}
      </p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Background
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["transparent", "Transparent"],
              ["light", "White"],
              ["dark", "Dark"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-1.5 border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-800"
            >
              <input
                type="radio"
                name="icon-bg"
                value={value}
                checked={background === value}
                onChange={() => setBackground(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void exportAll()}
          className="bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Download all PNG sizes
        </button>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {ICON_EXPORT_SIZES.map(({ label, size }) => (
            <button
              key={label}
              type="button"
              disabled={!ready || busy}
              onClick={() => void exportSize(size, label)}
              className="border border-zinc-200 px-2.5 py-1.5 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {size}×{size}
              </span>
              <span className="block text-xs text-zinc-500">
                {label}
                {size <= FAVICON_X_MAX ? " · x" : " · gx"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
