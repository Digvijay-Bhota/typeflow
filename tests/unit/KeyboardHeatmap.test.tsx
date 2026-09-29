// @vitest-environment happy-dom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KeyboardHeatmap } from "@/features/analytics/components/KeyboardHeatmap";

describe("KeyboardHeatmap", () => {
  it("renders empty state when errorMap is null", () => {
    render(<KeyboardHeatmap errorMap={null} />);
    expect(screen.getByText("No key data available")).toBeTruthy();
  });

  it("renders empty state when errorMap is empty", () => {
    render(<KeyboardHeatmap errorMap={{}} />);
    expect(screen.getByText("No key data available")).toBeTruthy();
  });

  it("renders heatmap with keys when errorMap is provided", () => {
    const errorMap = {
      a: { expected: "a", count: 5, corrected: 2, uncorrected: 3 },
      b: { expected: "b", count: 2, corrected: 1, uncorrected: 1 },
      " ": { expected: " ", count: 10, corrected: 5, uncorrected: 5 },
    };

    render(<KeyboardHeatmap errorMap={errorMap} />);

    // Check aria label of the container
    expect(screen.getByRole("region", { name: "Keyboard Error Heatmap" })).toBeTruthy();

    // Check individual keys
    expect(screen.getByLabelText("Key a, 5 misses")).toBeTruthy();
    expect(screen.getByLabelText("Key b, 2 misses")).toBeTruthy();
    expect(screen.getByLabelText("Key Space, 10 misses")).toBeTruthy();

    // Check that keys with no errors are also rendered
    expect(screen.getByLabelText("Key q, 0 misses")).toBeTruthy();
  });
});
