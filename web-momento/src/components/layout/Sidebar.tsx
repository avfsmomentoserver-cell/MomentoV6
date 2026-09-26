import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  CalendarClock,
  Shapes,
  Blocks,
  BookOpen,
  BrainCircuit,
  ChartCandlestick,
  Compass,
  Crown,
  Dna,
  Download,
  Eye,
  Fingerprint,
  Flame,
  FlaskConical,
  Gauge,
  Layers,
  LayoutDashboard,
  LineChart,
  Radar,
  Radio,
  Target,
  Rocket,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  Users,
  Waves,
  X,
  Zap,
  type LucideIcon,
  Database, Lightbulb, Scale, Cpu, FlaskRound, Timer, History, Columns3, Dices, BookA, Search, Bell, MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/auth";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  operatorOnly?: boolean;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { to: "/dashboard", label: "Command Center", icon: LayoutDashboard, end: true },
      { to: "/dashboard/market", label: "Market", icon: ChartCandlestick },
      { to: "/dashboard/ladder", label: "Ladder Telemetry", icon: Layers },
      { to: "/dashboard/resistance", label: "Resistance", icon: TrendingDown },
      { to: "/dashboard/accuracy", label: "Accuracy Engine", icon: Target },
      { to: "/dashboard/momentum", label: "Momentum Lab", icon: Waves },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/dashboard/intelligence", label: "Full Intelligence", icon: Sparkles },
      { to: "/dashboard/moonshot", label: "Moonshot Finder", icon: Rocket },
      { to: "/dashboard/fx-lab", label: "FX Analysis Lab", icon: Radar },
      { to: "/dashboard/dna", label: "DNA Hunter", icon: Dna },
      { to: "/dashboard/mega-pressure", label: "Mega Pressure", icon: Flame },
      { to: "/dashboard/pattern-dna", label: "Pattern DNA", icon: Zap },
      { to: "/dashboard/studio", label: "Forecast Studio", icon: BrainCircuit },
      { to: "/dashboard/linguistics", label: "Linguistics", icon: Fingerprint },
      { to: "/dashboard/vocabulary", label: "Vocabulary", icon: Fingerprint },
      { to: "/dashboard/chart-lab", label: "Chart Lab", icon: Shapes },
      { to: "/dashboard/investigation", label: "Investigation Suite", icon: FlaskConical },
    ],
  },
  {
    label: "Proof",
    items: [
      { to: "/dashboard/track-record", label: "Track Record", icon: ShieldCheck },
      { to: "/dashboard/reliability", label: "Reliability", icon: Gauge },
      { to: "/dashboard/integrity", label: "Integrity", icon: Database },
      { to: "/dashboard/explain", label: "Explain", icon: Lightbulb },
      { to: "/dashboard/fairness", label: "Fairness Console", icon: Scale },
      { to: "/dashboard/platform-book", label: "Platform Book", icon: BookOpen },
    ],
  },
  {
    label: "Lab",
    items: [
      { to: "/dashboard/engines", label: "Engine Registry", icon: Cpu },
      { to: "/dashboard/experiments", label: "Experiments", icon: FlaskRound },
      { to: "/dashboard/eta", label: "ETA Board", icon: Timer },
      { to: "/dashboard/predict", label: "Predict & Cone", icon: LineChart },
      { to: "/dashboard/replay", label: "Replay", icon: History },
      { to: "/dashboard/multi", label: "Multi-timeframe", icon: Columns3 },
      { to: "/dashboard/decisions", label: "Decisions", icon: Scale },
      { to: "/dashboard/simulator", label: "Simulator", icon: Dices },
      { to: "/dashboard/dictionary", label: "Dictionary", icon: BookA },
      { to: "/dashboard/sequence", label: "Sequence Search", icon: Search },
      { to: "/dashboard/alerts", label: "Alerts", icon: Bell },
      { to: "/dashboard/ask", label: "Ask Momento", icon: MessageSquareText },
    ],
  },
  {
    label: "Execution",
    items: [
      { to: "/orchestrator", label: "Orchestrator", icon: Compass },
      { to: "/dashboard/momento-fx", label: "MomentoFX", icon: LineChart },
      { to: "/dashboard/momento-fx-v2", label: "MomentoFX v2.0", icon: Sparkles },
      { to: "/dashboard/autopilot", label: "Autopilot", icon: Gauge },
      { to: "/inventory", label: "Plugin Inventory", icon: Blocks },
    ],
  },
  {
    label: "Data & Platform",
    items: [
      { to: "/dashboard/ingest", label: "Ingest Console", icon: Radio },
      { to: "/dashboard/eagle-eye", label: "Eagle Eye", icon: Eye },
      { to: "/dashboard/scheduler", label: "Scheduler", icon: CalendarClock },
      { to: "/dashboard/sources", label: "Sources", icon: Activity },
      { to: "/dashboard/birdeye", label: "Bird's Eye", icon: LineChart },
      { to: "/dashboard/build-steps", label: "Build Steps", icon: Download },
      { to: "/dashboard/downloads", label: "Downloads", icon: Download },
    ],
  },
  {
    label: "Research",
    items: [
      { to: "/dashboard/darkboard", label: "ShapeShifter Darkboard", icon: Shapes },
      { to: "/dashboard/range-lab", label: "Range Lab", icon: FlaskConical },
      { to: "/dashboard/calibration", label: "Calibration", icon: SlidersHorizontal },
      { to: "/dashboard/testing", label: "Round Testing", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/dashboard/docs", label: "Documentation", icon: BookOpen, end: true },
      { to: "/dashboard/settings", label: "Master Settings", icon: Settings2, operatorOnly: true },
      { to: "/dashboard/users", label: "Users", icon: Users, operatorOnly: true },
    ],
  },
];

const APP_ITEMS: NavItem[] = [
  { to: "/app", label: "Today", icon: Sparkles, end: true },
  { to: "/app/pro", label: "Pro Predictions", icon: ShieldCheck },
  { to: "/app/charts", label: "Charts", icon: LineChart },
  { to: "/app/premium", label: "Premium", icon: Crown },
];

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors",
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-2 h-4 w-[2px] rounded-full bg-primary" aria-hidden />}
          <Icon className={cn("h-[15px] w-[15px] shrink-0", isActive ? "text-primary" : "text-muted-foreground/70")} />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isOperator } = useAuth();
  const location = useLocation();

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <Link to="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/40 bg-primary/10 glow-signal">
              <span className="font-data text-[11px] font-bold text-primary">M</span>
            </span>
            <span className="leading-tight">
              <span className="block font-data text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Momento</span>
              <span className="block text-[10px] text-muted-foreground">Platform v6.5</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav key={location.pathname} className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.operatorOnly || isOperator);
            if (!items.length) return null;
            return (
              <div key={group.label} className="space-y-1">
                <p className="px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">{group.label}</p>
                {items.map((item) => (
                  <NavRow key={item.to} item={item} onNavigate={onClose} />
                ))}
              </div>
            );
          })}
          <div className="space-y-1 border-t border-sidebar-border pt-4">
            <p className="px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Consumer App</p>
            {APP_ITEMS.map((item) => (
              <NavRow key={item.to} item={item} onNavigate={onClose} />
            ))}
          </div>
        </nav>

        <div className="border-t border-sidebar-border px-4 py-3">
          <p className="font-data text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            v6.5.0 · momento-core worker
          </p>
        </div>
      </aside>
    </>
  );
}
