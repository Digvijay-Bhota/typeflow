import { describe, it, expect } from "vitest";
import { reconstructFinalBuffer } from "@/features/typing/lib/reconstruct";

describe("reconstructFinalBuffer", () => {
  it("computes abc -> 3 correct, 3 total", () => {
    const trace = {
      events: [
        [100, 0, 0, "a"],
        [200, 0, 1, "b"],
        [300, 0, 2, "c"],
      ],
      totalEvents: 3,
      durationMs: 300,
    };
    const res = reconstructFinalBuffer("abc", trace as any);
    expect(res.isValidTrace).toBe(true);
    expect(res.correctChars).toBe(3);
    expect(res.incorrectChars).toBe(0);
    expect(res.totalChars).toBe(3);
  });

  it("computes axc -> 2 correct, 3 total", () => {
    const trace = {
      events: [
        [100, 0, 0, "a"],
        [200, 0, 1, "x"],
        [300, 0, 2, "c"],
      ],
      totalEvents: 3,
      durationMs: 300,
    };
    const res = reconstructFinalBuffer("abc", trace as any);
    expect(res.isValidTrace).toBe(true);
    expect(res.correctChars).toBe(2);
    expect(res.incorrectChars).toBe(1);
    expect(res.totalChars).toBe(3);
  });

  it("computes xxx -> 0 correct, 3 total", () => {
    const trace = {
      events: [
        [100, 0, 0, "x"],
        [200, 0, 1, "x"],
        [300, 0, 2, "x"],
      ],
      totalEvents: 3,
      durationMs: 300,
    };
    const res = reconstructFinalBuffer("abc", trace as any);
    expect(res.isValidTrace).toBe(true);
    expect(res.correctChars).toBe(0);
    expect(res.incorrectChars).toBe(3);
    expect(res.totalChars).toBe(3);
  });

  it("computes a, backspace, b -> final state scored from final buffer", () => {
    const trace = {
      events: [
        [100, 0, 0, "a"],
        [200, 1, 0],
        [300, 0, 0, "b"],
      ],
      totalEvents: 3,
      durationMs: 300,
    };
    const res = reconstructFinalBuffer("abc", trace as any);
    expect(res.isValidTrace).toBe(true);
    expect(res.correctChars).toBe(0); // 'b' vs 'a'
    expect(res.totalChars).toBe(2); // 'a' pushed, then popped, 'b' pushed -> total pushes = 2
  });

  it("repeated backspace/retype cannot increase correctChars above passage length", () => {
    const trace = {
      events: [
        [100, 0, 0, "a"],
        [200, 1, 0],
        [300, 0, 0, "a"],
        [400, 1, 0],
        [500, 0, 0, "a"],
      ],
      totalEvents: 5,
      durationMs: 500,
    };
    const res = reconstructFinalBuffer("abc", trace as any);
    expect(res.isValidTrace).toBe(true);
    expect(res.correctChars).toBe(1); // Only 1 correct char remaining in the final buffer
    expect(res.totalChars).toBe(3); // 3 pushes total
  });
});
