(() => {
  const SHEET_NAME = "viaggio_new";
  const CSV_URL_CANDIDATES = [
    `https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-J-fU0zQ5bftX3r1UV3x_CB82dU4RGOiUKd4jEvAuI8USWaXzA1nJK2XIUrbc9w/pub?single=true&output=csv&sheet=${encodeURIComponent(SHEET_NAME)}`,
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-J-fU0zQ5bftX3r1UV3x_CB82dU4RGOiUKd4jEvAuI8USWaXzA1nJK2XIUrbc9w/pub?gid=158652418&single=true&output=csv"
  ];
  const GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";
  const CACHE_KEY = "trip_geocode_cache_v4";

  const HEADER_ALIASES = {
    date: ["data", "date", "giorno"],
    activity: ["tipo", "attività", "attivita", "activity", "type"],
    from: ["partenza", "da", "from", "origine", "departure"],
    to: ["arrivo", "a", "to", "destinazione", "arrival"],
    place: ["luogo", "luogo/notte", "notte", "city", "città", "citta"],
    km: ["km", "distanza", "distance"],
    lodging: ["hotel", "pernottamento", "alloggio", "nome", "lodging"],
    status: ["stato", "status", "booking status"],
    cost: ["costo", "cost", "prezzo", "price"],
    address: ["indirizzo", "address"],
    link: ["link", "url", "booking link", "link conferma o sito", "link conferma", "sito"],
    mapsLink: ["google maps", "maps", "google maps link", "mappa", "map link"],
    notes: ["note", "notes", "memo", "comment"],
    cancel: ["cancellazione", "cancellation"]
  };

  const IT_MONTHS = {
    gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
    luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12
  };

  const state = {
    rows: [],
    filtered: [],
    selectedActivityId: null,
    tab: "dashboard",
    mapMode: "route",
    mapReady: false,
    map: null,
    routeLayer: null,
    nightLayer: null,
    focusLayer: null,
    lastGeocodeAt: 0
  };

  const els = {
    sourceMeta: document.getElementById("sourceMeta"),
    q: document.getElementById("q"),
    type: document.getElementById("type"),
    city: document.getElementById("city"),
    status: document.getElementById("status"),
    kDays: document.getElementById("kDays"),
    kTrips: document.getElementById("kTrips"),
    kNights: document.getElementById("kNights"),
    kKm: document.getElementById("kKm"),
    kCost: document.getElementById("kCost"),
    metaCount: document.getElementById("metaCount"),
    healthBoard: document.getElementById("healthBoard"),
    nextActivities: document.getElementById("nextActivities"),
    activitiesMeta: document.getElementById("activitiesMeta"),
    activityDetail: document.getElementById("activityDetail"),
    mapMeta: document.getElementById("mapMeta"),
    viewDashboard: document.getElementById("view-dashboard"),
    viewMap: document.getElementById("view-map"),
    btnReload: document.getElementById("btnReload"),
    btnClearGeo: document.getElementById("btnClearGeo")
  };

  const norm = (s) => String(s ?? "").trim();
  const low = (s) => norm(s).toLowerCase();
  const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  function keyify(v) {
    return low(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_\-/]+/g, " ").replace(/[^\w\s.]/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseDateFlexible(raw) {
    const value = norm(raw);
    if (!value) return "";
    const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
    const clean = keyify(value);
    const it = clean.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
    if (it && IT_MONTHS[it[2]]) return `${it[3]}-${String(IT_MONTHS[it[2]]).padStart(2, "0")}-${it[1].padStart(2, "0")}`;
    const fallback = new Date(value);
    return !Number.isNaN(fallback.getTime()) ? fallback.toISOString().slice(0, 10) : "";
  }

  function fmtIT(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function safeNum(v) {
    const n = Number(norm(v).replace(/[^\d,.-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeHttpUrl(url) {
    const value = norm(url);
    if (!value || value === "?") return "";
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  }

  function linkHtml(url, label = "apri") {
    const safe = normalizeHttpUrl(url);
    return safe ? `<a class="link" href="${esc(safe)}" target="_blank" rel="noopener">${esc(label)}</a>` : "";
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
        if (inQuotes && n === '"') { cell += '"'; i++; } else inQuotes = !inQuotes;
      } else if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
        if (c === ",") { row.push(cell); cell = ""; }
        else {
          row.push(cell);
          if (row.some((x) => norm(x))) out.push(row);
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
      if (row.some((x) => norm(x))) out.push(row);
    }
    return out;
  }

  function buildHeaderIndex(header) {
    const keys = header.map(keyify);
    const idx = {};
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      const aliasKeys = aliases.map(keyify);
      idx[canonical] = keys.findIndex((k) => aliasKeys.includes(k));
    }
    return idx;
  }

  function getCell(row, idx, key) {
    const i = idx[key];
    return i >= 0 ? norm(row[i]) : "";
  }

  function bookingPlace(r) {
    return norm(r.place) || norm(r.to) || norm(r.from) || "—";
  }

  function normalizeRow(raw, idx, i) {
    const row = {
      id: `row-${i + 1}`,
      date: getCell(raw, idx, "date"),
      activity: getCell(raw, idx, "activity"),
      from: getCell(raw, idx, "from"),
      to: getCell(raw, idx, "to"),
      place: getCell(raw, idx, "place"),
      km: getCell(raw, idx, "km"),
      lodging: getCell(raw, idx, "lodging"),
      status: getCell(raw, idx, "status"),
      cost: getCell(raw, idx, "cost"),
      address: getCell(raw, idx, "address"),
      link: getCell(raw, idx, "link"),
      mapsLink: getCell(raw, idx, "mapsLink"),
      notes: getCell(raw, idx, "notes"),
      cancel: getCell(raw, idx, "cancel")
    };
    row._dateISO = parseDateFlexible(row.date);
    row._km = safeNum(row.km);
    row._cost = safeNum(row.cost);
    row._city = row.place || row.to || row.from || "";
    row._activity = low(row.activity);
    row._addressQuery = row.address || row.place || row.to || row.from || "";
    row._kind = row._activity === "trip" ? "trip" : "night";
    row._title = row._kind === "trip" ? `${norm(row.from) || "—"} → ${norm(row.to) || "—"}` : bookingPlace(row);
    return row;
  }

  function isNightLike(r) {
    return r._activity === "notte" || !!(norm(r.lodging) || norm(r.address) || normalizeHttpUrl(r.link) || normalizeHttpUrl(r.mapsLink) || norm(r.status));
  }

  async function fetchFirstAvailableCsv() {
    let lastErr = null;
    for (const baseUrl of CSV_URL_CANDIDATES) {
      try {
        const res = await fetch(`${baseUrl}&t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const matrix = parseCSV(await res.text());
        if (!matrix.length) throw new Error("CSV vuoto");
        return { matrix, sourceUrl: baseUrl };
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Errore nel caricamento CSV (tentativi falliti: ${CSV_URL_CANDIDATES.length})${lastErr ? ` · ${lastErr.message}` : ""}`);
  }

  async function loadData() {
    els.sourceMeta.textContent = "Carico dati...";
    const { matrix, sourceUrl } = await fetchFirstAvailableCsv();

    const idx = buildHeaderIndex(matrix[0]);
    if (idx.date < 0) throw new Error("Colonna data non trovata");

    state.rows = matrix.slice(1).map((r, i) => normalizeRow(r, idx, i)).filter((r) => r._dateISO);
    state.rows.sort((a, b) => a._dateISO.localeCompare(b._dateISO) || (a._activity === "trip" ? -1 : 1));
    rebuildFilterOptions();
    renderAll();

    const sourceLabel = sourceUrl.includes(`sheet=${encodeURIComponent(SHEET_NAME)}`)
      ? `Google Sheets (${SHEET_NAME})`
      : "Google Sheets (fallback gid)";
    els.sourceMeta.textContent = `Fonte dati: ${sourceLabel} · ${state.rows.length} righe valide`;
  }

  function getFilters() {
    return {
      q: low(els.q.value),
      type: norm(els.type.value),
      city: norm(els.city.value),
      status: norm(els.status.value)
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

  function rebuildFilterOptions() {
    const cities = [...new Set(state.rows.map((r) => norm(r._city)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
    const statuses = [...new Set(state.rows.map((r) => norm(r.status)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));

    els.city.length = 1;
    cities.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      els.city.appendChild(o);
    });

    els.status.length = 1;
    statuses.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      els.status.appendChild(o);
    });
  }

  function renderAll() {
    state.filtered = applyFilters(state.rows);
    renderKPIs();
    renderDashboard();
    if (state.tab === "map") void renderMap();
    els.metaCount.textContent = `${state.filtered.length} elementi filtrati`;
  }

  function renderKPIs() {
    const data = state.filtered;
    els.kDays.textContent = new Set(data.map((r) => r._dateISO)).size || "—";
    els.kTrips.textContent = data.filter((r) => r._kind === "trip").length || "—";
    els.kNights.textContent = data.filter(isNightLike).length || "—";
    const km = data.reduce((s, r) => s + r._km, 0);
    const cost = data.reduce((s, r) => s + r._cost, 0);
    els.kKm.textContent = km ? km.toLocaleString("it-IT") : "—";
    els.kCost.textContent = cost ? cost.toLocaleString("it-IT") : "—";
  }

  function renderDashboard() {
    const data = state.filtered;
    const trips = data.filter((r) => r._kind === "trip").sort((a, b) => a._dateISO.localeCompare(b._dateISO));

    const longTrips = trips.filter((r) => r._km >= 500).length;
    const nightCandidates = data
      .filter((r) => bookingPlace(r) !== "—")
      .sort((a, b) => a._dateISO.localeCompare(b._dateISO));
    const missingAddresses = nightCandidates.filter((r) => !norm(r.address)).length;
    const booked = nightCandidates.filter((r) => ["prenotato", "confermato", "pagato"].includes(low(r.status))).length;

    els.healthBoard.innerHTML = `
      <div class="healthWrap">
        <article class="metric"><h4>Trip lunghi</h4><p>${longTrips}</p></article>
        <article class="metric"><h4>Pernotti senza indirizzo</h4><p>${missingAddresses}</p></article>
        <article class="metric"><h4>Prenotazioni confermate</h4><p>${booked}</p></article>
      </div>`;

    const byDate = new Map();
    for (const r of data) {
      if (!byDate.has(r._dateISO)) byDate.set(r._dateISO, []);
      byDate.get(r._dateISO).push(r);
    }

    const pickNightRow = (rows) => {
      if (!rows?.length) return null;
      const withNightSignal = rows.filter((r) => bookingPlace(r) !== "—");
      if (!withNightSignal.length) return null;

      const strong = withNightSignal.find((r) => r._activity === "notte" || norm(r.lodging) || norm(r.address) || norm(r.status));
      return strong || withNightSignal[0];
    };

    const dates = [...byDate.keys()].sort();
    const calendarRows = dates.map((date) => {
      const rows = byDate.get(date);
      const trip = rows.find((r) => r._kind === "trip") || null;
      const night = pickNightRow(rows);
      return { date, trip, night };
    });

    const groupMeta = new Map();
    const nightKey = (r) => bookingPlace(r);
    let i = 0;
    while (i < calendarRows.length) {
      const current = calendarRows[i].night;
      if (!current) {
        i += 1;
        continue;
      }

      const key = nightKey(current);
      let j = i + 1;
      while (j < calendarRows.length) {
        const nextNight = calendarRows[j].night;
        if (!nextNight) break;
        if (nightKey(nextNight) !== key) break;
        j += 1;
      }

      groupMeta.set(i, { rowSpan: j - i, row: current });
      for (let k = i + 1; k < j; k += 1) {
        groupMeta.set(k, { skip: true });
      }
      i = j;
    }

    const selectableNights = [...groupMeta.values()]
      .filter((m) => m.row && !m.skip)
      .map((m) => m.row);
    if (!state.selectedActivityId || !selectableNights.some((a) => a.id === state.selectedActivityId)) {
      state.selectedActivityId = selectableNights[0]?.id || null;
    }

    els.activitiesMeta.textContent = `${trips.length} trip · ${selectableNights.length} pernottamenti`;

    const renderTripCell = (r) => `
      <article class="activityRow tripRow">
        <div class="top"><span>Trip</span><span>${esc(fmtIT(r._dateISO))}</span></div>
        <div class="route">${esc(`${norm(r.from) || "—"} → ${norm(r.to) || "—"}`)}</div>
        <div class="inlineMeta">${r._km ? `<span class="pill">${esc(r._km.toLocaleString("it-IT"))} km</span>` : ""}</div>
      </article>`;

    const renderNightGroup = (r) => `
      <article class="activityRow clickable nightGroup ${r.id === state.selectedActivityId ? "active" : ""}" data-activity-id="${esc(r.id)}">
        <div class="top"><span>Pernottamento</span><span>${esc(fmtIT(r._dateISO))}</span></div>
        <div class="route">${esc(bookingPlace(r))}</div>
        <div class="inlineMeta">${norm(r.lodging) ? `<span class="pill">🏨 ${esc(norm(r.lodging))}</span>` : ""}${norm(r.status) ? `<span class="pill">${esc(norm(r.status))}</span>` : ""}</div>
      </article>`;

    const rows = calendarRows.map((day, idx) => {
      const tripCell = day.trip ? renderTripCell(day.trip) : '<div class="cellEmpty">—</div>';
      const meta = groupMeta.get(idx);

      let nightTd = "";
      if (meta?.skip) {
        nightTd = "";
      } else if (meta?.row) {
        nightTd = `<td class="nightCellWrap" rowspan="${meta.rowSpan}">${renderNightGroup(meta.row)}</td>`;
      } else {
        nightTd = '<td><div class="cellEmpty">—</div></td>';
      }

      return `
        <tr>
          <td class="dateCell">${esc(fmtIT(day.date))}</td>
          <td>${tripCell}</td>
          ${nightTd}
        </tr>`;
    }).join("");

    els.nextActivities.innerHTML = dates.length
      ? `
      <div class="activityBoard">
        <table class="activityTable">
          <thead><tr><th>Data</th><th>Trip</th><th>Pernottamento</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
      : '<div class="emptyState">Nessuna attività disponibile</div>';

    els.nextActivities.querySelectorAll(".activityRow.clickable[data-activity-id]").forEach((node) => {
      node.addEventListener("click", () => {
        state.selectedActivityId = node.getAttribute("data-activity-id");
        renderDashboard();
      });
    });

    const selected = selectableNights.find((a) => a.id === state.selectedActivityId);
    renderActivityDetail(selected);
  }

  function renderActivityDetail(row) {
    if (!row) {
      els.activityDetail.innerHTML = '<div class="emptyState">Seleziona una riga (Trip o Pernottamento) per vedere i dettagli.</div>';
      return;
    }

    const mapsUrl = normalizeHttpUrl(row.mapsLink) || (norm(row.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(norm(row.address))}` : "");

    els.activityDetail.innerHTML = `
      <h3>${esc(norm(row.lodging) || row._title)}</h3>
      <div class="detailGrid">
        <div class="k">Data</div><div>${esc(fmtIT(row._dateISO))}</div>
        <div class="k">Tipo</div><div>${esc(row.activity || "—")}</div>
        <div class="k">Percorso / Luogo</div><div>${esc(row._title)}</div>
        <div class="k">Hotel</div><div>${esc(norm(row.lodging) || "—")}</div>
        <div class="k">Indirizzo</div><div>${esc(norm(row.address) || "—")}</div>
        <div class="k">Stato</div><div>${esc(norm(row.status) || "—")}</div>
        <div class="k">Km</div><div>${row._km ? esc(row._km.toLocaleString("it-IT")) : "—"}</div>
        <div class="k">Costo</div><div>${row._cost ? esc(row._cost.toLocaleString("it-IT")) : "—"}</div>
        <div class="k">Cancellazione</div><div>${esc(norm(row.cancel) || "—")}</div>
        <div class="k">Link conferma</div><div>${linkHtml(row.link, "Apri link conferma") || "—"}</div>
        <div class="k">Google Maps</div><div>${mapsUrl ? `<a class="link" href="${esc(mapsUrl)}" target="_blank" rel="noopener">Apri in Google Maps</a>` : "—"}</div>
        <div class="k">Note</div><div>${esc(norm(row.notes) || "—")}</div>
      </div>
      <div class="actions">
        <button class="actionBtn" id="btnFocusActivityMap">Mostra su mappa</button>
      </div>
    `;

    document.getElementById("btnFocusActivityMap")?.addEventListener("click", () => void focusActivityOnMap(row));
  }

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
    catch { return {}; }
  }

  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function geocodeWithCache(query) {
    const q = norm(query);
    if (!q) return null;
    const cache = loadCache();
    if (cache[q]) return cache[q];

    const wait = Math.max(0, 1100 - (Date.now() - state.lastGeocodeAt));
    if (wait) await sleep(wait);

    const res = await fetch(`${GEOCODE_ENDPOINT}?format=json&q=${encodeURIComponent(q)}&limit=1`, { headers: { Accept: "application/json" } });
    state.lastGeocodeAt = Date.now();
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;

    const hit = { lat: Number(data[0].lat), lng: Number(data[0].lon), display: data[0].display_name || "" };
    if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null;

    cache[q] = hit;
    saveCache(cache);
    return hit;
  }

  function initMap() {
    if (state.mapReady) return;
    state.map = L.map("map", { scrollWheelZoom: true }).setView([41.9, 12.5], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.map);
    state.routeLayer = L.layerGroup().addTo(state.map);
    state.nightLayer = L.layerGroup().addTo(state.map);
    state.focusLayer = L.layerGroup().addTo(state.map);
    state.mapReady = true;
  }

  function clearMapLayers() {
    state.routeLayer?.clearLayers();
    state.nightLayer?.clearLayers();
    state.focusLayer?.clearLayers();
  }

  function fitBoundsOrFallback(layers, fallback) {
    if (!layers.length) {
      state.map.setView([41.9, 12.5], 5);
      els.mapMeta.textContent = fallback;
      return;
    }
    state.map.fitBounds(L.featureGroup(layers).getBounds().pad(0.16));
  }

  async function renderRouteMap(data) {
    const stopQueries = new Map();
    data.forEach((r) => [r.from, r.to, r.place].forEach((x) => {
      const v = norm(x);
      if (v && !stopQueries.has(v)) stopQueries.set(v, v);
    }));

    const geo = new Map();
    for (const [city, query] of stopQueries.entries()) {
      const hit = await geocodeWithCache(query);
      if (hit) geo.set(city, hit);
    }

    const layers = [];
    for (const [city, g] of geo.entries()) {
      const mk = L.marker([g.lat, g.lng]).bindPopup(`<strong>${esc(city)}</strong><br>${esc(g.display)}`);
      mk.addTo(state.routeLayer);
      layers.push(mk);
    }

    data.filter((r) => r._kind === "trip").forEach((r) => {
      const a = geo.get(norm(r.from));
      const b = geo.get(norm(r.to));
      if (!a || !b) return;
      const line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]]).bindPopup(`<strong>${esc(norm(r.from))} → ${esc(norm(r.to))}</strong>`);
      line.addTo(state.routeLayer);
      layers.push(line);
    });

    fitBoundsOrFallback(layers, "Nessuna tratta geocodificata in modalità rotta");
    els.mapMeta.textContent = `${geo.size} tappe geocodificate`;
  }

  async function renderNightMap(data) {
    const nights = data.filter(isNightLike);
    const layers = [];
    let count = 0;

    for (const r of nights) {
      const query = norm(r.address) || bookingPlace(r);
      if (!query) continue;
      const hit = await geocodeWithCache(query);
      if (!hit) continue;
      count += 1;
      const popup = `<strong>${esc(norm(r.lodging) || bookingPlace(r))}</strong><br>${esc(query)}${norm(r.status) ? `<br>📌 ${esc(norm(r.status))}` : ""}${linkHtml(r.mapsLink, "Apri in Google Maps") ? `<br>🗺️ ${linkHtml(r.mapsLink, "Apri in Google Maps")}` : ""}`;
      const mk = L.marker([hit.lat, hit.lng]).bindPopup(popup);
      mk.addTo(state.nightLayer);
      layers.push(mk);
    }

    fitBoundsOrFallback(layers, "Nessun pernottamento geocodificato");
    els.mapMeta.textContent = `${count}/${nights.length} pernottamenti geocodificati`;
  }

  async function renderMap() {
    if (state.tab !== "map" && !state.mapReady) return;
    initMap();
    clearMapLayers();
    if (state.mapMode === "route") await renderRouteMap(state.filtered);
    else await renderNightMap(state.filtered);
  }

  async function focusActivityOnMap(row) {
    setTab("map");
    setMapMode(isNightLike(row) ? "night" : "route");
    const query = norm(row.address) || bookingPlace(row);
    const hit = await geocodeWithCache(query);
    if (!hit) {
      els.mapMeta.textContent = "Impossibile geocodificare questa attività";
      return;
    }
    state.focusLayer.clearLayers();
    const mk = L.marker([hit.lat, hit.lng]).bindPopup(`<strong>${esc(norm(row.lodging) || row._title)}</strong><br>${esc(query)}`);
    mk.addTo(state.focusLayer).openPopup();
    state.map.setView([hit.lat, hit.lng], 12);
    els.mapMeta.textContent = `Focus su ${row._title}`;
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    els.viewDashboard.classList.toggle("hidden", tab !== "dashboard");
    els.viewMap.classList.toggle("hidden", tab !== "map");

    if (tab === "map") {
      initMap();
      setTimeout(() => {
        state.map.invalidateSize(true);
        void renderMap();
      }, 10);
    }
  }

  function setMapMode(mode) {
    state.mapMode = mode;
    document.querySelectorAll(".modeBtn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    if (state.tab === "map") void renderMap();
  }

  function debounce(fn, ms = 180) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function showError(err) {
    console.error(err);
    els.sourceMeta.innerHTML = `<span class="error">Errore: ${esc(err?.message || String(err))}</span>`;
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    document.querySelectorAll(".modeBtn").forEach((b) => b.addEventListener("click", () => setMapMode(b.dataset.mode)));

    const debouncedRender = debounce(renderAll);
    [els.q, els.type, els.city, els.status].forEach((node) => {
      node.addEventListener("input", debouncedRender);
      node.addEventListener("change", renderAll);
    });

    els.btnReload.addEventListener("click", () => loadData().catch(showError));
    els.btnClearGeo.addEventListener("click", () => {
      localStorage.removeItem(CACHE_KEY);
      alert("Cache geocoding pulita");
      if (state.tab === "map") void renderMap();
    });
  }

  bindEvents();
  loadData().catch(showError);
})();
