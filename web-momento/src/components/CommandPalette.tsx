import { useNavigate } from "react-router-dom";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { BookOpen, Download, LayoutDashboard, Search } from "lucide-react";
import { NAV_GROUPS } from "@/components/layout/Sidebar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** ⌘K palette — every nav destination plus docs, all routes from the sitemap contract. */
export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, features, docs…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Command Center
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/downloads")}>
            <Download className="mr-2 h-4 w-4" /> Download source bundle
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/docs")}>
            <BookOpen className="mr-2 h-4 w-4" /> Documentation Center
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/ingest")}>
            <Search className="mr-2 h-4 w-4" /> Ingest Console
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        {NAV_GROUPS.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem key={item.to} onSelect={() => go(item.to)}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="Documentation">
          {[
            ["overview", "Platform Overview"],
            ["architecture", "Architecture"],
            ["api-reference", "API Reference"],
            ["data-model", "Data Model"],
            ["parity-report", "Parity & Verification Report"],
            ["changelog", "Changelog"],
            ["decision-log", "Decision Log"],
            ["keyboard-shortcuts", "Keyboard Shortcuts"],
          ].map(([slug, title]) => (
            <CommandItem key={slug} onSelect={() => go(`/dashboard/docs/${slug}`)}>
              <BookOpen className="mr-2 h-4 w-4" /> {title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
