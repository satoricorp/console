"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/button";
import { SatoriLogo } from "@/components/satori-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
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

const GxLogo = dynamic(
  () => import("@/components/gx-logo").then((mod) => mod.GxLogo),
  {
    ssr: false,
    loading: () => (
      <div className="h-7 w-20 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    ),
  },
);

const GxLogoIconExporter = dynamic(
  () =>
    import("@/components/gx-logo/gx-logo-icon-exporter").then(
      (mod) => mod.GxLogoIconExporter,
    ),
  { ssr: false },
);

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

function LogoSection() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          GX chrome
        </p>
        <div className="mt-2">
          <GxLogo variant="header" />
        </div>
      </div>
      <div className="border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Satori
        </p>
        <div className="mt-2 bg-zinc-900 px-3 py-2">
          <SatoriLogo height={12} />
        </div>
      </div>
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
  logo: <LogoSection />,
  components: <ComponentsSection />,
  "icon-export": <IconExportSection />,
};

export function DesignOverview() {
  const [section, setSection] = useState<DesignSectionId>("colors");
  const sectionLabel =
    DESIGN_SECTIONS.find((s) => s.id === section)?.label ?? "Colors";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Console
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Design
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
