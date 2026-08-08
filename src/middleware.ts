import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REVIEWS_ENABLED } from "@/lib/feature-flags";

export const config = {
  matcher: ["/reviews/:path*", "/api/reviews/:path*", "/api/bookmarks/:path*"],
};

/**
 * Front door for the reviews kill switch. The pages and API routes also gate
 * themselves on REVIEWS_ENABLED, but notFound() thrown inside the root
 * layout's Suspense boundary streams the 404 UI under HTTP 200 — only
 * refusing before render yields a real 404 status. Rewriting to a path that
 * matches no route renders the app's not-found page with that status.
 */
export function middleware(request: NextRequest) {
  if (REVIEWS_ENABLED) {
    return NextResponse.next();
  }
  return NextResponse.rewrite(new URL("/reviews-disabled-404", request.url));
}
