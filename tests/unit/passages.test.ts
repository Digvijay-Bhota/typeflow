import { describe, it, expect } from "vitest";
import { englishPassages, selectPassage, selectNextPassage } from "@/features/typing/lib/passages";

describe("passages", () => {
  it("exports an array of englishPassages", () => {
    expect(Array.isArray(englishPassages)).toBe(true);
    expect(englishPassages.length).toBeGreaterThan(0);
    expect(englishPassages[0].id).toBeDefined();
    expect(englishPassages[0].content).toBeDefined();
  });
  
  it("selectPassage", () => {
    const passage = selectPassage({ mode: "ENGLISH" });
    expect(passage).toBeDefined();
  });
  
  it("selectNextPassage", () => {
    const passage = selectNextPassage({ mode: "ENGLISH", previousId: "1" });
    expect(passage).toBeDefined();
  });
});
