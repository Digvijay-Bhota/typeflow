import { describe, it, expect } from "vitest";
import { SubmitResultSchema } from "@/schemas/result.schema";

describe("EventTrace Security & Zod Validation", () => {
  const getBasePayload = () => ({
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    clientElapsedMs: 60000,
    integrityToken: "t1",
    metrics: {
      wpm: 50,
      rawWpm: 50,
      accuracy: 1,
      correctChars: 250,
      incorrectChars: 0,
      totalChars: 250,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      consistency: null,
    },
    integritySignals: {
      pasteAttempts: 0,
      copyAttempts: 0,
      focusLossCount: 0,
      visibilityChanges: 0,
      suspiciousPattern: false,
      intervalWpms: [],
      selectionAttempts: 0,
    },
    eventTrace: {
      events: [
        [100, 0, 0, "h"],
        [250, 0, 1, "e"],
      ] as [number, number, number, string?][],
      totalEvents: 2,
      durationMs: 60000,
    },
  });

  it("should accept a valid structural trace", () => {
    const payload = getBasePayload();
    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("should reject trace exceeding maximum event bounds (DoS protection)", () => {
    const payload = getBasePayload();
    // Over 12000 events
    payload.eventTrace.events = Array(12001).fill([100, 0, 0, "a"]);

    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject negative timestamps", () => {
    const payload = getBasePayload();
    payload.eventTrace.events = [[-100, 0, 0]];
    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid event types (only 0,1 allowed)", () => {
    const payload = getBasePayload();
    payload.eventTrace.events = [[100, 2, 0]]; // Type 2 is invalid now
    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject negative indexes", () => {
    const payload = getBasePayload();
    payload.eventTrace.events = [[100, 0, -1]];
    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject malformed event payloads (e.g. strings)", () => {
    const payload = getBasePayload();
    (payload.eventTrace.events as any) = [[100, 0, "string"]];
    const result = SubmitResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
