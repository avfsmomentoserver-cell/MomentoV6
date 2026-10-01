#!/usr/bin/env node
// local-dev.mjs — Local dev server for v6 functions.
// Uses sql.js (pure WASM SQLite) to run v6 functions locally without Cloudflare runtime.

import { createServer } from "http";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import initSqlJs from "sql.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load functions/.env (ENTRIM_API_KEY, …) without a dependency. Real environment
// variables win over the file; a missing or malformed file is not fatal.
const envFile = resolve(__dirname, ".env");
if (existsSync(envFile)) {
  try {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    console.log("[momento-v6] loaded functions/.env");
  } catch (e) {
    console.warn("[momento-v6] could not read functions/.env:", e instanceof Error ? e.message : e);
  }
}

// Parse args
const args = process.argv.slice(2);
let port = 8000;
let dbPath = resolve(__dirname, "../data/momento-v6.sqlite");

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "-p" || args[i] === "--port") && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
  if ((args[i] === "-d" || args[i] === "--db") && args[i + 1]) {
    dbPath = args[i + 1];
    i++;
  }
}

// Ensure data directory
mkdirSync(dirname(dbPath), { recursive: true });

// ─── SQL.js Storage (sync API matching Cloudflare's ctx.storage.sql) ───

class LocalStorage {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init(SQL) {
    if (existsSync(this.dbPath)) {
      const data = readFileSync(this.dbPath);
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
    }
  }

  /** Debounced persist — exporting the whole DB after every INSERT made bulk ingest O(n²). */
  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 250);
  }

  _save() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    } catch (e) { /* ignore */ }
  }

  // Sync sql.exec() matching Cloudflare's API
  get sql() {
    const db = this.db;
    const self = this;
    return {
      exec(sql, ...params) {
        if (!db) return { toArray: () => [] };
        
        // Check if this is a SELECT query (returns rows)
        const isSelect = sql.trim().toUpperCase().startsWith("SELECT");
        
        if (params.length === 0 && !isSelect) {
          // No params and not SELECT - use db.exec for DDL/DML multi-statement support
          db.exec(sql);
          const written = db.getRowsModified();
          return { toArray: () => [], rowsWritten: written };
        }
        
        // For SELECT or parameterized queries, use prepared statements
        const stmt = db.prepare(sql);
        if (params.length) {
          stmt.bind(params);
        }
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        const rowsWritten = isSelect ? 0 : db.getRowsModified();
        if (!isSelect) self._scheduleSave();
        return { toArray: () => rows, rowsWritten };
      },
    };
  }

  transactionSync(fn) {
    // sql.js is single-threaded, so direct call is safe
    return fn();
  }

  async getAlarm() { return this._alarmAt ?? null; }
  async setAlarm(ms) { this._alarmAt = ms; }

  close() {
    if (this.db) {
      this._save();
      this.db.close();
    }
  }
}

// ─── Initialize ───

console.log("[momento-v6] Loading SQL.js...");
const SQL = await initSqlJs();

console.log("[momento-v6] Creating storage...");
const storage = new LocalStorage(dbPath);
await storage.init(SQL);

// Run PRAGMAs
storage.sql.exec("PRAGMA journal_mode = WAL");
storage.sql.exec("PRAGMA foreign_keys = ON");

console.log("[momento-v6] Bundling functions...");

