import { LockKeyhole } from "lucide-react";

export function RepoVisibilityIcon({
  isPrivate,
  className = "",
}: {
  isPrivate: boolean;
  className?: string;
}) {
  if (!isPrivate) return null;

  return (
    <span
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500 ${className}`}
    >
      <LockKeyhole aria-label="Private repository" className="size-full" />
    </span>
  );
}
