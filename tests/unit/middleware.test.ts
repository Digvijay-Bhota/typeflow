import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options: any }[]) => void;
};

const supabaseMock = vi.hoisted(() => ({
  user: null as { id: string } | null,
  refreshedCookies: [] as { name: string; value: string; options: any }[],
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: supabaseMock.createServerClient.mockImplementation(
    (_url: string, _key: string, { cookies }: { cookies: CookieMethods }) => ({
      auth: {
        getUser: async () => {
          // Simulate a token refresh, which calls setAll() mid-request.
          if (supabaseMock.refreshedCookies.length > 0) {
            cookies.setAll(supabaseMock.refreshedCookies);
          }
          return { data: { user: supabaseMock.user } };
        },
      },
    })
  ),
}));

import { middleware, config } from "@/middleware";

const request = (path: string) => new NextRequest(new URL(path, "https://typeflow.test"));

describe("middleware", () => {
  beforeEach(() => {
    supabaseMock.user = null;
    supabaseMock.refreshedCookies = [];
    supabaseMock.createServerClient.mockClear();

    // Only the two Supabase auth vars are valid. Every other server var is
    // missing or invalid, which getServerEnv() would reject.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-only-anon-key");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://not-tls.example:6379");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIRECT_URL", "");
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    vi.stubEnv("SESSION_SECRET", "too-short");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs on the Node.js runtime and keeps the existing matcher", () => {
    expect(config.runtime).toBe("nodejs");
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ]);
  });

  it("does not depend on unrelated server env vars", async () => {
    const res = await middleware(request("/"));

    expect(res.status).toBe(200);
    expect(supabaseMock.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "test-only-anon-key",
      expect.anything()
    );
  });

  it("fails closed when the Supabase auth vars are missing", async () => {
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(middleware(request("/"))).rejects.toThrow(
      "Invalid Supabase auth environment variables"
    );
    expect(supabaseMock.createServerClient).not.toHaveBeenCalled();
  });

  it("sets a nonce-bearing CSP on the response and x-nonce on the request", async () => {
    const res = await middleware(request("/"));

    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    const nonce = /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("keeps the CSP header and sets cookies when Supabase refreshes the session", async () => {
    supabaseMock.user = { id: "u1" };
    supabaseMock.refreshedCookies = [
      { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
    ];

    const res = await middleware(request("/"));

    expect(res.headers.get("Content-Security-Policy")).toMatch(/'nonce-/);
    expect(res.cookies.get("sb-access-token")?.value).toBe("refreshed");
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("redirects logged-out users away from /dashboard", async () => {
    const res = await middleware(request("/dashboard/settings"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://typeflow.test/login");
  });

  it("lets logged-in users through to /dashboard", async () => {
    supabaseMock.user = { id: "u1" };

    const res = await middleware(request("/dashboard"));

    expect(res.status).toBe(200);
  });

  it.each(["/login", "/signup"])(
    "redirects logged-in users from %s to /dashboard",
    async (path) => {
      supabaseMock.user = { id: "u1" };

      const res = await middleware(request(path));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://typeflow.test/dashboard");
    }
  );

  it("carries refreshed session cookies onto redirects", async () => {
    supabaseMock.user = { id: "u1" };
    supabaseMock.refreshedCookies = [
      { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
    ];

    const res = await middleware(request("/login"));

    expect(res.status).toBe(307);
    expect(res.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });

  it("does not redirect logged-in users from /login when a claimToken is present", async () => {
    supabaseMock.user = { id: "u1" };

    const res = await middleware(request("/login?claimToken=abc"));

    expect(res.status).toBe(200);
  });

  it("does not redirect logged-out users from /login or /signup", async () => {
    expect((await middleware(request("/login"))).status).toBe(200);
    expect((await middleware(request("/signup"))).status).toBe(200);
  });
});
