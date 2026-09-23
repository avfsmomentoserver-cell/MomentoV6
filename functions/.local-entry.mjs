
// Local dev entry - replaces Cloudflare Worker with Node.js HTTP server
import Database from "better-sqlite3";

// Shim for cloudflare:workers
class LocalStorage {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }
  get sql() {
    const db = this.db;
    return {
      exec: (sql, ...params) => {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        return { toArray: () => rows };
      },
    };
  }
  transactionSync(fn) { return this.db.transaction(fn)(); }
  async getAlarm() { return null; }
  async setAlarm(_ms) {}
  close() { this.db.close(); }
}

class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async alarm() {}
}

// Export shim
export { DurableObject };

// Now import the real functions
import { MomentoCore } from "./core.js";

// Create instance
const DB_PATH = "/home/pirate/v/v6/data/momento-v6.sqlite";
const storage = new LocalStorage(DB_PATH);
const ctx = {
  storage,
  blockConcurrencyWhile: async (fn) => { await fn(); },
};

const core = new MomentoCore(ctx, {});

// Wait for bootstrap
await new Promise(r => setTimeout(r, 500));

// Import the worker handler (index.ts)
import workerModule from "./index.js";
const worker = workerModule.default;

// Mock DO fetcher that calls core directly
const mockFetcher = {
  async fetch(req) {
    // Route request through core's fetch if it exists
    if (typeof core.fetch === "function") {
      return core.fetch(req);
    }
    // Fallback - this shouldn't happen
    return new Response("Not implemented", { status: 501 });
  }
};

// Export for the server
export { core, worker, storage };
