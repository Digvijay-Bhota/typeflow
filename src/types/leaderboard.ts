export type LeaderboardPeriod = "daily" | "weekly" | "all-time";

export interface LeaderboardQuery {
  period: LeaderboardPeriod;
  mode?: string;
  language?: string;
  codeLanguage?: string;
  duration?: number;
  limit?: number;
  offset?: number;
}

export interface LeaderboardEntry {
  rank: number;
  shareId: string;
  displayName: string;
  avatarUrl: string | null;
  wpm: number;
  netWpm: number;
  accuracy: number;
  duration: number | null;
  mode: string;
  language: string;
  codeLanguage?: string;
  integrityStatus: "VERIFIED" | "REVIEW" | "INVALID";
  isCertificateEligible: boolean;
  trustTier: string;
  createdAt: string;
}
