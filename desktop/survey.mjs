const earthRadius = 6371008.8;
const rad = degrees => degrees * Math.PI / 180;
const shortAngle = degrees => ((degrees + 540) % 360) - 180;

export function readSurvey(source, fallbackName = "Levantamento", date = null) {
  if (!Array.isArray(source?.pontos) || !source.pontos.length ||
      source.pontos.length > 10000 || source.pontos.some(p =>
        !Number.isFinite(p?.lat) || Math.abs(p.lat) > 90 ||
        !Number.isFinite(p.lng) || Math.abs(p.lng) > 180)) return null;
  return {
    snapshot: source,
    projeto: String(source.projeto || fallbackName).trim().slice(0, 120) || "Levantamento",
    responsavel: String(source.responsavel ?? "").trim().slice(0, 120),
    data: date || source.data || source.atualizado || null,
    pontos: source.pontos.map((p, i) => ({
      lat: p.lat,
      lng: p.lng,
      nome: String(p.nome || `P${i + 1}`).slice(0, 80),
      accuracy: Number.isFinite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null,
      samples: Number.isInteger(p.qualidade?.samples) && p.qualidade.samples >= 0
        ? p.qualidade.samples : null,
    })),
  };
}

export function readBackup(input) {
  if (input?.formato !== "GPS-Landmensure-backup" || input.versao !== 1 ||
      !input.levantamentos || typeof input.levantamentos !== "object" ||
      Array.isArray(input.levantamentos)) throw new Error("Selecione um backup JSON exportado pelo Landmensure.");
  const surveys = [];
  let rejected = 0;
  for (const [name, value] of Object.entries(input.levantamentos)) {
    const survey = readSurvey(value, name);
    if (survey) surveys.push(survey);
    else rejected++;
  }
  if (input.rascunho?.pontos?.length) {
    const draft = readSurvey(input.rascunho, "Rascunho");
    if (draft) surveys.push({ ...draft, projeto: `${draft.projeto} · Rascunho` });
    else rejected++;
  }
  return { surveys, rejected };
}

function surveyEdges(points, closed) {
  const edges = closed ? points.length : Math.max(0, points.length - 1);
  return points.slice(0, edges).map((a, i) => {
    const b = points[(i + 1) % points.length];
    const latA = rad(a.lat);
    const latB = rad(b.lat);
    const deltaLng = rad(shortAngle(b.lng - a.lng));
    const h = Math.sin((latB - latA) / 2) ** 2 +
      Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;
    const distance = 2 * earthRadius * Math.asin(Math.sqrt(Math.min(1, h)));
    const y = Math.sin(deltaLng) * Math.cos(latB);
    const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLng);
    const azimuth = Math.hypot(x, y) < 1e-15 ? null : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return { a, b, distance, azimuth, areaTerm: deltaLng * (Math.sin(latA) + Math.sin(latB)) };
  });
}

export function measures(points) {
  const closed = points.length >= 3;
  let perimeter = 0;
  let area = 0;
  const edges = surveyEdges(points, closed);
  for (const edge of edges) {
    perimeter += edge.distance;
    area += edge.areaTerm;
  }
  return { area: closed ? Math.abs(area) * earthRadius ** 2 / 2 : null, perimeter, closed, edges };
}

export function plotCoordinates(points, width = 720, height = 360) {
  const origin = points[0];
  const scaleX = Math.cos(rad(origin.lat));
  const flat = points.map(p => ({ x: shortAngle(p.lng - origin.lng) * scaleX, y: origin.lat - p.lat }));
  const bounds = flat.reduce((b, p) => ({
    left: Math.min(b.left, p.x), right: Math.max(b.right, p.x),
    top: Math.min(b.top, p.y), bottom: Math.max(b.bottom, p.y),
  }), { left: 0, right: 0, top: 0, bottom: 0 });
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;
  const scale = w || h
    ? Math.min(w ? (width - 112) / w : Infinity, h ? (height - 88) / h : Infinity)
    : 1;
  return flat.map(p => ({
    x: width / 2 + (p.x - bounds.left - w / 2) * scale,
    y: height / 2 + (p.y - bounds.top - h / 2) * scale,
  }));
}

export function surveyQuality(points, closed) {
  const flags = points.map(point => [
    ...(point.accuracy > 5 ? ["Acurácia acima de 5 m"] : []),
    ...(point.samples !== null && point.samples < 3 ? ["Poucas leituras"] : []),
  ]);
  const locations = new Map();
  points.forEach(({ lat, lng }, index) => {
    const key = JSON.stringify([lat, lng === 180 ? -180 : lng]);
    const group = locations.get(key) ?? [];
    group.push(index);
    locations.set(key, group);
  });
  for (const group of locations.values()) {
    if (group.length > 1) for (const index of group) flags[index].push("Coordenada duplicada");
  }
  if (!closed) return flags;

  const origin = points[0].lng;
  const vertices = points.map(p => ({ x: shortAngle(p.lng - origin), y: p.lat }));
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const segments = vertices.map((a, index) => {
    const next = (index + 1) % vertices.length;
    const b = vertices[next];
    return { a, b, index, next, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
      bottom: Math.min(a.y, b.y), top: Math.max(a.y, b.y) };
  }).sort((a, b) => a.left - b.left);
  const crossed = new Set();
  for (const [i, first] of segments.entries()) {
    if (first.a.x === first.b.x && first.a.y === first.b.y) continue;
    for (let j = i + 1; j < segments.length; j++) {
      const second = segments[j];
      if (second.left > first.right) break;
      if (first.next === second.index || second.next === first.index ||
        first.top < second.bottom || second.top < first.bottom ||
        (second.a.x === second.b.x && second.a.y === second.b.y)) continue;
      const side = Math.sign(cross(first.a, first.b, second.a)) * Math.sign(cross(first.a, first.b, second.b));
      const otherSide = Math.sign(cross(second.a, second.b, first.a)) * Math.sign(cross(second.a, second.b, first.b));
      if (side <= 0 && otherSide <= 0) {
        crossed.add(first.index).add(first.next).add(second.index).add(second.next);
      }
    }
  }
  for (const index of crossed) flags[index].push("Cruzamento no contorno");
  return flags;
}

export function surveyCsv(survey) {
  const cell = value => {
    const raw = String(value ?? "");
    const text = typeof value === "string" && /^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(raw) ? "'" + raw : raw;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = survey.pontos.map(p => [p.nome, p.lat, p.lng, p.accuracy, p.samples]);
  return [["Vértice", "Latitude", "Longitude", "Acurácia (m)", "Leituras aceitas"], ...rows]
    .map(row => row.map(cell).join(";")).join("\r\n");
}

export function surveyKml(survey) {
  const escape = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const coord = p => `${p.lng},${p.lat},0`;
  const points = survey.pontos;
  const coordinates = points.map(coord);
  const geometry = points.length >= 3
    ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${[...coordinates, coordinates[0]].join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
    : points.length === 2 ? `<LineString><coordinates>${coordinates.join(" ")}</coordinates></LineString>` : "";
  const marks = points.map(p => `<Placemark><name>${escape(p.nome)}</name><Point><coordinates>${coord(p)}</coordinates></Point></Placemark>`);
  const contour = geometry ? `<Placemark><name>Contorno</name>${geometry}</Placemark>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escape(survey.projeto)}</name>${contour}${marks.join("")}</Document></kml>`;
}
