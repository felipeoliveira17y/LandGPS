import { measures, plotCoordinates, readBackup, readSurvey, surveyQuality, surveyCsv, surveyKml } from "./survey.mjs";

const $ = id => document.getElementById(id);
const number = (n, places = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: places });
const example = readSurvey({
  projeto: "Talhão de demonstração",
  responsavel: "Projeto de exemplo",
  pontos: [
    { lat: -7.18060, lng: -38.78081, accuracy: 2.6, qualidade: { samples: 22 } },
    { lat: -7.18058, lng: -38.77994, accuracy: 3.1, qualidade: { samples: 19 } },
    { lat: -7.18006, lng: -38.77977, accuracy: 2.8, qualidade: { samples: 25 } },
    { lat: -7.17991, lng: -38.78030, accuracy: 3.4, qualidade: { samples: 20 } },
    { lat: -7.18020, lng: -38.78088, accuracy: 2.7, qualidade: { samples: 24 } },
  ],
});
const labels = { demo: "Demonstração · dados fictícios", local: "Backup aberto neste computador", cloud: "Levantamentos da conta" };
const namespace = "http://www.w3.org/2000/svg";
let source = "welcome";
let surveys = [];
let selected = 0;
let session = null;
let hasPro = false;
let requestGeneration = 0;
let cloudOffset = 0;
let hasMore = false;
const cloudIds = new Set();

const config = fetch("/config.json").then(res => res.ok ? res.json() : null).catch(() => null);

function svg(name, attributes) {
  const node = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

let mapMode = "schematic";
let surveyMap;
let baseLayer;
let surveyLayer;
let mapMarkers = [];
let activeVertex = -1;
const sheetFields = {
  imovel: "Imóvel", cliente: "Cliente", responsavelTecnico: "Responsável técnico", metodoColeta: "Método de coleta",
};

function showSurveySheet(survey) {
  const details = [];
  for (const [field, label] of Object.entries(sheetFields)) {
    const raw = survey.snapshot[field];
    const value = typeof raw === "string" ? raw.trim().slice(0, 120) : "";
    $("survey-sheet").elements.namedItem(field).value = value;
    if (value) details.push(`${label} — ${value}`);
  }
  $("memorial-sheet").textContent = details.join(" · ");
}

$("survey-sheet").addEventListener("submit", event => {
  event.preventDefault();
  const survey = surveys[selected];
  if (!survey) return;
  for (const field of Object.keys(sheetFields)) {
    survey.snapshot[field] = event.currentTarget.elements.namedItem(field).value.trim();
  }
  showSurveySheet(survey);
  $("sheet-status").textContent = "Ficha atualizada nesta sessão. Exporte o backup JSON para guardar os dados.";
});
let reviewTab = "overview";
const tabs = [...document.querySelectorAll(".review-tabs [role=tab]")];

function openReviewTab(name, focus = false) {
  reviewTab = name;
  for (const tab of tabs) {
    const active = tab.id === "tab-" + name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute("aria-controls")).hidden = !active;
    if (active && focus) tab.focus();
  }
  if (name === "map") renderMap();
  if (name === "history" && !historyState) void loadHistory();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => openReviewTab(tab.id.slice(4)));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visible = tabs.filter(item => !item.hidden);
    const index = visible.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length;
    openReviewTab(visible[next].id.slice(4), true);
  });
}
const mapSources = {
  street: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>', 19],
  satellite: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri World Imagery</a>', 19],
};

function fitSurveyMap() {
  if (surveyLayer) surveyMap.fitBounds(surveyLayer.getBounds(), { padding: [30, 30], maxZoom: 18, animate: false });
}

