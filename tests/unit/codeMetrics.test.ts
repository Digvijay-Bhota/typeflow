import { describe, it, expect } from "vitest";
import { calculateCodeMetrics } from "@/features/typing/lib/codeMetrics";
import { ErrorMap } from "@/types/typing";

describe("Code Metrics", () => {
  it("calculates indentation and whitespace correctly", () => {
    const passage = "def foo():\n    return True\n";
    // Indexes:
    // 0123456789 (newline at 10)
    // 11 12 13 14 (spaces)
    // 15..25 (return True\n)
    
    // Let's create a fake errorMap where one indentation space has an error,
    // one regular space has an error.
    const errorMap: ErrorMap = {
      3: { expected: " ", typed: "x", corrected: false }, // space after def
      12: { expected: " ", typed: "x", corrected: false }, // 2nd space of indentation
    };
    
    const metrics = calculateCodeMetrics(passage, errorMap);
    
    // total indentation: 4 spaces + 2 newlines (wait, newlines themselves?
    // In our logic: if char === '\n', isIndentation checks previous char.
    // wait, passage[i-1] for '\n'.
    // Newline at index 10: i-1 = 9 (':'). Not ' ' or '\t' or '\n'. So isIndentation(10) is false.
    // Newline at index 26: i-1 = 25 ('e'). False.
    // Indentation spaces: index 11,12,13,14. i-1 is \n or space. So 4 indentation spaces.
    
    expect(metrics.totalIndentation).toBeGreaterThan(0);
    expect(metrics.indentationErrors).toBe(1);
    expect(metrics.whitespaceErrors).toBe(1);
  });
});
