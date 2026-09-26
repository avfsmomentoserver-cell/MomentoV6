import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, BookOpen, BrainCircuit, Database, Gauge, Layers, Radio, Rocket, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";
import { NAV_GROUPS } from "@/components/layout/Sidebar";

interface PlatformOverview {
  name: string;
  suite: string;
  version: string;
  pipeline: string;
  subProjects: number;
  screens: number;
  rounds: number;
  docs: number;
}

const FEATURES = [
  { icon: Layers, title: "Analysis Core", desc: "Ladders, resistance ceilings, streaks, regimes, edge fit — computed server-side from immutable rounds." },
  { icon: BrainCircuit, title: "Forecast Engine", desc: "Measured exceedance with Wilson CIs, honest walk-forward Brier scoring, earned-weight conditional models." },
  { icon: Rocket, title: "Moonshot & Pressure", desc: "Power-law tail priors across 100x → 100,000x targets with dry-run pressure and ETA bands." },
  { icon: BarChart3, title: "Market & Charts", desc: "Candles, points, session phases, and the MomentoFX research surfaces." },
  { icon: Radio, title: "Ingest & Live Engine", desc: "REST push, bulk import, and a provably-fair live round engine with verifiable hashes." },
  { icon: Database, title: "One Real Backend", desc: "A single Worker API over relational SQLite — export/import, audit log, releases, users." },
];

export default function Landing() {
  const overview = useQuery({
    queryKey: ["platform-overview"],
    queryFn: () => api.get<PlatformOverview>("/api/v1/platform/overview"),
  });

  return (
    <div className="aurora min-h-dvh">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 glow-signal font-data text-sm font-bold text-primary">M</span>
          <div className="leading-tight">
            <p className="font-data text-[12px] font-bold uppercase tracking-[0.2em]">Momento</p>
            <p className="text-[10px] text-muted-foreground">Platform v6.2</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/dashboard/docs/overview" className="hidden text-[13px] text-muted-foreground hover:text-foreground sm:block">Docs</Link>
          <Link to="/login" className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-muted-foreground hover:text-foreground">Sign in</Link>
          <Link to="/dashboard" className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground">
            Open console <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-14 md:pt-20">
        <p className="font-data mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-widest text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary live-dot" /> {overview.data ? `${fmtInt(overview.data.rounds)} live rounds in the database` : "loading platform…"}
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
          Crash-curve analytics,
          <span className="text-primary"> honestly measured.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground md:text-base">
          One coordinated platform: Collector → Ingest → Analysis → Forecast Engine → Database → Dashboard.
          Every number on every screen is computed server-side from rounds that are actually in the database —
          {overview.data ? ` all ${fmtInt(overview.data.rounds)} of them.` : " no mock data anywhere."}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <DownloadSourceButton />
          <Link to="/dashboard" className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2.5 text-[14px] font-medium transition-colors hover:border-primary/40">
            <Gauge className="h-4 w-4 text-primary" /> Explore the console
          </Link>
          <Link to="/dashboard/docs/overview" className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2.5 text-[14px] font-medium transition-colors hover:border-primary/40">
            <BookOpen className="h-4 w-4 text-primary" /> Documentation
          </Link>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="animate-in-up rounded-xl border border-border/80 bg-card/60 p-5 backdrop-blur-sm" style={{ animationDelay: `${i * 60}ms` }}>
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-[14px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-xl border border-border/80 bg-card/60 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Full sitemap — every link works</p>
          <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-primary/80">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((item) => (
                    <Link key={item.to} to={item.to} className="rounded-md border border-border/70 bg-background/50 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/25 bg-primary/5 p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <p className="text-[14px] font-semibold">Complete handover bundle</p>
              <p className="text-[12.5px] text-muted-foreground">Full source, docs, API reference, manifest and parity report — versioned with the platform.</p>
            </div>
          </div>
          <DownloadSourceButton />
        </div>
      </section>

      <footer className="border-t border-border/60 py-6">
        <p className="mx-auto max-w-6xl px-5 font-data text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
          momento platform v6.3.0 · graph ite aurora · built {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
