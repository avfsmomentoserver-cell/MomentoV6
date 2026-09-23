# Source Bundle & Step Docs

The most important delivery surface: one button on the Command Center that downloads the complete, runnable platform — source code plus a per-step build document — from the platform's own downloads folder, versioned and checksummed.

## Where it lives

- `web-momento/public/downloads/momento-platform-<version>.zip` — the bundle (public assets deploy verbatim, so the browser downloads it straight from the web origin).
- `web-momento/public/downloads/bundle-stats.json` — file count, size, SHA-256, generated timestamp, documented-step count. The Downloads page and Command Center read it live.
- `web-momento/public/downloads/latest.json` — machine-readable latest-release pointer.

## When it is produced

On **every build**. The web build pipeline runs:

```
node scripts/build-source-bundle.mjs   # generate walkthrough + zip + stats
node scripts/generate-docs.mjs         # regenerate the in-app docs module
vite build
```

So the bundle can never drift from the code it ships: it is regenerated from the working tree each time the platform builds.

## What goes in

- `web-momento/` — full web console source (components, pages, lib, docs), configs, package manifest.
- `functions/` — the backend Worker: `index.ts`, `core.ts` (Durable Object + all routes), `analysis.ts`, `fx.ts`, `pipeline.ts`, `docs.ts`.
- `docs/markdown/` — every documentation file, including the generated `BUILD_WALKTHROUGH.md`.
- `MANIFEST.md` — regenerated on each build: version, file inventory, per-file SHA-256s, total checksum.
- `PARITY_REPORT.md`, `README.md` (generated quickstart).

Excluded: `node_modules`, `dist`, the downloads folder itself, dotfiles.

## The step-by-step walkthrough

`BUILD_WALKTHROUGH.md` documents each build step (16 steps, from architecture & configuration through the v6 FX engines, Accuracy Engine v2, and the source-bundle pipeline itself): what the step delivers, the exact files involved, and how to verify it. The same step list backs the in-app Build Steps tracker (`GET /api/v1/platform/build-steps`).

## Release registration

After the zip is written, the script registers the release with the backend (`POST /api/v1/releases` — version, filename, URL, SHA-256). The Download Source button always points at the latest registered release via `GET /api/v1/releases/latest`, with a static fallback to the zip in `/downloads/`. Scripts can verify the running version against the downloaded bundle through the same API.

## Integrity

SHA-256 of the zip is printed by the build, embedded in `bundle-stats.json`, and registered server-side. Downloading from the platform's own origin means the bundle is always the version that is running.
