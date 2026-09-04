import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../worker/src/index.js';

const env = { SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', GEMINI_API_KEY: 'gemini-key', AI_DAILY_USER_LIMIT: '3', AI_DAILY_GLOBAL_LIMIT: '30' };

const json = body => JSON.parse(body);
const responseJson = (body, status = 200) => new Response(JSON.stringify(body), { status });
const authHeaders = { Authorization: 'Bearer user-token' }, adminHeaders = { Authorization: 'Bearer admin-token' };
const scenario = { title: 'Cafe', description: 'Order coffee', opening: 'Hello!', openingKo: '안녕하세요', hint: 'A coffee, please.', hintKo: '커피 주세요' };
const turn = { reply: 'Would you like milk?', translation: '우유를 넣을까요?', hint: 'Yes, please.', hintKo: '네 주세요', goalReached: false };

function createMockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? json(init.body) : undefined };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

function worker(fetchImpl, overrides = {}) {
  return createWorker({
    fetchImpl,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    randomBytes: length => new Uint8Array(Array.from({ length }, (_, index) => index + 1)),
    now: () => new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  });
}

function request(path, { method = 'POST', body, headers = {} } = {}) {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function supabaseAuth(call) {
  if (call.url.endsWith('/auth/v1/user')) {
    const token = call.init.headers.Authorization.replace('Bearer ', '');
    return responseJson({ id: token === 'admin-token' ? 'admin-user' : 'user-1', email: `${token}@test.local` });
  }
  if (call.url.includes('/rest/v1/profiles')) {
    const role = call.url.includes('admin-user') ? 'admin' : 'user';
    return responseJson([{ user_id: role === 'admin' ? 'admin-user' : 'user-1', role, display_name: 'Tester' }]);
  }
  throw new Error(`Unhandled mock URL: ${call.url}`);
}

const sessionBody = {
  access_token: 'issued-token',
  user: { id: 'created-user', email: 'new@test.local' },
};

test('OPTIONS preflight for any /api/* route returns CORS headers without touching Supabase', async () => {
  const api = worker(async () => { throw new Error('fetchImpl should not be called for a preflight request'); });

  const response = await api.fetch(request('/api/auth/login', { method: 'OPTIONS' }), env);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
});

test('JSON responses (success and error) carry CORS headers for a static frontend origin', async () => {
  const api = worker(async () => responseJson({}));

  const unauthorized = await api.fetch(request('/api/progress', { body: {} }), env);
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), '*');

  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/token?grant_type=password')) return responseJson({ access_token: 'login-token', user: { id: 'user-1', email: call.body.email } });
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const loginApi = worker(fetchImpl);
  const login = await loginApi.fetch(request('/api/auth/login', { body: { email: 'learner@test.local', password: 'secret123' } }), env);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('access-control-allow-origin'), '*');
});

test('GET /api/status reports AI availability without requiring a session', async () => {
  const api = worker(async () => { throw new Error('fetchImpl should not be called for a public status check'); });

  const configured = await api.fetch(request('/api/status', { method: 'GET' }), { ...env, GEMINI_API_KEY: 'gemini-key' });
  assert.equal(configured.status, 200);
  assert.deepEqual(await configured.json(), { configured: true, ai: { status: 'available', reason: null }, quotaBlocked: false, maxTurns: 6 });

  const unconfigured = await api.fetch(request('/api/status', { method: 'GET' }), { ...env, GEMINI_API_KEY: '' });
  assert.equal(unconfigured.status, 200);
  assert.deepEqual(await unconfigured.json(), { configured: false, ai: { status: 'limited', reason: 'not_configured' }, quotaBlocked: false, maxTurns: 6 });
});

test('unauthenticated progress, reward, and admin calls return 401', async () => {
  const api = worker(async () => responseJson({}));

  for (const path of ['/api/progress', '/api/rewards/claim', '/api/admin/claims']) {
    const response = await api.fetch(request(path, { body: {} }), env);
    assert.equal(response.status, 401);
  }
});

