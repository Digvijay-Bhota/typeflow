import React from "react";
import { db } from "@/server/db";
import { notFound } from "next/navigation";
import { ShieldCheck, Calendar, Clock, Target, Activity } from "lucide-react";
import Link from "next/link";

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const certificate = await db.certificate.findUnique({
    where: { id },
    include: {
      result: true,
      user: true,
    },
  });

  if (!certificate) {
    notFound();
  }

  const { wpm, accuracy, duration } = certificate.result;
  const issueDate = new Date(certificate.issuedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="bg-background text-foreground animate-fade-in flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="bg-surface border-border relative w-full max-w-4xl overflow-hidden rounded-[2rem] border p-1 shadow-2xl md:p-2">
        {/* INNER CERTIFICATE CONTAINER */}
        <div className="bg-background/50 border-border/50 relative flex w-full flex-col items-center overflow-hidden rounded-[1.5rem] border p-8 text-center md:p-16">
          {/* DECORATIVE ELEMENTS */}
          <div
            className="pointer-events-none absolute top-0 left-0 h-full w-full opacity-[0.03]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-emerald-500/10 blur-[100px]" />
          <div className="bg-accent/10 absolute -right-32 -bottom-32 h-96 w-96 rounded-full blur-[100px]" />

          {/* BADGE */}
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl" />
            <div className="bg-background shadow-glow relative z-10 rounded-full border-2 border-emerald-500/30 p-4 shadow-emerald-500/20">
              <ShieldCheck className="h-12 w-12 text-emerald-500" />
            </div>
          </div>

          <h3 className="text-accent mb-4 text-sm font-bold tracking-[0.3em] uppercase">
            Official Verification
          </h3>
          <h1 className="mb-8 text-4xl font-black tracking-tight md:text-6xl">
            Certificate of Typing
          </h1>

          <p className="text-muted mx-auto mb-4 max-w-2xl text-lg leading-relaxed font-medium md:text-xl">
            This is to certify that
          </p>
          <h2 className="text-foreground mb-4 text-3xl font-bold md:text-5xl">
            {certificate.user.displayName || "Verified User"}
          </h2>
          <p className="text-muted mx-auto mb-12 max-w-2xl text-lg leading-relaxed font-medium md:text-xl">
            has successfully completed a proctored and verified typing assessment on the
            TypeFlow platform.
          </p>

          {/* METRICS */}
          <div className="relative z-10 mx-auto mb-16 grid w-full max-w-3xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-8">
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Activity className="text-accent mb-3 h-6 w-6" />
              <span className="text-4xl font-black">{Math.round(wpm)}</span>
              <span className="text-muted mt-1 text-[10px] font-bold tracking-widest uppercase">
                Net Speed (WPM)
              </span>
            </div>
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Target className="mb-3 h-6 w-6 text-emerald-500" />
              <span className="text-4xl font-black">
                {Math.round(accuracy * 100)}
                <span className="text-muted text-lg">%</span>
              </span>
              <span className="text-muted mt-1 text-[10px] font-bold tracking-widest uppercase">
                Accuracy
              </span>
            </div>
            <div className="bg-surface border-border flex flex-col items-center rounded-2xl border p-6">
              <Clock className="mb-3 h-6 w-6 text-purple-400" />
              <span className="text-4xl font-black">
                {duration}
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
              <span className="font-mono text-sm font-medium">{certificate.id}</span>
            </div>
            <div className="flex flex-col text-center md:text-right">
              <span className="text-muted text-[10px] font-bold tracking-widest uppercase">
                Verification URL
              </span>
              <span className="font-mono text-sm font-medium">
                typeflow.com/certificate/{certificate.id.split("-")[0]}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 flex gap-4">
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
