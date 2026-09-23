import { Check, Crown } from "lucide-react";
import { PageHeader, Panel } from "@/components/bits";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";

const TIERS = [
  {
    name: "Observer",
    price: "Free",
    features: ["Full baseline analytics", "Today guidance & charts", "Live engine access", "Command palette navigation"],
  },
  {
    name: "Researcher",
    price: "Self-hosted",
    features: ["Everything in Observer", "Forecast Studio & Range Lab", "Vocabulary learning system", "Autopilot ledger & Orchestrator", "Full API access with your own key"],
    featured: true,
  },
  {
    name: "Institution",
    price: "Custom",
    features: ["Everything in Researcher", "Custom collectors & sources", "Extended dataset imports", "Priority support & onboarding"],
  },
];

export default function Premium() {
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Premium" subtitle="Momento is a research platform, not a signals service — the tiers below describe deployment scope, not accuracy promises." />
      <div className="grid gap-3 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.name} className={`rounded-xl border p-5 ${t.featured ? "border-primary/40 bg-primary/5 glow-signal" : "border-border/80 bg-card/70"}`}>
            <div className="flex items-center gap-2">
              {t.featured && <Crown className="h-4 w-4 text-primary" />}
              <h3 className="text-[15px] font-semibold">{t.name}</h3>
            </div>
            <p className="font-data mt-1 text-2xl font-semibold text-primary">{t.price}</p>
            <ul className="mt-4 space-y-2">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> {f}
                </li>
              ))}
            </ul>
            {t.featured && (
              <div className="mt-4">
                <DownloadSourceButton className="w-full justify-center" />
              </div>
            )}
          </div>
        ))}
      </div>
      <Panel title="Honest accuracy">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          The forecast engine stores every projection before the round lands and scores it with the Brier rule. The walk-forward lab's verdict stands: no conditional methodology beats the measured baseline at this
          sample size. Anyone selling certainty about crash rounds is selling noise — Momento gives you the measurement instead.
        </p>
      </Panel>
    </div>
  );
}
