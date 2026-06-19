"use client";

import { Button } from "@/components/button";
import { AppleIcon } from "@/components/apple-icon";
import { MACOS_DOWNLOAD_URL } from "@/lib/gx-download";

export function MacosDownloadButton({ className = "" }: { className?: string }) {
  return (
    <Button
      className={className}
      onClick={() => {
        window.location.href = MACOS_DOWNLOAD_URL;
      }}
    >
      <AppleIcon className="h-4 w-4" />
      Download for macOS
    </Button>
  );
}
