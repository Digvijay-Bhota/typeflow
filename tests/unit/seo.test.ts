import { describe, it, expect } from "vitest";
import { getSeoRouteConfig, ALLOWED_SEO_ROUTES } from "@/app/(seo)/[seoSlug]/seoConfig";
import { constructMetadata } from "@/lib/seo";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("SEO Foundation Tests", () => {
  describe("seoConfig", () => {
    it("returns null for unknown routes (triggers 404)", () => {
      expect(getSeoRouteConfig("arbitrary-route")).toBeNull();
      expect(getSeoRouteConfig("ruby-typing-test")).toBeNull();
    });

    it("returns valid config for allowlisted routes", () => {
      const config = getSeoRouteConfig("1-minute-typing-test");
      expect(config).not.toBeNull();
      expect(config?.h1).toBe("1 Minute Typing Test");
      expect(config?.testConfig.duration).toBe(60);
    });

    it("ensures all ALLOWED_SEO_ROUTES have a matching config", () => {
      for (const route of ALLOWED_SEO_ROUTES) {
        expect(getSeoRouteConfig(route)).not.toBeNull();
      }
    });

    it("does not fabricate misleading certificate claims", () => {
      const config = getSeoRouteConfig("typing-test-with-certificate");
      expect(config?.faqs?.some(f => f.answer.includes("No online typing test certificate is universally 'government-approved'"))).toBe(true);
    });
  });

  describe("Metadata Generation", () => {
    it("constructs canonical URLs accurately", () => {
      const meta = constructMetadata({
        title: "Test",
        description: "Desc",
        path: "/test-path",
      });
      expect(meta.alternates?.canonical).toContain("/test-path");
      expect(meta.openGraph?.url).toContain("/test-path");
    });

    it("constructs valid OpenGraph metadata", () => {
      const meta = constructMetadata({
        title: "My SEO Title",
        description: "My Description",
        path: "/path",
      });
      expect(meta.title).toEqual({
        default: "My SEO Title - TypeFlow",
        template: "%s - TypeFlow",
      });
      expect(meta.openGraph?.title).toBe("My SEO Title");
      const images = meta.openGraph?.images as any[];
      expect(images?.[0]).toEqual(expect.objectContaining({ url: "/og-image.png" }));
    });
  });

  describe("Sitemap", () => {
    it("includes allowed SEO routes", () => {
      const map = sitemap();
      const urls = map.map(item => item.url);
      expect(urls).toContain("http://localhost:3000");
      expect(urls).toContain("http://localhost:3000/1-minute-typing-test");
      expect(urls).toContain("http://localhost:3000/javascript-typing-test");
    });

    it("excludes private routes", () => {
      const map = sitemap();
      const urls = map.map(item => item.url);
      expect(urls.some(url => url.includes("/dashboard"))).toBe(false);
      expect(urls.some(url => url.includes("/api"))).toBe(false);
    });
  });

  describe("Robots.txt", () => {
    it("disallows private routes", () => {
      const rules = robots().rules as any;
      expect(rules.allow).toBe("/");
      expect(rules.disallow).toContain("/dashboard/");
      expect(rules.disallow).toContain("/login");
      expect(rules.disallow).toContain("/signup");
    });
  });
});
