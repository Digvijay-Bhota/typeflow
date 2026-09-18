import React from "react";
import Link from "next/link";
import { TypingTest } from "@/features/typing/components/TypingTest";
import { JsonLd, generateFaqSchema, generateWebApSchema } from "@/components/StructuredData";
import type { Language, TypingMode } from "@/lib/constants";

interface Faq {
  question: string;
  answer: string;
}

interface SeoLink {
  title: string;
  href: string;
}

interface SeoPageTemplateProps {
  h1: string;
  introduction: React.ReactNode;
  testConfig: {
    mode: "timed" | "words";
    language: "english" | "hindi" | "code";
    codeLanguage?: string;
    duration?: number;
    wordCount?: number;
    trustTier?: "FREE" | "CERTIFICATE" | "B2B_ASSESSMENT";
  };
  faqs?: Faq[];
  relatedLinks?: SeoLink[];
}

export function SeoPageTemplate({ h1, introduction, testConfig, faqs, relatedLinks }: SeoPageTemplateProps) {
  return (
    <div className="flex flex-col max-w-5xl mx-auto py-12 px-4 gap-12 w-full animate-fade-in">
      <JsonLd data={generateWebApSchema()} />
      {faqs && faqs.length > 0 && <JsonLd data={generateFaqSchema(faqs)} />}

      <section className="flex flex-col gap-4 text-center">
        <h1 className="text-4xl font-extrabold text-foreground">
          {h1}
        </h1>
        <div className="text-lg text-muted max-w-3xl mx-auto">
          {introduction}
        </div>
      </section>

      <section className={`transition-all duration-300 ${
        testConfig.language === "code" 
          ? "bg-[#0A0A0A] p-2 rounded-xl border border-border shadow-2xl" 
          : "bg-surface p-8 rounded-3xl border border-border shadow-sm"
      }`}>
        {testConfig.language === "code" && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#222] bg-[#111] rounded-t-lg mb-4">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-danger/80" />
              <div className="w-3 h-3 rounded-full bg-warning/80" />
              <div className="w-3 h-3 rounded-full bg-success/80" />
            </div>
            <div className="text-xs font-mono text-muted uppercase tracking-wider">
              {testConfig.codeLanguage || "Code"}
            </div>
          </div>
        )}
        <div className={testConfig.language === "code" ? "px-6 pb-6 pt-2" : ""}>
          <TypingTest
            mode={testConfig.mode as TypingMode}
            language={testConfig.language as Language}
            codeLanguage={testConfig.codeLanguage}
            duration={testConfig.duration}
            wordCount={testConfig.wordCount}
            trustTier={testConfig.trustTier}
            hideConfig={true}
          />
        </div>
      </section>

      {(faqs || relatedLinks) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mt-8">
          <div className="md:col-span-2 flex flex-col gap-8">
            {faqs && faqs.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
                <div className="flex flex-col gap-6">
                  {faqs.map((faq, index) => (
                    <article key={index} className="flex flex-col gap-2 p-4 rounded-xl bg-surface border border-border">
                      <h3 className="font-semibold text-lg text-foreground">{faq.question}</h3>
                      <p className="text-muted leading-relaxed">{faq.answer}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="md:col-span-1">
            {relatedLinks && relatedLinks.length > 0 && (
              <div className="bg-surface p-6 rounded-2xl border border-border">
                <h3 className="font-bold text-foreground mb-4">Related Tests</h3>
                <ul className="flex flex-col gap-3">
                  {relatedLinks.map((link, i) => (
                    <li key={i}>
                      <Link href={link.href} className="text-accent hover:text-foreground font-medium transition-colors hover:underline">
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
