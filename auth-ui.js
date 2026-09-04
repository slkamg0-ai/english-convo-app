const AuthUI = (() => {
  let state = { user: null };
  const listeners = new Set();
  const el = (id) => document.getElementById(id);
  const notify = () => listeners.forEach((listener) => listener(state));

  function setStatus(message, error = false) {
    el("account-status").textContent = message;
    el("account-status").classList.toggle("status-error", error);
  }

  function render() {
    const signedIn = Boolean(state.user);
    el("account-user").textContent = signedIn ? `${state.user.displayName} · ${state.user.email}` : "로그인 전";
    el("account-role").textContent = signedIn ? state.user.role : "local";
    el("account-forms").classList.toggle("hidden", signedIn);
    el("account-signed-in").classList.toggle("hidden", !signedIn);
    el("admin-panel").classList.toggle("hidden", state.user?.role !== "admin");
  }

  async function refresh() {
    if (!CloudClient.hasToken()) {
      state = { user: null };
      render();
      notify();
      return;
    }
    try {
      const session = await CloudClient.session();
      state = { user: session.user };
      setStatus("계정이 연결되었습니다.");
    } catch {
      state = { user: null };
      setStatus("세션이 만료되었습니다. 다시 로그인해 주세요.", true);
    }
    render();
    notify();
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function bind() {
    el("signup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const result = await CloudClient.signup(formData(form));
        state = { user: result.user };
        form.reset();
        setStatus("초대 가입이 완료되었습니다.");
      } catch (error) { setStatus(error.message, true); }
      render();
      notify();
    });
    el("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const result = await CloudClient.login(formData(form));
        state = { user: result.user };
        form.reset();
        setStatus("로그인되었습니다.");
      } catch (error) { setStatus(error.message, true); }
      render();
      notify();
    });
    el("logout-btn").addEventListener("click", async () => {
      await CloudClient.logout();
      state = { user: null };
      setStatus("로그아웃되었습니다.");
      render();
      notify();
    });
  }

  return { init: () => { bind(); render(); refresh(); }, onChange: (listener) => listeners.add(listener), user: () => state.user, refresh };
})();
window.AuthUI = AuthUI;
