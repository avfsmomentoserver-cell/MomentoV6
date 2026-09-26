import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setAsOf } from "@/lib/asof";
import { useAsOf } from "@/components/v65/kit";
import { Bell, Clock3, Command, Download, LogOut, Menu, Search, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/auth";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";

export function TopBar({ onOpenSidebar, onOpenPalette }: { onOpenSidebar: () => void; onOpenPalette: () => void }) {
  const { user, isOperator, logout } = useAuth();
  const navigate = useNavigate();
  const [clock, setClock] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ service: string; version: string; rounds: number }>("/api/v1/health"),
    refetchInterval: 30_000,
  });

  const qc = useQueryClient();
  const asOf = useAsOf();
  const alerts = useQuery({
    queryKey: ["alerts-bell"],
    queryFn: () => api.live<{ unread: number }>("/api/v1/alerts"),
    refetchInterval: 20_000,
  });
  const toLocalInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const applyAsOf = (v: number | null) => { setAsOf(v); qc.invalidateQueries(); };

  return (
    <>
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="group flex h-9 w-full max-w-[340px] items-center gap-2 rounded-lg border border-border bg-card/60 px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-data text-[9px] sm:flex">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2.5">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 md:flex">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              health.isError ? "bg-destructive" : health.data ? "bg-emerald-400 live-dot" : "bg-warning",
            )}
          />
          <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
            {health.data ? `core ${health.data.version} · ${Number(health.data.rounds ?? 0).toLocaleString()} rounds` : health.isError ? "api offline" : "connecting…"}
          </span>
        </div>

        <div className={cn("hidden items-center gap-1.5 rounded-lg border px-2 py-1 md:flex", asOf ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-card/60")} title="Time machine (F-04): view the platform as it was at an instant">
          <Clock3 className={cn("h-3.5 w-3.5", asOf ? "text-amber-400" : "text-muted-foreground")} />
          <input
            type="datetime-local"
            aria-label="View as of"
            className="w-[150px] bg-transparent font-data text-[10.5px] text-foreground outline-none [color-scheme:dark]"
            value={asOf ? toLocalInput(asOf) : ""}
            onChange={(e) => { const t = e.target.value ? new Date(e.target.value).getTime() : NaN; applyAsOf(Number.isFinite(t) ? t : null); }}
          />
          {asOf && <button type="button" className="rounded bg-amber-500/20 px-1.5 font-data text-[10px] text-amber-300" onClick={() => applyAsOf(null)}>LIVE</button>}
        </div>

        <Link to="/dashboard/alerts" className="relative rounded-lg border border-border bg-card/60 p-2 text-muted-foreground hover:text-foreground" aria-label="Alerts">
          <Bell className="h-3.5 w-3.5" />
          {(alerts.data?.unread ?? 0) > 0 && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-primary px-1 text-center font-data text-[9px] leading-4 text-primary-foreground">{alerts.data!.unread > 99 ? "99+" : alerts.data!.unread}</span>}
        </Link>

        <span className="hidden font-data text-[11px] text-muted-foreground lg:block">
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>

        <Link to="/dashboard/downloads" className="hidden sm:block">
          <DownloadSourceButton compact />
        </Link>

        {user ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-[13px] hover:border-primary/40"
            >
              {isOperator ? <ShieldCheck className="h-4 w-4 text-primary" /> : <UserRound className="h-4 w-4 text-muted-foreground" />}
              <span className="hidden max-w-[120px] truncate md:block">{user.name}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-52 rounded-lg border border-border bg-popover p-1 shadow-xl">
                <p className="truncate px-3 py-2 text-[11px] text-muted-foreground">{user.email} · {user.role}</p>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); navigate("/dashboard/settings"); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> Master Settings
                </button>
                <button
                  type="button"
                  onClick={() => { logout(); setMenuOpen(false); navigate("/login"); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            className="flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
    {asOf && (
      <div className="sticky top-14 z-20 flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-[12px] text-amber-200">
        <span>Time machine: showing what the platform knew at <b className="font-data">{new Date(asOf).toLocaleString()}</b>. Rounds and forecasts after this instant are hidden.</span>
        <button type="button" className="rounded border border-amber-500/50 px-2 py-0.5 text-[11px] hover:bg-amber-500/20" onClick={() => applyAsOf(null)}>Back to live</button>
      </div>
    )}
    </>
  );
}
