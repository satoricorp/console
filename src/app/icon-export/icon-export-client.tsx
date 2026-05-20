"use client";

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
          GX icon export
        </h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Renders at 1024×1024, then scales to standard favicon and app-icon
          sizes. Favicons at 48px and below use the{" "}
          <strong>x</strong> clipped from the same chrome mesh as the header;
          larger sizes use the full <strong>gx</strong> mark. Use transparent
          PNGs for{" "}
          <code className="text-zinc-800 dark:text-zinc-200">favicon.ico</code>{" "}
          (via a converter),{" "}
          <code className="text-zinc-800 dark:text-zinc-200">
            apple-touch-icon.png
          </code>
          , and PWA manifests. Use white or dark backgrounds for iOS / Android
          store icons that require a solid fill.
        </p>
      </div>
      <GxLogoIconExporter />
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          Wire into Next.js after export
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            Copy{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              gx-icon-favicon-32.png
            </code>{" "}
            →{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              src/app/icon.png
            </code>{" "}
            (or{" "}
            <code className="text-zinc-800 dark:text-zinc-200">favicon.ico</code>{" "}
            in <code className="text-zinc-800 dark:text-zinc-200">public/</code>)
          </li>
          <li>
            Copy{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              gx-icon-apple-touch-icon.png
            </code>{" "}
            →{" "}
            <code className="text-zinc-800 dark:text-zinc-200">
              src/app/apple-icon.png
            </code>
          </li>
          <li>
            Tune framing in{" "}
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
