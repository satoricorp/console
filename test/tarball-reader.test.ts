import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarballStream } from "../convex/lib/turbopuffer/fetchGithubTarball";

/**
 * Built with the system tar against real files, not hand-assembled blocks. A
 * tar reader tested only against archives the test itself wrote proves the two
 * agree, not that either matches what GitHub sends.
 *
 * The deep path is the case that matters: tar's header has 100 bytes for a
 * name, and anything longer arrives as a PAX extended header. A reader that
 * ignores those drops exactly the deeply nested files a monorepo is made of,
 * silently, with nothing to notice.
 */
const DEEP_PATH =
  "packages/some-fairly-long-package-name/src/components/deeply/nested/directory/structure/ComponentWithALongName.tsx";

/**
 * A single filename component over 100 characters. This is what actually forces
 * a long-name extension: tar's ustar header splits a long path across a 155-byte
 * prefix and a 100-byte name, so a merely deep path fits and DEEP_PATH above is
 * carried by the prefix field alone. Only a component that cannot fit the name
 * field makes tar emit a PAX or GNU header.
 */
const LONG_COMPONENT_PATH = `src/generated/${"a".repeat(120)}.ts`;

let archive: string;
let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "tarball-test-"));
  // GitHub wraps everything in {owner}-{repo}-{sha}/, which the reader strips.
  const root = join(workdir, "acme-api-abc1234");
  const write = (rel: string, body: string) => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  };

  write("src/index.ts", "export const hello = 1;\n");
  write("README.md", "# acme\n");
  write("src/nested/deep/file.ts", "export const deep = 2;\n");
  write(DEEP_PATH, "export const Component = () => null;\n");
  write(LONG_COMPONENT_PATH, "export const generated = 3;\n");
  write("large.txt", "x".repeat(200000));

  archive = join(workdir, "repo.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", workdir, "acme-api-abc1234"]);
});

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe("tarball reader", () => {
  test("extracts the wanted files and strips the wrapper directory", async () => {
    const { contents } = await extractTarballStream(
      createReadStream(archive),
      new Set(["src/index.ts", "src/nested/deep/file.ts"]),
    );

    expect(contents.get("src/index.ts")).toBe("export const hello = 1;\n");
    expect(contents.get("src/nested/deep/file.ts")).toBe("export const deep = 2;\n");
    // Not asked for, so not carried in memory.
    expect(contents.has("README.md")).toBe(false);
  });

  test("reads a path too long for the tar header", async () => {
    expect(DEEP_PATH.length).toBeGreaterThan(100);

    const { contents } = await extractTarballStream(
      createReadStream(archive),
      new Set([DEEP_PATH]),
    );

    expect(contents.get(DEEP_PATH)).toBe("export const Component = () => null;\n");
  });

  test("reads a filename too long for the tar name field", async () => {
    const { contents } = await extractTarballStream(
      createReadStream(archive),
      new Set([LONG_COMPONENT_PATH]),
    );

    expect(contents.get(LONG_COMPONENT_PATH)).toBe("export const generated = 3;\n");
  });

  test("reads a file spanning many blocks intact", async () => {
    const { contents } = await extractTarballStream(
      createReadStream(archive),
      new Set(["large.txt"]),
    );

    expect(contents.get("large.txt")?.length).toBe(200000);
  });

  test("asking for nothing keeps nothing", async () => {
    const { contents, truncated } = await extractTarballStream(
      createReadStream(archive),
      new Set(["does/not/exist.ts"]),
    );

    expect(contents.size).toBe(0);
    expect(truncated).toBe(false);
  });
});
