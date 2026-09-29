import { BarChart3, History, Keyboard, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui";
import { CertificatePath } from "./DashboardOverview";

const PREVIEW = [
  {
    icon: ListChecks,
    title: "Your numbers",
    body: "Average and best speed, accuracy and time practised, updated after every test.",
  },
  {
    icon: History,
    title: "Every result",
    body: "Each test is saved to your history with a link to its full result.",
  },
  {
    icon: BarChart3,
    title: "Trends and next steps",
    body: "Speed and accuracy charts from your second test on, plus the keys you miss most.",
  },
];

/** The overview before the first completed test: one clear start, and what will appear. */
export function FirstRunOverview() {
  return (
    <div className="flex flex-col gap-8">
      <EmptyState
        title="Take your first test"
        description="Your first result sets your baseline: speed, accuracy and the keys you miss most. It is saved here automatically."
        actionText="Start a typing test"
        actionHref="/typing-test"
        icon={<Keyboard />}
      />

      <section aria-labelledby="first-run-preview" className="flex flex-col gap-4">
        <h2 id="first-run-preview" className="text-lg font-semibold tracking-tight">
          What you&apos;ll see here
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PREVIEW.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="h-full">
                <CardContent className="flex flex-col gap-2">
                  <Icon aria-hidden="true" className="text-accent size-5" />
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-secondary text-sm">{body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <CardContent>
          <CertificatePath />
        </CardContent>
      </Card>
    </div>
  );
}
