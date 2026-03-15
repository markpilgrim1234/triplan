(() => {
  const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-J-fU0zQ5bftX3r1UV3x_CB82dU4RGOiUKd4jEvAuI8USWaXzA1nJK2XIUrbc9w/pub?gid=158652418&single=true&output=csv";
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
    selectedBookingId: null,
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
    citySummary: document.getElementById("citySummary"),
    nextActivities: document.getElementById("nextActivities"),
    timeline: document.getElementById("timeline"),
    mapMeta: document.getElementById("mapMeta"),
    bookingsMeta: document.getElementById("bookingsMeta"),
    bookingsList: document.getElementById("bookingsList"),
    bookingDetail: document.getElementById("bookingDetail"),
    viewDashboard: document.getElementById("view-dashboard"),
    viewTimeline: document.getElementById("view-timeline"),
    viewMap: document.getElementById("view-map"),
    viewBookings: document.getElementById("view-bookings"),
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
    if (!Number.isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);
    return "";
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
    return row;
  }

  function isNightLike(r) {
    return r._activity === "notte" || !!(norm(r.lodging) || norm(r.address) || normalizeHttpUrl(r.link) || normalizeHttpUrl(r.mapsLink) || norm(r.status));
  }

  async function loadData() {
    els.sourceMeta.textContent = "Carico dati...";
    const res = await fetch(`${CSV_URL}&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Errore nel caricamento CSV");
    const matrix = parseCSV(await res.text());
    if (!matrix.length) throw new Error("CSV vuoto");

    const idx = buildHeaderIndex(matrix[0]);
    if (idx.date < 0) throw new Error("Colonna data non trovata");

    state.rows = matrix.slice(1).map((r, i) => normalizeRow(r, idx, i)).filter((r) => r._dateISO);
    state.rows.sort((a, b) => a._dateISO.localeCompare(b._dateISO) || (a._activity === "trip" ? -1 : 1));

    rebuildFilterOptions();
    renderAll();
    els.sourceMeta.textContent = `Fonte dati: Google Sheets · ${state.rows.length} righe valide`;
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
    renderTimeline();
    renderBookings();
    void renderMap();
    els.metaCount.textContent = `${state.filtered.length} elementi filtrati`;
  }

  function renderKPIs() {
    const data = state.filtered;
    const days = new Set(data.map((r) => r._dateISO)).size;
    const trips = data.filter((r) => r._activity === "trip").length;
    const nights = data.filter(isNightLike).length;
    const km = data.reduce((s, r) => s + r._km, 0);
    const cost = data.reduce((s, r) => s + r._cost, 0);
    els.kDays.textContent = days || "—";
    els.kTrips.textContent = trips || "—";
    els.kNights.textContent = nights || "—";
    els.kKm.textContent = km ? km.toLocaleString("it-IT") : "—";
    els.kCost.textContent = cost ? cost.toLocaleString("it-IT") : "—";
  }

  function renderDashboard() {
    const data = state.filtered;
    const trips = data.filter((r) => r._activity === "trip");
    const longTrips = trips.filter((r) => r._km >= 500).length;
    const missingAddresses = data.filter((r) => isNightLike(r) && !norm(r.address)).length;
    const booked = data.filter((r) => ["prenotato", "confermato", "pagato"].includes(low(r.status))).length;

    els.healthBoard.innerHTML = `
      <div class="healthWrap">
        <article class="metric"><h4>Trip lunghi</h4><p>${longTrips}</p></article>
        <article class="metric"><h4>Notti senza indirizzo</h4><p>${missingAddresses}</p></article>
        <article class="metric"><h4>Prenotazioni confermate</h4><p>${booked}</p></article>
      </div>`;

    const cityMap = new Map();
    data.forEach((r) => {
      const c = norm(r._city);
      if (!c) return;
      if (!cityMap.has(c)) cityMap.set(c, { trips: 0, nights: 0 });
      const obj = cityMap.get(c);
      if (r._activity === "trip") obj.trips += 1;
      if (isNightLike(r)) obj.nights += 1;
    });
    const topCities = [...cityMap.entries()].sort((a, b) => (b[1].nights + b[1].trips) - (a[1].nights + a[1].trips)).slice(0, 8);
    els.citySummary.innerHTML = topCities.length
      ? `<div class="cityList">${topCities.map(([city, s]) => `<div class="cityRow"><strong>${esc(city)}</strong><span class="muted">${s.nights} notti · ${s.trips} trip</span></div>`).join("")}</div>`
      : `<div class="emptyState">Nessuna città disponibile</div>`;

    const upcoming = [...data].sort((a, b) => a._dateISO.localeCompare(b._dateISO)).slice(0, 10);
    els.nextActivities.innerHTML = upcoming.length
      ? `<div class="activityList">${upcoming.map((r) => `
        <article class="activityItem">
          <div class="top"><span>${esc(fmtIT(r._dateISO))}</span><span>${esc(r.activity || "—")}</span></div>
          <strong>${esc(r._activity === "trip" ? `${norm(r.from) || "—"} → ${norm(r.to) || "—"}` : (norm(r.place) || norm(r.to) || "Pernotto"))}</strong>
          <span class="muted">${esc(norm(r.lodging) || norm(r.address) || norm(r.notes) || "")}</span>
          ${linkHtml(r.mapsLink, "Google maps") ? `<span class="muted">🗺️ ${linkHtml(r.mapsLink, "Google maps")}</span>` : ""}
        </article>`).join("")}</div>`
      : `<div class="emptyState">Nessuna attività disponibile</div>`;
  }

  function renderTimeline() {
    const byDay = new Map();
    state.filtered.forEach((r) => {
      if (!byDay.has(r._dateISO)) byDay.set(r._dateISO, []);
      byDay.get(r._dateISO).push(r);
    });
    const days = [...byDay.keys()].sort();
    if (!days.length) {
      els.timeline.innerHTML = `<div class="emptyState">Nessun dato in timeline con i filtri correnti.</div>`;
      return;
    }

    els.timeline.innerHTML = days.map((d) => {
      const items = byDay.get(d);
      const km = items.reduce((s, r) => s + r._km, 0);
      const cost = items.reduce((s, r) => s + r._cost, 0);
      return `
      <article class="timelineDay">
        <header class="timelineHead"><span>${esc(fmtIT(d))}</span><span>${km ? `${km.toLocaleString("it-IT")} km` : ""}${km && cost ? " · " : ""}${cost ? cost.toLocaleString("it-IT") : ""}</span></header>
        <div class="timelineBody">
          ${items.map((r) => `
            <div class="timelineCard ${r._activity === "trip" ? "trip" : "night"}">
              <div class="route">${esc(r._activity === "trip" ? `${norm(r.from) || "—"} → ${norm(r.to) || "—"}` : (norm(r.place) || norm(r.to) || "Pernottamento"))}</div>
              <div class="badges">
                <span class="badge">${esc(r.activity || "—")}</span>
                ${r._km ? `<span class="badge">${esc(r._km.toLocaleString("it-IT"))} km</span>` : ""}
                ${norm(r.status) ? `<span class="badge">${esc(norm(r.status))}</span>` : ""}
                ${norm(r.lodging) ? `<span class="badge">🏨 ${esc(norm(r.lodging))}</span>` : ""}
                ${norm(r.address) ? `<span class="badge">📍 ${esc(norm(r.address))}</span>` : ""}
                ${linkHtml(r.link, "link") ? `<span class="badge">🔗 ${linkHtml(r.link, "link")}</span>` : ""}
              </div>
            </div>`).join("")}
        </div>
      </article>`;
    }).join("");
  }

  function bookingPlace(r) {
    return norm(r.place) || norm(r.to) || norm(r.from) || "—";
  }

  function renderBookings() {
    const bookings = state.filtered.filter(isNightLike).sort((a, b) => a._dateISO.localeCompare(b._dateISO));
    els.bookingsMeta.textContent = `${bookings.length} elementi`;

    if (!bookings.length) {
      els.bookingsList.innerHTML = `<div class="emptyState">Nessuna prenotazione nei filtri correnti.</div>`;
      els.bookingDetail.innerHTML = `<div class="emptyState">Seleziona una prenotazione per i dettagli.</div>`;
      state.selectedBookingId = null;
      return;
    }

    if (!state.selectedBookingId || !bookings.some((b) => b.id === state.selectedBookingId)) {
      state.selectedBookingId = bookings[0].id;
    }

    els.bookingsList.innerHTML = bookings.map((b) => `
      <article class="bookingCard ${b.id === state.selectedBookingId ? "active" : ""}" data-booking-id="${esc(b.id)}">
        <div class="top">
          <span class="title">${esc(norm(b.lodging) || bookingPlace(b))}</span>
          <span class="date">${esc(fmtIT(b._dateISO))}</span>
        </div>
        <div class="inlineMeta">
          <span class="pill">📍 ${esc(bookingPlace(b))}</span>
          ${norm(b.status) ? `<span class="pill">${esc(norm(b.status))}</span>` : ""}
          ${b._cost ? `<span class="pill">${esc(b._cost.toLocaleString("it-IT"))}</span>` : ""}
          ${linkHtml(b.mapsLink, "maps") ? `<span class="pill">🗺️ ${linkHtml(b.mapsLink, "maps")}</span>` : ""}
        </div>
      </article>
    `).join("");

    els.bookingsList.querySelectorAll("[data-booking-id]").forEach((node) => {
      node.addEventListener("click", () => {
        state.selectedBookingId = node.getAttribute("data-booking-id");
        renderBookings();
      });
    });

    const selected = bookings.find((b) => b.id === state.selectedBookingId) || bookings[0];
    els.bookingDetail.innerHTML = `
      <h3>${esc(norm(selected.lodging) || bookingPlace(selected))}</h3>
      <div class="detailGrid">
        <div class="k">Data</div><div>${esc(fmtIT(selected._dateISO))}</div>
        <div class="k">Luogo</div><div>${esc(bookingPlace(selected))}</div>
        <div class="k">Indirizzo</div><div>${esc(norm(selected.address) || "—")}</div>
        <div class="k">Stato</div><div>${esc(norm(selected.status) || "—")}</div>
        <div class="k">Costo</div><div>${selected._cost ? esc(selected._cost.toLocaleString("it-IT")) : "—"}</div>
        <div class="k">Cancellazione</div><div>${esc(norm(selected.cancel) || "—")}</div>
        <div class="k">Google Maps</div><div>${linkHtml(selected.mapsLink, "apri mappa") || "—"}</div>
        <div class="k">Link conferma</div><div>${linkHtml(selected.link, "apri prenotazione") || "—"}</div>
        <div class="k">Note</div><div>${esc(norm(selected.notes) || "—")}</div>
      </div>
      <div class="actions">
        <button class="actionBtn" id="btnFocusBooking">Apri in mappa</button>
      </div>
    `;

    document.getElementById("btnFocusBooking")?.addEventListener("click", () => void focusBookingOnMap(selected));
  }

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore
    }
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

    data.filter((r) => r._activity === "trip").forEach((r) => {
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
      const popup = `<strong>${esc(norm(r.lodging) || bookingPlace(r))}</strong><br>${esc(query)}${norm(r.status) ? `<br>📌 ${esc(norm(r.status))}` : ""}${linkHtml(r.mapsLink, "Google Maps") ? `<br>🗺️ ${linkHtml(r.mapsLink, "Google Maps")}` : ""}${linkHtml(r.link, "Conferma") ? `<br>🔗 ${linkHtml(r.link, "Conferma")}` : ""}`;
      const mk = L.marker([hit.lat, hit.lng]).bindPopup(popup);
      mk.addTo(state.nightLayer);
      layers.push(mk);
    }

    fitBoundsOrFallback(layers, "Nessun pernottamento geocodificato");
    els.mapMeta.textContent = `${count}/${nights.length} pernottamenti geocodificati`;
  }

  async function renderMap() {
    if (els.viewMap.classList.contains("hidden") && !state.mapReady) return;
    initMap();
    clearMapLayers();
    if (state.mapMode === "route") await renderRouteMap(state.filtered);
    else await renderNightMap(state.filtered);
  }

  async function focusBookingOnMap(booking) {
    setTab("map");
    setMapMode("night");

    const query = norm(booking.address) || bookingPlace(booking);
    const hit = await geocodeWithCache(query);
    if (!hit) {
      els.mapMeta.textContent = "Impossibile geocodificare questa prenotazione";
      return;
    }

    state.focusLayer.clearLayers();
    const mk = L.marker([hit.lat, hit.lng]).bindPopup(`<strong>${esc(norm(booking.lodging) || bookingPlace(booking))}</strong><br>${esc(query)}`);
    mk.addTo(state.focusLayer).openPopup();
    state.map.setView([hit.lat, hit.lng], 12);
    els.mapMeta.textContent = `Focus su ${bookingPlace(booking)}`;
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    els.viewDashboard.classList.toggle("hidden", tab !== "dashboard");
    els.viewTimeline.classList.toggle("hidden", tab !== "timeline");
    els.viewMap.classList.toggle("hidden", tab !== "map");
    els.viewBookings.classList.toggle("hidden", tab !== "bookings");

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
    void renderMap();
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
      void renderMap();
    });
  }

  bindEvents();
  loadData().catch(showError);
})();
