"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFrame, useThree } from "@react-three/fiber";
import { ChevronDown } from "lucide-react";
import type { WebGLRenderer } from "three";
import { Vector2 } from "three";
import { Button } from "@/components/button";
import { GxLogo } from "@/components/gx-logo/gx-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCENT_COLORS,
  DESIGN_SECTIONS,
  SEMANTIC_COLORS,
  TYPOGRAPHY,
  UI_ZINC,
  type DesignSectionId,
} from "@/lib/design-tokens";

const LOGO_EXPORT_WIDTH = 1600;
const LOGO_EXPORT_HEIGHT = 520;
const FAVICON_EXPORT_SIZE = 512;
const LOGO_CAPTURE_FRAMES = 36;

const GxLogoIconExporter = dynamic(
  () =>
    import("@/components/gx-logo/gx-logo-icon-exporter").then(
      (mod) => mod.GxLogoIconExporter,
    ),
  { ssr: false },
);

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function compositeLogo(
  source: HTMLCanvasElement,
  background: "light" | "dark",
) {
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_EXPORT_WIDTH;
  canvas.height = LOGO_EXPORT_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");

  ctx.fillStyle = background === "light" ? "#ffffff" : "#0a0a0a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}

function compositeLogoSvg(
  source: HTMLCanvasElement,
  background: "light" | "dark",
) {
  const fill = background === "light" ? "#ffffff" : "#0a0a0a";
  const image = source.toDataURL("image/png");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_EXPORT_WIDTH}" height="${LOGO_EXPORT_HEIGHT}" viewBox="0 0 ${LOGO_EXPORT_WIDTH} ${LOGO_EXPORT_HEIGHT}">`,
    `<rect width="${LOGO_EXPORT_WIDTH}" height="${LOGO_EXPORT_HEIGHT}" fill="${fill}"/>`,
    `<image href="${image}" width="${LOGO_EXPORT_WIDTH}" height="${LOGO_EXPORT_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>`,
    "</svg>",
  ].join("");
}

function compositeFavicon(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = FAVICON_EXPORT_SIZE;
  canvas.height = FAVICON_EXPORT_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}

function compositeFaviconSvg(source: HTMLCanvasElement) {
  const image = source.toDataURL("image/png");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FAVICON_EXPORT_SIZE}" height="${FAVICON_EXPORT_SIZE}" viewBox="0 0 ${FAVICON_EXPORT_SIZE} ${FAVICON_EXPORT_SIZE}">`,
    `<rect width="${FAVICON_EXPORT_SIZE}" height="${FAVICON_EXPORT_SIZE}" fill="#0a0a0a"/>`,
    `<image href="${image}" width="${FAVICON_EXPORT_SIZE}" height="${FAVICON_EXPORT_SIZE}" preserveAspectRatio="xMidYMid meet"/>`,
    "</svg>",
  ].join("");
}

function LogoCaptureBridge({
  width,
  height,
  onReady,
}: {
  width: number;
  height: number;
  onReady: (capture: () => Promise<HTMLCanvasElement>) => void;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const frames = useRef(0);
  const notified = useRef(false);

  const capture = useCallback(async () => {
    const renderer = gl as WebGLRenderer;
    const previousSize = new Vector2();
    const previousPixelRatio = renderer.getPixelRatio();

    renderer.getSize(previousSize);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(renderer.domElement, 0, 0);

    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(previousSize.x, previousSize.y, false);
    invalidate();

    return canvas;
  }, [camera, gl, height, invalidate, scene, width]);

  useFrame(() => {
    if (notified.current) return;
    frames.current += 1;
    if (frames.current >= LOGO_CAPTURE_FRAMES) {
      notified.current = true;
      onReady(capture);
      return;
    }
    invalidate();
  });

  return null;
}

function ChromeLogoDownloads() {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [faviconSource, setFaviconSource] = useState<HTMLCanvasElement | null>(null);
  const [captureError, setCaptureError] = useState(false);

  const handleReady = useCallback((capture: () => Promise<HTMLCanvasElement>) => {
    void capture()
      .then((canvas) => {
        setSource(canvas);
        setCaptureError(false);
      })
      .catch(() => setCaptureError(true));
  }, []);

  const handleFaviconReady = useCallback(
    (capture: () => Promise<HTMLCanvasElement>) => {
      void capture()
        .then((canvas) => {
          setFaviconSource(canvas);
          setCaptureError(false);
        })
        .catch(() => setCaptureError(true));
    },
    [],
  );

  const downloadLogo = useCallback(
    (background: "light" | "dark") => {
      if (!source) return;
      downloadDataUrl(
        compositeLogo(source, background),
        `gx-chrome-logo-${background}.png`,
      );
    },
    [source],
  );

  const downloadLogoSvg = useCallback(
    (background: "light" | "dark") => {
      if (!source) return;
      downloadText(
        compositeLogoSvg(source, background),
        `gx-chrome-logo-${background}.svg`,
        "image/svg+xml",
      );
    },
    [source],
  );

  const downloadFavicon = useCallback(() => {
    if (!faviconSource) return;
    downloadDataUrl(compositeFavicon(faviconSource), "gx-favicon.png");
  }, [faviconSource]);

  const downloadFaviconSvg = useCallback(() => {
    if (!faviconSource) return;
    downloadText(
      compositeFaviconSvg(faviconSource),
      "gx-favicon.svg",
      "image/svg+xml",
    );
  }, [faviconSource]);

  return (
    <section className="space-y-5 border-b border-zinc-200 pb-8 dark:border-zinc-800">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] md:items-end">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Brand Assets
          </h1>
          <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Export the GX chrome mark and favicon. The default download uses a
            black background; use the menu for the light version.
          </p>
        </div>
        <div
          className="pointer-events-none fixed top-0 -left-[10000px] h-[180px] w-[520px] overflow-hidden opacity-0"
          aria-hidden
        >
          <GxLogo
            variant="footer"
            tone="chrome"
            interactive={false}
            preserveDrawingBuffer
            frameloop="always"
          >
            <LogoCaptureBridge
              width={LOGO_EXPORT_WIDTH}
              height={LOGO_EXPORT_HEIGHT}
              onReady={handleReady}
            />
          </GxLogo>
        </div>
        <div
          className="pointer-events-none fixed top-0 -left-[10000px] size-48 overflow-hidden opacity-0"
          aria-hidden
        >
          <GxLogo
            variant="iconX"
            tone="chrome"
            interactive={false}
            preserveDrawingBuffer
            frameloop="always"
          >
            <LogoCaptureBridge
              width={FAVICON_EXPORT_SIZE}
              height={FAVICON_EXPORT_SIZE}
              onReady={handleFaviconReady}
            />
          </GxLogo>
        </div>
      </div>

      <div className="border border-zinc-800 bg-[#0a0a0a] p-4">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_8rem] md:items-center">
          <div className="flex h-44 min-w-0 items-center justify-center overflow-hidden">
            <GxLogo
              variant="footer"
              tone="chrome"
              interactive={false}
              className="w-full max-w-[21rem]"
              frameloop="always"
            />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-20 items-center justify-center border border-zinc-800 bg-[#0a0a0a]">
              <GxLogo
                variant="iconX"
                tone="chrome"
                interactive={false}
                pixelSize={56}
                frameloop="always"
              />
            </div>
            <p className="text-xs text-zinc-500">favicon</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-50">Black</p>
            <p className="text-xs text-zinc-500">
              1600x520 logo PNG, 512x512 favicon PNG
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!source || !faviconSource}
                className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-700 px-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download
                <ChevronDown className="size-4 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => downloadLogo("dark")}>
                Black logo PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadLogoSvg("dark")}>
                Black logo SVG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadLogo("light")}>
                Light logo PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadLogoSvg("light")}>
                Light logo SVG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadFavicon}>
                Favicon PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadFaviconSvg}>
                Favicon SVG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {captureError ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          Logo capture failed. Refresh the page and try again.
        </p>
      ) : !source ? (
        <p className="text-sm text-zinc-500">Preparing logo downloads...</p>
      ) : !faviconSource ? (
        <p className="text-sm text-zinc-500">Preparing favicon download...</p>
      ) : null}
    </section>
  );
}

