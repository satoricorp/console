"use client";

import { Button } from "@/components/button";

const MEET_URL = "https://cal.com/meet-with-satori/30min";

export function MeetWithUsButton({ className = "" }: { className?: string }) {
  return (
    <Button
      className={className}
      onClick={() => {
        window.location.href = MEET_URL;
      }}
    >
      Say hi
    </Button>
  );
}
