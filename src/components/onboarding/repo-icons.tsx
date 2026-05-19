import type { ReactNode } from "react";

function IconSlot({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500 ${className}`}
    >
      {children}
    </span>
  );
}

export function RepoVisibilityIcon({
  isPrivate,
  className = "",
}: {
  isPrivate: boolean;
  className?: string;
}) {
  if (!isPrivate) return null;

  return (
    <IconSlot className={className}>
      <svg
        aria-label="Private repository"
        role="img"
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V7.125a4.125 4.125 0 1 0-8.25 0V10.5m11.25 0H4.875c-.621 0-1.125.504-1.125 1.125v7.125c0 .621.504 1.125 1.125 1.125h14.25c.621 0 1.125-.504 1.125-1.125v-7.125c0-.621-.504-1.125-1.125-1.125Z"
        />
      </svg>
    </IconSlot>
  );
}
