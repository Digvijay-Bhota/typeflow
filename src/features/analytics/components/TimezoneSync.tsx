"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Adds the viewer's time zone (?tz=) to the analytics URL once, so the server
 * groups tests by the viewer's own days. Replaces the history entry instead of
 * adding one, so Back does not return to the UTC view.
 */
export function TimezoneSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTimezone = searchParams.has("tz");

  useEffect(() => {
    if (hasTimezone) return;
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return; // Stay on UTC.
    }
    if (!timezone) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tz", timezone);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [hasTimezone, pathname, router, searchParams]);

  return null;
}
