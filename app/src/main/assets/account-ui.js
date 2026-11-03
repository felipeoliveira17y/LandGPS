(() => {
  const model = {
    signedIn: false,
    email: "",
    recovery: false,
    pro: false,
    busy: false,
  };
  const native = () =>
    window.Android && typeof window.Android.getAccountState === "function";
  const escapeHtml = (value) =>
    String(value || "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );

  function setText(id, message, tone = "") {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function credentials(prefix = "gate") {
    return {
      email: document.getElementById(`${prefix}Email`)?.value.trim() || "",
      password: document.getElementById(`${prefix}Password`)?.value || "",
    };
  }

  function renderGate() {
    const content = document.getElementById("authGateContent");
    if (!content) return;
    if (model.recovery) {
      content.innerHTML = `<form class="auth-gate-form" onsubmit="return window.landmensureAccount.savePassword(event)"><label class="auth-field"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="gateNewPassword" type="password" minlength="8" required autocomplete="new-password" placeholder="Nova senha (mínimo 8 caracteres)"></label><button class="auth-main navy" type="submit">Salvar nova senha</button><button class="auth-secondary" type="button" onclick="window.landmensureAccount.cancelRecovery()">Voltar para o login</button></form>`;
      return;
    }
    content.innerHTML = `<form class="auth-gate-form" onsubmit="return window.landmensureAccount.signIn(event)"><label class="auth-field"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m4 7 8 6 8-6"/></svg><input id="gateEmail" type="email" required autocomplete="email" placeholder="Seu e-mail"></label><label class="auth-field"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="gatePassword" type="password" minlength="8" required autocomplete="current-password" placeholder="Sua senha"></label><button class="auth-main navy" type="submit">Entrar no Landmensure</button><button class="auth-secondary" type="button" onclick="window.landmensureAccount.signUp()">Criar minha conta</button><button class="auth-recovery" type="button" onclick="window.landmensureAccount.recover()">Esqueci minha senha</button></form>`;
  }

  function renderAccount() {
    const content = document.getElementById("accountContent");
    if (!content) return;
    if (!model.signedIn) {
      content.innerHTML = `<p class="account-status">A conta é necessária para usar as funções de levantamento.</p><button class="account-plan-action navy" type="button" onclick="window.landmensureAccount.openGate()">Entrar ou criar conta</button>`;
      return;
    }
    const plan = model.pro ? "Landmensure Pro ativo" : "Plano gratuito ativo";
    const action = model.pro
      ? "Gerenciar assinatura"
      : "Ver planos Landmensure Pro";
    content.innerHTML = `<section class="account-summary"><strong>${escapeHtml(model.email || "Conta Landmensure")}</strong><span>${plan} neste aparelho.</span></section><button class="account-plan-action navy" type="button" onclick="window.landmensureAccount.openPlans()">${action}</button><button class="account-logout" type="button" onclick="window.landmensureAccount.signOut()">Sair da conta</button>`;
  }

  function openGate(requestState = true) {
    document.getElementById("accountModal").hidden = true;
    document.getElementById("authGate").hidden = false;
    document.body.style.overflow = "hidden";
    renderGate();
    if (requestState && native()) window.Android.getAccountState();
    else
      setText(
        "authGateStatus",
        "O acesso por conta funciona no aplicativo Android instalado.",
        "error",
      );
  }

  function closeGate() {
    if (!model.signedIn) return;
    document.getElementById("authGate").hidden = true;
    document.body.style.overflow = "";
  }

  function openAccount() {
    if (!model.signedIn) return openGate();
    document.getElementById("accountModal").hidden = false;
    document.body.style.overflow = "hidden";
    renderAccount();
  }

  function closeAccount() {
    document.getElementById("accountModal").hidden = true;
    document.body.style.overflow = "";
  }

  function openPlans() {
    document.getElementById("planModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePlans() {
    document.getElementById("planModal").hidden = true;
    document.body.style.overflow = "";
  }

  function startRequest(statusId, message) {
    if (model.busy) return false;
    model.busy = true;
    setText(statusId, message);
    document
      .querySelectorAll(
        ".auth-main,.auth-secondary,.auth-recovery,.plan-choose",
      )
      .forEach((button) => {
        button.disabled = true;
      });
    return true;
  }

  function finishRequest() {
    model.busy = false;
    document
      .querySelectorAll(
        ".auth-main,.auth-secondary,.auth-recovery,.plan-choose",
      )
      .forEach((button) => {
        button.disabled = false;
      });
  }

  function applyProRestrictions() {
    const captureMode = document.getElementById("tempoColeta");
    document
      .querySelectorAll('option[value="121"]')
      .forEach((adjustedOption) => {
        adjustedOption.disabled = !model.pro;
        adjustedOption.textContent = model.pro
          ? "Ponto ajustado • 120 s"
          : "Ponto ajustado • 120 s (Pro)";
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
    window.dispatchEvent(
      new CustomEvent("landmensure:account-state", {
        detail: { signedIn: model.signedIn, pro: model.pro },
      }),
    );
  }

  window.landmensureAccount = {
    openGate,
    openPlans,
    closePlans,
    openAccount,
    closeAccount,
    signIn(event) {
      event.preventDefault();
      const { email, password } = credentials();
      if (!startRequest("authGateStatus", "Entrando na sua conta…"))
        return false;
      if (native()) window.Android.signIn(email, password);
      return false;
    },
    signUp() {
      const form = document.querySelector("#authGateContent form");
      if (!form?.reportValidity()) return;
      const { email, password } = credentials();
      if (!startRequest("authGateStatus", "Criando a sua conta…")) return;
      if (native()) window.Android.signUp(email, password);
    },
    recover() {
      const { email } = credentials();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        setText(
          "authGateStatus",
          "Informe um e-mail válido para recuperar a senha.",
          "error",
        );
        return;
      }
      if (!startRequest("authGateStatus", "Enviando as instruções…")) return;
      if (native()) window.Android.requestPasswordRecovery(email);
    },
    savePassword(event) {
      event.preventDefault();
      const password = document.getElementById("gateNewPassword")?.value || "";
      setText("authGateStatus", "Salvando a nova senha…");
      if (native()) window.Android.updatePassword(password);
      return false;
    },
    cancelRecovery() {
      model.recovery = false;
      renderGate();
    },
    signOut() {
      if (native()) window.Android.signOut();
    },
    subscribe(plan) {
      if (!startRequest("planStatus", "Abrindo o pagamento seguro…")) return;
      if (native()) window.Android.subscribe(plan);
    },
  };

  window.receiveAccountEvent = (event) => {
    finishRequest();
    if (event.type === "state") {
      model.signedIn = Boolean(event.signedIn);
      model.email = event.email || "";
      model.pro = Boolean(event.pro);
      document.documentElement.dataset.plan = model.pro ? "pro" : "free";
      applyProRestrictions();
      window.dispatchEvent(
        new CustomEvent("landmensure:entitlement", {
          detail: { pro: model.pro },
        }),
      );
      announceAccountState();
      if (model.signedIn) closeGate();
      else openGate(false);
      renderAccount();
      return;
    }
    if (event.type === "signed_in") {
      model.signedIn = true;
      model.email = event.email || "";
      model.recovery = false;
      announceAccountState();
      closeGate();
      closePlans();
      renderAccount();
      setText("accountStatus", event.message, "ok");
      return;
    }
    if (event.type === "signed_out") {
      model.signedIn = false;
      model.email = "";
      model.recovery = false;
      announceAccountState();
      closeAccount();
      closePlans();
      openGate(false);
      setText("authGateStatus", event.message, "ok");
      return;
    }
    if (event.type === "recovery_ready") {
      model.recovery = true;
      openGate();
      renderGate();
      setText("authGateStatus", event.message, "ok");
      return;
    }
    const tone =
      event.type === "error"
        ? "error"
        : [
              "confirmation_sent",
              "recovery_sent",
              "password_updated",
              "checkout_opened",
              "payment_returned",
            ].includes(event.type)
          ? "ok"
          : "";
    setText(
      ["checkout_opened", "payment_returned"].includes(event.type)
        ? "planStatus"
        : "authGateStatus",
      event.message || "",
      tone,
    );
  };

  document.addEventListener("DOMContentLoaded", () => {
    const toolbar = document.getElementById("appToolbar");
    const settings = toolbar?.querySelector(".toolbar-settings");
    if (toolbar && settings) {
      const actions = document.createElement("div");
      actions.className = "toolbar-actions";
      const account = document.createElement("button");
      account.className = "account-entry";
      account.type = "button";
      account.textContent = "Conta";
      account.onclick = openAccount;
      toolbar.insertBefore(actions, settings);
      actions.append(account, settings);
    }
    document.body.insertAdjacentHTML(
      "beforeend",
      `<section id="authGate" class="auth-gate" aria-label="Acesso à conta"><div class="auth-gate-card"><div class="auth-brand"><img src="logo_landmensure_mark.png" alt=""><div><strong>Landmensure</strong><span>Levantamento de campo</span></div></div><h1 class="auth-title">Entre para continuar</h1><p class="auth-description">Crie uma conta para proteger seus dados e acessar as ferramentas de levantamento.</p><p id="authGateStatus" class="auth-gate-status">Informe seus dados para acessar o aplicativo.</p><div id="authGateContent"></div><p class="auth-note">Ao continuar, você poderá usar o plano gratuito ou escolher o Landmensure Pro.</p></div></section><div id="accountModal" class="account-overlay" hidden onclick="if(event.target===this)window.landmensureAccount.closeAccount()"><section class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><div class="account-grip"></div><header class="account-head"><div><p class="account-kicker">LANDMENSURE</p><h2 class="account-title" id="accountTitle">Conta</h2></div><button class="account-close" type="button" aria-label="Fechar" onclick="window.landmensureAccount.closeAccount()">×</button></header><p class="account-copy">Gerencie a conta e escolha um plano quando precisar dos recursos profissionais.</p><p id="accountStatus" class="account-status">Conta conectada.</p><div id="accountContent"></div></section></div><section id="planModal" class="plan-overlay" hidden onclick="if(event.target===this)window.landmensureAccount.closePlans()"><div class="plan-dialog" role="dialog" aria-modal="true" aria-labelledby="planTitle"><header class="plan-dialog-head"><div><p>LANDMENSURE PRO</p><h2 id="planTitle">Escolha o período do seu plano</h2></div><button class="plan-close" type="button" aria-label="Fechar" onclick="window.landmensureAccount.closePlans()">×</button></header><div class="plan-grid"><article class="plan-card"><p class="plan-label">FLEXÍVEL</p><h3>Semana</h3><p>Para uma demanda pontual ou um trabalho de campo específico.</p><div class="plan-list"><span>Ponto Ajustado de 120 s</span><span>Memorial e exportação profissional</span><span>Dados GNSS detalhados</span></div><button class="plan-choose" type="button" onclick="window.landmensureAccount.subscribe('weekly')">Assinar por semana</button></article><article class="plan-card featured"><p class="plan-label">MAIS ESCOLHIDO</p><h3>Mês</h3><p>Para profissionais com rotina de levantamentos durante o mês.</p><div class="plan-list"><span>Tudo do plano semanal</span><span>Projetos e coletas sem limite definido pelo plano</span><span>Acesso contínuo aos recursos Pro</span></div><button class="plan-choose" type="button" onclick="window.landmensureAccount.subscribe('monthly')">Assinar por mês</button></article><article class="plan-card"><p class="plan-label">MELHOR CUSTO</p><h3>Ano</h3><p>Para uso profissional contínuo e previsibilidade no trabalho.</p><div class="plan-list"><span>Tudo do plano mensal</span><span>Renovação anual</span><span>Uso Pro durante todo o período contratado</span></div><button class="plan-choose" type="button" onclick="window.landmensureAccount.subscribe('yearly')">Assinar por ano</button></article></div><p class="plan-footnote">O pagamento é concluído em uma página segura do Stripe. O valor final e a renovação aparecem antes da confirmação.</p><p id="planStatus" class="plan-status"></p></div></section>`,
    );
    renderGate();
    renderAccount();
    const originalCapture = window.capturar;
    if (typeof originalCapture === "function") {
      window.capturar = function guardedCapture() {
        if (
          document.getElementById("tempoColeta")?.value === "121" &&
          !model.pro
        ) {
          setText(
            "authGateStatus",
            "Ponto ajustado é um recurso do Landmensure Pro.",
            "error",
          );
          openPlans();
          return;
        }
        return originalCapture();
      };
    }
    window.landmensureCloseTopOverlay = () => {
      const plans = document.getElementById("planModal");
      if (plans && !plans.hidden) {
        closePlans();
        return true;
      }
      const account = document.getElementById("accountModal");
      if (account && !account.hidden) {
        closeAccount();
        return true;
      }
      const settingsModal = document.getElementById("settingsModal");
      if (
        settingsModal &&
        !settingsModal.hidden &&
        typeof window.fecharDefinicoes === "function"
      ) {
        window.fecharDefinicoes();
        return true;
      }
      return false;
    };
    applyProRestrictions();
    // A conta é a primeira tela do aplicativo. Se houver uma sessão salva, a
    // resposta nativa fecha esta tela logo em seguida; sem sessão, o login fica visível.
    openGate();
  });
})();
