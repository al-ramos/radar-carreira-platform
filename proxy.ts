import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

export function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/collector/import" };
