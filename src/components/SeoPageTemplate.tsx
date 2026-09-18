import React from "react";
import Link from "next/link";
import { TypingTest } from "@/features/typing/components/TypingTest";
import {
  JsonLd,
  generateFaqSchema,
  generateWebApSchema,
} from "@/components/StructuredData";
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

export function SeoPageTemplate({
  h1,
  introduction,
  testConfig,
  faqs,
  relatedLinks,
}: SeoPageTemplateProps) {
  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12">
      <JsonLd data={generateWebApSchema()} />
      {faqs && faqs.length > 0 && <JsonLd data={generateFaqSchema(faqs)} />}

      <section className="flex flex-col gap-4 text-center">
        <h1 className="text-foreground text-4xl font-extrabold">{h1}</h1>
        <div className="text-muted mx-auto max-w-3xl text-lg">{introduction}</div>
      </section>

      <section
        className={`transition-all duration-300 ${
          testConfig.language === "code"
            ? "border-border rounded-xl border bg-[#0A0A0A] p-2 shadow-2xl"
            : "bg-surface border-border rounded-3xl border p-8 shadow-sm"
        }`}
      >
        {testConfig.language === "code" && (
          <div className="mb-4 flex items-center justify-between rounded-t-lg border-b border-[#222] bg-[#111] px-4 py-2">
            <div className="flex gap-2">
              <div className="bg-danger/80 h-3 w-3 rounded-full" />
              <div className="bg-warning/80 h-3 w-3 rounded-full" />
              <div className="bg-success/80 h-3 w-3 rounded-full" />
            </div>
            <div className="text-muted font-mono text-xs tracking-wider uppercase">
              {testConfig.codeLanguage || "Code"}
            </div>
          </div>
        )}
        <div className={testConfig.language === "code" ? "px-6 pt-2 pb-6" : ""}>
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
        <div className="mt-8 grid grid-cols-1 gap-12 md:grid-cols-3">
          <div className="flex flex-col gap-8 md:col-span-2">
            {faqs && faqs.length > 0 && (
              <section>
                <h2 className="text-foreground mb-6 text-2xl font-bold">
                  Frequently Asked Questions
                </h2>
                <div className="flex flex-col gap-6">
                  {faqs.map((faq, index) => (
                    <article
                      key={index}
                      className="bg-surface border-border flex flex-col gap-2 rounded-xl border p-4"
                    >
                      <h3 className="text-foreground text-lg font-semibold">
                        {faq.question}
                      </h3>
                      <p className="text-muted leading-relaxed">{faq.answer}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="md:col-span-1">
            {relatedLinks && relatedLinks.length > 0 && (
              <div className="bg-surface border-border rounded-2xl border p-6">
                <h3 className="text-foreground mb-4 font-bold">Related Tests</h3>
                <ul className="flex flex-col gap-3">
                  {relatedLinks.map((link, i) => (
                    <li key={i}>
                      <Link
                        href={link.href}
                        className="text-accent hover:text-foreground font-medium transition-colors hover:underline"
                      >
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
