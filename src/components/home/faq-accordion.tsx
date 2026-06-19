import { ChevronDown } from "lucide-react";

type FaqItem = {
  question: string;
  answer: string;
};

export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="border-y border-zinc-200 dark:border-zinc-800">
      {items.map((item) => (
        <details
          key={item.question}
          className="group border-b border-zinc-200 dark:border-zinc-800"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between py-5 text-left text-sm font-medium text-zinc-950 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
            {item.question}
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="pb-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {item.answer}
          </div>
        </details>
      ))}
    </div>
  );
}
