// public/app.js
// Realtime Tampere traffic lights map UI
// - Shows a fallback badge if server is using demo data
// - Per-request toast when a route falls back (X-Demo-Fallback header)
// - Uses GRINT mapping (from grint.js) and adapters (from adapters.js)

(async function () {
  // ----- DOM refs
  const $status = document.getElementById("status");
  const $conn = document.getElementById("conn");
  const $last = document.getElementById("lastUpdate");
  const $cfg = document.getElementById("cfg");

  // ----- Toast helper
  function makeToastContainer() {
    let el = document.getElementById("toast-container");
    if (el) return el;
    el = document.createElement("div");
    el.id = "toast-container";
    Object.assign(el.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      display: "grid",
      gap: "8px",
      zIndex: "9999"
    });
    document.body.appendChild(el);
    return el;
  }

  function toast(msg, kind = "info") {
    const box = document.createElement("div");
    const bg = kind === "warn" ? "#40220f" : kind === "error" ? "#3a0f12" : "#10233f";
    const color = kind === "warn" ? "#ffb15a" : kind === "error" ? "#ff808b" : "#9dc1ff";
    Object.assign(box.style, {
      minWidth: "220px",
      maxWidth: "360px",
      padding: "10px 12px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: bg,
      color,
      fontSize: "13px",
      boxShadow: "0 6px 30px rgba(0,0,0,0.35)"
    });
    box.textContent = msg;
    const cont = makeToastContainer();
    cont.appendChild(box);
    setTimeout(() => {
      box.style.transition = "opacity .35s ease, transform .35s ease";
      box.style.opacity = "0";
      box.style.transform = "translateY(6px)";
      setTimeout(() => box.remove(), 400);
    }, 2200);
  }

  // ----- Fetch helpers
  async function get(url) {
    const r = await fetch(url, { cache: "no-store" });
    const ct = (r.headers.get("content-type") || "").toLowerCase();

    // Per-request fallback notification
    const fb = r.headers.get("X-Demo-Fallback");
    if (fb === "locations") toast("Locations fell back to demo", "warn");
    if (fb === "states") toast("States fell back to demo", "warn");

    if (ct.includes("application/json") || ct.includes("+json")) return r.json();
    return r.text();
  }

  // ----- Config & initial badge
  const cfg = await fetch("/config").then(r => r.json()).catch(() => ({}));
  $cfg.textContent = JSON.stringify(cfg, null, 2);

  // Header connection label
  function setConn(text, color = "#4da3ff") {
    $conn.textContent = text;
    $conn.style.color = color;
  }

  // Global fallback badge if server-wide fallback is active
  const fallbackNow = !!(cfg.fallbackActive && (cfg.fallbackActive.locations || cfg.fallbackActive.states));
  if (fallbackNow) {
    const badge = document.createElement("span");
    badge.textContent = "fallback: demo";
    Object.assign(badge.style, {
      padding: "2px 8px",
      borderRadius: "999px",
      background: "#40220f",
      color: "#ffb15a",
      border: "1px solid #8a5a2b"
    });
    $status.appendChild(badge);
  }

  // ----- Map
  const tampere = [61.4978, 23.7610];
  const map = L.map("map", { zoomControl: true }).setView(tampere, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 20
  }).addTo(map);

  // ----- Markers state
  const markers = new Map(); // id -> Leaflet marker
  let pollInterval = Number(cfg.pollIntervalMs || 2000) || 2000;

  // Visual marker chip
  function chip(color) {
    const div = document.createElement("div");
    div.className = "marker-chip";
    div.style.background = color;
    return L.divIcon({ html: div, className: "", iconSize: [16, 16] });
  }

  // Create/update a marker
  function upsertMarker(loc, stateCode) {
    const cat = window.GRINT.toCategory(stateCode);
    const color = window.GRINT.color(cat);
    const existing = markers.get(loc.id);
    const html = `
      <strong>${escapeHTML(loc.name || loc.id)}</strong><br/>
      <small>ID: ${escapeHTML(loc.id)}</small><br/>
      <small>State: ${escapeHTML(stateCode || "?")} (${escapeHTML(cat)})</small>
    `;
    if (existing) {
      existing.setIcon(chip(color));
      existing.setPopupContent(html);
      return existing;
    }
    const m = L.marker([loc.lat, loc.lon], { icon: chip(color) }).bindPopup(html);
    m.addTo(map);
    markers.set(loc.id, m);
    return m;
  }

  // Small HTML escaper for popup content
  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ----- Data loaders
  async function loadLocations() {
    try {
      setConn("loading locations…");
      const raw = await get("/api/locations");
      const locs = window.TampereAdapters.parseLocations(raw);
      if (!Array.isArray(locs) || !locs.length) throw new Error("No locations parsed");
      locs.forEach(loc => upsertMarker(loc, null));
      setConn(`loaded ${locs.length} locations`);
      return locs;
    } catch (e) {
      console.error("[locations] parse/error:", e);
      setConn("failed to load locations (see console)", "#ff808b");
      toast("Failed to load locations", "error");
      return [];
    }
  }

  async function loadStates() {
    try {
      const raw = await get("/api/states");
      const states = window.TampereAdapters.parseStates(raw);
      if (!Array.isArray(states)) return [];
      return states;
    } catch (e) {
      console.error("[states] fetch/error:", e);
      return [];
    }
  }

  // ----- Kickoff
  const locations = await loadLocations();

  async function tick() {
    try {
      setConn("updating…");
      const states = await loadStates();
      const now = new Date();
      const locById = new Map(locations.map(l => [String(l.id), l]));
      let hits = 0;

      for (const s of states) {
        const loc = locById.get(String(s.id));
        if (!loc) continue; // ignore unknown ids
        upsertMarker(loc, s.state);
        hits++;
      }

      $last.textContent = `• updated ${now.toLocaleTimeString()}`;
      setConn(`live: ${hits} states`);
    } catch (e) {
      console.error("[tick] error:", e);
      setConn("update error", "#ff808b");
    }
  }

  // Initial + interval
  if (locations.length) {
    await tick();
    setInterval(tick, pollInterval);
  }
})();
