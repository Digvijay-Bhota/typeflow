import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Clock,
  Target,
  Activity,
  Download,
} from "lucide-react";
import { getCertificateVerification } from "@/server/services/certificate.service";
import { certificateVerifyPath } from "@/lib/certificateStatus";

// Status changes (activation, refund, revocation) must show immediately.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Certificate Verification | TypeFlow",
  robots: { index: false, follow: false },
};

const STATUS_TITLES = {
  PENDING: "Not Activated",
  PROCESSING: "Being Prepared",
  REVOKED: "Certificate Revoked",
  EXPIRED: "Certificate Expired",
  INVALID: "Verification Failed",
} as const;

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;
  const verification = await getCertificateVerification(certificateId);
  if (!verification) notFound();

  if (verification.state !== "VERIFIED") {
    return (
      <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
        <div className="bg-surface border-border w-full max-w-xl rounded-[2rem] border p-10 text-center shadow-xl">
          <div className="mx-auto mb-6 w-fit rounded-full border-2 border-red-500/30 p-4">
            <ShieldAlert className="h-12 w-12 text-red-500" />
          </div>
          <h3 className="mb-3 text-sm font-bold tracking-[0.3em] text-red-500 uppercase">
            Not Verified
          </h3>
          <h1 className="mb-4 text-3xl font-black tracking-tight">
            {STATUS_TITLES[verification.state]}
          </h1>
          <p className="text-muted mb-8 text-lg font-medium">{verification.message}</p>
          <p className="text-muted text-[10px] font-bold tracking-widest uppercase">
            Certificate ID
          </p>
          <p className="font-mono text-sm font-medium">{verification.certificateId}</p>
        </div>
        <div className="mt-12">
          <Link
            href="/"
            className="bg-surface text-foreground border-border hover:bg-surface-elevated rounded-xl border px-6 py-3 font-bold transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const issueDate = verification.issuedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="bg-background text-foreground animate-fade-in flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="bg-surface border-border relative w-full max-w-4xl overflow-hidden rounded-[2rem] border p-1 shadow-2xl md:p-2">
        <div className="bg-background/50 border-border/50 relative flex w-full flex-col items-center overflow-hidden rounded-[1.5rem] border p-8 text-center md:p-16">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-emerald-500/10 blur-[100px]" />
          <div className="bg-accent/10 absolute -right-32 -bottom-32 h-96 w-96 rounded-full blur-[100px]" />

          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl" />
            <div className="bg-background shadow-glow relative z-10 rounded-full border-2 border-emerald-500/30 p-4 shadow-emerald-500/20">
              <ShieldCheck className="h-12 w-12 text-emerald-500" />
            </div>
          </div>

          <h3 className="mb-4 text-sm font-bold tracking-[0.3em] text-emerald-500 uppercase">
            Verified Certificate
          </h3>
          <h1 className="mb-8 text-4xl font-black tracking-tight md:text-6xl">
            Certificate of Typing
          </h1>

          <p className="text-muted mx-auto mb-4 max-w-2xl text-lg leading-relaxed font-medium md:text-xl">
            This is to certify that
          </p>
          <h2 className="text-foreground mb-4 text-3xl font-bold md:text-5xl">
            {verification.recipientName}
          </h2>
          <p className="text-muted mx-auto mb-12 max-w-2xl text-lg leading-relaxed font-medium md:text-xl">
            has completed a server-verified {verification.testType.toLowerCase()} (
            {verification.language.toLowerCase()}) on the TypeFlow platform.{" "}
            {verification.message}
          </p>

          <div className="relative z-10 mx-auto mb-16 grid w-full max-w-3xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-8">
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Activity className="text-accent mb-3 h-6 w-6" />
              <span className="text-4xl font-black">{Math.round(verification.wpm)}</span>
              <span className="text-muted mt-1 text-[10px] font-bold tracking-widest uppercase">
                Net Speed (WPM)
              </span>
            </div>
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Target className="mb-3 h-6 w-6 text-emerald-500" />
              <span className="text-4xl font-black">
                {Math.round(verification.accuracy * 100)}
                <span className="text-muted text-lg">%</span>
              </span>
              <span className="text-muted mt-1 text-[10px] font-bold tracking-widest uppercase">
                Accuracy
              </span>
            </div>
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Clock className="mb-3 h-6 w-6 text-purple-400" />
              <span className="text-4xl font-black">
                {verification.duration}
                <span className="text-muted text-lg">s</span>
              </span>
              <span className="text-muted mt-1 text-[10px] font-bold tracking-widest uppercase">
                Duration
              </span>
            </div>
            <div className="bg-surface border-border flex flex-col items-center justify-center rounded-2xl border p-6">
              <Calendar className="mb-3 h-6 w-6 text-blue-400" />
              <span className="text-muted mt-1 text-center text-[10px] leading-relaxed font-bold tracking-widest uppercase">
                Issued On
                <br />
                {issueDate}
              </span>
            </div>
          </div>

          <div className="border-border/50 mt-8 flex w-full max-w-3xl flex-col items-center justify-between gap-6 border-t pt-8 md:flex-row">
            <div className="flex flex-col text-left">
              <span className="text-muted text-[10px] font-bold tracking-widest uppercase">
                Certificate ID
              </span>
              <span className="font-mono text-sm font-medium">
                {verification.certificateId}
              </span>
            </div>
            <div className="flex flex-col text-center md:text-right">
              <span className="text-muted text-[10px] font-bold tracking-widest uppercase">
                Verification URL
              </span>
              <span className="font-mono text-sm font-medium">
                {certificateVerifyPath(verification.certificateId)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 flex gap-4">
        {verification.pdfUrl && (
          <a
            href={verification.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 font-bold text-white transition-colors hover:bg-emerald-400"
          >
            <Download className="h-4 w-4" /> Download PDF
          </a>
        )}
        <Link
          href="/"
          className="bg-surface text-foreground border-border hover:bg-surface-elevated rounded-xl border px-6 py-3 font-bold transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
