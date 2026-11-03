Deno.serve((request) => {
  const payment = new URL(request.url).searchParams.get("payment") ?? "complete";
  const message = payment === "success"
    ? "Recebemos o retorno do pagamento. Volte ao Landmensure; seu plano será confirmado pelo servidor."
    : "Pagamento cancelado. Você pode voltar ao Landmensure.";

  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Landmensure</title></head><body><p>${message}</p><p>Você pode fechar esta página e retornar ao aplicativo.</p></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
