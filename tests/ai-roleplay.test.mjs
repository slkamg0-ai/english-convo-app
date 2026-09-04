import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function core() {
  const context = vm.createContext({ AbortController, Date });
  vm.runInContext(await readFile(new URL('../ai-roleplay-core.js', import.meta.url), 'utf8'), context);
  return vm.runInContext('AIRoleplayCore', context);
}
const scenario = { title: '호텔 체크인', description: 'Check in', opening: 'Welcome!', openingKo: '환영합니다', hint: 'I have a reservation.', hintKo: '예약했어요' };
const turn = (reply = 'How many nights?', goalReached = false) => ({ reply, translation: '몇 박인가요?', hint: 'Two nights.', hintKo: '이틀이요.', goalReached });

test('conversation retains full context and blocks duplicate submissions', async () => {
  const { createSession } = await core();
  const calls = [];
  let resolveReply;
  const session = createSession({ request: async (body) => { calls.push(body); return body.action === 'start' ? turn() : new Promise(resolve => { resolveReply = resolve; }); } });
  await session.start(scenario, 'hotel', 'beginner');
  const pending = session.send('Two nights.');
  await session.send('Duplicate');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages[0].text, 'How many nights?');
  assert.equal(calls[1].messages[1].text, 'Two nights.');
  resolveReply(turn('Breakfast is included.'));
  await pending;
  assert.equal(session.state.messages.length, 3);
  assert.equal(session.state.turnCount, 1);
});

test('late response cannot resurrect a cancelled or replaced scenario', async () => {
  const { createSession } = await core();
  let finish;
  const session = createSession({ request: () => new Promise(resolve => { finish = resolve; }) });
  const pending = session.start(scenario, 'hotel', 'beginner');
  session.cancel();
  finish(turn());
  await pending;
  assert.equal(session.state.phase, 'idle');
  assert.equal(session.state.messages.length, 0);
});

test('failed answer retries explicitly without duplicating history', async () => {
  const { createSession } = await core();
  let count = 0;
  const calls = [];
  const session = createSession({ request: async body => { calls.push(body); if (++count === 2) throw Object.assign(new Error('offline'), { code: 'NETWORK' }); return turn(); } });
  await session.start(scenario, 'hotel', 'beginner');
  await session.send('Two nights.');
  assert.equal(session.state.phase, 'error');
  assert.equal(session.state.messages.length, 1);
  await session.retry();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].messages.length, 2);
  assert.equal(session.state.messages.length, 3);
});

test('six learner replies end conversation; review remains explicit', async () => {
  const { createSession } = await core();
  const session = createSession({ request: async body => body.action === 'review' ? { summary: '잘했어요', strength: '목적 전달', corrections: [], practice: ['Two nights, please.'] } : turn() });
  await session.start(scenario, 'hotel', 'beginner');
  for (let i = 0; i < 6; i++) await session.send(`Answer ${i}`);
  assert.equal(session.state.phase, 'ready-review');
  assert.equal(session.state.turnCount, 6);
  await session.send('Another answer');
  assert.equal(session.state.turnCount, 6);
  await session.finish();
  assert.equal(session.state.phase, 'review');
  assert.equal(session.state.review.summary, '잘했어요');
});

test('quota failures do not auto retry and cannot be retried by retry action', async () => {
  const { createSession } = await core();
  let calls = 0;
  const session = createSession({ request: async () => { calls++; throw Object.assign(new Error('한도 초과'), { code: 'QUOTA_EXCEEDED' }); } });
  await session.start(scenario, 'hotel', 'beginner');
  await session.retry();
  assert.equal(calls, 1);
  assert.equal(session.state.phase, 'error');
});

test('corrupted saved review storage is safe and does not store credentials', async () => {
  const { readReviews, saveReview } = await core();
  let value = 'not json';
  const storage = { getItem: () => value, setItem: (_, data) => { value = data; } };
  assert.equal(readReviews(storage).length, 0);
  const record = { id: 'test-session', scenarioKey: 'hotel', title: '호텔', date: '2026-09-03T00:00:00.000Z', level: 'beginner', review: { summary: '잘했어요', strength: '인사', corrections: [], practice: ['Hello.'] }, apiKey: 'must-not-save' };
  saveReview(storage, record);
  saveReview(storage, record);
  assert.equal(readReviews(storage).length, 1);
  assert.equal(value.includes('must-not-save'), false);
  for (let i = 0; i < 25; i++) saveReview(storage, { ...record, id: `s${i}` });
  assert.equal(readReviews(storage).length, 20);
});
