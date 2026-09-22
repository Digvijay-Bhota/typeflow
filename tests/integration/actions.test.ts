import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, signup, logout } from "@/app/(auth)/actions";
import {
  LOGIN_IP_LIMIT,
  LOGIN_EMAIL_LIMIT,
  SIGNUP_IP_LIMIT,
  SIGNUP_EMAIL_LIMIT,
} from "@/app/(auth)/rate-limit-config";
import * as serverSupabase from "@/lib/supabase/server";
import * as nextNavigation from "next/navigation";
import * as nextCache from "next/cache";
import * as nextHeaders from "next/headers";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

// Note: rateLimit.ts is intentionally NOT mocked — these tests exercise the
// real in-memory limiter to verify the actual throttling/key behavior.
// Every test therefore uses its own unique IP/email so state from one test
// can't bleed into another (the limiter's Map is module-level and persists
// across `it()` blocks within this file).
function mockIp(ip: string) {
  vi.mocked(nextHeaders.headers).mockResolvedValue(
    new Headers({ "x-forwarded-for": ip }) as any
  );
}

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return formData;
}

describe("Login Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should redirect to /dashboard on successful login", async () => {
    mockIp("198.51.100.1");
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await login(
      buildFormData({ email: "login-success@test.com", password: "correct-password" })
    );

    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "login-success@test.com",
      password: "correct-password",
    });
    expect(nextNavigation.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("should redirect to /login?error on failed login (invalid credentials)", async () => {
    mockIp("198.51.100.2");
    const mockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: new Error("Invalid") }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await login(
      buildFormData({ email: "login-failure@test.com", password: "wrong-password" })
    );

    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalled();
    expect(nextNavigation.redirect).toHaveBeenCalledWith(
      "/login?error=Could not authenticate user"
    );
  });

  it("blocks the Supabase call once the IP rate limit is exceeded", async () => {
    const ip = "203.0.113.10";
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    // Exhaust the IP limit using a distinct email each time so the email
    // limiter (lower threshold) never triggers first.
    for (let i = 0; i < LOGIN_IP_LIMIT; i++) {
      mockIp(ip);
      await login(
        buildFormData({ email: `ip-limit-${i}@test.com`, password: "pass123" })
      );
    }
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_IP_LIMIT);

    mockIp(ip);
    await login(
      buildFormData({ email: "ip-limit-overflow@test.com", password: "pass123" })
    );

    // Supabase must not have been called for the blocked attempt.
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_IP_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/login?error=Could not authenticate user"
    );
  });

  it("blocks the Supabase call once the email rate limit is exceeded", async () => {
    const email = "email-limit-target@test.com";
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    // Exhaust the email limit using a distinct IP each time so the (higher)
    // IP limiter never triggers first.
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) {
      mockIp(`203.0.113.${20 + i}`);
      await login(buildFormData({ email, password: "pass123" }));
    }
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);

    mockIp("203.0.113.99");
    await login(buildFormData({ email, password: "pass123" }));

    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/login?error=Could not authenticate user"
    );
  });

  it("returns the same generic response whether blocked by rate limiting or a real auth failure", async () => {
    const blockedRedirectTarget = "/login?error=Could not authenticate user";

    // Real auth failure (from the earlier test in this suite already proved
    // its exact redirect string); re-derive it here explicitly for a direct
    // side-by-side comparison against the rate-limited outcome.
    mockIp("198.51.100.50");
    const failMockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: new Error("bad creds") }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(failMockSupabase as any);
    await login(
      buildFormData({ email: "generic-response-fail@test.com", password: "wrong" })
    );
    const realFailureRedirect = vi.mocked(nextNavigation.redirect).mock.calls.at(-1)?.[0];
    expect(realFailureRedirect).toBe(blockedRedirectTarget);

    // Now trip the email limiter and compare.
    const email = "generic-response-blocked@test.com";
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) {
      mockIp(`203.0.113.${40 + i}`);
      await login(buildFormData({ email, password: "pass123" }));
    }
    mockIp("203.0.113.199");
    await login(buildFormData({ email, password: "pass123" }));
    const blockedRedirect = vi.mocked(nextNavigation.redirect).mock.calls.at(-1)?.[0];

    expect(blockedRedirect).toBe(realFailureRedirect);
  });

  it("does not share the email limiter key between different emails", async () => {
    const emailA = "isolation-email-a@test.com";
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    // Exhaust email A's limit using a distinct IP each time so the (higher)
    // IP limiter never triggers first — isolates the email limiter.
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) {
      mockIp(`203.0.113.${220 + i}`);
      await login(buildFormData({ email: emailA, password: "pass123" }));
    }
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);

    // One more attempt for email A, from a brand-new IP, must be blocked —
    // proving the block is keyed on the email, not the IP.
    mockIp("203.0.113.230");
    await login(buildFormData({ email: emailA, password: "pass123" }));
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/login?error=Could not authenticate user"
    );

    // A genuinely different email, from yet another IP, must be entirely
    // unaffected by email A's exhausted quota — proving the keys don't collide.
    mockIp("203.0.113.231");
    await login(
      buildFormData({ email: "isolation-email-b@test.com", password: "pass123" })
    );
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(
      LOGIN_EMAIL_LIMIT + 1
    );
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith("/dashboard");
  });

  it("maps equivalent (differently-cased/whitespaced) emails to the same limiter key, while a genuinely different email stays independent", async () => {
    const mockSupabase = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    // All five of these normalize (trim + lowercase) to the same address, so
    // together they exhaust exactly one email-limiter key.
    const equivalentVariants = [
      "Normalize@Test.com",
      "normalize@test.com",
      "  normalize@test.com  ",
      "NORMALIZE@TEST.COM",
      "NoRmAlIzE@tEsT.cOm",
    ];
    expect(equivalentVariants.length).toBe(LOGIN_EMAIL_LIMIT);

    for (let i = 0; i < equivalentVariants.length; i++) {
      mockIp(`203.0.113.${80 + i}`);
      await login(buildFormData({ email: equivalentVariants[i]!, password: "pass123" }));
    }
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);

    // Property 1 — equivalence: a further differently-cased/whitespaced variant
    // of the SAME address must now be blocked, proving all five variants above
    // normalized into a single, now-exhausted limiter key.
    mockIp("203.0.113.200");
    await login(buildFormData({ email: " NORMALIZE@TEST.COM ", password: "pass123" }));
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(LOGIN_EMAIL_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/login?error=Could not authenticate user"
    );

    // Property 2 — independence: a GENUINELY different mailbox (plus-addressing
    // changes the address Supabase actually authenticates) must be entirely
    // unaffected by the exhausted quota above, proving the key isn't over-broad.
    mockIp("203.0.113.201");
    await login(
      buildFormData({ email: "normalize+other@test.com", password: "pass123" })
    );
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(
      LOGIN_EMAIL_LIMIT + 1
    );
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith("/dashboard");
  });
});

