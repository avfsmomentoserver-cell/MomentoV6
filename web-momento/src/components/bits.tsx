import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtInt, fmtMult, fmtPct } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="animate-in-up mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, right, children, className, pad = true }: { title?: string; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <Card className={cn("border-border/80 bg-card/70 backdrop-blur-sm", className)}>
      {title && (
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-[13px] font-medium text-muted-foreground">{title}</CardTitle>
          {right}
        </CardHeader>
      )}
      <CardContent className={cn(pad && "pt-1", title ? "" : "pt-5")}>{children}</CardContent>
    </Card>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  pulse,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "signal";
  pulse?: boolean;
}) {
  const toneClass =
    tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-rose-400" : tone === "signal" ? "text-primary" : "text-foreground";
  return (
    <Card className="border-border/80 bg-card/70">
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {pulse && <span className="h-1.5 w-1.5 rounded-full bg-primary live-dot" />}
          {label}
        </p>
        <p className={cn("font-data mt-1.5 text-2xl font-semibold tracking-tight", toneClass)}>{value}</p>
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-muted/60" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-10 text-center">
      <p className="text-[14px] font-medium text-muted-foreground">{title}</p>
      {hint && <p className="max-w-sm text-[12px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function Bar({ value, max = 100, tone = "primary" }: { value: number; max?: number; tone?: "primary" | "good" | "warn" | "bad" }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const bg = tone === "good" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : tone === "bad" ? "bg-rose-400" : "bg-primary";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all duration-500", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 text-[13px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-data">{value}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{children}</h2>;
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

export { fmtInt, fmtMult, fmtPct };
