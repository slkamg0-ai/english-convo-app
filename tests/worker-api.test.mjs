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
    throw new Error(`Unhandled mock URL: ${call.url}`);
  });
  const api = worker(fetchImpl);

  const response = await api.fetch(request('/api/auth/signup', {
    body: { email: 'new@test.local', password: 'secret123', displayName: 'Site Captain', inviteCode: 'JOIN-2026' },
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: { id: 'created-user', email: 'new@test.local' } });
  const redeemIndex = calls.findIndex(call => call.url.includes('/rest/v1/rpc/reserve_invite'));
  const authIndex = calls.findIndex(call => call.url.endsWith('/auth/v1/admin/users'));
  const profileIndex = calls.findIndex(call => call.url.includes('/rest/v1/profiles') && call.init.method === 'POST');
  assert.ok(redeemIndex > -1 && redeemIndex < authIndex && authIndex < profileIndex);
  assert.equal(calls[redeemIndex].body.invite_code_hash.length, 64);
  const profileInsert = calls.find(call => call.url.includes('/rest/v1/profiles') && call.init.method === 'POST');
  assert.deepEqual(profileInsert.body, { user_id: 'created-user', display_name: 'Site Captain', role: 'user' });
  assert.ok(calls.every(call => !JSON.stringify(call.body ?? {}).includes('JOIN-2026')));
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
  assert.deepEqual([adminBody, JSON.stringify(adminBody).includes('JOIN-2026'), userResponse.status], [{ invites }, false, 403]);
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

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { progress: { total_xp: 50, current_streak: 1 } });
  assert.equal(calls.find(call => call.url.includes('/rest/v1/rpc/record_activity')).body.xp_delta, 50);
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

test('Worker RPC names are defined in Supabase migration', async () => {
  const migration = await readFile(new URL('../supabase/migrations/0001_multi_user_rewards.sql', import.meta.url), 'utf8');

  for (const rpcName of ['record_activity', 'claim_reward', 'reserve_invite', 'release_invite', 'reserve_ai_usage']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpcName}\\b`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpcName}\\(`));
  }
});
