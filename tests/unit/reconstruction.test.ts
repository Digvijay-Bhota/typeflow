import { describe, it, expect } from "vitest";
import { verifyCertificateTest } from "@/server/services/certificateVerification.service";

describe("verifyCertificateTest", () => {
  const passage = "hello world";

  it("should verify a valid perfect trace", () => {
    const trace: [number, number, number, string?][] = [
      [0, 0, 0, "h"],
      [100, 0, 1, "e"],
      [200, 0, 2, "l"],
      [300, 0, 3, "l"],
      [400, 0, 4, "o"],
      [500, 0, 5, " "],
      [600, 0, 6, "w"],
      [700, 0, 7, "o"],
      [800, 0, 8, "r"],
      [900, 0, 9, "l"],
      [1000, 0, 10, "d"],
    ];

    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("VERIFIED");
    expect(result.reconstructed?.correctChars).toBe(11);
    expect(result.reconstructed?.incorrectChars).toBe(0);
    expect(result.reconstructed?.totalChars).toBe(11);
  });

  it("should correctly handle wrong characters", () => {
    // "hello wxrld" (error at 'o' index 7)
    const trace: [number, number, number, string?][] = [
      [0, 0, 0, "h"], [100, 0, 1, "e"], [200, 0, 2, "l"], [300, 0, 3, "l"],
      [400, 0, 4, "o"], [500, 0, 5, " "], [600, 0, 6, "w"],
      [700, 0, 7, "x"], // typed x instead of o
      [800, 0, 8, "r"], [900, 0, 9, "l"], [1000, 0, 10, "d"],
    ];

    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("VERIFIED");
    expect(result.reconstructed?.correctChars).toBe(10);
    expect(result.reconstructed?.incorrectChars).toBe(1);
    expect(result.reconstructed?.uncorrectedErrors).toBe(1);
  });

  it("should correctly handle backspace and correction", () => {
    // "hello wx" -> backspace -> "world"
    const trace: [number, number, number, string?][] = [
      [0, 0, 0, "h"], [100, 0, 1, "e"], [200, 0, 2, "l"], [300, 0, 3, "l"],
      [400, 0, 4, "o"], [500, 0, 5, " "], [600, 0, 6, "w"],
      [700, 0, 7, "x"], // typed x instead of o
      [800, 1, 7],      // backspace
      [900, 0, 7, "o"], // typed o correctly
      [1000, 0, 8, "r"], [1100, 0, 9, "l"], [1200, 0, 10, "d"],
    ];

    const result = verifyCertificateTest(passage, trace, 1200);
    expect(result.status).toBe("VERIFIED");
    expect(result.reconstructed?.correctChars).toBe(11); // eventually correct
    expect(result.reconstructed?.incorrectChars).toBe(0); // net 0 since it was corrected
    expect(result.reconstructed?.correctedErrors).toBe(1);
    expect(result.reconstructed?.uncorrectedErrors).toBe(0);
  });

  it("should reject out-of-order events", () => {
    const trace: [number, number, number, string?][] = [
      [100, 0, 0, "h"],
      [50, 0, 1, "e"], // Time went backwards
    ];
    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("INVALID");
    expect(result.reasons).toContain("Events out of order");
  });

  it("should reject invalid index", () => {
    const trace: [number, number, number, string?][] = [
      [100, 0, 0, "h"],
      [200, 0, 2, "e"], // Skipped index 1
    ];
    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("INVALID");
    expect(result.reasons[0]).toContain("Index mismatch");
  });

  it("should reject negative timing", () => {
    const trace: [number, number, number, string?][] = [
      [-10, 0, 0, "h"],
    ];
    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("INVALID");
    expect(result.reasons).toContain("Negative timestamp");
  });

  it("should reject empty trace", () => {
    const result = verifyCertificateTest(passage, [], 1000);
    expect(result.status).toBe("INVALID");
    expect(result.reasons).toContain("Empty event trace");
  });

  it("should reject events significantly after server duration", () => {
    const trace: [number, number, number, string?][] = [
      [0, 0, 0, "h"],
      [10000, 0, 1, "e"], // Server elapsed was only 1000, 10000 is way beyond grace period
    ];
    const result = verifyCertificateTest(passage, trace, 1000);
    expect(result.status).toBe("INVALID");
    expect(result.reasons[0]).toContain("after test duration");
  });

  it("should calculate correct WPM based on server time, not client time", () => {
    const trace: [number, number, number, string?][] = [
      [0, 0, 0, "h"], [10, 0, 1, "e"], [20, 0, 2, "l"], [30, 0, 3, "l"],
      [40, 0, 4, "o"], [50, 0, 5, " "], [60, 0, 6, "w"],
      [70, 0, 7, "o"], [80, 0, 8, "r"], [90, 0, 9, "l"], [100, 0, 10, "d"],
    ];

    // Even though events happened in 100ms, server elapsed is 60000ms (1 minute).
    // WPM should be calculated over 1 minute.
    const result = verifyCertificateTest(passage, trace, 60000);
    expect(result.status).toBe("VERIFIED");
    
    // 11 correct chars -> 11/5 = 2.2 words in 1 minute -> WPM = 2.2
    expect(result.reconstructed?.wpm).toBe(2.2);
  });
});