describe("Signup Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should redirect to /signup?error if signup fails", async () => {
    mockIp("198.51.100.101");
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: new Error("Failed"),
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await signup(
      buildFormData({
        email: "signup-fail-1@test.com",
        password: "pass123",
        displayName: "Test User",
      })
    );

    expect(nextNavigation.redirect).toHaveBeenCalledWith(
      "/signup?error=Could not create user"
    );
  });

  it("should redirect to /signup/check-email if signup succeeds but no session (email confirmation required)", async () => {
    mockIp("198.51.100.102");
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: null },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await signup(
      buildFormData({
        email: "signup-check-email@test.com",
        password: "pass123",
        displayName: "Test User",
      })
    );

    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(nextNavigation.redirect).toHaveBeenCalledWith("/signup/check-email");
  });

  it("should redirect to /dashboard if signup succeeds with session", async () => {
    mockIp("198.51.100.103");
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await signup(
      buildFormData({
        email: "signup-dashboard@test.com",
        password: "pass123",
        displayName: "Test User",
      })
    );

    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(nextNavigation.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("should redirect to login with claimToken if signup succeeds with claimToken", async () => {
    mockIp("198.51.100.104");
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    await signup(
      buildFormData({
        email: "signup-claim@test.com",
        password: "pass123",
        displayName: "Test User",
        claimToken: "claim-token-123",
      })
    );

    expect(nextNavigation.redirect).toHaveBeenCalledWith(
      "/login?claimToken=claim-token-123&claimed=true"
    );
  });

  it("blocks the Supabase signUp call once the email rate limit is exceeded", async () => {
    const email = "signup-email-limit@test.com";
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    for (let i = 0; i < SIGNUP_EMAIL_LIMIT; i++) {
      mockIp(`203.0.113.${120 + i}`);
      await signup(
        buildFormData({ email, password: "pass123", displayName: "Test User" })
      );
    }
    expect(mockSupabase.auth.signUp).toHaveBeenCalledTimes(SIGNUP_EMAIL_LIMIT);

    mockIp("203.0.113.199");
    await signup(buildFormData({ email, password: "pass123", displayName: "Test User" }));

    expect(mockSupabase.auth.signUp).toHaveBeenCalledTimes(SIGNUP_EMAIL_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/signup?error=Could not create user"
    );
  });

  it("blocks the Supabase signUp call once the IP rate limit is exceeded", async () => {
    const ip = "203.0.113.150";
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    for (let i = 0; i < SIGNUP_IP_LIMIT; i++) {
      mockIp(ip);
      await signup(
        buildFormData({
          email: `signup-ip-limit-${i}@test.com`,
          password: "pass123",
          displayName: "Test User",
        })
      );
    }
    expect(mockSupabase.auth.signUp).toHaveBeenCalledTimes(SIGNUP_IP_LIMIT);

    mockIp(ip);
    await signup(
      buildFormData({
        email: "signup-ip-limit-overflow@test.com",
        password: "pass123",
        displayName: "Test User",
      })
    );

    expect(mockSupabase.auth.signUp).toHaveBeenCalledTimes(SIGNUP_IP_LIMIT);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/signup?error=Could not create user"
    );
  });

  it("preserves the existing outward redirect when rate limited (no distinct message)", async () => {
    // Same string asserted in "should redirect to /signup?error if signup fails" —
    // proves the blocked path is indistinguishable from a normal signup failure.
    const email = "signup-generic-response@test.com";
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    for (let i = 0; i < SIGNUP_EMAIL_LIMIT; i++) {
      mockIp(`203.0.113.${160 + i}`);
      await signup(
        buildFormData({ email, password: "pass123", displayName: "Test User" })
      );
    }
    mockIp("203.0.113.199");
    await signup(buildFormData({ email, password: "pass123", displayName: "Test User" }));

    expect(nextNavigation.redirect).toHaveBeenLastCalledWith(
      "/signup?error=Could not create user"
    );
  });
});

describe("Logout Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("remains unrestricted — no rate limiting is applied", async () => {
    const mockSupabase = {
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    // Call it many more times than any auth rate limit threshold; logout
    // never touches rateLimit(), so every call must succeed identically.
    for (let i = 0; i < LOGIN_IP_LIMIT + 5; i++) {
      await logout();
    }

    expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(LOGIN_IP_LIMIT + 5);
    expect(nextNavigation.redirect).toHaveBeenLastCalledWith("/");
  });
});
