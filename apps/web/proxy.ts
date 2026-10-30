import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const origin = new URL(process.env.APP_URL ?? "http://localhost:8000");
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-proto", origin.protocol.slice(0, -1));
  headers.set("x-forwarded-host", origin.host);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: "/api/:path*" };
