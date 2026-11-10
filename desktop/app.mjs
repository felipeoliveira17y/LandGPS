import { measures, plotCoordinates, readBackup, readSurvey } from "./survey.mjs";

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
let source = "demo";
let surveys = [example];
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

function showSurvey() {
  const survey = surveys[selected];
  $("empty").hidden = Boolean(survey);
  $("survey").hidden = !survey;
  $("action-status").textContent = "";
  if (!survey) {
    $("plot").replaceChildren();
    $("vertices").replaceChildren();
    return;
  }
  const { area, perimeter, closed } = measures(survey.pontos);
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
  $("print").textContent = source === "demo" || hasPro ? "Imprimir memorial" : "Imprimir memorial · Pro";

  const plotted = plotCoordinates(survey.pontos);
  const nodes = [svg(closed ? "polygon" : "polyline", {
    points: plotted.map(({ x, y }) => `${x},${y}`).join(" "),
    class: closed ? "shape area" : "shape line",
  })];
  plotted.forEach(({ x, y }, i) => {
    const point = svg("circle", { cx: x, cy: y, r: plotted.length > 250 ? 2 : 4.5, class: "vertex" });
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
  const rows = document.createDocumentFragment();
  for (const p of survey.pontos) {
    const tr = document.createElement("tr");
    for (const value of [p.nome, p.lat.toFixed(7), p.lng.toFixed(7),
      p.accuracy === null ? "—" : `${number(p.accuracy)} m`, p.samples ?? "—"]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    rows.append(tr);
  }
  $("vertices").replaceChildren(rows);
}

function render() {
  $("source-label").textContent = labels[source];
  $("account").textContent = session ? "Sair da conta" : "Entrar na conta";
  $("more").hidden = source !== "cloud" || !hasMore;
  const entries = surveys.map((survey, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = survey.projeto;
    button.setAttribute("aria-current", String(selected === index));
    button.addEventListener("click", () => {
      selected = index;
      for (const [i, child] of [...$("projects").children].entries()) {
        child.firstElementChild.setAttribute("aria-current", String(i === selected));
      }
      showSurvey();
    });
    item.append(button);
    return item;
  });
  $("projects").replaceChildren(...entries);
  showSurvey();
}

function switchSource(next, items, message = "") {
  requestGeneration++;
  source = next;
  surveys = items;
  selected = 0;
  hasMore = false;
  $("library-status").textContent = message;
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
      cloudIds.add(record.survey_id);
      const survey = readSurvey(record.snapshot, "Levantamento", record.created_at);
      if (survey) surveys.push(survey);
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
  switchSource("demo", [example], "Você saiu da conta.");
  void api("/auth/v1/logout?scope=local", { token: previous, method: "POST" }).catch(() => {});
});
$("close-login").addEventListener("click", () => $("login-dialog").close());
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
    if (generation === requestGeneration) $("library-status").textContent = error instanceof SyntaxError
      ? "O arquivo não contém um JSON válido." : error.message;
  } finally {
    input.value = "";
  }
});
$("download").addEventListener("click", () => {
  const survey = surveys[selected];
  if (!survey) return;
  const backup = {
    formato: "GPS-Landmensure-backup", versao: 1,
    levantamentos: { [survey.projeto]: survey.snapshot }, rascunho: null,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${survey.projeto.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("print").addEventListener("click", async () => {
  if (source === "demo") { window.print(); return; }
  if (!session) { $("login-dialog").showModal(); return; }
  const currentSession = session;
  const currentSurvey = surveys[selected];
  $("print").disabled = true;
  try {
    const pro = await api("/rest/v1/rpc/has_active_pro", {
      token: currentSession, method: "POST", body: {},
    });
    if (session !== currentSession || surveys[selected] !== currentSurvey) return;
    hasPro = pro === true;
    $("print").textContent = hasPro ? "Imprimir memorial" : "Imprimir memorial · Pro";
    if (hasPro) window.print();
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
