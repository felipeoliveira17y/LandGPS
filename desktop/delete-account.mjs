const form = document.getElementById("account-deletion");
const status = document.getElementById("deletion-status");
const submit = form.querySelector("button");
const setStatus = (message, error = false) => {
  status.dataset.tone = error ? "error" : "";
  status.textContent = message;
};

async function request(url, key, body, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

try {
  const response = await fetch("/config.json", { cache: "no-store" });
  const { project, key } = await response.json();
  if (!response.ok || !key || !project) throw new Error("Missing public configuration");
  submit.disabled = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const { email, password, confirmation } = Object.fromEntries(new FormData(form));
    if (confirmation !== "EXCLUIR") return;
    submit.disabled = true;
    form.elements.password.value = "";
    setStatus("Validando sua conta…");
    try {
      const login = await request(`${project}/auth/v1/token?grant_type=password`, key, { email, password });
      if (!login.ok || !login.data?.access_token) {
        setStatus("Não foi possível entrar. Confira o e-mail e a senha.", true);
        return;
      }
      setStatus("Excluindo sua conta e encerrando a assinatura…");
      const deletion = await request(`${project}/functions/v1/delete-account`, key,
        { confirmation }, login.data.access_token);
      if (!deletion.ok || deletion.data?.deleted !== true) {
        setStatus(deletion.data?.error || "A exclusão não foi concluída. Tente novamente.", true);
        return;
      }
      form.reset();
      form.hidden = true;
      setStatus("Sua conta foi excluída.");
    } catch {
      setStatus("Não foi possível confirmar a exclusão. Confira a conexão e tente novamente.", true);
    } finally {
      if (!form.hidden) submit.disabled = false;
    }
  });
} catch {
  setStatus("A exclusão pela web está indisponível. Use a opção de exclusão no aplicativo ou fale com o atendimento.", true);
}
