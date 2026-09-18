import React from "react";

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function generateFaqSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function generateWebApSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "TypeFlow",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    description:
      "Professional typing test application for measuring typing speed and accuracy.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}
