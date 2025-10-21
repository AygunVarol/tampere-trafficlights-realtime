import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "node:fs/promises";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const BASE = (process.env.TRAFFIC_API_BASE || "").replace(/\/+$/, "");
const LOCATIONS_URL = process.env.LOCATIONS_URL || "";
const STATES_URL = process.env.STATES_URL || "";
const DEMO_CONFIGURED = String(process.env.ENABLE_DEMO_MODE || "true").toLowerCase() === "true";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);

// NEW: configurable upstream timeout and backoff
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 3000);
const BACKOFF_AFTER_FAILS = Number(process.env.BACKOFF_AFTER_FAILS || 3);
const BACKOFF_WINDOW_MS = Number(process.env.BACKOFF_WINDOW_MS || 30000);

// Fallback flags for /config
let lastLocationsFallback = false;
let lastStatesFallback = false;

// Simple caches
let cacheLocations = { data: null, contentType: "application/json", at: 0 };
let cacheStates = { data: null, contentType: "application/json", at: 0 };

// Failure counters / backoff
let locFailCount = 0, statesFailCount = 0;
let locNextTryAt = 0, statesNextTryAt = 0;

app.use(morgan("dev"));

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, must-revalidate");
    },
  })
);

function toAbs(urlOrPath) {
  if (!urlOrPath) return null;
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (!BASE) return null;
  return `${BASE}/${urlOrPath.replace(/^\/+/, "")}`;
}

app.get("/config", (_req, res) => {
  res.json({
    pollIntervalMs: POLL_MS,
    demoConfigured: DEMO_CONFIGURED,
    fallbackActive: {
      locations: lastLocationsFallback,
      states: lastStatesFallback,
    },
    usingRemote: Boolean(LOCATIONS_URL && STATES_URL),
    base: BASE ? new URL(BASE).origin : null,
    // debug info
    upstream: {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      backoffAfterFails: BACKOFF_AFTER_FAILS,
      backoffWindowMs: BACKOFF_WINDOW_MS,
      locFailCount, statesFailCount,
      locNextTryAt, statesNextTryAt
    }
  });
});

// Fetch with timeout + nice error
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// Remote getter with JSON/text handling
async function tryRemote(url, kind /* 'locations' | 'states' */) {
  try {
    const r = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: `Upstream ${r.status}`, text: txt };
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json") || ct.includes("+json")) {
      const data = await r.json();
      return { ok: true, data, contentType: "application/json" };
    }
    const text = await r.text();
    return { ok: true, text, contentType: ct || "text/plain; charset=utf-8" };
  } catch (e) {
    console.warn(`[${kind}] fetch error:`, e?.name || "", e?.message || e);
    return { ok: false, status: 502, error: String(e) };
  }
}

async function readDemoJSON(relPath) {
  const fp = path.join(__dirname, relPath);
  const text = await readFile(fp, "utf8");
  return JSON.parse(text);
}

function shouldBackoff(nextTryAt) {
  return Date.now() < nextTryAt;
}

function onFail(kind) {
  if (kind === "locations") {
    locFailCount++;
    if (locFailCount >= BACKOFF_AFTER_FAILS) {
      locNextTryAt = Date.now() + BACKOFF_WINDOW_MS;
      locFailCount = 0; // reset counter for next window
    }
  } else {
    statesFailCount++;
    if (statesFailCount >= BACKOFF_AFTER_FAILS) {
      statesNextTryAt = Date.now() + BACKOFF_WINDOW_MS;
      statesFailCount = 0;
    }
  }
}

function onSuccess(kind) {
  if (kind === "locations") {
    locFailCount = 0;
    locNextTryAt = 0;
  } else {
    statesFailCount = 0;
    statesNextTryAt = 0;
  }
}

