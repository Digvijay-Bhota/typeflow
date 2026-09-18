import { describe, it, expect } from "vitest";
import {
  formatWpm,
  formatAccuracy,
  formatDuration,
  formatConsistency,
} from "@/features/analytics/lib/formatMetrics";

describe("Metric Formatting Utilities", () => {
  it("formats WPM correctly by rounding to nearest integer", () => {
    expect(formatWpm(78.4)).toBe("78");
    expect(formatWpm(78.5)).toBe("79");
    expect(formatWpm(0)).toBe("0");
  });

  it("formats accuracy correctly", () => {
    expect(formatAccuracy(1)).toBe("100%");
    expect(formatAccuracy(0.964)).toBe("96.4%");
    expect(formatAccuracy(0.96437829)).toBe("96.4%");
    expect(formatAccuracy(0.5)).toBe("50%");
    expect(formatAccuracy(0)).toBe("0%");
  });

  it("formats duration correctly (mm:ss)", () => {
    expect(formatDuration(5000)).toBe("0:05");
    expect(formatDuration(60000)).toBe("1:00");
    expect(formatDuration(65000)).toBe("1:05");
    expect(formatDuration(150000)).toBe("2:30");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats consistency correctly", () => {
    expect(formatConsistency(0.912)).toBe("91.2%");
    expect(formatConsistency(1)).toBe("100%");
    expect(formatConsistency(null)).toBe("N/A");
  });
});
