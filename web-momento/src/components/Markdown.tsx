import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer with GFM support, styled for the graphite console. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="docs-prose max-w-none text-[13.5px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h2 className="mt-6 mb-3 border-b border-border/60 pb-2 text-[18px] font-semibold first:mt-0" {...p} />,
          h2: (p) => <h3 className="mt-6 mb-2 text-[15.5px] font-semibold" {...p} />,
          h3: (p) => <h4 className="mt-4 mb-1.5 text-[14px] font-semibold" {...p} />,
          p: (p) => <p className="my-2.5 text-muted-foreground" {...p} />,
          a: (p) => <a className="text-primary hover:underline" {...p} />,
          ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-5 text-muted-foreground" {...p} />,
          ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-5 text-muted-foreground" {...p} />,
          li: (p) => <li className="pl-0.5" {...p} />,
          strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
          code: ({ className, children, ...rest }) =>
            className?.includes("language-") ? (
              <code className="block overflow-x-auto rounded-lg border border-border/70 bg-background/70 p-3 font-data text-[11.5px] text-foreground/90" {...rest}>{children}</code>
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 font-data text-[12px] text-primary" {...rest}>{children}</code>
            ),
          pre: (p) => <pre className="my-3" {...p} />,
          blockquote: (p) => <blockquote className="my-3 border-l-2 border-primary/50 pl-3 text-muted-foreground italic" {...p} />,
          table: (p) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full min-w-[480px] font-data text-[12px]" {...p} />
            </div>
          ),
          th: (p) => <th className="border-b border-border pb-1.5 pr-4 text-left font-medium text-muted-foreground" {...p} />,
          td: (p) => <td className="border-b border-border/40 py-1.5 pr-4" {...p} />,
          hr: () => <hr className="my-5 border-border/60" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