/* ---------- LOCATIONS ---------- */
app.get("/api/locations", async (_req, res) => {
  lastLocationsFallback = false;

  const remoteUrl = toAbs(LOCATIONS_URL);
  const now = Date.now();

  if (remoteUrl && !shouldBackoff(locNextTryAt)) {
    const out = await tryRemote(remoteUrl, "locations");
    if (out.ok) {
      onSuccess("locations");
      if (out.contentType === "application/json") {
        cacheLocations = { data: out.data, contentType: out.contentType, at: now };
        return res.json(out.data);
      }
      cacheLocations = { data: out.text, contentType: out.contentType, at: now };
      return res.type(out.contentType).send(out.text);
    }
    console.warn(`[locations] upstream failed (${out.status}): ${out.error}`);
    onFail("locations");
  }

  // Serve cached if available
  if (cacheLocations.data) {
    res.setHeader("X-Cache", "hit-locations");
    return cacheLocations.contentType === "application/json"
      ? res.json(cacheLocations.data)
      : res.type(cacheLocations.contentType).send(cacheLocations.data);
  }

  // Demo fallback
  if (DEMO_CONFIGURED) {
    lastLocationsFallback = true;
    res.setHeader("X-Demo-Fallback", "locations");
    const text = await readFile(path.join(__dirname, "sample-data", "locations.geojson"), "utf8");
    return res.type("application/json").send(text);
  }

  res.status(500).json({ error: "LOCATIONS_URL failed, and demo mode disabled" });
});

/* ---------- STATES ---------- */
app.get("/api/states", async (_req, res) => {
  lastStatesFallback = false;

  const remoteUrl = toAbs(STATES_URL);
  const now = Date.now();

  if (remoteUrl && !shouldBackoff(statesNextTryAt)) {
    const out = await tryRemote(remoteUrl, "states");
    if (out.ok) {
      onSuccess("states");
      if (out.contentType === "application/json") {
        cacheStates = { data: out.data, contentType: out.contentType, at: now };
        return res.json(out.data);
      }
      cacheStates = { data: out.text, contentType: out.contentType, at: now };
      return res.type(out.contentType).send(out.text);
    }
    console.warn(`[states] upstream failed (${out.status}): ${out.error}`);
    onFail("states");
  }

  // Serve cached states if we have any
  if (cacheStates.data) {
    res.setHeader("X-Cache", "hit-states");
    return cacheStates.contentType === "application/json"
      ? res.json(cacheStates.data)
      : res.type(cacheStates.contentType).send(cacheStates.data);
  }

  // Demo fallback with gentle randomization
  if (DEMO_CONFIGURED) {
    lastStatesFallback = true;
    res.setHeader("X-Demo-Fallback", "states");
    const base = await readDemoJSON("sample-data/states.json");
    const candidates = ["1","4","5","9","12","14","16","17","18","19","22","23"];
    const randomized = base.map((s) => ({
      ...s,
      state: Math.random() < 0.25 ? candidates[Math.floor(Math.random() * candidates.length)] : s.state,
    }));
    return res.json(randomized);
  }

  res.status(500).json({ error: "STATES_URL failed, and demo mode disabled" });
});

/* ---------- OPTIONAL: proxy ---------- */
app.get("/api/proxy", async (req, res) => {
  const p = (req.query.path || "").toString();
  const url = toAbs(p);
  if (!url) return res.status(400).json({ error: "Invalid path or base not set" });
  const out = await tryRemote(url, "proxy");
  if (!out.ok) return res.status(out.status || 502).send(out.text || out.error || "Proxy error");
  if (out.contentType === "application/json") return res.json(out.data);
  res.type(out.contentType).send(out.text);
});

/* ---------- health ---------- */
app.get("/health", async (_req, res) => {
  const out = {};
  if (LOCATIONS_URL) {
    const r = await tryRemote(toAbs(LOCATIONS_URL), "locations");
    out.locations = { ok: r.ok, status: r.status || 200 };
  } else out.locations = { ok: false, status: 400 };

  if (STATES_URL) {
    const r = await tryRemote(toAbs(STATES_URL), "states");
    out.states = { ok: r.ok, status: r.status || 200 };
  } else out.states = { ok: false, status: 400 };

  res.json({ results: out });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`⚙️  Demo configured: ${DEMO_CONFIGURED}`);
  if (!BASE) console.log("ℹ️  TRAFFIC_API_BASE not set (demo/relative-only).");
  if (!LOCATIONS_URL || !STATES_URL) console.log("ℹ️  LOCATIONS_URL or STATES_URL missing — will fallback to demo when needed.");
});
