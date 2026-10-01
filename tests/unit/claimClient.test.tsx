// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ClaimClient } from "@/features/auth/components/ClaimClient";
import React from "react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("ClaimClient", () => {
  beforeEach(() => {
    sessionStorage.clear();
    pushMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the correct keyed token after a successful claim", async () => {
    const shareId = "guest_123";
    const token = "claim_token_abc";
    sessionStorage.setItem(`tf_claim_token_${shareId}`, token);
    sessionStorage.setItem("tf_claim_token_other", "keep_me");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ shareId: "claimed_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ClaimClient claimToken={token} shareId={shareId} />);

    await waitFor(() => {
      expect(screen.getByText("Result claimed successfully!")).toBeTruthy();
    });

    expect(sessionStorage.getItem(`tf_claim_token_${shareId}`)).toBeNull();
    expect(sessionStorage.getItem("tf_claim_token_other")).toBe("keep_me");

    vi.runAllTimers();
    expect(pushMock).toHaveBeenCalledWith("/result/claimed_123");
  });
});
