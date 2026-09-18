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
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 sm:p-12 animate-fade-in">
      
      <div className="w-full max-w-4xl bg-surface border border-border p-1 md:p-2 rounded-[2rem] shadow-2xl relative overflow-hidden">
        
        {/* INNER CERTIFICATE CONTAINER */}
        <div className="w-full bg-background/50 border border-border/50 rounded-[1.5rem] p-8 md:p-16 relative overflow-hidden flex flex-col items-center text-center">
          
          {/* DECORATIVE ELEMENTS */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px]" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-accent/10 rounded-full blur-[100px]" />

          {/* BADGE */}
          <div className="mb-8 relative">
             <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full" />
             <div className="bg-background border-2 border-emerald-500/30 p-4 rounded-full relative z-10 shadow-glow shadow-emerald-500/20">
               <ShieldCheck className="h-12 w-12 text-emerald-500" />
             </div>
          </div>

          <h3 className="text-accent uppercase tracking-[0.3em] font-bold text-sm mb-4">Official Verification</h3>
          <h1 className="text-4xl md:text-6xl font-black mb-8 tracking-tight">Certificate of Typing</h1>
          
          <p className="text-muted text-lg md:text-xl font-medium max-w-2xl mx-auto mb-4 leading-relaxed">
            This is to certify that
          </p>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            {certificate.user.displayName || "Verified User"}
          </h2>
          <p className="text-muted text-lg md:text-xl font-medium max-w-2xl mx-auto mb-12 leading-relaxed">
            has successfully completed a proctored and verified typing assessment on the TypeFlow platform.
          </p>

          {/* METRICS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 w-full max-w-3xl mx-auto mb-16 relative z-10">
             <div className="bg-surface border border-border p-6 rounded-2xl flex flex-col items-center">
                <Activity className="h-6 w-6 text-accent mb-3" />
                <span className="text-4xl font-black">{Math.round(wpm)}</span>
                <span className="text-[10px] text-muted uppercase tracking-widest font-bold mt-1">Net Speed (WPM)</span>
             </div>
             <div className="bg-surface border border-border p-6 rounded-2xl flex flex-col items-center">
                <Target className="h-6 w-6 text-emerald-500 mb-3" />
                <span className="text-4xl font-black">{Math.round(accuracy * 100)}<span className="text-lg text-muted">%</span></span>
                <span className="text-[10px] text-muted uppercase tracking-widest font-bold mt-1">Accuracy</span>
             </div>
             <div className="bg-surface border border-border p-6 rounded-2xl flex flex-col items-center">
                <Clock className="h-6 w-6 text-purple-400 mb-3" />
                <span className="text-4xl font-black">{duration}<span className="text-lg text-muted">s</span></span>
                <span className="text-[10px] text-muted uppercase tracking-widest font-bold mt-1">Duration</span>
             </div>
             <div className="bg-surface border border-border p-6 rounded-2xl flex flex-col items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-400 mb-3" />
                <span className="text-[10px] text-muted uppercase tracking-widest font-bold mt-1 text-center leading-relaxed">
                  Issued On<br/>{issueDate}
                </span>
             </div>
          </div>

          <div className="w-full max-w-3xl flex flex-col md:flex-row justify-between items-center border-t border-border/50 pt-8 mt-8 gap-6">
             <div className="text-left flex flex-col">
                <span className="text-muted text-[10px] uppercase tracking-widest font-bold">Certificate ID</span>
                <span className="font-mono text-sm font-medium">{certificate.id}</span>
             </div>
             <div className="text-center md:text-right flex flex-col">
                <span className="text-muted text-[10px] uppercase tracking-widest font-bold">Verification URL</span>
                <span className="font-mono text-sm font-medium">typeflow.com/certificate/{certificate.id.split('-')[0]}</span>
             </div>
          </div>

        </div>
      </div>

      <div className="mt-12 flex gap-4">
        <Link href="/" className="bg-surface text-foreground border border-border px-6 py-3 rounded-xl font-bold hover:bg-surface-elevated transition-colors">
           Back to Home
        </Link>
      </div>

    </div>
  );
}
