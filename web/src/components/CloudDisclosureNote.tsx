import { ShieldCheck } from "lucide-react";
import type { CloudDisclosure } from "@/lib/types";
import { cn } from "@/lib/utils";

function ofTotal(sent: number, held: number, noun: string): string {
  return `${sent} of ${held} ${noun}`;
}

/**
 * "What did the cloud model actually see?" — one line under a medical reply,
 * expandable for the detail. The server never sends the health record, only a
 * relevance-filtered brief; this makes that visible rather than a promise in a
 * settings page. Like the model label beside it, don't drop it to tidy the UI.
 */
export function CloudDisclosureNote({ disclosure, className }: { disclosure: CloudDisclosure; className?: string }) {
  const { sent, held } = disclosure;
  const summary = [
    ofTotal(sent.issues, held.issues, "issues"),
    ofTotal(sent.records, held.records, "history entries"),
    ...(disclosure.scope === "question" ? [ofTotal(sent.rules, held.rules, "rules")] : []),
  ].join(" · ");

  return (
    <details className={cn("group text-[10px] text-muted-foreground", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 tap [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        <span>Shared with the cloud model: {summary}</span>
      </summary>
      <ul className="mt-1 space-y-0.5 pl-4">
        {disclosure.topics.length > 0 && <li>Read as being about: {disclosure.topics.join(", ")}</li>}
        <li>Always shared: conditions, medications, allergies</li>
        {disclosure.computedLocally.length > 0 && (
          <li>Worked out on the app's server first: {disclosure.computedLocally.join(", ")}</li>
        )}
        {disclosure.withheld.length > 0 && <li>Kept back: {disclosure.withheld.join(", ")}</li>}
        {disclosure.redactions > 0 && (
          <li>
            {disclosure.redactions} identifier{disclosure.redactions === 1 ? "" : "s"} removed (name,
            numbers, emails, links)
          </li>
        )}
      </ul>
    </details>
  );
}
