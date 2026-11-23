Deno.serve((request) => {
  const success = new URL(request.url).searchParams.get("payment") === "success";
  const title = success ? "Retorno do pagamento" : "Pagamento cancelado";
  const message = success
    ? "Recebemos o retorno do pagamento. Volte ao Landmensure; seu plano será confirmado pelo servidor."
    : "Pagamento cancelado. Você pode voltar ao Landmensure.";

  return new Response(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Landmensure</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #F6F5F0;
      --surface: #FFFFFF;
      --ink: #13201A;
      --muted: #4E5F56;
      --line: #CFD6CE;
      --accent: #14533C;
      --shadow: 0 4px 16px rgba(19, 32, 26, 0.07);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0F1714;
        --surface: #16221D;
        --ink: #EDF3EF;
        --muted: #9BB0A4;
        --line: #2C3F36;
        --accent: #4ADE80;
        --shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      }
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      padding: 24px;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--ink);
      font: 1rem/1.55 system-ui, sans-serif;
    }
    main {
      width: min(100%, 30rem);
      padding: clamp(20px, 6vw, 36px);
      background: var(--surface);
      border: 1px solid var(--line);
      border-top: 4px solid var(--accent);
      border-radius: 16px;
      box-shadow: var(--shadow);
    }
    .brand { margin: 0 0 12px; color: var(--accent); font-weight: 700; }
    h1 { margin: 0; font-size: clamp(1.4rem, 5vw, 1.85rem); line-height: 1.2; }
    p:last-child { margin-bottom: 0; color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <p class="brand">Landmensure</p>
    <h1>${title}</h1>
    <p>${message}</p>
    <p>Você pode fechar esta página e retornar ao aplicativo.</p>
  </main>
</body>
</html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
