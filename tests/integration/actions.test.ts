import { describe, it, expect, vi, beforeEach } from "vitest";
import { signup } from "@/app/(auth)/actions";
import * as serverSupabase from "@/lib/supabase/server";
import * as nextNavigation from "next/navigation";
import * as nextCache from "next/cache";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Signup Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should redirect to /signup?error if signup fails", async () => {
    const mockSupabase = {
      auth: {
        signUp: vi
          .fn()
          .mockResolvedValue({
            data: { user: null, session: null },
            error: new Error("Failed"),
          }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    const formData = new FormData();
    formData.append("email", "test@test.com");
    formData.append("password", "pass123");
    formData.append("displayName", "Test User");

    await signup(formData);

    expect(nextNavigation.redirect).toHaveBeenCalledWith(
      "/signup?error=Could not create user"
    );
  });

  it("should redirect to /signup/check-email if signup succeeds but no session (email confirmation required)", async () => {
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: null },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    const formData = new FormData();
    formData.append("email", "test@test.com");
    formData.append("password", "pass123");
    formData.append("displayName", "Test User");

    await signup(formData);

    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(nextNavigation.redirect).toHaveBeenCalledWith("/signup/check-email");
  });

  it("should redirect to /dashboard if signup succeeds with session", async () => {
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    const formData = new FormData();
    formData.append("email", "test@test.com");
    formData.append("password", "pass123");
    formData.append("displayName", "Test User");

    await signup(formData);

    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(nextNavigation.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("should redirect to login with claimToken if signup succeeds with claimToken", async () => {
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "1" }, session: { access_token: "token" } },
          error: null,
        }),
      },
    };
    vi.mocked(serverSupabase.createClient).mockResolvedValue(mockSupabase as any);

    const formData = new FormData();
    formData.append("email", "test@test.com");
    formData.append("password", "pass123");
    formData.append("displayName", "Test User");
    formData.append("claimToken", "claim-token-123");

    await signup(formData);

    expect(nextNavigation.redirect).toHaveBeenCalledWith(
      "/login?claimToken=claim-token-123&claimed=true"
    );
  });
});