test('POST /api/auth/signup reserves invite before account creation and creates profile', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.includes('/rest/v1/rpc/reserve_invite')) return responseJson({ id: 'invite-1', uses: 1, max_uses: 1 });
    if (call.url.endsWith('/auth/v1/admin/users')) return responseJson({ id: 'created-user', email: call.body.email });
    if (call.url.includes('/rest/v1/profiles')) return responseJson([{ user_id: call.body.user_id, display_name: call.body.display_name, role: 'user' }], 201);
    if (call.url.endsWith('/auth/v1/token?grant_type=password')) return responseJson(sessionBody);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/auth/signup', {
    body: { email: 'new@test.local', password: 'secret123', displayName: 'Site Captain', inviteCode: 'JOIN-2026' },
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: { id: 'created-user', email: 'new@test.local', displayName: 'Site Captain', role: 'user', localProgressImportedAt: null },
    session: { token: 'issued-token' },
  });
  const redeemIndex = calls.findIndex(call => call.url.includes('/rest/v1/rpc/reserve_invite'));
  const authIndex = calls.findIndex(call => call.url.endsWith('/auth/v1/admin/users'));
  const profileIndex = calls.findIndex(call => call.url.includes('/rest/v1/profiles') && call.init.method === 'POST');
  assert.ok(redeemIndex > -1 && redeemIndex < authIndex && authIndex < profileIndex);
  assert.equal(calls[redeemIndex].body.invite_code_hash.length, 64);
  const profileInsert = calls.find(call => call.url.includes('/rest/v1/profiles') && call.init.method === 'POST');
  assert.deepEqual(profileInsert.body, { user_id: 'created-user', display_name: 'Site Captain', role: 'user' });
  assert.equal(calls.find(call => call.url.endsWith('/auth/v1/token?grant_type=password')).body.password, 'secret123');
  assert.ok(calls.every(call => !JSON.stringify(call.body ?? {}).includes('JOIN-2026')));
});

test('Worker login session and logout match browser cloud-client contract', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/token?grant_type=password')) return responseJson({ access_token: 'login-token', user: { id: 'user-1', email: call.body.email } });
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.endsWith('/auth/v1/logout')) return new Response(null, { status: 204 });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const login = await api.fetch(request('/api/auth/login', { body: { email: 'learner@test.local', password: 'secret123' } }), env);
  const session = await api.fetch(request('/api/session', { method: 'GET', headers: { Authorization: 'Bearer login-token' } }), env);
  const logout = await api.fetch(request('/api/auth/logout', { headers: { Authorization: 'Bearer login-token' } }), env);

  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { user: { id: 'user-1', email: 'learner@test.local', displayName: 'Tester', role: 'user', localProgressImportedAt: null }, session: { token: 'login-token' } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { user: { id: 'user-1', email: 'login-token@test.local', displayName: 'Tester', role: 'user', localProgressImportedAt: null }, session: { active: true } });
  assert.equal(logout.status, 200);
  assert.ok(calls.some(call => call.url.endsWith('/auth/v1/logout') && call.init.headers.Authorization === 'Bearer login-token'));
});

test('POST /api/auth/signup rejects unavailable invites before auth user creation', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.includes('/rest/v1/rpc/reserve_invite')) return responseJson({ error: 'unavailable' }, 409);
    throw new Error(`Auth should not be called after failed redemption: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/auth/signup', {
    body: { email: 'late@test.local', password: 'secret123', displayName: 'Late User', inviteCode: 'JOIN-2026' },
  }), env);

  assert.equal(response.status, 403);
  assert.ok(calls.some(call => call.url.includes('/rest/v1/rpc/reserve_invite')));
  assert.deepEqual([
    calls.some(call => call.url.endsWith('/auth/v1/admin/users')),
    calls.some(call => call.url.includes('/rest/v1/profiles')),
  ], [false, false]);
});

test('POST /api/auth/signup releases reserved invite when auth user creation fails', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.includes('/rest/v1/rpc/reserve_invite')) return responseJson({ id: 'invite-1', uses: 1, max_uses: 1 });
    if (call.url.endsWith('/auth/v1/admin/users')) return responseJson({ error: 'duplicate email' }, 409);
    if (call.url.includes('/rest/v1/rpc/release_invite')) return responseJson({ id: 'invite-1', uses: 0, max_uses: 1 });
    throw new Error(`Unexpected signup call: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/auth/signup', {
    body: { email: 'dupe@test.local', password: 'secret123', displayName: 'Duplicate', inviteCode: 'JOIN-2026' },
  }), env);

  assert.equal(response.status, 409);
  assert.ok(calls.findIndex(call => call.url.includes('/rest/v1/rpc/reserve_invite')) < calls.findIndex(call => call.url.endsWith('/auth/v1/admin/users')));
  assert.ok(calls.some(call => call.url.includes('/rest/v1/rpc/release_invite') && call.body.invite_id === 'invite-1'));
  assert.equal(calls.some(call => call.url.includes('/rest/v1/profiles')), false);
});

