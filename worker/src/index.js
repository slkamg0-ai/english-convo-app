import { generation, parseOutput, validate } from '../../gemini-service.mjs';

// SIZE_OK: Worker route module stays together to share one Supabase adapter and avoid divergent auth/reward logic.
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const readBody = async request => {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HttpError(400, 'INVALID_REQUEST');
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, 'INVALID_REQUEST');
    throw error;
  }
};
const requiredString = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const positiveInt = value => Number.isInteger(value) && value > 0;
async function inviteHash(code) {
  const encoded = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const limit = value => {
  const parsed = Number.parseInt(value || '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

class SupabaseClient {
  constructor(env, fetchImpl) {
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options) {
    const response = await this.fetchImpl(`${this.env.SUPABASE_URL}${path}`, {
      method: options.method,
      headers: {
        apikey: options.key,
        Authorization: `Bearer ${options.key}`,
        'Content-Type': 'application/json',
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      let details = null;
      try { details = await response.json(); } catch { details = null; }
      throw new HttpError(response.status, 'SUPABASE_ERROR', details);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async rpc(name, body, key) {
    return this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body, key });
  }

  async verify(token) {
    const userResponse = await this.fetchImpl(`${this.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userResponse.ok) throw new HttpError(401, 'UNAUTHORIZED');
    const user = await userResponse.json();
    const profileRows = await this.request(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,role,display_name,local_progress_imported_at`, {
      method: 'GET',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : undefined;
    if (!profile) throw new HttpError(401, 'UNAUTHORIZED');
    return { token, user, profile };
  }

  async passwordSession(email, password) {
    const response = await this.fetchImpl(`${this.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new HttpError(response.status, 'UNAUTHORIZED');
    return response.json();
  }

  async logout(token) {
    const response = await this.fetchImpl(`${this.env.SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 204) throw new HttpError(response.status, 'SUPABASE_ERROR');
  }

  async reserveInvite(inviteCodeHash) {
    try {
      return await this.rpc('reserve_invite', { invite_code_hash: inviteCodeHash }, this.env.SUPABASE_SERVICE_ROLE_KEY);
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(403, 'INVITE_UNAVAILABLE');
      throw error;
    }
  }

  async releaseInvite(inviteId) {
    return this.rpc('release_invite', { invite_id: inviteId }, this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async reserveAiUsage(limits, key) {
    try {
      return await this.rpc('reserve_ai_usage', limits, key);
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(429, 'AI_DAILY_LIMIT');
      throw error;
    }
  }

  async createUser(body) {
    return this.request('/auth/v1/admin/users', {
      method: 'POST',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
      body: { email: body.email, password: body.password, email_confirm: true },
    });
  }

  async createProfile(user, displayName) {
    return this.request('/rest/v1/profiles?select=user_id,display_name,role', {
      method: 'POST',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
      prefer: 'return=representation',
      body: { user_id: user.id, display_name: displayName, role: 'user' },
    });
  }
}

function authToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, 'UNAUTHORIZED');
  return match[1];
}

function codeFromBytes(bytes) {
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('').slice(0, 20);
}

async function requireSession(request, supabase) {
  return supabase.verify(authToken(request));
}

function requireAdmin(session) {
  if (session.profile.role !== 'admin') throw new HttpError(403, 'FORBIDDEN');
}

function publicUser(session) {
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.profile.display_name || session.user.email,
    role: session.profile.role,
    localProgressImportedAt: session.profile.local_progress_imported_at || null,
  };
}

function validateSignup(body) {
  if (!requiredString(body?.email, 254) || !requiredString(body?.password, 128) || !requiredString(body?.inviteCode, 128)) throw new HttpError(400, 'INVALID_REQUEST');
}

function displayNameFromEmail(email) {
  return email.split('@')[0].slice(0, 80);
}

function signupDisplayName(body) {
  return requiredString(body.displayName, 80) ? body.displayName.trim() : displayNameFromEmail(body.email);
}

function validateInvite(body) {
  if (!positiveInt(body?.maxUses) || body.maxUses > 100) throw new HttpError(400, 'INVALID_REQUEST');
  if (body.expiresAt !== undefined && Number.isNaN(Date.parse(body.expiresAt))) throw new HttpError(400, 'INVALID_REQUEST');
}

async function handleSignup(request, supabase) {
  const body = await readBody(request);
  validateSignup(body);
  const invite = await supabase.reserveInvite(await inviteHash(body.inviteCode));
  try {
    const user = await supabase.createUser(body);
    const profileRows = await supabase.createProfile(user, signupDisplayName(body));
    const passwordSession = await supabase.passwordSession(body.email, body.password);
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
    return json({ user: publicUser({ user, profile }), session: { token: passwordSession.access_token } });
  } catch (error) {
    await supabase.releaseInvite(invite.id);
    throw error;
  }
}

async function handleLogin(request, supabase) {
  const body = await readBody(request);
  if (!requiredString(body?.email, 254) || !requiredString(body?.password, 128)) throw new HttpError(400, 'INVALID_REQUEST');
  const passwordSession = await supabase.passwordSession(body.email, body.password);
  const session = await supabase.verify(passwordSession.access_token);
  return json({ user: publicUser({ user: passwordSession.user, profile: session.profile }), session: { token: passwordSession.access_token } });
}

async function handleLogout(request, supabase) {
  await supabase.logout(authToken(request));
  return json({ ok: true });
}

async function handleInviteCreate(request, supabase, session, randomBytes) {
  requireAdmin(session);
  const body = await readBody(request);
  validateInvite(body);
  const code = codeFromBytes(randomBytes(20));
  const rows = await supabase.request('/rest/v1/invites?select=id,code_hash,max_uses,expires_at,created_by', {
    method: 'POST',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
    prefer: 'return=representation',
    body: { code_hash: await inviteHash(code), max_uses: body.maxUses, expires_at: body.expiresAt ?? null, created_by: session.user.id },
  });
  return json({ code, invite: Array.isArray(rows) ? rows[0] : rows });
}

function adminInvite(invite) {
  return {
    id: invite.id,
    maxUses: invite.max_uses,
    uses: invite.uses,
    expiresAt: invite.expires_at,
    createdBy: invite.created_by,
    createdAt: invite.created_at,
  };
}

async function handleInviteList(supabase, session) {
  requireAdmin(session);
  const invites = await supabase.request('/rest/v1/invites?select=id,max_uses,uses,expires_at,created_by,created_at&order=created_at.desc', {
    method: 'GET',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return json({ invites: (Array.isArray(invites) ? invites : []).map(adminInvite) });
}

async function handleProgress(request, supabase, session) {
  const body = await readBody(request);
  const progress = await supabase.rpc('record_activity', {
    client_event_id: body.clientEventId,
    kind: body.kind,
    source_id: body.sourceId ?? null,
    xp_delta: body.xpDelta,
    occurred_at: body.occurredAt,
    metadata: body.metadata ?? {},
  }, session.token);
  return json({ progress });
}

function translateRpcConflict(error, rules) {
  if (!(error instanceof HttpError)) throw error;
  const message = error.details?.message || '';
  const matched = rules.find(rule => message.includes(rule.match));
  if (matched) throw new HttpError(matched.status, matched.code);
  throw error;
}

function validateImportProgress(progress) {
  if (!progress || typeof progress !== 'object') throw new HttpError(400, 'INVALID_REQUEST');
  if (!Number.isInteger(progress.xp) || progress.xp < 0) throw new HttpError(400, 'INVALID_REQUEST');
  if (!Number.isInteger(progress.currentStreak) || progress.currentStreak < 0) throw new HttpError(400, 'INVALID_REQUEST');
  if (progress.lastActivityDate !== null && progress.lastActivityDate !== undefined && !requiredString(progress.lastActivityDate, 10)) {
    throw new HttpError(400, 'INVALID_REQUEST');
  }
}

async function handleProgressImport(request, supabase, session) {
  const body = await readBody(request);
  const progress = body?.progress;
  validateImportProgress(progress);
  const completedCount = Array.isArray(progress.rewardedIds) ? progress.rewardedIds.length : 0;
  let summary;
  try {
    summary = await supabase.rpc('import_local_progress', {
      xp: progress.xp,
      current_streak: progress.currentStreak,
      last_activity_date: progress.lastActivityDate ?? null,
      completed_count: completedCount,
    }, session.token);
  } catch (error) {
    translateRpcConflict(error, [
      { match: 'already imported', code: 'ALREADY_IMPORTED', status: 409 },
      { match: 'Cloud progress already exists', code: 'ALREADY_HAS_PROGRESS', status: 409 },
    ]);
  }
  return json({ summary: progressSummary([summary]) });
}

function progressSummary(progressRows) {
  const progress = Array.isArray(progressRows) && progressRows[0] ? progressRows[0] : {};
  return { xp: progress.total_xp || 0, currentStreak: progress.current_streak || 0, totalActivities: progress.completed_count || 0 };
}

async function handleProgressSummary(supabase, session) {
  const progressRows = await supabase.request(`/rest/v1/progress_summaries?user_id=eq.${encodeURIComponent(session.user.id)}&select=total_xp,current_streak,completed_count`, {
    method: 'GET',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return json({ summary: progressSummary(progressRows) });
}

async function handleRewards(supabase, session) {
  const progressRows = await supabase.request(`/rest/v1/progress_summaries?user_id=eq.${encodeURIComponent(session.user.id)}&select=total_xp,current_streak,completed_count`, {
    method: 'GET',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const rules = await supabase.request('/rest/v1/reward_rules?select=id,title,required_xp,description,active&order=required_xp.asc', {
    method: 'GET',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const claims = await supabase.request(`/rest/v1/reward_claims?user_id=eq.${encodeURIComponent(session.user.id)}&select=id,reward_rule_id,status,requested_at,reviewed_at,delivered_at,admin_note`, {
    method: 'GET',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const summary = progressSummary(progressRows);
  const claimed = new Set((Array.isArray(claims) ? claims : []).map(claim => claim.reward_rule_id));
  return json({
    summary,
    rules: (Array.isArray(rules) ? rules : []).map(rule => ({
      id: rule.id,
      label: rule.title,
      description: rule.description || '',
      requiredXp: rule.required_xp,
      active: rule.active,
      eligible: rule.active && summary.xp >= rule.required_xp && !claimed.has(rule.id),
      claimed: claimed.has(rule.id),
    })),
    claims: (Array.isArray(claims) ? claims : []).map(claim => ({
      id: claim.id,
      rewardRuleId: claim.reward_rule_id,
      status: claim.status,
      requestedAt: claim.requested_at,
      reviewedAt: claim.reviewed_at,
      deliveredAt: claim.delivered_at,
      adminNote: claim.admin_note,
    })),
  });
}

async function handleRewardClaim(request, supabase, session) {
  const body = await readBody(request);
  if (!requiredString(body?.ruleId, 80)) throw new HttpError(400, 'INVALID_REQUEST');
  let claim;
  try {
    claim = await supabase.rpc('claim_reward', { rule_id: body.ruleId }, session.token);
  } catch (error) {
    translateRpcConflict(error, [
      { match: 'already claimed', code: 'REWARD_ALREADY_CLAIMED', status: 409 },
      { match: 'not available', code: 'REWARD_UNAVAILABLE', status: 400 },
      { match: 'Not enough XP', code: 'REWARD_UNAVAILABLE', status: 400 },
    ]);
  }
  return json({ claim });
}

function adminClaim(claim) {
  return {
    id: claim.id,
    userId: claim.user_id,
    displayName: claim.profiles?.display_name || '',
    userEmail: claim.profiles?.email || '',
    rewardRuleId: claim.reward_rule_id,
    rewardLabel: claim.reward_rules?.title || claim.reward_rule_id,
    status: claim.status,
    createdAt: claim.requested_at,
    decidedAt: claim.reviewed_at || claim.delivered_at || null,
  };
}

async function handleClaims(request, supabase, session) {
  requireAdmin(session);
  if (request.method === 'GET') {
    const claims = await supabase.request('/rest/v1/reward_claims?select=id,user_id,reward_rule_id,status,requested_at,reviewed_at,delivered_at,profiles(display_name,email),reward_rules(title)&order=requested_at.desc', { method: 'GET', key: supabase.env.SUPABASE_SERVICE_ROLE_KEY });
    return json({ claims: (Array.isArray(claims) ? claims : []).map(adminClaim) });
  }
  const body = await readBody(request);
  if (!requiredString(body?.claimId, 80) || !requiredString(body?.status, 30)) throw new HttpError(400, 'INVALID_REQUEST');
  const rows = await supabase.request(`/rest/v1/reward_claims?id=eq.${encodeURIComponent(body.claimId)}&select=*`, {
    method: 'PATCH',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
    prefer: 'return=representation',
    body: { status: body.status, admin_note: body.adminNote ?? null, reviewed_at: new Date().toISOString() },
  });
  return json({ claim: Array.isArray(rows) ? rows[0] : rows });
}

async function handleClaimUpdate(request, supabase, session, claimId) {
  requireAdmin(session);
  const body = await readBody(request);
  if (!requiredString(claimId, 80) || !requiredString(body?.status, 30)) throw new HttpError(400, 'INVALID_REQUEST');
  const rows = await supabase.request(`/rest/v1/reward_claims?id=eq.${encodeURIComponent(claimId)}&select=*`, {
    method: 'PATCH',
    key: supabase.env.SUPABASE_SERVICE_ROLE_KEY,
    prefer: 'return=representation',
    body: { status: body.status, admin_note: body.adminNote ?? null, reviewed_at: new Date().toISOString() },
  });
  return json({ claim: Array.isArray(rows) ? rows[0] : rows });
}

async function handleRoleplay(request, env, supabase, session, fetchImpl, now) {
  const body = await readBody(request);
  const turns = validate(body);
  await supabase.reserveAiUsage({
    usage_date: now().toISOString().slice(0, 10),
    user_limit: limit(env.AI_DAILY_USER_LIMIT),
    global_limit: limit(env.AI_DAILY_GLOBAL_LIMIT),
  }, session.token);
  const upstream = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(generation(body, turns)),
  });
  if (upstream.status === 429) {
    return json({ ai: { status: 'limited' }, fallback: 'scripted', message: 'AI practice is limited right now. Try the scenario prompt and sample answer while the quota resets.' });
  }
  if (!upstream.ok) throw new HttpError(502, 'UPSTREAM_ERROR');
  const result = parseOutput(await upstream.json(), body, turns);
  return json(result);
}

export function createWorker(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
  const randomBytes = deps.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length)));
  const now = deps.now ?? (() => new Date());
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        const supabase = new SupabaseClient(env, fetchImpl);
        if (url.pathname === '/api/auth/signup' && request.method === 'POST') return await handleSignup(request, supabase);
        if (url.pathname === '/api/auth/login' && request.method === 'POST') return await handleLogin(request, supabase);
        if (url.pathname === '/api/auth/logout' && request.method === 'POST') return await handleLogout(request, supabase);
        if (!url.pathname.startsWith('/api/')) return json({ error: { code: 'NOT_FOUND' } }, 404);
        const session = await requireSession(request, supabase);
        if (url.pathname === '/api/session' && request.method === 'GET') return json({ user: publicUser(session), session: { active: true } });
        if (url.pathname === '/api/admin/invites' && request.method === 'POST') return await handleInviteCreate(request, supabase, session, randomBytes);
        if (url.pathname === '/api/admin/invites' && request.method === 'GET') return await handleInviteList(supabase, session);
        if (url.pathname === '/api/progress' && request.method === 'GET') return await handleProgressSummary(supabase, session);
        if ((url.pathname === '/api/progress' || url.pathname === '/api/progress/activity') && request.method === 'POST') return await handleProgress(request, supabase, session);
        if (url.pathname === '/api/progress/import' && request.method === 'POST') return await handleProgressImport(request, supabase, session);
        if (url.pathname === '/api/rewards' && request.method === 'GET') return await handleRewards(supabase, session);
        if (url.pathname === '/api/rewards/claim' && request.method === 'POST') return await handleRewardClaim(request, supabase, session);
        if (url.pathname === '/api/admin/claims' && (request.method === 'GET' || request.method === 'POST')) return await handleClaims(request, supabase, session);
        const claimMatch = /^\/api\/admin\/claims\/([^/]+)$/.exec(url.pathname);
        if (claimMatch && request.method === 'PATCH') return await handleClaimUpdate(request, supabase, session, claimMatch[1]);
        if (url.pathname === '/api/roleplay' && request.method === 'POST') return await handleRoleplay(request, env, supabase, session, fetchImpl, now);
        return json({ error: { code: 'NOT_FOUND' } }, 404);
      } catch (error) {
        if (error instanceof HttpError) return json({ error: { code: error.code } }, error.status);
        throw error;
      }
    },
  };
}

export default createWorker();
