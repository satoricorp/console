"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type OrgMultiSelectProps = {
  orgs: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  className?: string;
};

function formatTriggerLabel(orgs: string[], selected: Set<string>) {
  if (selected.size === 0) return "All organizations";
  if (selected.size === 1) return [...selected][0];
  if (selected.size === 2) {
    const [a, b] = [...selected].sort((x, y) => x.localeCompare(y));
    return `${a}, ${b}`;
  }
  return `${selected.size} organizations`;
}

export function OrgMultiSelect({
  orgs,
  selected,
  onChange,
  className,
}: OrgMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => formatTriggerLabel(orgs, selected), [orgs, selected]);

  function toggleOrg(org: string) {
    const next = new Set(selected);
    if (next.has(org)) {
      next.delete(org);
    } else {
      next.add(org);
    }
    onChange(next);
  }

  function selectAll() {
    onChange(new Set());
  }

  const allSelected = selected.size === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Filter by organization"
          className={cn(
            "flex w-full items-center justify-between border-0 bg-zinc-50 px-3 py-2.5 text-left text-[13px] leading-5 text-zinc-900 outline-none transition-colors hover:bg-zinc-100/80 dark:bg-zinc-900/50 dark:text-zinc-100 dark:hover:bg-zinc-900",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search organizations..." />
          <CommandList>
            <CommandEmpty>No organization found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all-organizations"
                onSelect={selectAll}
                className="gap-2"
              >
                <Checkbox checked={allSelected} className="pointer-events-none" />
                <span className="font-medium">All organizations</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {orgs.map((org) => {
                const isSelected = selected.has(org);
                return (
                  <CommandItem
                    key={org}
                    value={org}
                    onSelect={() => toggleOrg(org)}
                    className="gap-2"
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                    <span className="truncate">{org}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
