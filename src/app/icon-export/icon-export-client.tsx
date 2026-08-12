"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const GxLogoIconExporter = dynamic(
  () =>
    import("@/components/gx-logo/gx-logo-icon-exporter").then(
      (mod) => mod.GxLogoIconExporter,
    ),
  { ssr: false },
);

export function IconExportClient() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          gx icon export
        </h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Renders at 1024×1024, then scales to standard favicon and app-icon
          sizes. See the{" "}
          <Link
            href="/design"
            className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-50"
          >
            design overview
          </Link>{" "}
          for colors, type, and export sizes. The site favicon uses the{" "}
          <strong>Blob</strong> X (
          <code className="text-zinc-800 dark:text-zinc-200">icon.tsx</code>);
          the touch icon uses the <strong>Xer0</strong> wordmark (
          <code className="text-zinc-800 dark:text-zinc-200">apple-icon.tsx</code>
          ). This exporter is for chrome mesh marks. Use transparent PNGs for
          PWA manifests; use white or dark backgrounds for iOS / Android store
          icons that require a solid fill.
        </p>
      </div>
      <GxLogoIconExporter />
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          Wire into Next.js after export
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            The site tab icon is generated from Blob in{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              src/app/icon.tsx
            </code>
            ; the touch icon from Xer0 in{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              src/app/apple-icon.tsx
            </code>
            .
          </li>
          <li>
            Tune chrome mesh framing in{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              src/components/gx-logo/constants.ts
            </code>{" "}
            under the <code className="text-zinc-800 dark:text-zinc-200">icon</code>{" "}
            variant.
          </li>
        </ul>
      </section>
    </main>
  );
}
