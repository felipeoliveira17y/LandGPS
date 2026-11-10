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
      samples: Number.isInteger(p.qualidade?.samples) && p.qualidade.samples > 0
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

export function measures(points) {
  let perimeter = 0;
  let area = 0;
  const closed = points.length >= 3;
  const edges = closed ? points.length : Math.max(0, points.length - 1);
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const deltaLng = rad(shortAngle(b.lng - a.lng));
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(deltaLng / 2) ** 2;
    perimeter += 2 * earthRadius * Math.asin(Math.sqrt(Math.min(1, h)));
    area += deltaLng * (Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
  }
  return { area: closed ? Math.abs(area) * earthRadius ** 2 / 2 : null, perimeter, closed };
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
