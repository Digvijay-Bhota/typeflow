import { Skeleton, VisuallyHidden } from "@/components/ui";

/** Shown under the dashboard tabs while a workspace page loads its data. */
export default function DashboardLoading() {
  return (
    <div role="status" className="flex flex-col gap-8 pb-12">
      <VisuallyHidden>Loading…</VisuallyHidden>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="rounded-card h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="rounded-card h-64 lg:col-span-2" />
        <Skeleton className="rounded-card h-64" />
      </div>
    </div>
  );
}