function selectVertex(index, pan = false) {
  const previous = activeVertex;
  activeVertex = index;
  for (const vertex of new Set([previous, index])) {
    const selected = vertex === index;
    $("vertices").rows[vertex]?.firstElementChild.firstElementChild.setAttribute("aria-pressed", String(selected));
    $("plot").querySelector(`[data-vertex="${vertex}"]`)?.classList.toggle("vertex-selected", selected);
    mapMarkers[vertex]?.setStyle({ color: selected ? "#a44227" : "#184c3c", weight: selected ? 4 : 2 });
  }
  if (pan && mapMode !== "schematic" && mapMarkers[index]) {
    surveyMap.panTo(mapMarkers[index].getLatLng());
    mapMarkers[index].openTooltip();
  }
}

function renderMap() {
  const survey = surveys[selected];
  const interactive = reviewTab === "map" && mapMode !== "schematic" && Boolean(globalThis.L) && Boolean(survey);
  $("plot").classList.toggle("plot-hidden-on-screen", interactive);
  $("survey-map").hidden = !interactive;
  $("map-fit").hidden = !interactive;
  $("map-status").textContent = interactive ? "Selecione um vértice na tabela para localizá-lo."
    : mapMode === "schematic" ? "Vista esquemática" : "Mapa indisponível. Exibindo o esquema.";
  if (!interactive) {
    if (surveyMap) {
      surveyLayer?.remove();
      surveyLayer = null;
      mapMarkers = [];
      baseLayer?.remove();
      baseLayer = null;
    }
    return;
  }
  const L = globalThis.L;
  if (!surveyMap) surveyMap = L.map("survey-map");
  baseLayer?.remove();
  const [url, attribution, maxZoom] = mapSources[mapMode];
  baseLayer = L.tileLayer(url, {
    attribution, maxZoom, referrerPolicy: "strict-origin-when-cross-origin",
  }).on("tileerror", () => {
    $("map-status").textContent = "Algumas imagens do mapa estão indisponíveis. O contorno continua visível.";
  }).addTo(surveyMap);
  surveyLayer?.remove();
  const firstLng = survey.pontos[0].lng;
  const positions = survey.pontos.map(p => [p.lat, firstLng + ((p.lng - firstLng + 540) % 360 - 180)]);
  const shape = positions.length >= 3 ? L.polygon : L.polyline;
  mapMarkers = positions.map((position, index) => {
    const label = document.createElement("span");
    label.textContent = survey.pontos[index].nome;
    return L.circleMarker(position, { radius: 5, color: "#184c3c", fillColor: "#fffef8", fillOpacity: 1 })
      .bindTooltip(label).on("click", () => selectVertex(index));
  });
  surveyLayer = L.featureGroup([shape(positions, { color: "#184c3c" }), ...mapMarkers]).addTo(surveyMap);
  surveyMap.invalidateSize({ pan: false });
  fitSurveyMap();
  if (activeVertex >= 0) selectVertex(activeVertex);
}

for (const mode of ["schematic", "street", "satellite"]) {
  $("map-" + mode).addEventListener("click", () => {
    $("map-" + mapMode).setAttribute("aria-pressed", "false");
    mapMode = mode;
    $("map-" + mapMode).setAttribute("aria-pressed", "true");
    renderMap();
  });
}
$("map-fit").addEventListener("click", fitSurveyMap);

