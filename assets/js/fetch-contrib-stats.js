// assets/js/fetch-contrib-stats.js
// Debuggable fetch of Missing Maps contribution stats from osm-stats.
// Writes ONLY 4 display-ready values into root _data/contrib_stats.json.
// Logs ONLY errors by default; set DEBUG_CONTRIB=1 for detailed logs.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEBUG = process.env.DEBUG_CONTRIB === "1";

const HASHTAG = process.env.OSM_STATS_HASHTAG || "missingmaps";

// IMPORTANT: osm-stats endpoint is HTTP (not HTTPS)
const OSMSTATS_BASE = process.env.OSMSTATS_BASE || "http://osm-stats-production-api.azurewebsites.net";
const API_URL = `${OSMSTATS_BASE}/stats/${encodeURIComponent(HASHTAG)}`;

// Save into ROOT _data (from assets/js → ../.. → repo root → _data)
const dataDir = path.join(__dirname, "..", "..", "_data");
const outputPath = path.join(dataDir, "contrib_stats.json");

function dlog(...args) {
  if (DEBUG) console.log("[contrib-stats]", ...args);
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function writeJson(obj) {
  ensureDataDir();
  fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2) + "\n");
  dlog("Wrote", outputPath);
}

// ---------- formatting ----------
function formatAbbrev(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  if (num >= 1_000_000_000) return `${Math.floor(num / 1_000_000_000)}B+`;
  if (num >= 1_000_000) return `${Math.floor(num / 1_000_000)}M+`;
  if (num >= 1_000) return `${Math.floor(num / 1_000)}K+`;
  return `${Math.floor(num)}+`;
}

function formatRoadsKm(km) {
  const num = Number(km);
  if (!Number.isFinite(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return `${num.toFixed(0)}`;
}

// ---------- normalization ----------
function pick(obj, paths) {
  for (const p of paths) {
    const v = p.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function normalizeOsmStats(payload) {
  // We print payload keys in debug mode so you can map them if needed.
  dlog("Top-level keys:", Object.keys(payload).slice(0, 80));

  const total_contributors = pick(payload, ["total_users", "totalUsers", "users", "contributors"]);
  const total_edits = pick(payload, ["total_edits", "totalEdits", "edits"]);
  const building_edits = pick(payload, ["building_edits", "buildingEdits", "buildings"]);
  const roads_km = pick(payload, ["roads_km", "roadsKm", "roads", "road_km", "roadKm"]);

  if (DEBUG) {
    dlog("Picked raw numbers:", {
      total_contributors,
      total_edits,
      building_edits,
      roads_km,
    });
  }

  const missing = [];
  if (total_contributors == null) missing.push("total_contributors");
  if (total_edits == null) missing.push("total_edits");
  if (building_edits == null) missing.push("building_edits");
  if (roads_km == null) missing.push("roads_km");

  if (missing.length) {
    throw new Error(`Normalization failed. Missing: ${missing.join(", ")}`);
  }

  return { total_contributors, total_edits, building_edits, roads_km };
}

// ---------- fetch with deep error info ----------
function explainFetchError(err) {
  // Node/undici often throws TypeError: fetch failed with nested cause
  const lines = [];
  lines.push(String(err?.message || err));

  if (err?.cause) {
    lines.push(`cause: ${err.cause?.name || "Error"}: ${err.cause?.message || err.cause}`);
    if (err.cause?.code) lines.push(`cause.code: ${err.cause.code}`);
    if (err.cause?.errno) lines.push(`cause.errno: ${err.cause.errno}`);
    if (err.cause?.address) lines.push(`cause.address: ${err.cause.address}`);
    if (err.cause?.port) lines.push(`cause.port: ${err.cause.port}`);
  }

  // Some errors include codes on the top-level too
  if (err?.code) lines.push(`code: ${err.code}`);
  if (err?.errno) lines.push(`errno: ${err.errno}`);

  return lines.join("\n");
}

async function fetchJsonWithDebug(url) {
  dlog("Fetching URL:", url);

  let res;
  try {
    // Timeout using AbortController
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);

    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(t);
  } catch (err) {
    // This is where your “fetch failed” currently happens
    throw new Error(`Fetch request error:\n${explainFetchError(err)}`);
  }

  dlog("HTTP status:", res.status, res.statusText);

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw new Error(`Failed reading response body:\n${explainFetchError(err)}`);
  }

  if (!res.ok) {
    // Show a snippet of the response to understand if it’s HTML, proxy message, etc.
    throw new Error(`HTTP error ${res.status} – ${url}\nBody (first 400 chars):\n${text.slice(0, 400)}`);
  }

  // In debug mode, show a short preview (helps spot HTML instead of JSON)
  dlog("Body preview:", text.slice(0, 180).replace(/\s+/g, " "));

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON parse error: ${err.message}\nBody (first 400 chars):\n${text.slice(0, 400)}`);
  }
}

// ---------- main ----------
async function run() {
  try {
    const payload = await fetchJsonWithDebug(API_URL);
    const raw = normalizeOsmStats(payload);

    const out = {
      total_contributors: formatAbbrev(raw.total_contributors),
      total_edits: formatAbbrev(raw.total_edits),
      building_edits: formatAbbrev(raw.building_edits),
      roads_km: formatRoadsKm(raw.roads_km),
    };

    if (DEBUG) dlog("Formatted output:", out);

    writeJson(out);
  } catch (err) {
    // Errors only by default; DEBUG gives more context because the thrown message includes details
    console.error("Error fetching contribution stats:");
    console.error(err?.message || err);

    writeJson({
      total_contributors: "—",
      total_edits: "—",
      building_edits: "—",
      roads_km: "—",
    });
  }
}

run().catch((err) => {
  console.error("Unhandled error in fetch-contrib-stats:");
  console.error(err?.message || err);
});
