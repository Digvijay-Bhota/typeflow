export function formatWpm(wpm: number): string {
  return Math.round(wpm).toString();
}

export function formatAccuracy(accuracy: number): string {
  // accuracy is 0-1
  return `${(accuracy * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatConsistency(consistency: number | null): string {
  if (consistency === null) return "N/A";
  return `${(consistency * 100).toFixed(1).replace(/\.0$/, "")}%`;
}
