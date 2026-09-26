#!/usr/bin/env python3
"""Render the Momento Platform Book to a static website.

Usage: python tools/build_site.py [out_dir]   (requires: pip install markdown pygments)
"""
import html, pathlib, re, sys, shutil
import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "site")

pages = [("README.md", "index.html")]
pages += [(f"chapters/{p.name}", f"{p.stem}.html") for p in sorted((ROOT / "chapters").glob("*.md"))]
pages += [(f"appendices/{p.name}", f"{p.stem}.html") for p in sorted((ROOT / "appendices").glob("*.md"))]
link_map = {src: dst for src, dst in pages}


def title_of(text, fallback):
    m = re.search(r"^#\s+(.+)$", text, re.M)
    return m.group(1).strip() if m else fallback


def fix_links(text, src):
    base = pathlib.PurePosixPath(src).parent

    def repl(m):
        target, anchor = m.group(2), m.group(3) or ""
        norm = str(pathlib.PurePosixPath(base / target)).replace("chapters/../", "").replace("appendices/../", "")
        norm = re.sub(r"^[^/]+/\.\./", "", norm)
        if norm in link_map:
            return f"{m.group(1)}({link_map[norm]}{anchor})"
        return m.group(0)

    return re.sub(r"(\[[^\]]*\])\(((?!https?:)[^)#\s]+\.md)(#[^)]*)?\)", repl, text)


CSS = """
:root{--bg:#0d1016;--panel:#131821;--line:#232a36;--text:#dfe5ee;--muted:#8b96a8;--accent:#4fd1c5;--accent2:#8b7cf6;--code:#0a0d12}
@media (prefers-color-scheme: light){:root{--bg:#f7f8fa;--panel:#ffffff;--line:#e2e6ec;--text:#1b2230;--muted:#5d6878;--accent:#0f8a80;--accent2:#5b4bd6;--code:#f1f3f6}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.layout{display:grid;grid-template-columns:290px 1fr;min-height:100vh}
nav{position:sticky;top:0;height:100vh;overflow:auto;background:var(--panel);border-right:1px solid var(--line);padding:22px 16px}
nav .brand{font-weight:700;font-size:15px;letter-spacing:.02em;margin:0 8px 4px}
nav .brand span{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
nav .sub{color:var(--muted);font-size:12px;margin:0 8px 18px}
nav h4{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:18px 8px 6px}
nav a{display:block;padding:5px 8px;border-radius:6px;color:var(--text);text-decoration:none;font-size:13.5px}
nav a:hover{background:var(--line)}nav a.active{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-weight:600}
#q{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);margin-bottom:6px;font:inherit;font-size:13px}
main{padding:40px min(6vw,72px) 80px;max-width:1080px;width:100%}
h1{font-size:2.1rem;line-height:1.2;margin:.2em 0 .6em}h2{margin-top:2.2em;padding-top:.4em;border-top:1px solid var(--line)}h3{margin-top:1.8em}
a{color:var(--accent)}
code{font-family:JetBrains Mono,ui-monospace,Menlo,monospace;font-size:.86em;background:var(--code);padding:.12em .35em;border-radius:4px}
pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto;line-height:1.45}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--panel)}tr:nth-child(even) td{background:color-mix(in srgb,var(--panel) 55%,transparent)}
blockquote{border-left:3px solid var(--accent2);margin:1em 0;padding:.2em 1em;color:var(--muted)}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:56px;border-top:1px solid var(--line);padding-top:20px}
.pager a{padding:10px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;max-width:48%}
.menu{display:none}
@media (max-width:860px){.layout{grid-template-columns:1fr}nav{position:fixed;inset:0 30% 0 0;z-index:9;transform:translateX(-105%);transition:.2s}
nav.open{transform:none}.menu{display:block;position:fixed;top:10px;right:10px;z-index:10;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)}main{padding:56px 18px 60px}}
"""

JS = """
const q=document.getElementById('q');q&&q.addEventListener('input',()=>{const v=q.value.toLowerCase();
document.querySelectorAll('nav a[data-t]').forEach(a=>a.style.display=a.dataset.t.includes(v)?'':'none')});
document.querySelector('.menu').onclick=()=>document.querySelector('nav').classList.toggle('open');
"""


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    docs = []
    for src, dst in pages:
        text = (ROOT / src).read_text()
        docs.append((src, dst, title_of(text, src), text))

    def nav(active):
        groups = [("Start", [d for d in docs if d[0] == "README.md"]),
                  ("Chapters", [d for d in docs if d[0].startswith("chapters/")]),
                  ("Appendices", [d for d in docs if d[0].startswith("appendices/")])]
        out = ['<div class="brand"><span>MOMENTO</span> Platform Book</div><div class="sub">Knowledge source &amp; feature blueprint</div>',
               '<input id="q" placeholder="Filter chapters…" aria-label="Filter chapters">']
        for g, items in groups:
            out.append(f"<h4>{g}</h4>")
            for src, dst, t, _ in items:
                label = "Contents" if src == "README.md" else t
                cls = ' class="active"' if dst == active else ""
                out.append(f'<a href="{dst}"{cls} data-t="{html.escape(label.lower())}">{html.escape(label)}</a>')
        return "\n".join(out)

    for i, (src, dst, t, text) in enumerate(docs):
        body = markdown.markdown(fix_links(text, src), extensions=["tables", "fenced_code", "toc", "sane_lists"])
        prev = docs[i - 1] if i > 0 else None
        nxt = docs[i + 1] if i + 1 < len(docs) else None
        pager = '<div class="pager">' + (f'<a href="{prev[1]}">← {html.escape(prev[2])}</a>' if prev else "<span></span>") + \
                (f'<a href="{nxt[1]}">{html.escape(nxt[2])} →</a>' if nxt else "<span></span>") + "</div>"
        page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(t)} · Momento Platform Book</title><style>{CSS}</style></head><body>
<button class="menu" aria-label="Menu">☰</button><div class="layout"><nav>{nav(dst)}</nav><main>{body}{pager}</main></div>
<script>{JS}</script></body></html>"""
        (OUT / dst).write_text(page)
    print(f"built {len(docs)} pages → {OUT}")


if __name__ == "__main__":
    build()