test('POST /api/auth/signup releases reserved invite when profile creation fails', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.includes('/rest/v1/rpc/reserve_invite')) return responseJson({ id: 'invite-1', uses: 1, max_uses: 1 });
    if (call.url.endsWith('/auth/v1/admin/users')) return responseJson({ id: 'created-user', email: call.body.email });
    if (call.url.includes('/rest/v1/profiles')) return responseJson({ error: 'profile failed' }, 500);
    if (call.url.includes('/rest/v1/rpc/release_invite')) return responseJson({ id: 'invite-1', uses: 0, max_uses: 1 });
    throw new Error(`Unexpected signup call: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/auth/signup', {
    body: { email: 'profile-fail@test.local', password: 'secret123', displayName: 'Profile Fail', inviteCode: 'JOIN-2026' },
  }), env);

  assert.equal(response.status, 500);
  assert.ok(calls.some(call => call.url.includes('/rest/v1/profiles') && call.init.method === 'POST'));
  assert.ok(calls.some(call => call.url.includes('/rest/v1/rpc/release_invite') && call.body.invite_id === 'invite-1'));
});

test('POST /api/admin/invites creates a hashed invite code record and returns the plain code once', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/invites')) return responseJson([{ id: 'invite-1', code_hash: call.body.code_hash, max_uses: 2 }], 201);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/admin/invites', { headers: adminHeaders, body: { maxUses: 2, expiresAt: '2026-09-30T00:00:00.000Z' } }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.invite.id, 'invite-1');
  assert.match(body.code, /^[A-Z2-9]{20}$/);
  const insert = calls.find(call => call.url.includes('/rest/v1/invites') && call.init.method === 'POST');
  assert.ok(insert);
  assert.equal(insert.body.code_hash.length, 64);
  assert.equal(insert.body.max_uses, 2);
  assert.ok(!JSON.stringify(insert.body).includes(body.code));
});

test('GET /api/admin/invites lists invite metadata for admins only without plain codes', async () => {
  const invites = [{
    id: 'invite-1',
    max_uses: 2,
    uses: 1,
    expires_at: '2026-09-30T00:00:00.000Z',
    created_by: 'admin-user',
    created_at: '2026-09-04T00:00:00.000Z',
  }];
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/invites')) {
      assert.equal(call.url.includes('code_hash'), false);
      return responseJson(invites);
    }
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const adminResponse = await api.fetch(request('/api/admin/invites', { method: 'GET', headers: adminHeaders }), env);
  const adminBody = await adminResponse.json();
  const userResponse = await api.fetch(request('/api/admin/invites', { method: 'GET', headers: authHeaders }), env);

  assert.equal(adminResponse.status, 200);
  assert.deepEqual(adminBody, { invites: [{
    id: 'invite-1',
    maxUses: 2,
    uses: 1,
    expiresAt: '2026-09-30T00:00:00.000Z',
    createdBy: 'admin-user',
    createdAt: '2026-09-04T00:00:00.000Z',
  }] });
  assert.deepEqual([JSON.stringify(adminBody).includes('JOIN-2026'), userResponse.status], [false, 403]);
});

test('authenticated /api/progress calls Supabase RPC record_activity', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/record_activity')) return responseJson({ total_xp: 50, current_streak: 1 });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress', {
    headers: authHeaders,
    body: { clientEventId: 'event-1', kind: 'lesson_complete', sourceId: 'lesson-1', xpDelta: 50, occurredAt: '2026-09-04T00:00:00.000Z', metadata: { lesson: 1 } },
  }), env);

  const rpcCall = calls.find(call => call.url.includes('/rest/v1/rpc/record_activity'));
  assert.equal(rpcCall.init.headers.apikey, env.SUPABASE_ANON_KEY, 'apikey must be the project key, not the user JWT reused from Authorization');
  assert.equal(rpcCall.init.headers.Authorization, 'Bearer user-token');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { progress: { total_xp: 50, current_streak: 1 } });
  assert.equal(calls.find(call => call.url.includes('/rest/v1/rpc/record_activity')).body.p_xp_delta, 50);
});

test('GET /api/progress returns browser progress summary shape', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/progress_summaries')) return responseJson([{ total_xp: 240, current_streak: 3, completed_count: 12 }]);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress', { method: 'GET', headers: authHeaders }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summary: { xp: 240, currentStreak: 3, totalActivities: 12 } });
});

test('GET /api/progress returns empty progress when no summary row exists', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/progress_summaries')) return responseJson([]);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress', { method: 'GET', headers: authHeaders }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summary: { xp: 0, currentStreak: 0, totalActivities: 0 } });
});

test('POST /api/progress/activity uses the same record_activity RPC contract', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/record_activity')) return responseJson({ total_xp: 50, current_streak: 1 });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress/activity', {
    headers: authHeaders,
    body: { clientEventId: 'event-1', kind: 'lesson_complete', sourceId: 'lesson-1', xpDelta: 50, occurredAt: '2026-09-04T00:00:00.000Z' },
  }), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).progress.total_xp, 50);
  assert.equal(calls.find(call => call.url.includes('/rest/v1/rpc/record_activity')).body.p_client_event_id, 'event-1');
});

test('GET /api/rewards returns summary rules and claim eligibility', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/progress_summaries')) return responseJson([{ total_xp: 600, current_streak: 2, completed_count: 7 }]);
    if (call.url.includes('/rest/v1/reward_rules')) return responseJson([
      { id: '11111111-1111-4111-8111-111111111111', title: '500 XP Coffee coupon', required_xp: 500, description: 'Entry/manual review', active: true },
      { id: '22222222-2222-4222-8222-222222222222', title: '1000 XP Coffee coupon', required_xp: 1000, description: 'Manual delivery', active: true },
    ]);
    if (call.url.includes('/rest/v1/reward_claims')) return responseJson([{ id: 'claim-1', reward_rule_id: '11111111-1111-4111-8111-111111111111', status: 'pending' }]);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/rewards', { method: 'GET', headers: authHeaders }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.summary, { xp: 600, currentStreak: 2, totalActivities: 7 });
  assert.deepEqual(body.rules.map(rule => ({ id: rule.id, eligible: rule.eligible, claimed: rule.claimed })), [
    { id: '11111111-1111-4111-8111-111111111111', eligible: false, claimed: true },
    { id: '22222222-2222-4222-8222-222222222222', eligible: false, claimed: false },
  ]);
});

test('/api/rewards/claim invokes Supabase RPC claim_reward', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/claim_reward')) return responseJson({ id: 'claim-1', reward_rule_id: call.body.rule_id, status: 'pending' });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/rewards/claim', {
    headers: authHeaders,
    body: { ruleId: '11111111-1111-4111-8111-111111111111' },
  }), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).claim.id, 'claim-1');
  assert.equal(calls.find(call => call.url.includes('/rest/v1/rpc/claim_reward')).body.rule_id, '11111111-1111-4111-8111-111111111111');
});

test('/api/admin/claims rejects non-admin profiles', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/admin/claims', { headers: authHeaders, body: { claimId: 'claim-1', status: 'approved' } }), env);

  assert.equal(response.status, 403);
});

test('GET /api/admin/claims returns browser admin claim shape', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/reward_claims')) return responseJson([{
      id: 'claim-1',
      user_id: 'user-1',
      reward_rule_id: 'reward-500',
      status: 'pending',
      requested_at: '2026-09-04T00:00:00.000Z',
      reviewed_at: null,
      delivered_at: null,
      profiles: { display_name: 'Site Captain', email: 'learner@test.local' },
      reward_rules: { title: '500 XP Coffee coupon' },
    }]);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/admin/claims', { method: 'GET', headers: adminHeaders }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claims: [{
    id: 'claim-1',
    userId: 'user-1',
    displayName: 'Site Captain',
    userEmail: 'learner@test.local',
    rewardRuleId: 'reward-500',
    rewardLabel: '500 XP Coffee coupon',
    status: 'pending',
    createdAt: '2026-09-04T00:00:00.000Z',
    decidedAt: null,
  }] });
  assert.match(calls.find(call => call.url.includes('/rest/v1/reward_claims')).url, /profiles\(display_name,email\).*reward_rules\(title\)/);
});

test('PATCH /api/admin/claims/:id updates claim status for admins', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/reward_claims?id=eq.claim-1')) return responseJson([{ id: 'claim-1', status: call.body.status, admin_note: call.body.admin_note }]);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/admin/claims/claim-1', {
    method: 'PATCH',
    headers: adminHeaders,
    body: { status: 'delivered', adminNote: 'sent' },
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claim: { id: 'claim-1', status: 'delivered', admin_note: 'sent' } });
  assert.equal(calls.find(call => call.url.includes('/rest/v1/reward_claims?id=eq.claim-1')).init.method, 'PATCH');
});

test('/api/roleplay reserves daily usage before calling Gemini', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/reserve_ai_usage')) return responseJson({ user_id: 'user-1', usage_date: '2026-09-04', request_count: 1 });
    if (call.url.includes('generativelanguage.googleapis.com')) return responseJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(turn) }] } }] });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/roleplay', {
    headers: authHeaders,
    body: { action: 'start', scenario, level: 'beginner', messages: [] },
  }), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, turn.reply);
  assert.ok(calls.findIndex(call => call.url.includes('/rest/v1/rpc/reserve_ai_usage')) < calls.findIndex(call => call.url.includes('generativelanguage.googleapis.com')));
  const staleQuotaRpcs = ['check_ai_' + 'usage', 'increment_ai_' + 'usage'];
  assert.deepEqual(staleQuotaRpcs.map(rpcName => calls.some(call => call.url.includes(`/rest/v1/rpc/${rpcName}`))), [false, false]);
});

test('/api/roleplay maps a genuine reserve_ai_usage limit message to 429 AI_DAILY_LIMIT', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/reserve_ai_usage')) return responseJson({ code: '22023', message: 'AI usage limit reached' }, 400);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/roleplay', {
    headers: authHeaders,
    body: { action: 'start', scenario, level: 'beginner', messages: [] },
  }), env);

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'AI_DAILY_LIMIT');
});

test('/api/roleplay does not mask an unrelated reserve_ai_usage failure as AI_DAILY_LIMIT', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/reserve_ai_usage')) return responseJson({ code: 'PGRST202', message: 'Could not find the function public.reserve_ai_usage' }, 404);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/roleplay', {
    headers: authHeaders,
    body: { action: 'start', scenario, level: 'beginner', messages: [] },
  }), env);

  const body = await response.json();
  assert.notEqual(body.error.code, 'AI_DAILY_LIMIT');
  assert.equal(body.error.code, 'SUPABASE_ERROR');
});

test('Gemini 429 returns limited-mode response without leaking upstream text', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/reserve_ai_usage')) return responseJson({ user_id: 'user-1', usage_date: '2026-09-04', request_count: 1 });
    if (call.url.includes('generativelanguage.googleapis.com')) return new Response('SECRET quota details', { status: 429 });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/roleplay', {
    headers: authHeaders,
    body: { action: 'start', scenario, level: 'beginner', messages: [] },
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.ai, { status: 'limited' });
  assert.equal(body.fallback, 'scripted');
  assert.equal(typeof body.message, 'string');
  assert.doesNotMatch(JSON.stringify(body), /SECRET/);
});

test('POST /api/progress/import invokes Supabase RPC import_local_progress', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/import_local_progress')) return responseJson({ total_xp: 240, current_streak: 2, completed_count: 2 });
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress/import', {
    headers: authHeaders,
    body: { progress: { xp: 240, rewardedIds: ['a', 'b'], currentStreak: 2, lastActivityDate: '2026-09-03' } },
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summary: { xp: 240, currentStreak: 2, totalActivities: 2 } });
  const rpcCall = calls.find(call => call.url.includes('/rest/v1/rpc/import_local_progress'));
  assert.deepEqual(rpcCall.body, { p_xp: 240, p_current_streak: 2, p_last_activity_date: '2026-09-03', p_completed_count: 2 });
});

test('POST /api/progress/import rejects an invalid payload without calling Supabase', async () => {
  const { fetchImpl, calls } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress/import', {
    headers: authHeaders,
    body: { progress: { xp: -5, currentStreak: 2 } },
  }), env);

  assert.equal(response.status, 400);
  assert.equal(calls.some(call => call.url.includes('/rest/v1/rpc/import_local_progress')), false);
});

test('POST /api/progress/import translates a Postgrest conflict into ALREADY_IMPORTED', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/import_local_progress')) {
      return responseJson({ code: '23505', message: 'Local progress already imported' }, 409);
    }
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress/import', {
    headers: authHeaders,
    body: { progress: { xp: 10, currentStreak: 1, rewardedIds: [] } },
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'ALREADY_IMPORTED');
});

test('POST /api/progress/import translates a Postgrest conflict into ALREADY_HAS_PROGRESS', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/import_local_progress')) {
      return responseJson({ code: '23505', message: 'Cloud progress already exists' }, 409);
    }
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/progress/import', {
    headers: authHeaders,
    body: { progress: { xp: 10, currentStreak: 1, rewardedIds: [] } },
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'ALREADY_HAS_PROGRESS');
});

test('/api/rewards/claim translates a Postgrest conflict into REWARD_ALREADY_CLAIMED', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/claim_reward')) {
      return responseJson({ code: '23505', message: 'Reward already claimed' }, 409);
    }
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/rewards/claim', {
    headers: authHeaders,
    body: { ruleId: '11111111-1111-4111-8111-111111111111' },
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'REWARD_ALREADY_CLAIMED');
});

test('/api/rewards/claim translates a not-eligible Postgrest error into REWARD_UNAVAILABLE', async () => {
  const { fetchImpl } = createMockFetch(call => {
    if (call.url.endsWith('/auth/v1/user') || call.url.includes('/rest/v1/profiles')) return supabaseAuth(call);
    if (call.url.includes('/rest/v1/rpc/claim_reward')) {
      return responseJson({ code: '22023', message: 'Not enough XP for this reward' }, 400);
    }
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/rewards/claim', {
    headers: authHeaders,
    body: { ruleId: '11111111-1111-4111-8111-111111111111' },
  }), env);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'REWARD_UNAVAILABLE');
});

test('Worker RPC names are defined in Supabase migration', async () => {
  const migration = await readFile(new URL('../supabase/migrations/0001_multi_user_rewards.sql', import.meta.url), 'utf8');

  for (const rpcName of ['record_activity', 'claim_reward', 'reserve_invite', 'release_invite', 'reserve_ai_usage', 'import_local_progress']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpcName}\\b`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpcName}\\(`));
  }
});

test('RPC parameters never collide with the target table columns they write', async () => {
  const migration = await readFile(new URL('../supabase/migrations/0001_multi_user_rewards.sql', import.meta.url), 'utf8');

  // A parameter named the same as a column it writes makes PL/pgSQL raise "column
  // reference is ambiguous" (42702) the first time it runs against real Postgres —
  // Node tests mock fetchImpl and never execute the SQL, so this is otherwise invisible.
  const cases = [
    { rpcName: 'record_activity', columns: ['client_event_id', 'kind', 'source_id', 'xp_delta', 'occurred_at', 'metadata'] },
    { rpcName: 'reserve_ai_usage', columns: ['usage_date', 'request_count'] },
    { rpcName: 'import_local_progress', columns: ['total_xp', 'current_streak', 'last_activity_date', 'completed_count'] },
  ];

  for (const { rpcName, columns } of cases) {
    const signatureStart = migration.indexOf(`create or replace function public.${rpcName}(`);
    assert.ok(signatureStart > -1, `${rpcName} not found`);
    const signatureEnd = migration.indexOf(')', migration.indexOf('returns', signatureStart));
    const signature = migration.slice(signatureStart, signatureEnd);
    const paramNames = [...signature.matchAll(/^\s*(\w+)\s+\w/gm)].map(match => match[1]);
    assert.ok(paramNames.length > 0, `${rpcName} signature was not parsed`);
    for (const column of columns) {
      assert.equal(paramNames.includes(column), false, `${rpcName} has a parameter literally named "${column}"`);
    }
  }
});
