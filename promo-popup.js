const PromoPopup = (() => {
  const STORAGE_KEY = "englishConvoApp.promoLastShown";
  const el = (id) => document.getElementById(id);

  function todayKey(userId) {
    return `${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  function alreadyShownToday(userId) {
    try {
      return localStorage.getItem(STORAGE_KEY) === todayKey(userId);
    } catch {
      return false;
    }
  }

  function markShownToday(userId) {
    try {
      localStorage.setItem(STORAGE_KEY, todayKey(userId));
    } catch {
      /* private browsing or storage disabled: popup may reshow, harmless */
    }
  }

  function open() {
    el("promo-popup").classList.remove("hidden");
  }

  function close() {
    el("promo-popup").classList.add("hidden");
  }

  function homeTabActive() {
    return document.getElementById("home")?.classList.contains("active") ?? false;
  }

  function maybeShow() {
    const user = window.AuthUI?.user();
    if (!user || !homeTabActive() || alreadyShownToday(user.id)) return;
    markShownToday(user.id);
    open();
  }

  function bind() {
    el("promo-popup-close").addEventListener("click", close);
    el("promo-popup-backdrop").addEventListener("click", close);
    el("promo-popup-cta").addEventListener("click", () => {
      close();
      window.showTab?.("progress");
    });
    window.AuthUI?.onChange(maybeShow);
  }

  return { init: () => bind(), maybeShow };
})();
window.PromoPopup = PromoPopup;
