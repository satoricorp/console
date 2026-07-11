"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { SignInLink } from "@/components/sign-in-link";
import { cn } from "@/lib/utils";

type CliDevice = {
  id: string;
  machineId: string;
  machineName: string;
  gxVersion: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  status: "active" | "inactive";
};

function formatDate(value: number | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function DeviceRow({ device }: { device: CliDevice }) {
  const statusClass =
    device.status === "active"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
      : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-5 text-zinc-950 dark:text-zinc-50">
            {device.machineName}
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center border px-2 py-0.5 text-[11px] font-medium capitalize leading-4",
              statusClass,
            )}
          >
            {device.status}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
          {device.gxVersion ? `GX ${device.gxVersion}` : "GX version unknown"} ·{" "}
          {device.machineId}
        </p>
      </div>
      <div className="text-left text-[11px] leading-4 text-zinc-500 dark:text-zinc-400 sm:text-right">
        <p>Last used {formatDate(device.lastUsedAt)}</p>
        <p>Expires {formatDate(device.expiresAt)}</p>
      </div>
    </li>
  );
}

export function DeviceList() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const devices = useQuery(
    api.devices.getMyCliDevices,
    isAuthenticated ? {} : "skip",
  );

  if (!isLoading && !isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-2xl border border-zinc-200 px-4 py-8 text-[13px] leading-5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <SignInLink className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:text-zinc-300" />{" "}
        to view CLI devices.
      </div>
    );
  }

  if (isLoading || devices === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="space-y-2 border border-zinc-200 p-4 dark:border-zinc-800">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse bg-zinc-100 dark:bg-zinc-900"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {devices.length === 0 ? (
        <div className="border border-zinc-200 px-4 py-8 text-[13px] leading-5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No CLI devices signed in.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </ul>
      )}
    </div>
  );
}
