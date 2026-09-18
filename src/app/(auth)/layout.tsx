import React from "react";
import { constructMetadata } from "@/lib/seo";

export const metadata = constructMetadata({
  title: "Authentication",
  description: "Sign in or create an account",
  path: "/login",
  noindex: true,
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
