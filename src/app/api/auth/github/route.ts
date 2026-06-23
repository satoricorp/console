import { NextRequest, NextResponse } from "next/server";
import { POST_SIGN_IN_URL } from "@/lib/site-links";

const FALLBACK_CALLBACK_URL = POST_SIGN_IN_URL;
const ERROR_URL = "/?auth_error=github";

export async function GET(request: NextRequest) {
  const callbackURL = safeCallbackURL(
    request.nextUrl.searchParams.get("callbackURL"),
  );
  const signInResponse = await fetch(
    new URL("/api/auth/sign-in/social", request.nextUrl.origin),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        provider: "github",
        callbackURL,
        errorCallbackURL: ERROR_URL,
      }),
      redirect: "manual",
      cache: "no-store",
    },
  );

  if (!signInResponse.ok) {
    return NextResponse.redirect(new URL(ERROR_URL, request.url), 303);
  }

  const payload = (await signInResponse.json().catch(() => null)) as
    | { url?: unknown }
    | null;
  const url = typeof payload?.url === "string" ? payload.url : null;
  if (!url) {
    return NextResponse.redirect(new URL(ERROR_URL, request.url), 303);
  }

  const response = NextResponse.redirect(url, 303);
  for (const cookie of readSetCookieHeaders(signInResponse.headers)) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function safeCallbackURL(value: string | null) {
  if (!value) return FALLBACK_CALLBACK_URL;
  if (!value.startsWith("/") || value.startsWith("//")) {
    return FALLBACK_CALLBACK_URL;
  }
  return value;
}

function readSetCookieHeaders(headers: Headers) {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }

  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}
