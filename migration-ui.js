const MigrationUI = (() => {
  const el = (id) => document.getElementById(id);
  let dismissed = false;

  function shouldOffer(user) {
    return Boolean(user) && !dismissed && !user.localProgressImportedAt && hasLocalProgressToMigrate();
  }

  function render(user) {
    el("progress-import-card").classList.toggle("hidden", !shouldOffer(user));
  }

  function setBusy(busy) {
    el("progress-import-btn").disabled = busy;
    el("progress-import-skip").disabled = busy;
  }

  async function importNow() {
    setBusy(true);
    try {
      await CloudClient.importLocalProgress(getMigrationPayload());
      el("progress-import-status").textContent = "기존 학습 기록을 계정으로 가져왔습니다.";
      dismissed = true;
      await AuthUI.refresh();
      window.RewardsUI?.refresh();
    } catch (error) {
      el("progress-import-status").textContent = error.message;
    }
    setBusy(false);
    render(AuthUI.user());
  }

  function skip() {
    dismissed = true;
    el("progress-import-status").textContent = "";
    render(AuthUI.user());
  }

  function bind() {
    el("progress-import-btn").addEventListener("click", importNow);
    el("progress-import-skip").addEventListener("click", skip);
  }

  return {
    init: () => {
      bind();
      AuthUI.onChange((state) => {
        if (!state.user) dismissed = false;
        render(state.user);
      });
    },
  };
})();
window.MigrationUI = MigrationUI;