function showSurvey() {
  activeVertex = -1;
  const survey = surveys[selected];
  $("empty").hidden = Boolean(survey);
  $("survey").hidden = !survey;
  $("action-status").textContent = "";
  if (!survey) {
    $("plot").replaceChildren();
    $("vertices").replaceChildren();
    renderMap();
    return;
  }
  const { area, perimeter, closed, edges } = measures(survey.pontos);
  showSurveySheet(survey);
  $("sheet-status").textContent = "";
  $("survey-source").textContent = labels[source];
  $("review-title").textContent = survey.projeto;
  const date = new Date(survey.data);
  $("survey-meta").textContent = [
    survey.responsavel,
    survey.data && Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR") : "",
  ].filter(Boolean).join(" · ");
  $("metric-count").textContent = number(survey.pontos.length, 0);
  $("metric-area").textContent = area === null ? "—" : `${number(area)} m²`;
  $("distance-label").textContent = closed ? "Perímetro" : "Distância entre pontos";
  $("metric-distance").textContent = `${number(perimeter)} m`;
  $("memorial-summary").textContent = closed
    ? `O levantamento “${survey.projeto}” tem área estimada de ${number(area)} m² e perímetro de ${number(perimeter)} m.`
    : "A coleta apresenta um contorno aberto. São necessários ao menos três vértices para descrever um perímetro fechado.";
  $("memorial-description").textContent = edges.length ?
    `A descrição parte de ${survey.pontos[0].nome}. ` + edges.map(({ a, b, distance, azimuth }) => {
      const direction = azimuth === null ? "" : `, no azimute inicial de ${number(Math.round(azimuth * 100) % 36000 / 100)}°`;
      return `De ${a.nome} a ${b.nome} são ${number(distance)} m${direction}.`;
    }).join(" ") + (closed ? ` O último trecho retorna a ${survey.pontos[0].nome}.` : "")
    : `A coleta contém o vértice ${survey.pontos[0].nome}, sem trechos entre vértices.`;
  $("print").textContent = source === "demo" || hasPro ? "Memorial em PDF" : "Memorial em PDF · Pro";

  const plotted = plotCoordinates(survey.pontos);
  const nodes = [svg(closed ? "polygon" : "polyline", {
    points: plotted.map(({ x, y }) => `${x},${y}`).join(" "),
    class: closed ? "shape area" : "shape line",
  })];
  plotted.forEach(({ x, y }, i) => {
    const point = svg("circle", { cx: x, cy: y, r: plotted.length > 250 ? 2 : 4.5, class: "vertex", "data-vertex": i });
    const label = svg("title", {});
    label.textContent = survey.pontos[i].nome;
    point.append(label);
    nodes.push(point);
    if (plotted.length <= 15) {
      const text = svg("text", { x: x + 8, y: y - 8, class: "point-label" });
      text.textContent = survey.pontos[i].nome.slice(0, 14);
      nodes.push(text);
    }
  });
  $("plot").replaceChildren(...nodes);
  const quality = surveyQuality(survey.pontos, closed);
  const flagged = quality.filter(flags => flags.length).length;
  $("quality-summary").textContent = flagged
    ? `${number(flagged, 0)} de ${number(survey.pontos.length, 0)} vértices com alertas de conferência.`
    : "Nenhum alerta nos dados registrados.";
  const rows = document.createDocumentFragment();
  for (const [index, p] of survey.pontos.entries()) {
    const tr = document.createElement("tr");
    const vertexCell = document.createElement("td");
    const vertexButton = document.createElement("button");
    vertexButton.type = "button";
    vertexButton.className = "vertex-button";
    vertexButton.textContent = p.nome;
    vertexButton.setAttribute("aria-pressed", "false");
    vertexButton.addEventListener("click", () => {
      openReviewTab("map", true);
      selectVertex(index, true);
    });
    vertexCell.append(vertexButton);
    tr.append(vertexCell);
    for (const value of [p.lat.toFixed(7), p.lng.toFixed(7),
      p.accuracy === null ? "Não registrada" : `${number(p.accuracy)} m`,
      p.samples ?? "Não registradas", quality[index].join(" · ") || "—"]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    if (quality[index].length) tr.classList.add("quality-alert");
    rows.append(tr);
  }
  $("vertices").replaceChildren(rows);
  renderMap();
}

const projectNameOrder = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const searchText = value => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
const surveyTime = survey => Date.parse(survey.data) || 0;
const revisionDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

function renderProjects() {
  const filter = searchText($("project-search").value.trim());
  const entries = surveys.map((survey, index) => ({ survey, index }))
    .filter(({ survey }) => searchText(`${survey.projeto} ${survey.responsavel}`).includes(filter))
    .sort((a, b) => {
      const byName = projectNameOrder.compare(a.survey.projeto, b.survey.projeto);
      return $("project-sort").value === "name" ? byName : surveyTime(b.survey) - surveyTime(a.survey) || byName;
    });
  $("library-filters").hidden = !surveys.length;
  $("filter-status").textContent = filter && !entries.length
    ? (hasMore ? "Nenhum resultado entre os projetos carregados. Você pode carregar mais." : "Nenhum projeto encontrado.")
    : "";
  $("projects").replaceChildren(...entries.map(({ survey, index }) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = survey.projeto;
    const details = [survey.responsavel, surveyTime(survey) ? revisionDate.format(surveyTime(survey)) : ""].filter(Boolean);
    if (details.length) {
      const meta = document.createElement("small");
      meta.textContent = details.join(" · ");
      button.append(meta);
    }
    button.setAttribute("aria-current", String(selected === index));
    button.addEventListener("click", () => {
      selected = index;
      for (const entry of $("projects").querySelectorAll("button")) {
        entry.setAttribute("aria-current", String(entry === button));
      }
      resetHistory();
      openReviewTab("overview");
      showSurvey();
    });
    item.append(button);
    return item;
  }));
}

