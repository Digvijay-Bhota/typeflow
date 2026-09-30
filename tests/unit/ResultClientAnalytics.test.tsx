import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultClient } from "@/features/analytics/components/ResultClient";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: any) => children,
    LineChart: ({ data }: any) =>
      React.createElement("div", {
        "data-testid": "line-chart",
        "data-chart": JSON.stringify(data),
      }),
  };
});

describe("ResultClient Analytics improvements", () => {
  const baseResult = {
    shareId: "s1",
    wpm: 60,
    rawWpm: 60,
    netWpm: 60,
    accuracy: 0.97,
    consistency: 0.95,
    correctChars: 300,
    incorrectChars: 5,
    totalChars: 305,
    correctedErrors: 2,
    uncorrectedErrors: 3,
    integrityStatus: "VERIFIED",
    scoringSource: "SERVER_RECONSTRUCTED",
    intervalWpms: [],
    errorMap: {},
    session: {
      mode: "TIMED",
      language: "ENGLISH",
      trustTier: "FREE",
      duration: 60,
    },
  };

  it("renders AccuracyPanel and WeakKeys when errors exist", () => {
    const errorMap = {
      a: { expected: "a", count: 3, corrected: 1, uncorrected: 2 },
    };
    const html = renderToStaticMarkup(
      <ResultClient result={{ ...baseResult, errorMap }} />
    );
    expect(html).toContain("Accuracy Breakdown");
    expect(html).toContain("Session Error Analysis");
    expect(html).toContain("3 errors");
  });

  it("renders CodeMetricsPanel for CODE mode", () => {
    const codeMetrics = {
      totalPunctuation: 10,
      punctuationErrors: 1,
      punctuationAccuracy: 0.9,
      totalSymbols: 5,
      symbolErrors: 0,
      symbolAccuracy: 1,
      totalIndentation: 20,
      indentationErrors: 2,
      indentationAccuracy: 0.9,
      totalWhitespace: 15,
      whitespaceErrors: 0,
      whitespaceAccuracy: 1,
    };
    const html = renderToStaticMarkup(
      <ResultClient
        result={{
          ...baseResult,
          session: { ...baseResult.session, language: "CODE", mode: "TIMED" },
          codeMetrics,
        }}
      />
    );
    expect(html).toContain("Code Typing Metrics");
    expect(html).toContain("Punctuation");
    expect(html).toContain("Syntax / Symbols");
  });

  it("renders Trend Analysis for TREND comparison type", () => {
    const comparison = {
      type: "TREND",
      count: 5,
      beforeWpm: 50,
      beforeAccuracy: 95,
    };
    const html = renderToStaticMarkup(
      <ResultClient result={baseResult} comparison={comparison} />
    );
    expect(html).toContain("Recent Trend (Last 5 Tests)");
    expect(html).toContain(
      "Awesome! You&#x27;re trending upwards in speed without losing accuracy."
    );
  });

  it("renders Practice Results for PRACTICE comparison type", () => {
    const comparison = {
      type: "PRACTICE",
      count: 2,
      beforeWpm: 50,
      beforeAccuracy: 95,
    };
    const html = renderToStaticMarkup(
      <ResultClient
        result={{
          ...baseResult,
          session: { ...baseResult.session, mode: "PRACTICE" },
        }}
        comparison={comparison}
      />
    );
    expect(html).toContain("Practice Results");
    expect(html).toContain(
      "Great job! You improved your speed and accuracy on your weak keys."
    );
  });

  it("maps chart data points to 5-second intervals", () => {
    const resultWithIntervals = {
      ...baseResult,
      intervalWpms: [40, 50, 60],
    };

    const html = renderToStaticMarkup(<ResultClient result={resultWithIntervals} />);

    // We expect the array mapped to have seconds 5, 10, 15
    expect(html).toContain("{&quot;second&quot;:5,&quot;wpm&quot;:40}");
    expect(html).toContain("{&quot;second&quot;:10,&quot;wpm&quot;:50}");
    expect(html).toContain("{&quot;second&quot;:15,&quot;wpm&quot;:60}");
  });
});
