const CloudClient = (() => {
  const TOKEN_KEY = "englishConvoApp.cloudToken";
  let token = localStorage.getItem(TOKEN_KEY) || "";

  const ERROR_MESSAGES = {
    UNAUTHORIZED: "이메일 또는 비밀번호를 다시 확인해 주세요.",
    FORBIDDEN: "이 작업을 할 수 있는 권한이 없습니다.",
    INVALID_REQUEST: "입력 내용을 다시 확인해 주세요.",
    INVITE_UNAVAILABLE: "초대코드를 사용할 수 없습니다. 코드나 만료일을 확인해 주세요.",
    NOT_FOUND: "요청한 항목을 찾을 수 없습니다.",
    REWARD_UNAVAILABLE: "아직 신청할 수 없는 보상입니다.",
    REWARD_ALREADY_CLAIMED: "이미 신청한 보상입니다.",
    ALREADY_IMPORTED: "이미 학습 기록을 가져왔습니다.",
    ALREADY_HAS_PROGRESS: "이미 계정에 학습 기록이 있어 가져올 수 없습니다.",
    AI_DAILY_LIMIT: "오늘의 AI 사용 한도에 도달했습니다. 내일 다시 시도해 주세요.",
    SUPABASE_ERROR: "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    UPSTREAM_ERROR: "AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.",
    NETWORK: "요청을 처리하지 못했습니다.",
  };

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
    if (!response.ok) {
      const code = value.error?.code || "NETWORK";
      throw Object.assign(new Error(value.error?.message || ERROR_MESSAGES[code] || ERROR_MESSAGES.NETWORK), { code });
    }
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
    importLocalProgress: (body) => request("/api/progress/import", { method: "POST", body }),
    rewards: () => request("/api/rewards"),
    claimReward: (ruleId) => request("/api/rewards/claim", { method: "POST", body: { ruleId } }),
    createInvite: (body) => request("/api/admin/invites", { method: "POST", body }),
    invites: () => request("/api/admin/invites"),
    adminClaims: () => request("/api/admin/claims"),
    updateClaim: (claimId, body) => request(`/api/admin/claims/${encodeURIComponent(claimId)}`, { method: "PATCH", body }),
  };
})();
window.CloudClient = CloudClient;