// Bundle with esbuild
await build({
  entryPoints: [resolve(__dirname, "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(__dirname, ".local-bundle.mjs"),
  external: ["sql.js", "fs"],
  define: {
    "import.meta.env": JSON.stringify({}),
  },
  logLevel: "warning",
  // Replace cloudflare:workers import with inline shim
  plugins: [{
    name: "cloudflare-shim",
    setup(build) {
      build.onResolve({ filter: /^cloudflare:/ }, (args) => {
        return { path: args.path, namespace: "cloudflare-shim" };
      });
      build.onLoad({ filter: /^.*$/, namespace: "cloudflare-shim" }, () => {
        return {
          contents: `
            export class DurableObject {
              constructor(ctx, env) { this.ctx = ctx; this.env = env; }
              async alarm() {}
            }
          `,
          loader: "js",
        };
      });
    },
  }],
});

console.log("[momento-v6] Loading bundled worker...");
const workerModule = await import(resolve(__dirname, ".local-bundle.mjs"));
const worker = workerModule.default;

// ─── Create DO Instance ───

// We need to get the MomentoCore class from the bundle
// It's exported from core.ts which is bundled
const coreExports = await import(resolve(__dirname, ".local-bundle.mjs"));

// The bundle exports MomentoCore from core.ts
// We need to find it - let's check what's available
// Actually, the bundle is bundled so exports are merged
// Let's create the ctx and instantiate

const ctx = {
  storage,
  blockConcurrencyWhile: async (fn) => { await fn(); },
};

// We need the MomentoCore class - it should be in the bundle
// Let's import core.ts separately to get the class
console.log("[momento-v6] Loading MomentoCore class...");

await build({
  entryPoints: [resolve(__dirname, "core.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(__dirname, ".local-core.mjs"),
  external: ["sql.js", "fs"],
  define: {
    "import.meta.env": JSON.stringify({}),
  },
  logLevel: "warning",
  plugins: [{
    name: "cloudflare-shim",
    setup(build) {
      build.onResolve({ filter: /^cloudflare:/ }, (args) => {
        return { path: args.path, namespace: "cloudflare-shim" };
      });
      build.onLoad({ filter: /^.*$/, namespace: "cloudflare-shim" }, () => {
        return {
          contents: `
            export class DurableObject {
              constructor(ctx, env) { this.ctx = ctx; this.env = env; }
              async alarm() {}
            }
          `,
          loader: "js",
        };
      });
    },
  }],
});

const coreModule = await import(resolve(__dirname, ".local-core.mjs"));
const MomentoCore = coreModule.MomentoCore;

console.log("[momento-v6] Instantiating MomentoCore...");
const core = new MomentoCore(ctx, {
  ENTRIM_API_KEY: process.env.ENTRIM_API_KEY ?? "",
});

// Local Durable-Object alarm emulation: the deep tier (scheduled scans, chart
// ledger, AI summary) and the accuracy engine run exactly as on Cloudflare.
let alarmBusy = false;
setInterval(async () => {
  if (alarmBusy) return;
  const at = storage._alarmAt;
  if (at === undefined || at === null) {
    storage._alarmAt = Date.now() + 30_000;
    return;
  }
  if (Date.now() < at) return;
  alarmBusy = true;
  storage._alarmAt = null;
  try {
    await core.alarm();
  } catch (e) {
    console.error("[momento-v6] alarm failed", e?.message ?? e);
  } finally {
    alarmBusy = false;
    if (!storage._alarmAt) storage._alarmAt = Date.now() + 60_000;
  }
}, 5_000);

// Wait for bootstrap
await new Promise(r => setTimeout(r, 2000));
console.log("[momento-v6] Bootstrap complete");

// ─── HTTP Server ───

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  
  // Read body
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  
  // Create Request
  const request = new Request(url, {
    method: req.method,
    headers: req.headers, // Node.js http headers are already a plain object
    body: req.method !== "GET" && req.method !== "HEAD" && body ? body : undefined,
  });
  
  // Add DO routing headers
  request.headers.set("X-Rork-DO-Class", "MomentoCore");
  request.headers.set("X-Rork-DO-Id", "global");
  
  try {
    // Mock DO fetcher that routes to our core instance
    const mockFetcher = {
      async fetch(req) {
        // The worker's index.ts expects to call env.DO.fetch()
        // which should route to the DO's fetch method
        // We need to call core's fetch handler
        // But MomentoCore extends DurableObject which doesn't have a fetch method by default
        // The routes are defined in the DO's fetch handler
        
        // Actually looking at index.ts, it calls env.DO.fetch(wrapped)
        // and the DO needs to have a fetch method
        // In Cloudflare Workers, the DO's fetch method is what handles requests
        // We need to check if core has a fetch method
        
        if (typeof core.fetch === "function") {
          return core.fetch(req);
        }
        
        // If no fetch method, the routes might be defined differently
        return new Response(JSON.stringify({ ok: false, error: "DO fetch not implemented" }), { 
          status: 501,
          headers: { "content-type": "application/json", ...corsHeaders }
        });
      }
    };
    
    const response = await worker.fetch(request, { DO: mockFetcher });
    
    // Write response
    const responseHeaders = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, responseHeaders);
    
    const text = await response.text();
    res.end(text);
  } catch (err) {
    console.error("[momento-v6] Request error:", err.message, err.stack);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[momento-v6] ✓ Running at http://0.0.0.0:${port}`);
  console.log(`[momento-v6] ✓ Database: ${dbPath}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[momento-v6] Shutting down...");
  storage.close();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[momento-v6] Shutting down...");
  storage.close();
  server.close();
  process.exit(0);
});
