import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ReleaseDto } from "@/lib/types";

interface Props {
  compact?: boolean;
  className?: string;
}

/** One-click full-source bundle download — always pointed at the latest registered release. */
export function DownloadSourceButton({ compact = false, className }: Props) {
  const latest = useQuery({
    queryKey: ["releases", "latest"],
    queryFn: () => api.get<{ release: ReleaseDto | null }>("/api/v1/releases/latest"),
    staleTime: 60_000,
  });

  const release = latest.data?.release ?? null;
  const href = release?.url ?? "/downloads/momento-platform-6.2.0.zip";

  if (compact) {
    return (
      <a
        href={href}
        download
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95",
          className,
        )}
      >
        {latest.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        <span className="hidden md:inline">Source</span>
      </a>
    );
  }

  return (
    <a
      href={href}
      download
      className={cn(
        "group flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground shadow-[0_0_24px_hsl(190_95%_43%/0.25)] transition-all hover:scale-[1.02] hover:shadow-[0_0_32px_hsl(190_95%_43%/0.4)] active:scale-95",
        className,
      )}
    >
      {latest.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />}
      Download Source
      {release && <span className="font-data text-[11px] opacity-80">v{release.version}</span>}
    </a>
  );
}