$("project-search").addEventListener("input", renderProjects);
$("project-sort").addEventListener("change", renderProjects);

function render() {
  $("source-label").textContent = labels[source] || "";
  $("welcome").hidden = source !== "welcome";
  $("library").hidden = source === "welcome";
  $("review").hidden = source === "welcome";
  $("account").textContent = session ? "Sair da conta" : "Entrar na conta";
  $("more").hidden = source !== "cloud" || !hasMore;
  $("tab-history").hidden = !surveys[selected]?.surveyId;
  renderProjects();
  showSurvey();
}

function switchSource(next, items, message = "") {
  requestGeneration++;
  source = next;
  surveys = items;
  selected = 0;
  hasMore = false;
  $("project-search").value = "";
  resetHistory();
  openReviewTab("overview");
  $("library-status").textContent = next === "welcome" ? "" : message;
  $("welcome-status").textContent = next === "welcome" ? message : "";
  render();
  return requestGeneration;
}

async function api(endpoint, { token, method = "GET", body } = {}) {
  const settings = await config;
  if (!settings?.key) throw new Error("O painel ainda não tem a chave pública do Supabase configurada.");
  const headers = { apikey: settings.key };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(settings.project + endpoint, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const error = new Error("Não foi possível consultar o servidor. Tente novamente.");
    error.status = res.status;
    error.code = (await res.json().catch(() => ({}))).code;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

let historyState = null;
function resetHistory() {
  historyState = null;
  $("history-status").textContent = "";
  $("history-controls").hidden = true;
  $("history-more").hidden = true;
  $("history-comparison").hidden = true;
  $("history-before").replaceChildren();
  $("history-after").replaceChildren();
  $("history-vertices").replaceChildren();
  $("history-metrics").textContent = "";
}

async function loadHistory() {
  const surveyId = surveys[selected]?.surveyId;
  if (source !== "cloud" || !surveyId || !session) return;
  const token = session;
  const state = historyState ??= { revisions: new Map(), offset: 0, busy: false };
  if (state.busy) return;
  state.busy = true;
  $("history-more").disabled = true;
  $("history-status").textContent = "Carregando revisões…";
  try {
    const limit = 20;
    const query = new URLSearchParams({
      select: "revision_id,created_at,snapshot",
      survey_id: "eq." + surveyId,
      order: "created_at.desc,revision_id.desc",
      limit, offset: state.offset,
    });
    const records = await api("/rest/v1/survey_revisions?" + query, { token });
    if (historyState !== state || session !== token) return;
    state.offset += records.length;
    for (const record of records) {
      const revision = readSurvey(record.snapshot, "Levantamento", record.created_at);
      if (revision) state.revisions.set(record.revision_id, revision);
    }
    $("history-more").hidden = records.length < limit;
    $("history-more").textContent = "Carregar versões anteriores";
    renderHistory(state.revisions);
  } catch (error) {
    if (historyState !== state || session !== token) return;
    $("history-status").textContent = error.status === 401
      ? "Sua sessão expirou. Saia da conta e entre novamente."
      : "Não foi possível carregar o histórico. Tente novamente.";
    $("history-more").textContent = "Tentar novamente";
    $("history-more").hidden = false;
  } finally {
    state.busy = false;
    if (historyState === state) $("history-more").disabled = false;
  }
}

function renderHistory(revisions) {
  const before = $("history-before");
  const after = $("history-after");
  const oldSelection = [before.value, after.value];
  const ids = [...revisions.keys()];
  for (const select of [before, after]) {
    select.replaceChildren(...ids.map((id, index) => {
      const option = document.createElement("option");
      option.value = id;
      const time = surveyTime(revisions.get(id));
      option.textContent = (time ? revisionDate.format(time) : "Data indisponível") + (index === 0 ? " · Mais recente" : "");
      return option;
    }));
  }
  const comparable = revisions.size >= 2;
  $("history-controls").hidden = !comparable;
  $("history-status").textContent = comparable ? "Os vértices são pareados pelo nome e pela ordem de ocorrência." :
    "O histórico precisa de duas revisões para comparar.";
  before.value = revisions.has(oldSelection[0]) ? oldSelection[0] : ids[1] ?? "";
  after.value = revisions.has(oldSelection[1]) ? oldSelection[1] : ids[0] ?? "";
  renderComparison();
}

function vertexIds(points) {
  const occurrences = new Map();
  return new Map(points.map((point, index) => {
    const occurrence = (occurrences.get(point.nome) ?? 0) + 1;
    occurrences.set(point.nome, occurrence);
    return [JSON.stringify([point.nome, occurrence]), { point, index }];
  }));
}

function renderComparison() {
  const revisions = historyState?.revisions;
  const before = revisions?.get($("history-before").value);
  const after = revisions?.get($("history-after").value);
  $("history-comparison").hidden = !before || !after;
  if (!before || !after) return;
  $("history-vertices").replaceChildren();
  if (before === after) {
    $("history-metrics").textContent = "Escolha duas revisões diferentes.";
    return;
  }
  const a = measures(before.pontos);
  const b = measures(after.pontos);
  const signed = value => value.toLocaleString("pt-BR", { signDisplay: "exceptZero", maximumFractionDigits: 2 });
  const area = a.closed && b.closed
    ? `Área ${number(a.area)} → ${number(b.area)} m² (${signed(b.area - a.area)} m²)`
    : "Sem comparação de área";
  const distance = a.closed === b.closed
    ? `${a.closed ? "Perímetro" : "Distância entre pontos"} ${number(a.perimeter)} → ${number(b.perimeter)} m (${signed(b.perimeter - a.perimeter)} m)`
    : "Sem comparação de perímetro entre contornos aberto e fechado";
  $("history-metrics").textContent = `${area} · ${distance} · Vértices ${signed(after.pontos.length - before.pontos.length)}`;
  const oldPoints = vertexIds(before.pontos);
  const newPoints = vertexIds(after.pontos);
  const changes = document.createDocumentFragment();
  for (const key of new Set([...oldPoints.keys(), ...newPoints.keys()])) {
    const oldEntry = oldPoints.get(key);
    const newEntry = newPoints.get(key);
    const old = oldEntry?.point;
    const next = newEntry?.point;
    const change = !old ? "Adicionado" : !next ? "Removido" :
      old.lat !== next.lat || old.lng !== next.lng ? "Coordenadas alteradas" :
      oldEntry.index !== newEntry.index ? "Ordem alterada" : null;
    if (!change) continue;
    const item = document.createElement("li");
    item.textContent = `${(next ?? old).nome} · ${change}`;
    if (change === "Coordenadas alteradas") {
      const coordinates = point => `${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`;
      item.append(` (${coordinates(old)} → ${coordinates(next)})`);
    }
    changes.append(item);
  }
  if (!changes.childNodes.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhuma mudança nos vértices.";
    changes.append(item);
  }
  $("history-vertices").append(changes);
}

$("history-before").addEventListener("change", renderComparison);
$("history-after").addEventListener("change", renderComparison);
$("history-more").addEventListener("click", () => void loadHistory());

async function loadCloud(append = false) {
  if (!session) { $("login-dialog").showModal(); return; }
  if (!append) { cloudOffset = 0; cloudIds.clear(); }
  const generation = append ? ++requestGeneration : switchSource("cloud", []);
  const currentSession = session;
  $("library-status").textContent = "Consultando os levantamentos da conta…";
  $("more").disabled = true;
  try {
    const limit = 20;
    const [records, pro] = await Promise.all([
      api(`/rest/v1/survey_revisions?select=survey_id,revision_id,created_at,snapshot&order=created_at.desc,revision_id.desc&limit=${limit}&offset=${cloudOffset}`, { token: currentSession }),
      api("/rest/v1/rpc/has_active_pro", { token: currentSession, method: "POST", body: {} }).catch(() => false),
    ]);
    if (generation !== requestGeneration || session !== currentSession) return;
    hasPro = pro === true;
    cloudOffset += records.length;
    hasMore = records.length === limit;
    for (const record of records) {
      if (cloudIds.has(record.survey_id)) continue;
      const survey = readSurvey(record.snapshot, "Levantamento", record.created_at);
      if (survey) {
        cloudIds.add(record.survey_id);
        surveys.push({ ...survey, surveyId: record.survey_id });
      }
    }
    $("library-status").textContent = surveys.length ? "" : "Nenhum levantamento foi enviado para esta conta.";
    render();
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (error.status === 401) {
      session = null;
      hasPro = false;
      switchSource("cloud", [], "Sua sessão expirou. Entre novamente para consultar os levantamentos.");
    } else {
      $("library-status").textContent = error.code === "PGRST205" || error.status === 404
        ? "A sincronização ainda não está disponível. Para revisar agora, abra o backup JSON do celular."
        : "Não foi possível consultar a conta. Confira a conexão ou abra um backup do celular.";
    }
  } finally {
    if (generation === requestGeneration) $("more").disabled = false;
  }
}

$("account").addEventListener("click", () => {
  if (!session) { $("login-status").textContent = ""; $("login-dialog").showModal(); return; }
  const previous = session;
  session = null;
  hasPro = false;
  switchSource("welcome", [], "Você saiu da conta.");
  void api("/auth/v1/logout?scope=local", { token: previous, method: "POST" }).catch(() => {});
});
$("close-login").addEventListener("click", () => $("login-dialog").close());
const recoveryDialog = $("recovery-dialog");
const recoveryStatus = $("recovery-status");
const resetForm = $("reset-password");
const recoveryButtons = recoveryDialog.querySelectorAll("button");
function setRecoveryBusy(busy) {
  recoveryButtons.forEach(button => { button.disabled = busy; });
}
let recoverySession;
let recoveryEmail;
const recoveryVerifierKey = "landmensure.recovery-verifier";
const callbackUrl = new URL(location.href);
const recoveryCode = callbackUrl.searchParams.get("code");
if (recoveryCode) {
  callbackUrl.searchParams.delete("code");
  history.replaceState(null, "", callbackUrl.pathname + callbackUrl.search);
  if (sessionStorage.getItem(recoveryVerifierKey)) {
    recoveryDialog.showModal();
    setRecoveryBusy(true);
    const verifier = sessionStorage.getItem(recoveryVerifierKey);
    sessionStorage.removeItem(recoveryVerifierKey);
    api("/auth/v1/token?grant_type=pkce", {
      method: "POST", body: { auth_code: recoveryCode, code_verifier: verifier },
    }).then(result => {
      recoverySession = result.access_token;
      recoveryEmail = result.user.email;
      $("recovery-code").closest("label").hidden = true;
      $("recovery-code").required = false;
      resetForm.hidden = false;
      recoveryStatus.textContent = "Escolha uma nova senha.";
    }).catch(() => {
      recoveryStatus.textContent = "Esse link expirou ou já foi usado. Peça outro.";
    }).finally(() => setRecoveryBusy(false));
  }
}

$("open-recovery").addEventListener("click", () => {
  $("recovery-email").value = $("email").value;
  recoveryStatus.textContent = "";
  $("login-dialog").close();
  recoveryDialog.showModal();
});
$("close-recovery").addEventListener("click", () => recoveryDialog.close());
recoveryDialog.addEventListener("cancel", event => event.preventDefault());
recoveryDialog.addEventListener("close", () => {
  recoverySession = undefined;
  recoveryEmail = undefined;
  resetForm.reset();
  resetForm.hidden = true;
  $("recovery-code").closest("label").hidden = false;
  $("recovery-code").required = true;
  $("login-dialog").showModal();
});

$("request-recovery").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  if (button.disabled) return;
  setRecoveryBusy(true);
  const email = $("recovery-email").value.trim();
  try {
    if (location.protocol === "https:") {
      const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)),
        byte => byte.toString(16).padStart(2, "0")).join("");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      sessionStorage.setItem(recoveryVerifierKey, verifier);
      const redirect = encodeURIComponent(location.origin + location.pathname);
      await api("/auth/v1/recover?redirect_to=" + redirect, {
        method: "POST", body: { email, code_challenge: challenge, code_challenge_method: "s256" },
      });
      recoveryStatus.textContent = "Se o e-mail estiver cadastrado, você receberá um link. Cole o link nesta mesma aba para redefinir a senha.";
      return;
    }
    if (!recoveryDialog.open) return;
    recoveryEmail = email;
    recoverySession = undefined;
    resetForm.reset();
    resetForm.hidden = false;
    recoveryStatus.textContent = "Se esse e-mail estiver cadastrado, você receberá um código.";
  } catch (error) {
    recoveryStatus.textContent = error.status === 429
      ? "Aguarde um pouco antes de pedir outro código." : "O envio está indisponível. Tente mais tarde.";
  } finally {
    setRecoveryBusy(false);
  }
});

resetForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  if (button.disabled || !recoveryEmail) return;
  const password = $("new-password").value;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    recoveryStatus.textContent = "Inclua uma letra maiúscula, uma minúscula e um número.";
    return;
  }
  const email = recoveryEmail;
  setRecoveryBusy(true);
  try {
    if (!recoverySession) {
      const result = await api("/auth/v1/verify", {
        method: "POST", body: { type: "recovery", email, token: $("recovery-code").value.trim() },
      });
      if (!recoveryDialog.open || recoveryEmail !== email) return;
      recoverySession = result.access_token;
    }
    await api("/auth/v1/user", { method: "PUT", token: recoverySession, body: { password } });
    if (!recoveryDialog.open) return;
    $("email").value = email;
    $("login-status").textContent = "Senha atualizada. Entre com a nova senha.";
    recoveryDialog.close();
  } catch (error) {
    if (error.status === 401) recoverySession = undefined;
    recoveryStatus.textContent = recoverySession
      ? "A senha não foi atualizada. Confira os requisitos e tente novamente."
      : "Confira o código recebido ou peça um novo.";
  } finally {
    $("new-password").value = "";
    setRecoveryBusy(false);
  }
});
$("login-dialog").addEventListener("close", () => { $("password").value = ""; });
$("login").addEventListener("submit", async event => {
  event.preventDefault();
  if ($("submit-login").disabled) return;
  $("submit-login").disabled = true;
  $("login-status").textContent = "Entrando…";
  try {
    const data = await api("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: $("email").value.trim(), password: $("password").value },
    });
    if (!$("login-dialog").open) return;
    if (typeof data?.access_token !== "string") throw new Error("Não foi possível iniciar a sessão.");
    session = data.access_token;
    $("login-dialog").close();
    await loadCloud();
  } catch (error) {
    $("login-status").textContent = [400, 401].includes(error.status)
      ? "Não foi possível entrar. Confira o e-mail e a senha." : error.message;
  } finally {
    $("password").value = "";
    $("submit-login").disabled = false;
  }
});
$("cloud").addEventListener("click", () => loadCloud());
$("more").addEventListener("click", () => loadCloud(true));
$("demo").addEventListener("click", () => switchSource("demo", [example]));
$("home").addEventListener("click", () => switchSource("welcome", []));
$("welcome-demo").addEventListener("click", () => {
  switchSource("demo", [example]);
  $("review-title").focus();
});
$("welcome-backup").addEventListener("click", () => $("backup").click());
$("welcome-account").addEventListener("click", () => loadCloud());
$("open-backup").addEventListener("click", () => $("backup").click());
$("backup").addEventListener("change", async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  const generation = ++requestGeneration;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("O backup deve ter até 5 MB.");
    const { surveys: imported, rejected } = readBackup(JSON.parse(await file.text()));
    if (generation !== requestGeneration) return;
    if (!imported.length) throw new Error("O backup não contém levantamentos válidos.");
    switchSource("local", imported, rejected ? `${rejected} levantamento(s) com dados inválidos ficaram de fora.` : "");
  } catch (error) {
    if (generation === requestGeneration) {
      const status = $(source === "welcome" ? "welcome-status" : "library-status");
      status.textContent = error instanceof SyntaxError ? "O arquivo não contém um JSON válido." : error.message;
    }
  } finally {
    input.value = "";
  }
});
const exportDialog = $("export-dialog");
$("open-export").addEventListener("click", () => exportDialog.showModal());

