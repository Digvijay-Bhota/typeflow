import { notFound } from "next/navigation";
import { SeoPageTemplate } from "@/components/SeoPageTemplate";
import { constructMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import { ALLOWED_SEO_ROUTES, getSeoRouteConfig } from "./seoConfig";

export async function generateStaticParams() {
  return ALLOWED_SEO_ROUTES.map((slug) => ({ seoSlug: slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ seoSlug: string }>;
}): Promise<Metadata> {
  const { seoSlug } = await params;
  const config = getSeoRouteConfig(seoSlug);

  if (!config) {
    return {};
  }

  return constructMetadata({
    title: config.title,
    description: config.description,
    path: `/${seoSlug}`,
  });
}

export default async function SeoPage({
  params,
}: {
  params: Promise<{ seoSlug: string }>;
}) {
  const { seoSlug } = await params;
  const config = getSeoRouteConfig(seoSlug);

  if (!config) {
    notFound();
  }

  return (
    <SeoPageTemplate
      h1={config.h1}
      introduction={<p>{config.introduction}</p>}
      testConfig={config.testConfig}
      faqs={config.faqs}
      relatedLinks={config.relatedLinks}
    />
  );
}
