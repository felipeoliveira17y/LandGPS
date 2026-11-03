(() => {
  const model = { signedIn: false, email: '', recovery: false, lastMessage: '' };
  const native = () => window.Android && typeof window.Android.getAccountState === 'function';
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);

  function setStatus(message, tone = '') {
    const status = document.getElementById('accountStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function render() {
    const content = document.getElementById('accountContent');
    if (!content) return;
    if (model.recovery) {
      content.innerHTML = `<form class="account-form" onsubmit="return window.landmensureAccount.savePassword(event)"><label>Nova senha<input id="accountNewPassword" type="password" minlength="8" required autocomplete="new-password"></label><div class="account-buttons"><button class="navy" type="submit">Salvar senha</button><button class="gray" type="button" onclick="window.landmensureAccount.cancelRecovery()">Cancelar</button></div></form>`;
      return;
    }
    if (model.signedIn) {
      content.innerHTML = `<div class="account-status" data-tone="ok">Conectado como <strong>${escapeHtml(model.email || 'usuário')}</strong>.</div><section class="account-pro"><h3>Landmensure Pro</h3><p>Escolha o período desejado. O pagamento abre em uma página segura do Stripe.</p><div class="account-plans"><button class="account-plan" type="button" onclick="window.landmensureAccount.subscribe('weekly')">Semanal<span>Acesso Pro por 7 dias</span></button><button class="account-plan" type="button" onclick="window.landmensureAccount.subscribe('monthly')">Mensal<span>Renovação mensal</span></button><button class="account-plan" type="button" onclick="window.landmensureAccount.subscribe('yearly')">Anual<span>Melhor custo por período</span></button></div></section><button class="account-logout" type="button" onclick="window.landmensureAccount.signOut()">Sair da conta</button>`;
      return;
    }
    content.innerHTML = `<form class="account-form" onsubmit="return window.landmensureAccount.signIn(event)"><label>E-mail<input id="accountEmail" type="email" required autocomplete="email" placeholder="voce@exemplo.com"></label><label>Senha<input id="accountPassword" type="password" minlength="8" required autocomplete="current-password" placeholder="Mínimo de 8 caracteres"></label><div class="account-buttons"><button class="navy" type="submit">Entrar</button><button class="gray" type="button" onclick="window.landmensureAccount.signUp()">Criar conta</button></div><button class="account-link" type="button" onclick="window.landmensureAccount.recover()">Esqueci minha senha</button></form>`;
  }

  function credentials() {
    return { email: document.getElementById('accountEmail')?.value.trim() || '', password: document.getElementById('accountPassword')?.value || '' };
  }

  function open() {
    document.getElementById('accountModal').hidden = false;
    document.body.style.overflow = 'hidden';
    render();
    if (native()) window.Android.getAccountState();
    else setStatus('A conta funciona somente no aplicativo Android instalado.', 'error');
  }
  function close() { document.getElementById('accountModal').hidden = true; document.body.style.overflow = ''; }

  window.landmensureAccount = {
    open, close,
    signIn(event) { event.preventDefault(); const { email, password } = credentials(); setStatus('Entrando…'); if (native()) window.Android.signIn(email, password); return false; },
    signUp() { const { email, password } = credentials(); setStatus('Criando conta…'); if (native()) window.Android.signUp(email, password); },
    recover() { const { email } = credentials(); setStatus('Enviando instruções…'); if (native()) window.Android.requestPasswordRecovery(email); },
    savePassword(event) { event.preventDefault(); setStatus('Salvando nova senha…'); if (native()) window.Android.updatePassword(document.getElementById('accountNewPassword').value); return false; },
    cancelRecovery() { model.recovery = false; render(); },
    signOut() { if (native()) window.Android.signOut(); },
    subscribe(plan) { setStatus('Abrindo o pagamento seguro…'); if (native()) window.Android.subscribe(plan); },
  };

  window.receiveAccountEvent = (event) => {
    model.lastMessage = event.message || '';
    if (event.type === 'signed_in') { model.signedIn = true; model.email = event.email || ''; model.recovery = false; render(); }
    if (event.type === 'signed_out') { model.signedIn = false; model.email = ''; model.recovery = false; render(); }
    if (event.type === 'state') { model.signedIn = Boolean(event.signedIn); model.email = event.email || ''; render(); }
    if (event.type === 'recovery_ready') { model.recovery = true; render(); }
    const tone = event.type === 'error' ? 'error' : ['signed_in','signed_out','confirmation_sent','recovery_sent','password_updated','checkout_opened'].includes(event.type) ? 'ok' : '';
    setStatus(event.message || '', tone);
  };

  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.getElementById('appToolbar');
    const settings = toolbar?.querySelector('.toolbar-settings');
    if (toolbar && settings) {
      const actions = document.createElement('div');
      actions.className = 'toolbar-actions';
      const account = document.createElement('button');
      account.className = 'account-entry'; account.type = 'button'; account.textContent = 'Conta'; account.onclick = open;
      toolbar.insertBefore(actions, settings); actions.append(account, settings);
    }
    document.body.insertAdjacentHTML('beforeend', `<div id="accountModal" class="account-overlay" hidden onclick="if(event.target===this)window.landmensureAccount.close()"><section class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><div class="account-grip"></div><header class="account-head"><div><p class="account-kicker">LANDMENSURE</p><h2 class="account-title" id="accountTitle">Conta e plano</h2></div><button class="account-close" type="button" aria-label="Fechar" onclick="window.landmensureAccount.close()">×</button></header><p class="account-copy">Entre para assinar o Landmensure Pro e acompanhar o acesso da sua conta.</p><p id="accountStatus" class="account-status">Informe seus dados para continuar.</p><div id="accountContent"></div></section></div>`);
    render();
  });
})();
