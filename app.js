const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-J-fU0zQ5bftX3r1UV3x_CB82dU4RGOiUKd4jEvAuI8USWaXzA1nJK2XIUrbc9w/pub?gid=158652418&single=true&output=csv";

const HEADER_ALIASES = {
  inc: ["inc", "index", "#", "id"],
  days: ["n days", "n. days", "days", "giorni", "durata"],
  date: ["data", "date", "giorno"],
  activity: ["attività", "attivita", "activity", "tipo", "type"],
  from: ["partenza", "da", "from", "start", "origine", "departure"],
  to: ["arrivo", "a", "to", "end", "destinazione", "arrival"],
  place: ["luogo", "citta", "città", "city", "location", "tappa", "stop"],
  km: ["km", "kms", "distanza", "distance"],
  lodging: ["pernottamento", "hotel", "alloggio", "accommodation", "lodging"],
  status: ["stato", "status", "prenotazione", "booking status"],
  cost: ["costo", "cost", "prezzo", "price", "budget"],
  notes: ["note", "notes", "commenti", "comment", "memo"],
  address: ["indirizzo", "address", "location address", "place address"],
  link: ["link", "url", "booking link", "website"]
};

let rows = [];
let map;
let mapLayerGroup;
let mapReady = false;
let activeMapMode = "route";

