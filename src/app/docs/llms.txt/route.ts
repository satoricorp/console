import { readDocsFile } from "@/lib/docs-content";

export function GET() {
  return new Response(readDocsFile("llms.txt"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
