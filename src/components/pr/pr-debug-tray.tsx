"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type PrDebugTrayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: unknown;
};

export function PrDebugTray({ open, onOpenChange, data }: PrDebugTrayProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Incoming data</SheetTitle>
          <SheetDescription>
            Raw payload from <code className="text-xs">gx pr</code> (remove before
            production).
          </SheetDescription>
        </SheetHeader>
        <pre className="mt-4 max-h-[calc(100vh-8rem)] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          {JSON.stringify(data, null, 2)}
        </pre>
      </SheetContent>
    </Sheet>
  );
}
