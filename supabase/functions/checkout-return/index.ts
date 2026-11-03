const deepLink = (payment: string) =>
  `gpslandmensure://auth-callback?payment=${encodeURIComponent(payment)}`;

Deno.serve((request) => {
  const payment = new URL(request.url).searchParams.get("payment") ?? "complete";
  const url = deepLink(payment);
  const message = payment === "success"
    ? "Pagamento concluído. Volte ao Landmensure para atualizar o seu plano."
    : "Pagamento cancelado. Você pode voltar ao Landmensure.";

  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Landmensure</title></head><body><p>${message}</p><p><a href="${url}">Abrir Landmensure</a></p><script>location.replace(${JSON.stringify(url)})</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
