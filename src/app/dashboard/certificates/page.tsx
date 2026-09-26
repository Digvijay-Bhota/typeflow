import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { db } from "@/server/db";
import { Award, ShieldCheck, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  certificateOwnerState,
  certificateVerifyPath,
  type CertificateOwnerState,
} from "@/lib/certificateStatus";

const STATE_BADGES: Record<CertificateOwnerState, string> = {
  NONE: "",
  PENDING_PAYMENT: "Awaiting Payment",
  PROCESSING: "Preparing",
  ACTIVE: "Verified",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
};

export default async function CertificatesDashboard() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const certificates = await db.certificate.findMany({
    where: { userId: user.id },
    include: { payment: { select: { status: true } } },
    orderBy: { issuedAt: "desc" },
  });

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-5xl flex-col gap-10 pb-12">
      <div>
        <h1 className="mb-2 text-4xl font-black tracking-tight">Your Certificates</h1>
        <p className="text-muted">
          Manage, verify, and track your progress toward official TypeFlow credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {certificates.map((cert) => {
          const state = certificateOwnerState(cert, cert.payment?.status ?? null);
          return (
            <div
              key={cert.id}
              className="from-surface to-surface-elevated border-border group relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl transition-colors group-hover:bg-emerald-500/20" />

              <div className="relative z-10 mb-6 flex items-start justify-between">
                <div className="shadow-glow rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 shadow-emerald-500/10">
                  <ShieldCheck className="h-6 w-6 text-emerald-500" />
                </div>
                <span className="bg-background border-border text-foreground rounded-full border px-3 py-1.5 text-xs font-bold tracking-wider uppercase">
                  {STATE_BADGES[state]}
                </span>
              </div>

              <div className="relative z-10 mb-8 space-y-4">
                <h3 className="text-xl font-bold tracking-tight">Official Typist</h3>
                <div className="flex gap-4">
                  <div>
                    <p className="text-muted mb-1 text-[10px] font-bold tracking-widest uppercase">
                      Speed
                    </p>
                    <p className="text-2xl font-black">
                      {Math.round(cert.wpm)}{" "}
                      <span className="text-muted text-xs font-bold tracking-widest uppercase">
                        WPM
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-muted mb-1 text-[10px] font-bold tracking-widest uppercase">
                      Accuracy
                    </p>
                    <p className="text-2xl font-black">
                      {Math.round(cert.accuracy * 100)}
                      <span className="text-muted text-lg">%</span>
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-muted mb-1 text-[10px] font-bold tracking-widest uppercase">
                    Issued On
                  </p>
                  <p className="text-foreground text-sm font-bold">
                    {new Date(cert.issuedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>

              <div className="border-border relative z-10 flex items-center gap-2 border-t pt-4">
                <Link
                  href={certificateVerifyPath(cert.certificateId)}
                  className="bg-background hover:bg-surface-elevated border-border text-foreground flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-center text-xs font-bold tracking-wider uppercase transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> View
                </Link>
                {state === "ACTIVE" && cert.pdfUrl && (
                  <a
                    href={cert.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shadow-glow flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-center text-xs font-bold tracking-wider text-white uppercase shadow-emerald-500/20 transition-colors hover:bg-emerald-400"
                  >
                    <Download className="h-3 w-3" /> PDF
                  </a>
                )}
              </div>
            </div>
          );
        })}

        {/* LOCKED CERTIFICATE STATE */}
        <div className="from-surface to-surface-elevated border-border relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6 opacity-60 shadow-sm grayscale transition-all duration-500 hover:opacity-100 hover:grayscale-0">
          <div className="relative z-10 mb-6 flex items-start justify-between">
            <div className="border-muted bg-background rounded-xl border p-3">
              <Award className="text-muted h-6 w-6" />
            </div>
            <span className="bg-background border-border text-muted rounded-full border px-3 py-1.5 text-xs font-bold tracking-wider uppercase">
              Locked
            </span>
          </div>

          <div className="relative z-10 mb-8 space-y-4">
            <h3 className="text-muted text-xl font-bold tracking-tight">Pro Typist</h3>
            <div className="flex gap-4">
              <div>
                <p className="text-muted mb-1 text-[10px] font-bold tracking-widest uppercase">
                  Req. Speed
                </p>
                <p className="text-muted text-2xl font-black">
                  80{" "}
                  <span className="text-xs font-bold tracking-widest uppercase">WPM</span>
                </p>
              </div>
              <div>
                <p className="text-muted mb-1 text-[10px] font-bold tracking-widest uppercase">
                  Req. Accuracy
                </p>
                <p className="text-muted text-2xl font-black">
                  98 <span className="text-lg">%</span>
                </p>
              </div>
            </div>
            <p className="text-muted mt-4 text-xs font-medium">
              Complete a verified session hitting these metrics to unlock this tier.
            </p>
          </div>

          <div className="border-border relative z-10 flex items-center gap-2 border-t pt-4">
            <Link
              href="/typing-test"
              className="bg-accent hover:bg-accent/80 text-accent-foreground flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-center text-xs font-bold tracking-wider uppercase transition-colors"
            >
              Attempt Now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
