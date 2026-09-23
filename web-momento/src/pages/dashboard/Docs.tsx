import { Link, useParams } from "react-router-dom";
import { BookOpen, ChevronRight } from "lucide-react";
import { DOC_CONTENT, fallbackMeta, useDocManifest } from "@/lib/docs";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

export function DocsIndex() {
  const manifest = useDocManifest();
  if (manifest.isLoading) return <Loading rows={4} />;
  const docs = manifest.data?.docs ?? fallbackMeta();
  const sections = [...new Set(docs.map((d) => d.section))];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Documentation Center"
        subtitle="Everything about this platform: overview, architecture, full API reference, data model, feature guides, verification reports, changelog and decision log. The same files ship inside the source bundle."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Panel key={section} title={section}>
            <div className="space-y-1">
              {docs
                .filter((d) => d.section === section)
                .map((d) => (
                  <Link
                    key={d.slug}
                    to={`/dashboard/docs/${d.slug}`}
                    className="group flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-background/40"
                  >
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium group-hover:text-primary">{d.title}</p>
                      {d.summary && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{d.summary}</p>}
                    </div>
                    <ChevronRight className="ml-auto mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  </Link>
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function DocPage() {
  const { slug } = useParams<{ slug: string }>();
  const manifest = useDocManifest();
  const docs = manifest.data?.docs ?? fallbackMeta();
  const meta = docs.find((d) => d.slug === slug);
  const content = slug ? DOC_CONTENT[slug] : undefined;
  const sections = [...new Set(docs.map((d) => d.section))];

  if (!content) {
    return (
      <div className="animate-in-up space-y-4">
        <PageHeader title="Documentation" />
        <Panel>
          <p className="text-[13.5px] text-muted-foreground">
            This document doesn't exist. <Link to="/dashboard/docs" className="text-primary hover:underline">Back to the Documentation Center</Link>.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="animate-in-up flex gap-6">
      <aside className="no-scrollbar sticky top-[72px] hidden h-fit max-h-[calc(100dvh-100px)] w-56 shrink-0 overflow-y-auto xl:block">
        {sections.map((section) => (
          <div key={section} className="mb-4">
            <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">{section}</p>
            {docs
              .filter((d) => d.section === section)
              .map((d) => (
                <Link
                  key={d.slug}
                  to={`/dashboard/docs/${d.slug}`}
                  className={cn(
                    "block rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                    d.slug === slug ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {d.title}
                </Link>
              ))}
          </div>
        ))}
      </aside>
      <article className="min-w-0 flex-1">
        <div className="mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">{meta?.section ?? "Docs"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{meta?.title ?? slug}</h1>
        </div>
        <div className="rounded-xl border border-border/80 bg-card/50 p-6">
          <Markdown>{content}</Markdown>
        </div>
      </article>
    </div>
  );
}
