(() => {
  const model = {
    signedIn: false,
    email: "",
    pro: false,
    mode: "signIn",
    pending: "",
  };
  const byId = (id) => document.getElementById(id);
  const native = () => typeof window.Android?.getAccountState === "function";
  const appSections = ["appToolbar", "mainTabs", "mainPage", "memorialPage", "satPage", "settingsModal"];
  let accountTrigger;
  let planTrigger;

  function setStatus(id, message = "", tone = "") {
    const element = byId(id);
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function syncOverlays() {
    const gateOpen = !byId("authGate").hidden;
    const accountOpen = !byId("accountModal").hidden;
    const plansOpen = !byId("planModal").hidden;
    document.body.classList.toggle("account-overlay-open", gateOpen || accountOpen || plansOpen);
    appSections.forEach((id) => {
      const section = byId(id);
      if (section) section.inert = gateOpen || accountOpen || plansOpen;
    });
    byId("accountModal").inert = plansOpen;
  }

  function renderGate(email = "") {
    const creating = model.mode === "signUp";
    const resetting = model.mode === "reset";
    const confirming = model.mode === "confirm";
    byId("authTitle").textContent = creating ? "Crie sua conta"
      : resetting ? "Defina uma nova senha"
      : confirming ? "Confira seu e-mail"
      : "Entre na sua conta";
    byId("authIntro").textContent = creating ? "Comece a usar o Landmensure com o plano gratuito."
      : resetting ? ""
      : confirming ? "Abra o link de confirmação e volte ao app para entrar."
      : "Acesse suas ferramentas de levantamento.";

    const switchMode = confirming || resetting
      ? '<button class="auth-secondary" type="button" data-auth-mode="signIn">Voltar para entrar</button>'
      : `<p class="auth-switch">${creating ? "Já tem conta?" : "Primeira vez aqui?"}
          <button class="auth-secondary" type="button" data-auth-mode="${creating ? "signIn" : "signUp"}">
            ${creating ? "Entrar" : "Criar conta"}
          </button>
        </p>`;
    byId("authGateContent").innerHTML = confirming ? switchMode : `
      <form id="authForm" class="auth-gate-form">
        ${resetting ? "" : `
          <div class="auth-control">
            <label for="gateEmail">E-mail</label>
            <div class="auth-field">
              <input id="gateEmail" name="email" type="email" autocomplete="username"
                inputmode="email" autocapitalize="none" spellcheck="false" required>
            </div>
          </div>`}
        <div class="auth-control">
          <label for="gatePassword">Senha</label>
          <div class="auth-field">
            <input id="gatePassword" name="password" type="password"
              autocomplete="${creating || resetting ? "new-password" : "current-password"}"
              ${creating || resetting ? 'aria-describedby="authPasswordHint"' : ""} required>
            <button id="authPasswordToggle" class="auth-password-toggle" type="button"
              aria-controls="gatePassword" aria-label="Mostrar senha">Mostrar</button>
          </div>
          ${creating || resetting ? '<p class="auth-hint" id="authPasswordHint">Use pelo menos 10 caracteres, com maiúscula, minúscula e número.</p>' : ""}
        </div>
        <button class="auth-main navy" type="submit">
          ${creating ? "Criar conta" : resetting ? "Salvar nova senha" : "Entrar"}
        </button>
      </form>
      ${switchMode}`;

    const emailInput = byId("gateEmail");
    if (emailInput) emailInput.value = email;
    byId("authGateContent").querySelector("[data-auth-mode]")?.addEventListener("click", (event) => {
      const enteredEmail = byId("gateEmail")?.value || email;
      model.mode = event.currentTarget.dataset.authMode;
      renderGate(enteredEmail);
      byId("authTitle").focus();
    });
    byId("authPasswordToggle")?.addEventListener("click", (event) => {
      const password = byId("gatePassword");
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "Ocultar" : "Mostrar";
      event.currentTarget.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
    });
    byId("authForm")?.addEventListener("submit", submitCredentials);
    byId("authForm")?.addEventListener("input", (event) => {
      event.target.removeAttribute("aria-invalid");
      event.target.removeAttribute("aria-errormessage");
      if (byId("authGateStatus").dataset.tone === "error") setStatus("authGateStatus");
    });
    setStatus("authGateStatus", native() ? "" : "Para entrar ou criar uma conta, abra o Landmensure instalado no Android.");
    syncControls();
  }

  function syncControls() {
    const authBusy = model.pending === "auth";
    byId("authForm")?.setAttribute("aria-busy", String(authBusy));
    byId("authGateContent").querySelectorAll("input, button").forEach((control) => {
      control.disabled = authBusy || (!native() && control.type === "submit");
    });
    byId("accountLogout").disabled = model.pending === "logout";
    byId("planPeriods").disabled = model.pending === "checkout";
    byId("planSubmit").disabled = model.pending === "checkout";
  }

  function submitCredentials(event) {
    event.preventDefault();
    if (!native() || model.pending) return;
    const email = byId("gateEmail")?.value.trim() || "";
    const password = byId("gatePassword").value;
    model.pending = "auth";
    syncControls();
    if (model.mode === "signUp") {
      setStatus("authGateStatus", "Criando sua conta…");
      window.Android.signUp(email, password);
    } else if (model.mode === "reset") {
      setStatus("authGateStatus", "Salvando sua senha…");
      window.Android.updatePassword(password);
    } else {
      setStatus("authGateStatus", "Entrando…");
      window.Android.signIn(email, password);
    }
  }

  function renderAccount() {
    byId("accountEmail").textContent = model.email || "Conta Landmensure";
    byId("accountPlan").textContent = model.pro ? "Landmensure Pro ativo" : "Plano gratuito";
    byId("accountPlans").textContent = model.pro ? "Ver assinatura" : "Conhecer o Pro";
    byId("planOptions").hidden = model.pro;
    byId("planActive").hidden = !model.pro;
  }

  function openGate({ refreshState = true } = {}) {
    byId("accountModal").hidden = true;
    byId("planModal").hidden = true;
    byId("authGate").hidden = false;
    syncOverlays();
    if (refreshState && native()) window.Android.getAccountState();
  }

  function openAccount() {
    if (!model.signedIn) return openGate();
    accountTrigger = document.activeElement;
    setStatus("accountStatus");
    byId("accountModal").hidden = false;
    syncOverlays();
    byId("accountTitle").focus();
  }

  function closeAccount() {
    byId("accountModal").hidden = true;
    syncOverlays();
    accountTrigger?.focus();
  }

  function openPlans() {
    if (!model.signedIn) return openGate();
    planTrigger = document.activeElement;
    byId("planModal").hidden = false;
    syncOverlays();
    byId("planTitle").focus();
  }

  function closePlans() {
    byId("planModal").hidden = true;
    syncOverlays();
    planTrigger?.focus();
  }

  function subscribe(event) {
    event.preventDefault();
    if (!native() || !model.signedIn || model.pro || model.pending) return;
    const plan = new FormData(event.currentTarget).get("plan");
    if (!["weekly", "monthly", "yearly"].includes(plan)) return;
    model.pending = "checkout";
    syncControls();
    setStatus("planStatus", "Abrindo o pagamento…");
    window.Android.subscribe(plan);
  }

  function signOut() {
    if (!native() || model.pending) return;
    model.pending = "logout";
    syncControls();
    setStatus("accountStatus", "Saindo da conta…");
    window.Android.signOut();
  }

  function applyProRestrictions() {
    const captureMode = byId("tempoColeta");
    document.querySelectorAll('option[value="121"]').forEach((option) => {
      option.disabled = !model.pro;
      option.textContent = model.pro ? "Ponto ajustado • 120 s" : "Ponto ajustado • 120 s (Pro)";
    });
    if (!model.pro && captureMode?.value === "121") captureMode.value = "120";
    document.querySelectorAll(".settings-choice").forEach((choice) => {
      if (!choice.textContent.includes("Ponto ajustado")) return;
      choice.disabled = !model.pro;
      choice.setAttribute("aria-disabled", String(!model.pro));
      choice.title = model.pro ? "" : "Disponível no plano Pro";
    });
  }

  function announceAccountState() {
    const detail = { signedIn: model.signedIn, pro: model.pro };
    window.dispatchEvent(new CustomEvent("landmensure:account-state", { detail }));
  }

  function receiveState(event) {
    if (model.pending === "auth" || model.pending === "logout") return;
    model.signedIn = Boolean(event.signedIn);
    if (model.signedIn) model.email = event.email || "";
    model.pro = model.signedIn && Boolean(event.pro);
    document.documentElement.dataset.plan = model.pro ? "pro" : "free";
    applyProRestrictions();
    renderAccount();
    window.dispatchEvent(new CustomEvent("landmensure:entitlement", { detail: { pro: model.pro } }));
    announceAccountState();
    if (!model.signedIn) openGate({ refreshState: false });
    else if (model.mode !== "reset") {
      byId("authGate").hidden = true;
      syncOverlays();
    }
  }

  window.landmensureAccount = { openGate, openPlans, closePlans, openAccount, closeAccount };

  window.receiveAccountEvent = (event) => {
    if (!byId("authGate")) return;
    if (event.type === "state") {
      receiveState(event);
      return;
    }
    const pending = model.pending;
    if (event.type !== "payment_returned") model.pending = "";
    syncControls();
    switch (event.type) {
      case "signed_in":
        model.signedIn = true;
        model.email = event.email || "";
        model.mode = "signIn";
        renderGate();
        renderAccount();
        byId("authGate").hidden = true;
        syncOverlays();
        announceAccountState();
        break;
      case "signed_out":
        model.mode = "signIn";
        model.email = "";
        receiveState({ signedIn: false });
        renderGate();
        setStatus("planStatus");
        setStatus("authGateStatus", "Você saiu da sua conta.");
        byId("authTitle").focus();
        break;
      case "confirmation_sent":
        model.mode = "confirm";
        renderGate(byId("gateEmail")?.value);
        byId("authTitle").focus();
        break;
      case "recovery_ready":
        model.mode = "reset";
        openGate({ refreshState: false });
        renderGate();
        byId("authTitle").focus();
        break;
      case "password_updated":
        model.mode = "signIn";
        renderGate(model.email);
        setStatus("authGateStatus", "Sua senha foi atualizada.");
        if (native()) window.Android.getAccountState();
        break;
      case "checkout_opened":
      case "payment_returned":
        setStatus("planStatus", event.message);
        break;
      case "checkout_error":
        setStatus("planStatus", event.message, "error");
        break;
      case "error": {
        const status = pending === "checkout" ? "planStatus"
          : pending === "logout" ? "accountStatus" : "authGateStatus";
        setStatus(status, event.message, "error");
        const field = event.field === "email" ? byId("gateEmail")
          : event.field === "password" ? byId("gatePassword") : null;
        field?.setAttribute("aria-invalid", "true");
        field?.setAttribute("aria-errormessage", "authGateStatus");
        field?.focus();
        break;
      }
      default:
        setStatus("authGateStatus", event.message);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML("beforeend", `
      <section id="authGate" class="auth-gate" role="dialog" aria-modal="true"
        aria-labelledby="authTitle" aria-describedby="authIntro">
        <div class="auth-gate-card">
          <div class="auth-brand"><img src="logo_landmensure_mark.png" alt=""><strong>Landmensure</strong></div>
          <h1 class="auth-title" id="authTitle" tabindex="-1"></h1>
          <p class="auth-description" id="authIntro"></p>
          <div id="authGateContent"></div>
          <p id="authGateStatus" class="account-feedback" role="status"></p>
        </div>
      </section>
      <div id="accountModal" class="account-overlay" hidden>
        <section class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
          <header class="account-head">
            <h2 id="accountTitle" tabindex="-1">Sua conta</h2>
            <button class="account-close" id="accountClose" type="button" aria-label="Fechar conta">×</button>
          </header>
          <section class="account-summary">
            <strong id="accountEmail"></strong>
            <span id="accountPlan"></span>
          </section>
          <button class="auth-main navy account-plan-action" id="accountPlans" type="button">Conhecer o Pro</button>
          <button class="auth-secondary account-logout" id="accountLogout" type="button">Sair da conta</button>
          <p id="accountStatus" class="account-feedback" role="status"></p>
        </section>
      </div>
      <div id="planModal" class="account-overlay" hidden>
        <section class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="planTitle">
          <header class="account-head">
            <h2 id="planTitle" tabindex="-1">Landmensure Pro</h2>
            <button class="account-close" id="planClose" type="button" aria-label="Fechar planos">×</button>
          </header>
          <p id="planActive" class="account-summary" hidden>Seu plano Pro está ativo. Para gerenciar a assinatura, fale com o atendimento.</p>
          <form id="planOptions" class="plan-options">
            <p class="auth-description">Use o Ponto Ajustado de 120 s e exporte seus levantamentos em CSV, KML e memorial em PDF.</p>
            <fieldset id="planPeriods" class="plan-periods">
              <legend>Escolha o período</legend>
              <label><input type="radio" name="plan" value="weekly"> Semanal</label>
              <label><input type="radio" name="plan" value="monthly" checked> Mensal</label>
              <label><input type="radio" name="plan" value="yearly"> Anual</label>
            </fieldset>
            <button class="auth-main navy" id="planSubmit" type="submit">Continuar para o pagamento</button>
            <p class="auth-hint">O Stripe mostra o valor e a renovação antes de você confirmar.</p>
          </form>
          <p id="planStatus" class="account-feedback" role="status"></p>
        </section>
      </div>`);

    const toolbar = byId("appToolbar");
    const settings = toolbar?.querySelector(".toolbar-settings");
    if (toolbar && settings) {
      const actions = document.createElement("div");
      actions.className = "toolbar-actions";
      const account = document.createElement("button");
      account.className = "account-entry";
      account.type = "button";
      account.textContent = "Conta";
      account.addEventListener("click", openAccount);
      toolbar.insertBefore(actions, settings);
      actions.append(account, settings);
    }

    byId("accountClose").addEventListener("click", closeAccount);
    byId("accountPlans").addEventListener("click", openPlans);
    byId("accountLogout").addEventListener("click", signOut);
    byId("planClose").addEventListener("click", closePlans);
    byId("planOptions").addEventListener("submit", subscribe);
    byId("accountModal").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeAccount();
    });
    byId("planModal").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closePlans();
    });

    const originalCapture = window.capturar;
    if (typeof originalCapture === "function") {
      window.capturar = function guardedCapture() {
        if (byId("tempoColeta")?.value === "121" && !model.pro) {
          openPlans();
          setStatus("planStatus", "O Ponto Ajustado está disponível no Landmensure Pro.");
          return;
        }
        return originalCapture();
      };
    }

    window.landmensureCloseTopOverlay = () => {
      if (!byId("planModal").hidden) closePlans();
      else if (!byId("accountModal").hidden) closeAccount();
      else if (!byId("settingsModal")?.hidden && typeof window.fecharDefinicoes === "function") window.fecharDefinicoes();
      else return false;
      return true;
    };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && window.landmensureCloseTopOverlay()) event.preventDefault();
    });
    renderGate();
    renderAccount();
    applyProRestrictions();
    openGate();
  });
})();