function exportName(survey) {
  const title = survey.projeto.normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "levantamento";
  const time = new Date(survey.data || Date.now());
  const date = Number.isFinite(time.getTime()) ? time : new Date();
  return `${title}-${date.toISOString().slice(0, 10)}`;
}

function downloadSurvey(survey, extension, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${exportName(survey)}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("download").addEventListener("click", () => {
  const survey = surveys[selected];
  if (!survey) return;
  const backup = {
    formato: "GPS-Landmensure-backup", versao: 1,
    levantamentos: { [survey.projeto]: survey.snapshot }, rascunho: null,
  };
  downloadSurvey(survey, "json", JSON.stringify(backup, null, 2), "application/json");
});
for (const [id, extension, format, type] of [
  ["download-csv", "csv", surveyCsv, "text/csv;charset=utf-8"],
  ["download-kml", "kml", surveyKml, "application/vnd.google-earth.kml+xml"],
]) {
  $(id).addEventListener("click", () => {
    const survey = surveys[selected];
    if (survey) downloadSurvey(survey, extension, format(survey), type);
  });
}

function printSurvey(survey) {
  const originalTitle = document.title;
  document.title = exportName(survey);
  try { window.print(); } finally { document.title = originalTitle; }
}

$("print").addEventListener("click", async () => {
  exportDialog.close();
  const currentSurvey = surveys[selected];
  if (!currentSurvey) return;
  if (source === "demo") { printSurvey(currentSurvey); return; }
  if (!session) { $("login-dialog").showModal(); return; }
  const currentSession = session;
  $("print").disabled = true;
  try {
    const pro = await api("/rest/v1/rpc/has_active_pro", {
      token: currentSession, method: "POST", body: {},
    });
    if (session !== currentSession || surveys[selected] !== currentSurvey) return;
    hasPro = pro === true;
    $("print").textContent = hasPro ? "Memorial em PDF" : "Memorial em PDF · Pro";
    if (hasPro) printSurvey(currentSurvey);
    else $("action-status").textContent = "A impressão do memorial técnico está disponível com o plano Pro.";
  } catch {
    if (session === currentSession && surveys[selected] === currentSurvey) {
      $("action-status").textContent = "Não foi possível verificar o plano. Confira a conexão e tente novamente.";
    }
  } finally {
    $("print").disabled = false;
  }
});
$("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("theme").setAttribute("aria-pressed", String(dark));
  $("theme").textContent = dark ? "Modo claro" : "Modo escuro";
});
render();
