import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { db } from "@/server/db";
import { EmptyState } from "@/components/EmptyState";
import { Award, ShieldCheck, Download, ExternalLink } from "lucide-react";
import Link from "next/link";

export default async function CertificatesDashboard() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const certificates = await db.certificate.findMany({
    where: { userId: user.id },
    include: { result: true },
    orderBy: { issuedAt: "desc" }
  });

  if (certificates.length === 0) {
    return (
      <div className="animate-fade-in w-full max-w-5xl mx-auto flex flex-col gap-6">
        <h1 className="text-4xl font-black mb-2 tracking-tight">Your Certificates</h1>
        <EmptyState
          title="No Certificates Earned Yet"
          description="Complete a verified typing test with at least 40 WPM and 95% accuracy to earn your first official TypeFlow certificate."
          icon={<Award className="h-10 w-10 text-emerald-500" />}
          actionText="Take a Verified Test"
          actionHref="/typing-test"
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in w-full max-w-5xl mx-auto flex flex-col gap-10 pb-12">
      <div>
        <h1 className="text-4xl font-black mb-2 tracking-tight">Your Certificates</h1>
        <p className="text-muted">Manage, verify, and download your earned TypeFlow credentials.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {certificates.map((cert) => (
          <div key={cert.id} className="bg-gradient-to-br from-surface to-surface-elevated border border-border p-6 rounded-3xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-colors" />
            
            <div className="flex justify-between items-start mb-6 relative z-10">
               <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 shadow-glow shadow-emerald-500/10">
                  <ShieldCheck className="h-6 w-6 text-emerald-500" />
               </div>
               <span className="bg-background border border-border text-foreground text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
                  Verified
               </span>
            </div>

            <div className="space-y-4 relative z-10 mb-8">
               <h3 className="text-xl font-bold tracking-tight">Official Typist</h3>
               <div className="flex gap-4">
                 <div>
                    <p className="text-muted text-[10px] uppercase tracking-widest font-bold mb-1">Speed</p>
                    <p className="text-2xl font-black">{Math.round(cert.result.wpm)} <span className="text-xs text-muted font-bold uppercase tracking-widest">WPM</span></p>
                 </div>
                 <div>
                    <p className="text-muted text-[10px] uppercase tracking-widest font-bold mb-1">Accuracy</p>
                    <p className="text-2xl font-black">{Math.round(cert.result.accuracy * 100)}<span className="text-lg text-muted">%</span></p>
                 </div>
               </div>
               <div>
                  <p className="text-muted text-[10px] uppercase tracking-widest font-bold mb-1">Issued On</p>
                  <p className="text-sm font-bold text-foreground">{new Date(cert.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
               </div>
            </div>

            <div className="flex items-center gap-2 relative z-10 border-t border-border pt-4">
               <Link href={`/certificate/${cert.id}`} className="flex-1 bg-background hover:bg-surface-elevated border border-border py-2.5 rounded-xl text-center text-xs font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-2 text-foreground">
                  <ExternalLink className="h-3 w-3" /> View
               </Link>
               {cert.pdfUrl && (
                  <a href={cert.pdfUrl} target="_blank" rel="noreferrer" className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white py-2.5 rounded-xl text-center text-xs font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-2 shadow-glow shadow-emerald-500/20">
                    <Download className="h-3 w-3" /> PDF
                  </a>
               )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
