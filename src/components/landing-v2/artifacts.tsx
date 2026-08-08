/**
 * Faithful, hand-set renderings of gx output for the v2 landing. Content
 * mirrors the documented product surfaces (docs/cli.mdx, docs/pull-requests.mdx):
 * finding strengths, the two-models-plus-judge pipeline, PR summary sections,
 * and @gx answers with cited sources. Dark-only by design — the landing forces
 * a dark canvas in both OS themes.
 */

const RISK = "text-[#ff6166]";
const WARN = "text-[#f5a623]";
const OK = "text-[#62c073]";
const AGENT = "text-[#bf7af0]";

function Panel({
  bar,
  children,
  className = "",
}: {
  bar: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden border border-zinc-800 bg-[#111111] ${className}`}
    >
      <div className="border-b border-zinc-800 px-4 py-2.5">
        <p className="font-mono text-[11px] tracking-wide text-zinc-500">
          {bar}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Hero: a full `gx review` run in the terminal. */
export function ReviewTerminal() {
  return (
    <Panel bar="zsh — ~/work/api">
      <div className="space-y-4 px-4 py-4 font-mono text-xs leading-5">
        <div>
          <p>
            <span className="select-none text-zinc-600">$ </span>
            <span className="text-zinc-100">gx review</span>
          </p>
          <p className="text-zinc-500">
            reviewing working tree · 8 files · +214 −61
          </p>
          <p className="text-zinc-500">
            two models review · a judge dedupes and ranks
          </p>
        </div>

        <div>
          <p className={`${RISK}`}>
            strong{"          "}
            <span className="text-zinc-300">auth/session.ts:141</span>
          </p>
          <p className="text-zinc-400">
            Rotated refresh tokens are never revoked — a stolen token stays
            valid for its full TTL.
          </p>
        </div>

        <div>
          <p className={`${WARN}`}>
            worth-exploring{" "}
            <span className="text-zinc-300">api/publish.ts:58</span>
          </p>
          <p className="text-zinc-400">
            A partial failure re-sends the whole batch; duplicate rows land on
            flaky networks.
          </p>
        </div>

        <p className="text-zinc-300">
          2 findings survived the judge
          <span className="text-zinc-600"> · fix before you push</span>
        </p>
      </div>
    </Panel>
  );
}

/** Surface 1: /gx inside a coding agent (MCP). */
export function AgentPanel() {
  return (
    <Panel bar="your coding agent">
      <div className="space-y-1 px-4 py-4 font-mono text-xs leading-5">
        <p>
          <span className="select-none text-zinc-600">&gt; </span>
          <span className="text-zinc-100">/gx</span>
        </p>
        <p className="text-zinc-500">gx review — working tree</p>
        <p className="text-zinc-400">
          <span className={RISK}>1 strong</span>
          <span className="text-zinc-600"> · </span>
          <span className={WARN}>1 worth-exploring</span>
        </p>
        <p className="text-zinc-400">
          fixed in place<span className="text-zinc-600"> — </span>
          <span className={OK}>pushed clean</span>
        </p>
      </div>
    </Panel>
  );
}

/** Surface 2: the summary gx Cloud appends to the PR description. */
export function PrSummaryCard() {
  return (
    <Panel bar="pull request #482 — description, added by gx">
      <div className="space-y-3 px-4 py-4 text-xs leading-5">
        <p className="text-zinc-200">
          <span aria-hidden>🟡</span>{" "}
          <span className="font-medium">Careful pass</span>
          <span className="text-zinc-500"> (MEDIUM)</span>
          <span className="text-zinc-400">
            {" "}
            — token refresh reaches every signed-in session
          </span>
        </p>

        <p className="font-mono text-[11px] text-zinc-500">
          Blast radius · 3 files · auth, publish · beyond the diff:
          session lifetime for all users
        </p>

        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <div>
            <p className="font-mono text-zinc-300">auth/session.ts</p>
            <p className="text-zinc-400">
              Refresh tokens now rotate on every renewal.
            </p>
            <p className="font-mono text-[11px] text-zinc-500">
              Attribution: <span className={AGENT}>agent session</span> ·
              “rotate refresh tokens”
            </p>
          </div>
          <div>
            <p className="font-mono text-zinc-300">api/publish.ts</p>
            <p className="text-zinc-400">Outbox flush retries in batches.</p>
            <p className="font-mono text-[11px] text-zinc-500">
              Attribution: <span className="text-[#52a8ff]">codebase</span> ·
              src/server/outbox.ts
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Surface 3: @gx answering in the PR conversation. */
export function ChatThread() {
  return (
    <Panel bar="pull request #482 — conversation">
      <ul className="divide-y divide-zinc-800 text-xs leading-5">
        <li className="space-y-1 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            reviewer
          </p>
          <p className="text-zinc-300">@gx what’s the riskiest change here?</p>
        </li>
        <li className="space-y-1 px-4 py-3">
          <p className={`font-mono text-[10px] uppercase tracking-wider ${OK}`}>
            gx
          </p>
          <p className="text-zinc-300">
            The refresh-token rotation in auth/session.ts — it decides who
            stays signed in, and for how long. Start there.
          </p>
          <p className="font-mono text-[11px] text-zinc-500">
            Source: <span className={AGENT}>agent session</span> ·
            auth/session.ts
          </p>
        </li>
      </ul>
    </Panel>
  );
}

/** Setup: the two gx commands, and the Git flow left untouched. */
export function SetupTerminal() {
  return (
    <Panel bar="zsh — any repo">
      <div className="space-y-4 px-4 py-4 font-mono text-xs leading-5">
        <div>
          <p>
            <span className="select-none text-zinc-600">$ </span>
            <span className="text-zinc-100">gx init</span>
            <span className="text-zinc-600">
              {"      "}# once per repo — installs the hooks
            </span>
          </p>
          <p>
            <span className="select-none text-zinc-600">$ </span>
            <span className="text-zinc-100">gx review</span>
            <span className="text-zinc-600">
              {"    "}# whenever you want a review
            </span>
          </p>
        </div>
        <p className="border-t border-zinc-800 pt-3 text-zinc-500">
          git add · git commit · git push · gh pr create
          <span className="text-zinc-600"> — unchanged</span>
        </p>
      </div>
    </Panel>
  );
}
