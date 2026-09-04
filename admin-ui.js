const AdminUI = (() => {
  const el = (id) => document.getElementById(id);
  // The server returns a newly created invite's plain code exactly once; it is never
  // included in later GET /api/admin/invites responses. Remember codes created this
  // session so the table can still show them after a refresh, without ever falling
  // back to invite.id (a UUID an admin could mistake for a real, shareable code).
  const knownCodes = new Map();

  function option(status, claim) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = status;
    button.addEventListener("click", () => updateClaim(claim.id, status));
    return button;
  }

  function cell(text) {
    const item = document.createElement("span");
    item.textContent = text;
    return item;
  }

  function table(className, headers, rows) {
    const wrap = document.createElement("div");
    const head = document.createElement("div");
    wrap.className = className;
    head.className = "admin-table-head";
    head.replaceChildren(...headers.map(cell));
    wrap.appendChild(head);
    rows.forEach((row) => wrap.appendChild(row));
    return wrap;
  }

  function renderInvites(invites) {
    const rows = invites.map((invite) => {
      const row = document.createElement("div");
      row.className = "admin-table-row";
      const code = invite.code || knownCodes.get(invite.id) || "비공개 (재발급 필요)";
      row.replaceChildren(cell(code), cell(`${invite.uses}/${invite.maxUses}`), cell(invite.expiresAt || "무기한"));
      return row;
    });
    el("invite-list").replaceChildren(table("admin-table", ["초대", "사용", "만료"], rows));
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
    const rows = claims.map((claim) => {
      const row = document.createElement("div");
      row.className = "admin-table-row admin-claim-row";
      row.append(claimSummary(claim), option("approved", claim), option("delivered", claim), option("rejected", claim));
      return row;
    });
    el("admin-claim-list").replaceChildren(table("admin-table admin-claims-table", ["학습자", "승인", "전달", "반려"], rows));
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
      const form = event.currentTarget;
      const maxUses = Number(new FormData(form).get("maxUses") || 1);
      try {
        const result = await CloudClient.createInvite({ maxUses });
        if (result.invite?.id) knownCodes.set(result.invite.id, result.code);
        el("new-invite-code").textContent = `새 초대코드: ${result.code}`;
        el("new-invite-row").classList.remove("hidden");
        form.reset();
        await refresh();
      } catch (error) {
        el("admin-status").textContent = error.message;
      }
    });

    el("new-invite-copy").addEventListener("click", async () => {
      const [, code] = el("new-invite-code").textContent.split(": ");
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        el("admin-status").textContent = "코드를 복사했습니다.";
      } catch {
        el("admin-status").textContent = "복사에 실패했습니다. 직접 선택해 복사해 주세요.";
      }
    });
  }

  return { init: () => { bind(); AuthUI.onChange(refresh); refresh(); }, refresh };
})();
window.AdminUI = AdminUI;
