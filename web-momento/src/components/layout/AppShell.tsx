import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { useLivePulse } from "@/hooks/useLivePulse";
import { RouteBoundary } from "@/components/ErrorBoundary";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pulse, online } = useLivePulse();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[244px]">
        <TopBar onOpenSidebar={() => setNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main className="no-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 pb-16 md:p-6">
            <RouteBoundary label="dashboard page">
              <Outlet />
            </RouteBoundary>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="pointer-events-none fixed bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-border/70 bg-card/90 px-2.5 py-1 font-data text-[10.5px] text-muted-foreground shadow-lg backdrop-blur" aria-live="polite">
        <span className={online ? "h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" : "h-1.5 w-1.5 rounded-full bg-rose-500"} />
        {online ? "realtime" : "offline"}
        {pulse?.last && <span>· #{pulse.last.id} {Number(pulse.last.multiplier ?? 0).toFixed(2)}x · {Number(pulse.count ?? 0).toLocaleString()} rounds</span>}
      </div>
    </div>
  );
}
