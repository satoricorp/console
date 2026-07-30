"use node";

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isRetryableHttpStatus, withRetry } from "./retry";
import { parseFullName } from "./utils";

/**
 * Reads a repository's files from one tarball instead of one API call per file.
 *
 * The blob endpoint costs a request per file against an installation's 5000
 * requests per hour. A 422-file repository spent 422 of them on a single index
 * — and the budget is shared, so exhausting it does not merely slow indexing,
 * it takes PR summaries and @tx replies down with it for the rest of the hour.
 * The tarball is one request for the whole repository.
 *
 * Nothing is buffered whole. The response is gunzipped as it arrives and
 * entries are examined and discarded as they go past, so peak memory is the
 * files actually wanted rather than the size of the archive — which matters,
 * because most of a repository is content the indexer already filters out.
 */

/** Total kept bytes before extraction stops. */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const BLOCK = 512;
const EMPTY: Buffer = Buffer.alloc(0);


export type TarballResult = {
  contents: Map<string, string>;
  /** True when the byte budget stopped extraction before the archive ended. */
  truncated: boolean;
};

export async function fetchGithubTarball(
  fullName: string,
  ref: string,
  accessToken: string,
  wanted: Set<string>,
): Promise<TarballResult> {
  const { owner, name } = parseFullName(fullName);

  const response = await withRetry(
    async () => {
      const result = await fetch(
        `https://api.github.com/repos/${owner}/${name}/tarball/${ref}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "console-app",
          },
        },
      );
      if (isRetryableHttpStatus(result.status)) {
        throw new Error(`Failed to fetch tarball for ${fullName} (${result.status})`);
      }
      return result;
    },
    { maxAttempts: 4, baseMs: 1000 },
  );

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch tarball for ${fullName} (${response.status})`,
    );
  }

  // The web ReadableStream from fetch and Node's fromWeb disagree on their
  // type parameters across lib versions; the runtime shapes match.
  return extractTarballStream(
    Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    wanted,
  );
}

/**
 * Gunzips and walks a tar stream, keeping only the wanted paths.
 *
 * Separate from the fetch so it can be tested against a real archive. A tar
 * reader written by hand is exactly the code that should not be trusted on
 * a typecheck alone.
 */
export async function extractTarballStream(
  source: NodeJS.ReadableStream,
  wanted: Set<string>,
): Promise<TarballResult> {
  const reader = new TarReader(wanted);
  await pipeline(
    source,
    createGunzip(),
    async function (gunzipped: AsyncIterable<Buffer>) {
      // Deliberately drains rather than breaking early. Tearing the stream
      // down mid-flight makes pipeline() reject with an AbortError, which
      // would turn "found everything asked for" into a failed index. The
      // reader ignores input once it is done, so the remaining cost is gunzip
      // on bytes nobody keeps.
      for await (const chunk of gunzipped) {
        reader.push(chunk);
      }
    },
  );
  return { contents: reader.contents, truncated: reader.truncated };
}

/**
 * An incremental tar reader that keeps only the paths asked for.
 *
 * Written by hand rather than taken as a dependency because the format is a
 * linear walk of 512-byte blocks, and the only part that is not obvious — the
 * long-name extensions — is the part a dependency would have to be audited for
 * anyway. Ignoring those is the failure worth naming: GitHub emits a PAX
 * header for any path over 100 characters, and a reader that skips them drops
 * exactly the deeply nested files a monorepo is made of, silently and with no
 * error to notice.
 */
class TarReader {
  contents = new Map<string, string>();
  truncated = false;
  done = false;

  private buffer: Buffer = EMPTY;
  private keptBytes = 0;
  /** Set by a PAX or GNU long-name entry; applies to the next file entry. */
  private pendingLongName: string | null = null;

  constructor(private readonly wanted: Set<string>) {}

  push(chunk: Buffer): void {
    if (this.done) return;
    this.buffer =
      this.buffer.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain() {
    while (!this.done && this.buffer.length >= BLOCK) {
      const header = this.buffer.subarray(0, BLOCK);

      // Two consecutive zero blocks end the archive; one is enough to stop.
      if (header[0] === 0) {
        this.done = true;
        return;
      }

      const size = parseOctal(header.subarray(124, 136));
      const typeFlag = String.fromCharCode(header[156] ?? 0);
      const padded = Math.ceil(size / BLOCK) * BLOCK;

      if (this.buffer.length < BLOCK + padded) {
        return; // wait for the rest of this entry
      }

      const body = this.buffer.subarray(BLOCK, BLOCK + size);
      this.buffer = this.buffer.subarray(BLOCK + padded);

      if (typeFlag === "x" || typeFlag === "X") {
        this.pendingLongName = paxPath(body) ?? this.pendingLongName;
        continue;
      }
      if (typeFlag === "L") {
        this.pendingLongName = body.toString("utf8").replace(/\0+$/, "");
        continue;
      }

      const rawName = this.pendingLongName ?? headerName(header);
      this.pendingLongName = null;

      // Regular files only: "0" and the legacy "\0" spelling.
      if (typeFlag !== "0" && typeFlag !== "\0") continue;

      const path = stripRootComponent(rawName);
      if (!path || !this.wanted.has(path)) continue;

      if (this.keptBytes + size > MAX_TOTAL_BYTES) {
        this.truncated = true;
        this.done = true;
        return;
      }
      this.keptBytes += size;
      this.contents.set(path, body.toString("utf8"));

      // Everything asked for has been found; the rest of the archive is not
      // worth gunzipping.
      if (this.contents.size === this.wanted.size) {
        this.done = true;
        return;
      }
    }
  }
}

/** GitHub wraps the tree in `{owner}-{repo}-{sha}/`. */
function stripRootComponent(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(slash + 1);
}

function headerName(header: Buffer): string {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
  const prefix = header.subarray(345, 500).toString("utf8").replace(/\0+$/, "");
  return prefix ? `${prefix}/${name}` : name;
}

/** PAX records are `"<len> <key>=<value>\n"`, concatenated. */
function paxPath(body: Buffer): string | null {
  const text = body.toString("utf8");
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length).replace(/\n$/, "");
    const equals = record.indexOf("=");
    if (equals !== -1 && record.slice(0, equals) === "path") {
      return record.slice(equals + 1);
    }
    offset += length;
  }
  return null;
}

function parseOctal(field: Buffer): number {
  const text = field.toString("utf8").replace(/\0/g, "").trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}
