"use client";

import { useEffect, useRef, useState } from "react";

type Tone =
  | "default"
  | "muted"
  | "heading"
  | "high"
  | "med"
  | "low"
  | "magenta"
  | "green"
  | "cyan";

type Line = { text: string; tone?: Tone };

const TONE_CLASS: Record<Tone, string> = {
  default: "text-zinc-300",
  muted: "text-zinc-500",
  heading: "text-zinc-100",
  high: "text-red-400",
  med: "text-amber-400",
  low: "text-zinc-400",
  magenta: "text-[#ff80ff]",
  green: "text-green-400",
  cyan: "text-cyan-400",
};

const GX_REVIEW: Line[] = [
  { text: "gx · reviewing working tree — 3 files, +103 −7", tone: "heading" },
  { text: "" },
  { text: "  HIGH   security      src/auth.js:19", tone: "high" },
  { text: "    Auth bypass: requireUser() calls jwt.decode(), which reads", tone: "default" },
  { text: "    the token without verifying its signature. A forged token for", tone: "default" },
  { text: "    any user id is accepted, so anyone can act as anyone.", tone: "default" },
  { text: "" },
  { text: "  HIGH   security      src/server.js:52", tone: "high" },
  { text: "    SQL injection: /notes/search concatenates req.query.q straight", tone: "default" },
  { text: "    into the query. q=' OR '1'='1 returns every user's notes, and a", tone: "default" },
  { text: "    crafted value can read or drop any table.", tone: "default" },
  { text: "" },
  { text: "  MED    architecture  src/server.js", tone: "med" },
  { text: "    HTTP handling, business logic, and SQLite access all live in", tone: "default" },
  { text: "    one module against an import-time DB singleton. Nothing can be", tone: "default" },
  { text: "    unit-tested or swapped without rewriting the route handlers.", tone: "default" },
  { text: "" },
  { text: "  LOW    quality       src/auth.js, src/server.js", tone: "low" },
  { text: "    Debug console.log left in, no input validation, 30-day tokens,", tone: "default" },
  { text: "    and passwords stored in plaintext. Small things, but they add", tone: "default" },
  { text: "    up to a service you can't safely ship.", tone: "default" },
  { text: "" },
  { text: "4 findings — 2 high, 1 medium, 1 low", tone: "magenta" },
];

const CAT_AUTH: Line[] = [
  { text: "function requireUser(req, res, next) {", tone: "default" },
  { text: '  const header = req.headers.authorization || "";', tone: "default" },
  { text: '  const token = header.replace("Bearer ", "");', tone: "default" },
  { text: "  req.user = jwt.decode(token);   // never verifies the signature", tone: "high" },
  { text: "  if (!req.user) return res.status(401).json({ error: 'unauthorized' });", tone: "default" },
  { text: "  next();", tone: "default" },
  { text: "}", tone: "default" },
];

const HELP: Line[] = [
  { text: "available commands", tone: "heading" },
  { text: "  gx review          review the uncommitted change", tone: "default" },
  { text: "  ls                 list files", tone: "default" },
  { text: "  git status         show changed files", tone: "default" },
  { text: "  cat src/auth.js    show the auth module", tone: "default" },
  { text: "  clear              clear the screen", tone: "default" },
];

const LS: Line[] = [{ text: "README.md   package.json   src", tone: "cyan" }];

const GIT_STATUS: Line[] = [
  { text: "On branch main", tone: "default" },
  { text: "Changes not staged for commit:", tone: "default" },
  { text: "        modified:   src/auth.js", tone: "high" },
  { text: "        modified:   src/db.js", tone: "high" },
  { text: "        modified:   src/server.js", tone: "high" },
];

