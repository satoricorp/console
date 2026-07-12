import { readDocsFile } from "@/lib/docs-content";

export function GET() {
  return new Response(readDocsFile("llms-full.txt"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
