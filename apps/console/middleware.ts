import { NextRequest, NextResponse } from "next/server";

// Every console page needs a sign-in. The cookie is checked properly by the API on each call;
// this only sends people without one straight to the sign-in page.
export function middleware(req: NextRequest) {
  if (req.cookies.get("evgo_console")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the sign-in page and static files.
  matcher: ["/((?!login|_next/|icon.png|evgo-logo.png|favicon.ico).*)"],
};
