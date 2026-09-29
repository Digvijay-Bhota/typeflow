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
