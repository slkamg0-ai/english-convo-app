const AdminUI = (() => {
  const el = (id) => document.getElementById(id);

  function option(status, claim) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = status;
    button.addEventListener("click", () => updateClaim(claim.id, status));
    return button;
  }

  function renderInvites(invites) {
    el("invite-list").replaceChildren(...invites.map((invite) => {
      const row = document.createElement("p");
      row.className = "admin-row";
      row.textContent = `${invite.code || invite.id} · ${invite.uses}/${invite.maxUses}`;
      return row;
    }));
  }

  function claimSummary(claim) {
    const body = document.createElement("div");
    const learner = document.createElement("strong");
    const reward = document.createElement("p");
    learner.textContent = claim.displayName || claim.userEmail || "학습자";
    reward.textContent = `${claim.rewardLabel || claim.rewardRuleId || "리워드"} · ${claim.status}`;
    body.append(learner, reward);
    return body;
  }

  function renderClaims(claims) {
    el("admin-claim-list").replaceChildren(...claims.map((claim) => {
      const row = document.createElement("div");
      row.className = "admin-claim-row";
      row.append(claimSummary(claim), option("approved", claim), option("delivered", claim), option("rejected", claim));
      return row;
    }));
  }

  async function refresh() {
    if (AuthUI.user()?.role !== "admin") return;
    try {
      renderInvites((await CloudClient.invites()).invites || []);
      renderClaims((await CloudClient.adminClaims()).claims || []);
      el("admin-status").textContent = "관리자 자료를 불러왔습니다.";
    } catch (error) {
      el("admin-status").textContent = error.message;
    }
  }

  async function updateClaim(id, status) {
    await CloudClient.updateClaim(id, { status });
    await refresh();
  }

  function bind() {
    el("invite-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const maxUses = Number(new FormData(event.currentTarget).get("maxUses") || 1);
      try {
        const result = await CloudClient.createInvite({ maxUses });
        el("new-invite-code").textContent = `새 초대코드: ${result.code}`;
        event.currentTarget.reset();
        await refresh();
      } catch (error) {
        el("admin-status").textContent = error.message;
      }
    });
  }

  return { init: () => { bind(); AuthUI.onChange(refresh); refresh(); }, refresh };
})();
window.AdminUI = AdminUI;
