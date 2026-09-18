import type { Metadata } from "next";

type SeoProps = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
};

const SITE_NAME = "TypeFlow";
const DEFAULT_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export function constructMetadata({
  title,
  description,
  path,
  noindex = false,
}: SeoProps): Metadata {
  const canonicalUrl = `${DEFAULT_URL}${path}`;

  return {
    title: {
      default: `${title} - ${SITE_NAME}`,
      template: `%s - ${SITE_NAME}`,
    },
    description,
    metadataBase: new URL(DEFAULT_URL),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${title} - ${SITE_NAME}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
    robots: {
      index: !noindex,
      follow: !noindex,
      googleBot: {
        index: !noindex,
        follow: !noindex,
      },
    },
  };
}