/** Map a typed line to canned output. Returns null for `clear`. */
function run(raw: string): Line[] | null {
  const cmd = raw.trim().replace(/\s+/g, " ");
  if (cmd === "") return [];
  if (cmd === "clear") return null;
  if (cmd === "help") return HELP;
  if (cmd === "gx review") return GX_REVIEW;
  if (cmd === "gx" || cmd.startsWith("gx "))
    return [{ text: "usage: gx review", tone: "muted" }];
  if (cmd === "ls" || cmd === "ls -la" || cmd === "ll") return LS;
  if (cmd.startsWith("git status")) return GIT_STATUS;
  if (cmd === "cat src/auth.js") return CAT_AUTH;
  if (cmd === "cat" || cmd.startsWith("cat "))
    return [{ text: `cat: ${cmd.slice(4)}: try 'cat src/auth.js'`, tone: "muted" }];
  const bin = cmd.split(" ")[0];
  return [{ text: `zsh: command not found: ${bin}`, tone: "muted" }];
}

type Entry = { id: number; cmd: string; lines: Line[]; pending?: boolean };

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** gx "thinks" for this long before the findings appear. */
const REVIEW_DELAY_MS = 3200;

/**
 * A faux terminal for the /new playground: recognizes a handful of commands
 * and prints canned output. No backend, no wasm — just enough to let visitors
 * watch `gx review` flag the seeded findings.
 */
export function TerminalPanel({ className = "" }: { className?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("gx review");
  const [spinner, setSpinner] = useState(0);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Animate the spinner only while a review is "thinking".
  const thinking = entries.some((e) => e.pending);
  useEffect(() => {
    if (!thinking) return;
    const id = window.setInterval(
      () => setSpinner((s) => (s + 1) % SPINNER.length),
      90,
    );
    return () => window.clearInterval(id);
  }, [thinking]);

  function submit(raw: string) {
    const cmd = raw.trim().replace(/\s+/g, " ");
    if (cmd === "clear") {
      setEntries([]);
      return;
    }
    // gx review pauses to "think" before revealing findings.
    if (cmd === "gx review") {
      const id = nextId.current++;
      setEntries((prev) => [...prev, { id, cmd: raw, lines: [], pending: true }]);
      window.setTimeout(() => {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, lines: GX_REVIEW, pending: false } : e,
          ),
        );
      }, REVIEW_DELAY_MS);
      return;
    }
    setEntries((prev) => [
      ...prev,
      { id: nextId.current++, cmd: raw, lines: run(raw) ?? [] },
    ]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submit(input);
      setInput("");
    }
  }

  return (
    // Keep wheel events inside the terminal from rotating the page's word wheel.
    <div
      onWheel={(e) => e.stopPropagation()}
      onClick={() => inputRef.current?.focus()}
      className={`flex h-full min-h-0 cursor-text flex-col overflow-hidden border border-zinc-800 bg-[#181716] ${className}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        </span>
        <span className="text-[11px] tracking-[0.08em] text-zinc-500">
          api
        </span>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 text-[12px] leading-5"
      >
        <div className="text-zinc-500">{"'help' for commands"}</div>

        {entries.map((entry) => (
          <div key={entry.id} className="space-y-0.5">
            <div className="pt-1.5">
              <Prompt />
              <span className="text-zinc-200">{entry.cmd}</span>
            </div>
            {entry.pending ? (
              <Row
                line={{
                  text: `${SPINNER[spinner]} Reviewing changes...`,
                  tone: "magenta",
                }}
              />
            ) : (
              entry.lines.map((line, i) => <Row key={i} line={line} />)
            )}
          </div>
        ))}

        {/* Hold the next prompt back until the review has finished loading. */}
        {!thinking && (
          <div className="flex items-baseline pt-1.5">
            <Prompt />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              size={Math.max(input.length, 1)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="terminal input"
              className="bg-transparent text-zinc-100 caret-[#ff80ff] outline-none"
            />
            {entries.length === 0 && (
              <span className="ml-2 animate-pulse select-none whitespace-nowrap text-zinc-500">
                &lt;Hit Enter&gt;
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Prompt() {
  return (
    <span aria-hidden className="mr-2 select-none whitespace-nowrap">
      <span className="text-green-400">➜</span>{" "}
      <span className="text-cyan-400">api</span>{" "}
      <span className="text-[#ff80ff]">git:(main)</span>
    </span>
  );
}

function Row({ line }: { line: Line }) {
  if (line.text === "") return <div className="h-3" />;
  return (
    <div className={`whitespace-pre-wrap ${TONE_CLASS[line.tone ?? "default"]}`}>
      {line.text}
    </div>
  );
}
