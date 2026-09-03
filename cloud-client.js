const CloudClient = (() => {
  const TOKEN_KEY = "englishConvoApp.cloudToken";
  let token = localStorage.getItem(TOKEN_KEY) || "";

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error?.message || value.error?.code || "요청을 처리하지 못했습니다."), { code: value.error?.code || "NETWORK" });
    if (value.session?.token) {
      token = value.session.token;
      localStorage.setItem(TOKEN_KEY, token);
    }
    return value;
  }

  function clearToken() {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
  }

  return {
    hasToken: () => Boolean(token),
    authHeader: () => (token ? { Authorization: `Bearer ${token}` } : {}),
    session: () => request("/api/session"),
    signup: (body) => request("/api/auth/signup", { method: "POST", body }),
    login: (body) => request("/api/auth/login", { method: "POST", body }),
    logout: async () => {
      try { await request("/api/auth/logout", { method: "POST" }); }
      finally { clearToken(); }
    },
    progress: () => request("/api/progress"),
    recordActivity: (body) => request("/api/progress/activity", { method: "POST", body }),
    rewards: () => request("/api/rewards"),
    claimReward: (ruleId) => request("/api/rewards/claim", { method: "POST", body: { ruleId } }),
    createInvite: (body) => request("/api/admin/invites", { method: "POST", body }),
    invites: () => request("/api/admin/invites"),
    adminClaims: () => request("/api/admin/claims"),
    updateClaim: (claimId, body) => request(`/api/admin/claims/${encodeURIComponent(claimId)}`, { method: "PATCH", body }),
  };
})();
window.CloudClient = CloudClient;
