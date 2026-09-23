// Documentation registry — metadata comes from the API manifest, content from
// the generated module (auto-generated from src/docs/*.md at build time so the
// same files ship inside the source bundle).

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { DocMeta } from "@/lib/types";
import { DOCS_RAW } from "@/docs/generated";

export const DOC_CONTENT: Record<string, string> = DOCS_RAW;

export function useDocManifest() {
  return useQuery({
    queryKey: ["platform", "docs"],
    queryFn: () => api.get<{ docs: DocMeta[]; version: string }>("/api/v1/platform/docs"),
    staleTime: 5 * 60_000,
  });
}

export function fallbackMeta(): DocMeta[] {
  return Object.keys(DOC_CONTENT).map((slug) => ({
    slug,
    title: slug.replace(/-/g, " "),
    section: "Docs",
    summary: "",
    audience: "developer",
  }));
}