function ColorSwatch({
  token,
  hex,
  light,
  dark,
}: {
  token: string;
  hex?: string;
  light?: string;
  dark?: string;
}) {
  const swatch = hex ?? light ?? "#000000";
  return (
    <div className="flex items-center gap-2 border border-zinc-200 p-2 dark:border-zinc-800">
      <div
        className="size-8 shrink-0 border border-zinc-200 dark:border-zinc-700"
        style={{ backgroundColor: swatch }}
      />
      <div className="min-w-0 font-mono text-xs leading-snug">
        <p className="text-zinc-900 dark:text-zinc-50">{token}</p>
        {light && dark ? (
          <p className="text-zinc-500">
            {light} / {dark}
          </p>
        ) : hex ? (
          <p className="text-zinc-500">{hex}</p>
        ) : null}
      </div>
    </div>
  );
}

function ColorsSection() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {SEMANTIC_COLORS.map((c) => (
        <ColorSwatch
          key={c.token}
          token={c.token}
          light={c.light}
          dark={c.dark}
        />
      ))}
      {UI_ZINC.map((c) => (
        <ColorSwatch key={c.token} token={c.token} hex={c.hex} />
      ))}
      {ACCENT_COLORS.map((c) => (
        <ColorSwatch key={c.token} token={c.token} hex={c.hex} />
      ))}
    </div>
  );
}

function TypographySection() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TYPOGRAPHY.map((font) => (
        <div
          key={font.name}
          className="border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <p className="font-mono text-xs text-zinc-500">{font.variable}</p>
          <p
            className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            style={{ fontFamily: font.stack }}
          >
            The quick brown fox
          </p>
          {font.name === "Geist Mono" ? (
            <p
              className="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400"
              style={{ fontFamily: font.stack }}
            >
              const repo = &quot;connected&quot;;
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ComponentsSection() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="dashed">Dashed</Button>
    </div>
  );
}

function IconExportSection() {
  return <GxLogoIconExporter compact />;
}

const SECTION_CONTENT: Record<DesignSectionId, React.ReactNode> = {
  colors: <ColorsSection />,
  typography: <TypographySection />,
  components: <ComponentsSection />,
  "icon-export": <IconExportSection />,
};

export function DesignOverview() {
  const [section, setSection] = useState<DesignSectionId>("colors");
  const sectionLabel =
    DESIGN_SECTIONS.find((s) => s.id === section)?.label ?? "Colors";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ChromeLogoDownloads />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Console
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Design reference
          </h1>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 min-w-[9rem] items-center justify-between gap-2 border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-600"
            >
              {sectionLabel}
              <ChevronDown className="size-4 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[9rem]">
            <DropdownMenuRadioGroup
              value={section}
              onValueChange={(value) => setSection(value as DesignSectionId)}
            >
              {DESIGN_SECTIONS.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pt-5">{SECTION_CONTENT[section]}</div>
    </main>
  );
}
