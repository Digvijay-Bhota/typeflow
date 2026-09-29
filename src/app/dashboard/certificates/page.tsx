import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { db } from "@/server/db";
import { Award, ShieldCheck, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink, PageHeader } from "@/components/ui";
import {
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_WPM,
} from "@/lib/constants";
import {
  certificateAccuracyPercent,
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

  const header = (
    <PageHeader
      title="Certificates"
      description="Your TypeFlow certificates: open one to see its public verification page, or download the PDF."
    />
  );

  if (certificates.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col gap-8 pb-12">
        {header}
        <EmptyState
          title="No certificates yet"
          description={`A certificate comes from a ${CERTIFICATE_MIN_DURATION / 60}-minute certified test passed at ${CERTIFICATE_MIN_WPM}+ net WPM and ${CERTIFICATE_MIN_ACCURACY}%+ accuracy. Once you have one, it appears here with its verification link.`}
          actionText="Take the certified test"
          actionHref="/typing-test-with-certificate"
          icon={<Award />}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-8 pb-12">
      {header}

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
                <h2 className="text-xl font-bold tracking-tight">Official Typist</h2>
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
                      {certificateAccuracyPercent(cert.accuracy)}
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

        {/* Another attempt: the real eligibility bar, from constants. */}
        <div className="border-border flex flex-col justify-between gap-6 rounded-3xl border border-dashed p-6">
          <div className="flex flex-col gap-2">
            <Award aria-hidden="true" className="text-accent size-6" />
            <h2 className="text-lg font-semibold tracking-tight">
              Earn another certificate
            </h2>
            <p className="text-secondary text-sm">
              Pass a {CERTIFICATE_MIN_DURATION / 60}-minute certified test at{" "}
              {CERTIFICATE_MIN_WPM}+ net WPM and {CERTIFICATE_MIN_ACCURACY}%+ accuracy.
            </p>
          </div>
          <ButtonLink
            href="/typing-test-with-certificate"
            variant="secondary"
            className="w-fit"
          >
            Take the certified test
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
