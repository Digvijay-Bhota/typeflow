import { describe, it, expect } from "vitest";
import { cn, formatDuration, formatMs, formatNumber, formatAccuracy, clamp, generateId, generateCertificateId, debounce, truncate, isBrowser, hashString } from "@/lib/utils";

describe("utils", () => {
  it("cn", () => expect(cn("a", "b")).toBe("a b"));
  it("formatDuration", () => {
    expect(formatDuration(30)).toBe("30 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(120)).toBe("2 minutes");
  });
  it("formatMs", () => {
    expect(formatMs(90000)).toBe("1:30");
  });
  it("formatNumber", () => {
    expect(formatNumber(1.234)).toBe("1.2");
  });
  it("formatAccuracy", () => {
    expect(formatAccuracy(0.964)).toBe("96.4%");
  });
  it("clamp", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(15, 1, 10)).toBe(10);
  });
  it("generateId", () => {
    expect(generateId(10).length).toBe(10);
  });
  it("generateCertificateId", () => {
    expect(generateCertificateId().startsWith("TF-")).toBe(true);
  });
  it("debounce", () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 10);
    fn();
    expect(called).toBe(false);
  });
  it("truncate", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("isBrowser", () => {
    expect(isBrowser()).toBe(false);
  });
  it("hashString", () => {
    expect(typeof hashString("hello")).toBe("number");
  });
});
