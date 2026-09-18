import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getServerEnv } from "./lib/env";

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());

  const isDev = process.env.NODE_ENV === "development";
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: http: 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://*.supabase.co;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com;
    connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", cspHeader);

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  response.headers.set("Content-Security-Policy", cspHeader);

  const env = getServerEnv();

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect /dashboard routes
  if (request.nextUrl.pathname.startsWith("/dashboard")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Optional: Redirect /login to /dashboard if already logged in
  if (
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup")
  ) {
    if (user && !request.nextUrl.searchParams.get("claimToken")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
