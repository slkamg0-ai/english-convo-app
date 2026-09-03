const RewardsUI = (() => {
  const el = (id) => document.getElementById(id);
  let busy = false;

  function tag(rule) {
    if (rule.claimed) return "신청됨";
    if (rule.eligible) return "신청 가능";
    return `${rule.requiredXp} XP 필요`;
  }

  function render(data) {
    const summary = data?.summary || getProgressSummary();
    el("reward-xp").textContent = summary.xp;
    el("reward-streak").textContent = summary.currentStreak;
    el("reward-completed").textContent = summary.totalActivities;
    const rules = data?.rules || [];
    el("reward-list").replaceChildren(...rules.map((rule) => {
      const item = document.createElement("article");
      item.className = `reward-card${rule.eligible ? " reward-card-ready" : ""}`;
      item.innerHTML = `<div><strong>${rule.label}</strong><p>${rule.description}</p></div><span class="status-tag">${tag(rule)}</span>`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.textContent = "보상 신청";
      button.disabled = busy || !rule.eligible;
      button.addEventListener("click", () => claim(rule.id));
      item.append(button);
      return item;
    }));
    el("claim-list").replaceChildren(...(data?.claims || []).map((claim) => {
      const row = document.createElement("p");
      row.className = "claim-row";
      row.textContent = `${claim.rewardLabel || claim.rewardRuleId} · ${claim.status}`;
      return row;
    }));
  }

  async function refresh() {
    if (!AuthUI.user()) {
      render(null);
      el("reward-message").textContent = "로그인하면 보상 신청 현황이 동기화됩니다.";
      return;
    }
    try {
      const data = await CloudClient.rewards();
      render(data);
      el("reward-message").textContent = "계정 보상 현황을 불러왔습니다.";
    } catch (error) {
      el("reward-message").textContent = error.message;
    }
  }

  async function claim(ruleId) {
    busy = true;
    await refresh();
    try {
      await CloudClient.claimReward(ruleId);
      el("reward-message").textContent = "보상 신청이 접수되었습니다.";
    } catch (error) {
      el("reward-message").textContent = error.message;
    }
    busy = false;
    await refresh();
  }

  return { init: () => { AuthUI.onChange(refresh); refresh(); }, refresh };
})();
window.RewardsUI = RewardsUI;
