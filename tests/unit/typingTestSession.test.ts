// @vitest-environment happy-dom
/**
 * TypingTest keeps only the latest session.
 *
 * The config bar stays usable while a passage loads, so a slow response to an
 * earlier config can arrive after the response to the current one. Only the
 * latest request may apply its response; an older one is dropped.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { TypingTest } from "@/features/typing/components/TypingTest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const sessionResponse = (sessionId: string, content: string) =>
  new Response(
    JSON.stringify({
      sessionId,
      integrityToken: `${sessionId}-token`,
      passage: { id: `${sessionId}-passage`, content },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

describe("TypingTest — stale session responses", () => {
  it("ignores an older session response that arrives last", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first, second];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== "/api/session/create") throw new Error("unexpected");
      const next = pending.shift();
      if (!next) throw new Error("too many session requests");
      return next.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(TypingTest, {}));
    // The user picks another duration while the first passage is loading.
    fireEvent.click(screen.getByRole("button", { name: "30s" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve(sessionResponse("new", "fresh passage")));
    await act(async () => first.resolve(sessionResponse("old", "stale passage")));

    const textbox = await screen.findByRole("textbox");
    await waitFor(() => expect(textbox.textContent).toContain("fresh passage"));
    expect(textbox.textContent).not.toContain("stale passage");
  });
});

describe("Guest Claim Tokens", () => {
  it("allows multiple independent guest tests without claim-token collision", async () => {
    // We mock the completion fetch.
    let resultCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/session/create") {
        return sessionResponse("sess", "hello world");
      }
      if (String(input) === "/api/result") {
        resultCount++;
        return new Response(
          JSON.stringify({
            shareUrl: `/result/cm_guest_${resultCount}`,
            claimToken: `claim_token_${resultCount}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Test A
    render(createElement(TypingTest, { mode: "words", wordCount: 1 }));
    const textboxA = await screen.findByRole("textbox");
    // Type the first word "hello" and space
    fireEvent.keyDown(textboxA, { key: "h" });
    fireEvent.keyDown(textboxA, { key: "e" });
    fireEvent.keyDown(textboxA, { key: "l" });
    fireEvent.keyDown(textboxA, { key: "l" });
    await act(async () => {
      fireEvent.keyDown(textboxA, { key: "o" });
    });

    // Result submitted, it should have pushed to the share URL
    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    const urlA = push.mock.calls[0]![0];
    const shareIdA = urlA.split("/").pop();

    // Test B (new test, simulate it returning a different token)
    push.mockClear();
    render(createElement(TypingTest, { mode: "words", wordCount: 2 }));
    const textboxB = await screen.findByRole("textbox");
    fireEvent.keyDown(textboxB, { key: "h" });
    fireEvent.keyDown(textboxB, { key: "e" });
    fireEvent.keyDown(textboxB, { key: "l" });
    fireEvent.keyDown(textboxB, { key: "l" });
    fireEvent.keyDown(textboxB, { key: "o" });
    fireEvent.keyDown(textboxB, { key: " " });
    fireEvent.keyDown(textboxB, { key: "w" });
    fireEvent.keyDown(textboxB, { key: "o" });
    fireEvent.keyDown(textboxB, { key: "r" });
    fireEvent.keyDown(textboxB, { key: "l" });
    await act(async () => {
      fireEvent.keyDown(textboxB, { key: "d" });
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    const urlB = push.mock.calls[0]![0];
    const shareIdB = urlB.split("/").pop();

    expect(shareIdA).not.toBe(shareIdB);

    // Verify sessionStorage has both tokens separately stored
    expect(sessionStorage.getItem(`tf_claim_token_${shareIdA}`)).toBeDefined();
    expect(sessionStorage.getItem(`tf_claim_token_${shareIdB}`)).toBeDefined();
    expect(sessionStorage.getItem(`tf_claim_token_${shareIdA}`)).not.toBe(
      sessionStorage.getItem(`tf_claim_token_${shareIdB}`)
    );
  });
});
