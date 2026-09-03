import { generation, parseOutput, validate } from '../../gemini-service.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
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
    if (!response.ok) throw new HttpError(response.status, 'SUPABASE_ERROR');
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
    const profileRows = await this.request(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,role,display_name`, {
      method: 'GET',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : undefined;
    if (!profile) throw new HttpError(401, 'UNAUTHORIZED');
    return { token, user, profile };
  }

  async findInvite(codeHash) {
    const rows = await this.request(`/rest/v1/invites?code_hash=eq.${encodeURIComponent(codeHash)}&select=id,code_hash,uses,max_uses,expires_at`, {
      method: 'GET',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return Array.isArray(rows) ? rows[0] : undefined;
  }

  async createUser(body) {
    return this.request('/auth/v1/admin/users', {
      method: 'POST',
      key: this.env.SUPABASE_SERVICE_ROLE_KEY,
      body: { email: body.email, password: body.password, email_confirm: true },
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

function validateSignup(body) {
  if (!requiredString(body?.email, 254) || !requiredString(body?.password, 128) || !requiredString(body?.inviteCode, 128)) {
    throw new HttpError(400, 'INVALID_REQUEST');
  }
}

function validateInvite(body) {
  if (!positiveInt(body?.maxUses) || body.maxUses > 100) throw new HttpError(400, 'INVALID_REQUEST');
  if (body.expiresAt !== undefined && Number.isNaN(Date.parse(body.expiresAt))) throw new HttpError(400, 'INVALID_REQUEST');
}

async function handleSignup(request, supabase, now) {
  const body = await readBody(request);
  validateSignup(body);
  const invite = await supabase.findInvite(await inviteHash(body.inviteCode));
  const expired = invite?.expires_at && Date.parse(invite.expires_at) <= now().getTime();
  if (!invite || invite.uses >= invite.max_uses || expired) throw new HttpError(403, 'INVITE_UNAVAILABLE');
  const user = await supabase.createUser(body);
  await supabase.rpc('increment_invite_use', { invite_id: invite.id }, supabase.env.SUPABASE_SERVICE_ROLE_KEY);
  return json({ user: { id: user.id, email: user.email } });
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

async function handleRewardClaim(request, supabase, session) {
  const body = await readBody(request);
  if (!requiredString(body?.ruleId, 80)) throw new HttpError(400, 'INVALID_REQUEST');
  const claim = await supabase.rpc('claim_reward', { rule_id: body.ruleId }, session.token);
  return json({ claim });
}

async function handleClaims(request, supabase, session) {
  requireAdmin(session);
  if (request.method === 'GET') {
    const claims = await supabase.request('/rest/v1/reward_claims?select=*', { method: 'GET', key: supabase.env.SUPABASE_SERVICE_ROLE_KEY });
    return json({ claims });
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

async function handleRoleplay(request, env, supabase, session, fetchImpl, now) {
  const body = await readBody(request);
  const turns = validate(body);
  const usage = await supabase.rpc('check_ai_usage', {
    usage_date: now().toISOString().slice(0, 10),
    user_limit: limit(env.AI_DAILY_USER_LIMIT),
    global_limit: limit(env.AI_DAILY_GLOBAL_LIMIT),
  }, session.token);
  if (usage?.allowed === false) throw new HttpError(429, 'AI_DAILY_LIMIT');
  const upstream = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(generation(body, turns)),
  });
  if (upstream.status === 429) throw new HttpError(429, 'QUOTA_EXCEEDED');
  if (!upstream.ok) throw new HttpError(502, 'UPSTREAM_ERROR');
  const result = parseOutput(await upstream.json(), body, turns);
  await supabase.rpc('increment_ai_usage', { usage_date: now().toISOString().slice(0, 10) }, session.token);
  return json(result);
}

export function createWorker(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const randomBytes = deps.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length)));
  const now = deps.now ?? (() => new Date());
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        const supabase = new SupabaseClient(env, fetchImpl);
        if (url.pathname === '/api/auth/signup' && request.method === 'POST') return await handleSignup(request, supabase, now);
        if (!url.pathname.startsWith('/api/')) return json({ error: { code: 'NOT_FOUND' } }, 404);
        const session = await requireSession(request, supabase);
        if (url.pathname === '/api/admin/invites' && request.method === 'POST') return await handleInviteCreate(request, supabase, session, randomBytes);
        if (url.pathname === '/api/progress' && request.method === 'POST') return await handleProgress(request, supabase, session);
        if (url.pathname === '/api/rewards/claim' && request.method === 'POST') return await handleRewardClaim(request, supabase, session);
        if (url.pathname === '/api/admin/claims' && (request.method === 'GET' || request.method === 'POST')) return await handleClaims(request, supabase, session);
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
