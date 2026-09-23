import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { NAV_GROUPS } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="aurora flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <p className="font-data text-[72px] font-bold leading-none text-primary/80">404</p>
      <div className="text-center">
        <h1 className="text-xl font-semibold">This route isn't on the map</h1>
        <p className="mt-1.5 max-w-md text-[13.5px] text-muted-foreground">
          Every link from every previous Momento archive has a home here — this just isn't one of them.
        </p>
      </div>
      <div className="flex max-w-lg flex-wrap justify-center gap-1.5">
        {NAV_GROUPS.flatMap((g) => g.items).slice(0, 10).map((item) => (
          <Link key={item.to} to={item.to} className="rounded-md border border-border bg-card/60 px-2.5 py-1 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {item.label}
          </Link>
        ))}
      </div>
      <Link to="/dashboard">
        <Button className="gap-2">
          <Compass className="h-4 w-4" /> Back to Command Center
        </Button>
      </Link>
    </div>
  );
}