const norm = (s) => String(s ?? "").trim();
const low = (s) => norm(s).toLowerCase();

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeHttpUrl(url) {
  const value = norm(url);
  if (!value || value === "?") return "";
  try {
    const parsed = new URL(value);
    if (["http:", "https:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function safeLinkHtml(url, label = "link") {
  const safeUrl = normalizeHttpUrl(url);
  if (!safeUrl) return "";
  return `<a class="link" href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener">${escapeHTML(label)}</a>`;
}

function stripDiacritics(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function keyifyHeader(s) {
  return stripDiacritics(low(s))
    .replace(/[_\-]+/g, " ")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toISO(ddmmyyyy) {
  const v = norm(ddmmyyyy);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function fmtIT(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function safeNum(v) {
  const s = norm(v).replace(/[^\d,.\-]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseCSV(text) {
  const out = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"') {
      if (inQuotes && n === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === ",") {
        row.push(cell);
        cell = "";
      } else {
        row.push(cell);
        if (row.some((x) => String(x).trim() !== "")) out.push(row);
        row = [];
        cell = "";
        if (c === "\r" && n === "\n") i++;
      }
    } else {
      cell += c;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((x) => String(x).trim() !== "")) out.push(row);
  }
  return out;
}

function buildHeaderIndex(headerRow) {
  const headerKeys = headerRow.map((h) => keyifyHeader(h));
  const idx = {};

  for (const canonical of Object.keys(HEADER_ALIASES)) {
    const aliases = HEADER_ALIASES[canonical].map((a) => keyifyHeader(a));
    idx[canonical] = headerKeys.findIndex((headerKey) => aliases.includes(headerKey));
  }

  return idx;
}

function getCell(row, idx, canonical) {
  const i = idx[canonical];
  if (i === undefined || i < 0) return "";
  return norm(row[i]);
}

const GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const geocodeCacheKey = "geocode_cache_v2";

function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(geocodeCacheKey) || "{}");
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache) {
  try {
    localStorage.setItem(geocodeCacheKey, JSON.stringify(cache));
  } catch {
    // ignore localStorage errors
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastGeocodeAt = 0;

async function geocodeNominatim(query) {
  const q = norm(query);
  if (!q) return null;

  const cache = loadGeocodeCache();
  if (cache[q]) return cache[q];

  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastGeocodeAt));
  if (wait) await sleep(wait);

  const url = `${GEOCODE_ENDPOINT}?format=json&q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  lastGeocodeAt = Date.now();
  if (!res.ok) return null;

  const data = await res.json();
  if (!data || !data.length) return null;

  const hit = {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    display: data[0].display_name
  };

  if (Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
    cache[q] = hit;
    saveGeocodeCache(cache);
    return hit;
  }

  return null;
}

async function load() {
  document.getElementById("sourceMeta").textContent = "Carico dati…";
  const url = `${CSV_URL}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Impossibile caricare il CSV pubblicato.");

  const text = await res.text();
  const matrix = parseCSV(text);
  if (!matrix.length) throw new Error("CSV vuoto o non leggibile.");

  const header = matrix[0];
  const idx = buildHeaderIndex(header);

  if (idx.date < 0) throw new Error("Non trovo la colonna Data/Date (rinomina o aggiungi alias).");

  rows = matrix.slice(1).map((r) => {
    const obj = {
      inc: getCell(r, idx, "inc"),
      days: getCell(r, idx, "days"),
      date: getCell(r, idx, "date"),
      activity: getCell(r, idx, "activity"),
      from: getCell(r, idx, "from"),
      to: getCell(r, idx, "to"),
      place: getCell(r, idx, "place"),
      km: getCell(r, idx, "km"),
      lodging: getCell(r, idx, "lodging"),
      status: getCell(r, idx, "status"),
      cost: getCell(r, idx, "cost"),
      notes: getCell(r, idx, "notes"),
      address: getCell(r, idx, "address"),
      link: getCell(r, idx, "link")
    };

    obj._dateISO = toISO(obj.date);
    obj._km = safeNum(obj.km);
    obj._cost = safeNum(obj.cost);
    obj._city = obj.place || obj.to || obj.from || "";
    obj._addr = obj.address || obj.place || obj.to || obj.from || "";

    return obj;
  }).filter((r) => r._dateISO);

  rows.sort((a, b) => a._dateISO.localeCompare(b._dateISO) || (norm(a.activity) === "Trip" ? -1 : 1));

  rebuildFilters();
  renderAll();
  document.getElementById("sourceMeta").textContent = `Fonte: Google Sheets (righe: ${rows.length})`;
}

function getFilters() {
  return {
    q: low(document.getElementById("q").value),
    type: norm(document.getElementById("type").value),
    city: norm(document.getElementById("city").value),
    status: norm(document.getElementById("status").value)
  };
}

function applyFilters(data) {
  const f = getFilters();
  return data.filter((r) => {
    if (f.type && norm(r.activity) !== f.type) return false;
    if (f.city && norm(r._city) !== f.city) return false;
    if (f.status && norm(r.status) !== f.status) return false;
    if (f.q) {
      const blob = Object.values(r).join(" ").toLowerCase();
      if (!blob.includes(f.q)) return false;
    }
    return true;
  });
}

function rebuildFilters() {
  const citySet = new Set();
  const statusSet = new Set();

  rows.forEach((r) => {
    const c = norm(r._city);
    if (c) citySet.add(c);
    const st = norm(r.status);
    if (st) statusSet.add(st);
  });

  const citySel = document.getElementById("city");
  citySel.length = 1;
  [...citySet].sort((a, b) => a.localeCompare(b, "it")).forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    citySel.appendChild(o);
  });

  const statusSel = document.getElementById("status");
  statusSel.length = 1;
  [...statusSet].sort((a, b) => a.localeCompare(b, "it")).forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    statusSel.appendChild(o);
  });
}

function renderAll() {
  const filtered = applyFilters(rows);

  const days = new Set(filtered.map((r) => r._dateISO)).size;
  const trips = filtered.filter((r) => norm(r.activity) === "Trip").length;
  const nights = filtered.filter((r) => norm(r.activity) === "Notte").length;
  const km = filtered.reduce((s, r) => s + (r._km || 0), 0);
  const cost = filtered.reduce((s, r) => s + (r._cost || 0), 0);

  document.getElementById("kDays").textContent = days || "—";
  document.getElementById("kTrips").textContent = trips || "—";
  document.getElementById("kNights").textContent = nights || "—";
  document.getElementById("kKm").textContent = km ? km.toLocaleString("it-IT") : "—";
  document.getElementById("kCost").textContent = cost ? cost.toLocaleString("it-IT") : "—";
  document.getElementById("metaCount").textContent = filtered.length ? `${filtered.length} righe` : "nessun risultato";

  renderTimeline(filtered);
  renderCitySummary(filtered);
  renderBookings(filtered);
  renderMap(filtered);
}

function renderTimeline(data) {
  const out = document.getElementById("timeline");
  out.innerHTML = "";

  const by = new Map();
  for (const r of data) {
    if (!by.has(r._dateISO)) by.set(r._dateISO, []);
    by.get(r._dateISO).push(r);
  }

  const days = [...by.keys()].sort();

  for (const d of days) {
    const items = by.get(d);
    const tripItems = items.filter((r) => norm(r.activity) === "Trip");
    const nightItems = items.filter((r) => norm(r.activity) === "Notte");

    const dayKm = tripItems.reduce((s, r) => s + (r._km || 0), 0);
    const dayCost = items.reduce((s, r) => s + (r._cost || 0), 0);

    const dayBox = document.createElement("div");
    dayBox.className = "day";
    dayBox.innerHTML = `
      <div class="dayTop">
        <div class="d">${escapeHTML(fmtIT(d))}</div>
        <div class="s">${dayKm ? `${dayKm.toLocaleString("it-IT")} km` : ""}${dayKm && dayCost ? " · " : ""}${dayCost ? dayCost.toLocaleString("it-IT") : ""}</div>
      </div>
      <div class="lanes">
        <div class="lane trip">
          <div class="laneTitle"><span class="pill">TRIP</span><strong>Spostamenti</strong></div>
          <div class="laneBody" data-lane="trip"></div>
        </div>
        <div class="lane night">
          <div class="laneTitle"><span class="pill">NOTTE</span><strong>Pernotti</strong></div>
          <div class="laneBody" data-lane="night"></div>
        </div>
      </div>
    `;

    const tripLane = dayBox.querySelector('[data-lane="trip"]');
    const nightLane = dayBox.querySelector('[data-lane="night"]');

    if (!tripItems.length) {
      tripLane.innerHTML = '<div class="meta">Nessuno spostamento</div>';
    } else {
      for (const r of tripItems) {
        const kmValue = r._km;
        const warn = kmValue >= 500 ? "warn" : "";
        const st = norm(r.status);
        const costValue = r._cost ? r._cost.toLocaleString("it-IT") : "";
        const notes = norm(r.notes);
        const linkHtml = safeLinkHtml(r.link, "link");
        const route = `${norm(r.from) || "—"} → ${norm(r.to) || "—"}`;

        const card = document.createElement("div");
        card.className = `card ${warn}`;
        card.innerHTML = `
          <div class="route">🚗 ${escapeHTML(route)}</div>
          <div class="sub">
            ${kmValue ? `<span class="flag">${kmValue.toLocaleString("it-IT")} km</span>` : ""}
            ${st ? `<span class="flag">${escapeHTML(st)}</span>` : ""}
            ${costValue ? `<span class="flag">${escapeHTML(costValue)}</span>` : ""}
            ${notes ? `<span>📝 ${escapeHTML(notes)}</span>` : ""}
            ${linkHtml ? `<span>🔗 ${linkHtml}</span>` : ""}
          </div>
        `;
        tripLane.appendChild(card);
      }
    }

    if (!nightItems.length) {
      nightLane.innerHTML = '<div class="meta">Nessun pernotto</div>';
    } else {
      for (const r of nightItems) {
        const place = norm(r.place) || norm(r.to) || norm(r.from) || "—";
        const hotel = norm(r.lodging);
        const st = norm(r.status);
        const costValue = r._cost ? r._cost.toLocaleString("it-IT") : "";
        const notes = norm(r.notes);
        const ok = st && ["prenotato", "pagato", "confermato"].includes(low(st)) ? "ok" : "";
        const linkHtml = safeLinkHtml(r.link, "link");

        const card = document.createElement("div");
        card.className = `card ${ok}`;
        card.innerHTML = `
          <div class="place">🛏️ ${escapeHTML(place)}</div>
          <div class="sub">
            ${hotel ? `<span>🏨 ${escapeHTML(hotel)}</span>` : '<span class="meta">Hotel: —</span>'}
            ${st ? `<span class="flag">${escapeHTML(st)}</span>` : ""}
            ${costValue ? `<span class="flag">${escapeHTML(costValue)}</span>` : ""}
            ${linkHtml ? `<span>🔗 ${linkHtml}</span>` : ""}
            ${notes ? `<span>📝 ${escapeHTML(notes)}</span>` : ""}
          </div>
        `;
        nightLane.appendChild(card);
      }
    }

    out.appendChild(dayBox);
  }

  if (!days.length) {
    out.innerHTML = '<div class="meta">Nessun dato da mostrare con questi filtri.</div>';
  }
}

function renderCitySummary(data) {
  const out = document.getElementById("citySummary");
  const m = new Map();

  for (const r of data) {
    const c = norm(r._city);
    if (!c) continue;
    if (!m.has(c)) m.set(c, { nights: 0, tripsOut: 0, tripsIn: 0, km: 0, cost: 0 });

    const s = m.get(c);
    const act = norm(r.activity);
    if (act === "Notte") s.nights++;
    if (act === "Trip") {
      s.km += r._km || 0;
      const from = norm(r.from);
      const to = norm(r.to);
      if (from === c) s.tripsOut++;
      if (to === c) s.tripsIn++;
    }
    s.cost += r._cost || 0;
  }

  const items = [...m.entries()].sort((a, b) => (b[1].nights - a[1].nights) || a[0].localeCompare(b[0], "it"));
  if (!items.length) {
    out.innerHTML = '<div class="meta">Nessuna città (controlla colonne città/luogo).</div>';
    return;
  }

  out.innerHTML = items.map(([city, s]) => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:baseline;">
        <div style="font-weight:900;">${escapeHTML(city)}</div>
        <div class="meta">${s.nights} notti</div>
      </div>
      <div class="sub">
        <span class="flag">Trip out: ${s.tripsOut}</span>
        <span class="flag">Trip in: ${s.tripsIn}</span>
        <span class="flag">${s.km ? `${s.km.toLocaleString("it-IT")} km` : "—"}</span>
        <span class="flag">${s.cost ? s.cost.toLocaleString("it-IT") : "—"}</span>
      </div>
    </div>
  `).join("");
}

function renderBookings(data) {
  const out = document.getElementById("bookings");
  const nights = data.filter((r) => norm(r.activity) === "Notte");
  if (!nights.length) {
    out.innerHTML = '<div class="meta">Nessuna notte con questi filtri.</div>';
    return;
  }

  const byCity = new Map();
  nights.forEach((r) => {
    const c = norm(r._city) || "—";
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(r);
  });

  let html = "";
  for (const [city, items] of [...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0], "it"))) {
    html += `<h3 style="margin:10px 0 6px; font-size:16px;">${escapeHTML(city)} <span class="meta">(${items.length} notti)</span></h3>`;
    html += `<table>
      <thead><tr>
        <th>Data</th><th>Hotel</th><th>Stato</th><th>Costo</th><th>Link / Note</th>
      </tr></thead><tbody>`;

    for (const r of items.sort((a, b) => a._dateISO.localeCompare(b._dateISO))) {
      const linkHtml = safeLinkHtml(r.link, "apri") || "—";
      html += `<tr>
        <td>${escapeHTML(fmtIT(r._dateISO))}</td>
        <td>${escapeHTML(norm(r.lodging) || "—")}</td>
        <td>${escapeHTML(norm(r.status) || "—")}</td>
        <td>${r._cost ? escapeHTML(r._cost.toLocaleString("it-IT")) : "—"}</td>
        <td>
          ${linkHtml}
          ${norm(r.notes) ? `<div class="rowMini">📝 ${escapeHTML(norm(r.notes))}</div>` : ""}
        </td>
      </tr>`;
    }
    html += "</tbody></table>";
  }

  out.innerHTML = html;
}

function initMap() {
  if (mapReady) return;
  mapReady = true;
  map = L.map("map", { scrollWheelZoom: true }).setView([41.9, 12.5], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  mapLayerGroup = L.layerGroup().addTo(map);
}

function buildRouteStops(data) {
  const stops = new Map();
  for (const r of data) {
    const candidates = [r.from, r.to, r.place];
    for (const cityRaw of candidates) {
      const city = norm(cityRaw);
      if (!city || stops.has(city)) continue;
      stops.set(city, city);
    }
  }
  return stops;
}

function buildNightStops(data) {
  const stops = new Map();
  data.filter((r) => norm(r.activity) === "Notte").forEach((r, i) => {
    const label = norm(r.place) || norm(r.to) || norm(r.from) || `Pernottamento ${i + 1}`;
    const addr = norm(r.address);
    if (!addr) return;
    const key = `${label}__${addr}`;
    if (!stops.has(key)) {
      stops.set(key, { label, addr, date: r._dateISO, hotel: norm(r.lodging) });
    }
  });
  return stops;
}

async function renderMap(data) {
  const mapVisible = !document.getElementById("view-map").classList.contains("hidden");
  if (!mapVisible && !mapReady) return;

  initMap();
  mapLayerGroup.clearLayers();

  if (activeMapMode === "route") {
    await renderRouteMap(data);
  } else {
    await renderNightMap(data);
  }
}

async function renderRouteMap(data) {
  const stops = buildRouteStops(data);
  const cityToLatLng = new Map();

  for (const [city, query] of stops.entries()) {
    const hit = await geocodeNominatim(query);
    if (hit) cityToLatLng.set(city, { lat: hit.lat, lng: hit.lng, display: hit.display, q: query });
  }

  const markers = [];
  for (const [city, ll] of cityToLatLng.entries()) {
    const mk = L.marker([ll.lat, ll.lng]).bindPopup(
      `<strong>${escapeHTML(city)}</strong><br/>${escapeHTML(ll.q)}<br/><span style="color:#666">${escapeHTML(ll.display || "")}</span>`
    );
    mk.addTo(mapLayerGroup);
    markers.push(mk);
  }

  const lines = [];
  const tripRows = data.filter((r) => norm(r.activity) === "Trip");
  for (const r of tripRows) {
    const from = norm(r.from);
    const to = norm(r.to);
    const a = cityToLatLng.get(from);
    const b = cityToLatLng.get(to);
    if (a && b) {
      const line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]]);
      line.bindPopup(`<strong>${escapeHTML(from)} → ${escapeHTML(to)}</strong>${r._km ? `<br/>${escapeHTML(r._km.toLocaleString("it-IT"))} km` : ""}`);
      line.addTo(mapLayerGroup);
      lines.push(line);
    }
  }

  fitMap(markers, lines, `${markers.length} tappe geocodificate · ${lines.length} tratte`);
}

async function renderNightMap(data) {
  const stops = buildNightStops(data);
  const markers = [];

  for (const [, stop] of stops.entries()) {
    const hit = await geocodeNominatim(stop.addr);
    if (!hit) continue;
    const mk = L.marker([hit.lat, hit.lng]).bindPopup(
      `<strong>${escapeHTML(stop.label)}</strong><br/>${escapeHTML(stop.addr)}${stop.hotel ? `<br/>🏨 ${escapeHTML(stop.hotel)}` : ""}${stop.date ? `<br/>📅 ${escapeHTML(fmtIT(stop.date))}` : ""}`
    );
    mk.addTo(mapLayerGroup);
    markers.push(mk);
  }

  fitMap(markers, [], `${markers.length} pernottamenti geocodificati`);
}

function fitMap(markers, lines, successMeta) {
  const allLayers = [...markers, ...lines];
  if (allLayers.length) {
    const group = L.featureGroup(allLayers);
    map.fitBounds(group.getBounds().pad(0.15));
    document.getElementById("mapMeta").textContent = successMeta;
  } else {
    const fallbackMeta = activeMapMode === "route"
      ? "Nessuna tappa geocodificata. Controlla Partenza/Arrivo/Luogo con nomi più completi."
      : "Nessun pernottamento geocodificato. Verifica la colonna Indirizzo nelle righe Notte.";
    document.getElementById("mapMeta").textContent = fallbackMeta;
    map.setView([41.9, 12.5], 5);
  }
}

function setMapMode(mode) {
  activeMapMode = mode;
  document.querySelectorAll(".modeBtn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  renderMap(applyFilters(rows));
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("view-timeline").classList.toggle("hidden", name !== "timeline");
  document.getElementById("view-map").classList.toggle("hidden", name !== "map");
  document.getElementById("view-bookings").classList.toggle("hidden", name !== "bookings");
  if (name === "map") renderMap(applyFilters(rows));
}

function showErr(err) {
  console.error(err);
  document.getElementById("sourceMeta").textContent = `Errore: ${err?.message || err}`;
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
document.querySelectorAll(".modeBtn").forEach((b) => b.addEventListener("click", () => setMapMode(b.dataset.mode)));

["q", "type", "city", "status"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("input", renderAll);
  el.addEventListener("change", renderAll);
});

document.getElementById("btnReload").addEventListener("click", () => load().catch(showErr));
document.getElementById("btnClearGeo").addEventListener("click", () => {
  localStorage.removeItem(geocodeCacheKey);
  alert("Cache mappa svuotata.");
  renderMap(applyFilters(rows));
});

load().catch(showErr);
