import type { ErrorMap } from "@/types/typing";

export interface CodeMetrics {
  punctuationAccuracy: number;
  whitespaceAccuracy: number;
  indentationAccuracy: number;
  symbolAccuracy: number;
  totalPunctuation: number;
  totalWhitespace: number;
  totalIndentation: number;
  totalSymbols: number;
  punctuationErrors: number;
  whitespaceErrors: number;
  indentationErrors: number;
  symbolErrors: number;
}

function isIndentation(passage: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0) {
    if (passage[i] === "\n") return true;
    if (passage[i] !== " " && passage[i] !== "\t") return false;
    i--;
  }
  return true; // start of file
}

export function calculateCodeMetrics(passage: string, errorMap: ErrorMap): CodeMetrics {
  let totalPunctuation = 0,
    punctuationErrors = 0;
  let totalWhitespace = 0,
    whitespaceErrors = 0;
  let totalIndentation = 0,
    indentationErrors = 0;
  let totalSymbols = 0,
    symbolErrors = 0;

  for (let i = 0; i < passage.length; i++) {
    const char = passage[i] as string;
    const hasError =
      !!errorMap[i] && errorMap[i] !== undefined && !errorMap[i]!.corrected;

    if (char === " " || char === "\t" || char === "\n") {
      if (isIndentation(passage, i)) {
        totalIndentation++;
        if (hasError) indentationErrors++;
      } else {
        totalWhitespace++;
        if (hasError) whitespaceErrors++;
      }
    } else if (/^[.,;:!?'"…]$/.test(char)) {
      totalPunctuation++;
      if (hasError) punctuationErrors++;
    } else if (/^[\[\]{}()<>+\-*/%=&|^~\\]$/.test(char) || /^[`@#$_]$/.test(char)) {
      totalSymbols++;
      if (hasError) symbolErrors++;
    }
  }

  const calcAcc = (total: number, errs: number) =>
    total === 0 ? 1 : Math.max(0, (total - errs) / total);

  return {
    totalPunctuation,
    punctuationErrors,
    punctuationAccuracy: calcAcc(totalPunctuation, punctuationErrors),
    totalWhitespace,
    whitespaceErrors,
    whitespaceAccuracy: calcAcc(totalWhitespace, whitespaceErrors),
    totalIndentation,
    indentationErrors,
    indentationAccuracy: calcAcc(totalIndentation, indentationErrors),
    totalSymbols,
    symbolErrors,
    symbolAccuracy: calcAcc(totalSymbols, symbolErrors),
  };
}
