import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';

const scenario = { title:'Cafe', description:'Order coffee', opening:'Hello!', openingKo:'안녕하세요', hint:'A coffee, please.', hintKo:'커피 주세요' };
const turn = { reply:'Would you like milk?', translation:'우유를 넣을까요?', hint:'Yes, please.', hintKo:'네 주세요', goalReached:false };
const upstream = (data=turn, status=200, finishReason='STOP') => new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(data)}]}}]}),{status});
async function setup(t, fetchImpl=async()=>upstream(), options={geminiApiKey:'server-key'}) {
  const server=createApp({fetchImpl,...options}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call = (requestPath, body, method = body ? 'POST' : 'GET', headers = {}) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const request = http.request(base + requestPath, {
      method,
      headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, body: JSON.parse(text) });
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
  const play=(messages=[],action='start')=>call('/api/roleplay',{action,scenario,level:'beginner',messages});
  return {server,base,call,play};
}
test('settings mutation endpoints are gone and do not configure AI',async t=>{
 let calls=0;const a=await setup(t,async()=>{calls++;return upstream();});
 assert.equal((await a.call('/api/settings',{apiKey:'browser-key',freeTierConfirmed:true})).status,404);
 assert.equal((await a.call('/api/settings',null,'DELETE')).status,404);
 const r=await a.play([], 'start');
 assert.equal(r.status,200);
 assert.equal(calls,1);
});
test('loopback, origin, content type and static allowlist guards',async t=>{
 const a=await setup(t);
 const hostStatus=await new Promise((resolve,reject)=>http.get(a.base+'/api/status',{headers:{Host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));
 assert.equal(hostStatus,400);
 assert.equal((await a.call('/api/settings',{apiKey:'x',freeTierConfirmed:true},'POST',{Origin:'https://evil.test'})).status,400);
 assert.equal((await a.call('/api/roleplay',{apiKey:'x'},'POST',{'Content-Type':'text/plain'})).status,400);
 for(const path of ['/.env','/.git/config','/server.mjs']) assert.equal((await a.call(path)).status,404);
 assert.equal(await new Promise((resolve, reject) => http.get(a.base + '/', response => { response.resume(); resolve(response.statusCode); }).on('error', reject)), 200);
});
test('history and fixed generation settings are preserved; early goal is suppressed',async t=>{
 let sent;const a=await setup(t,async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return upstream({...turn,goalReached:true});});
 const messages=[{role:'model',text:'Hello!'},{role:'user',text:'I want coffee.'}];
 const r=await a.play(messages,'reply');assert.equal(r.status,200);assert.equal(r.body.goalReached,false);
 assert.deepEqual(sent.body.contents.slice(1).map(m=>({role:m.role,text:m.parts[0].text})),messages);
 assert.match(sent.url,/gemini-3\.5-flash-lite:generateContent$/);assert.equal(sent.init.headers['x-goog-api-key'],'server-key');
 assert.equal(sent.body.generationConfig.thinkingConfig,undefined);
 assert.equal(sent.body.generationConfig.responseMimeType,'application/json');
});
test('schema, finish reason and input validation reject unsafe results',async t=>{
 let result=upstream({reply:'bad'});let calls=0;const a=await setup(t,async()=>{calls++;return result;});
 assert.equal((await a.play()).status,502);result=upstream(turn,200,'MAX_TOKENS');assert.equal((await a.play()).status,502);
 assert.equal((await a.play([{role:'user',text:'wrong order'}],'reply')).status,400);assert.equal(calls,2);
});
test('review corrections quote only learner text',async t=>{
 const a=await setup(t,async()=>upstream({summary:'잘했어요',strength:'주문 성공',corrections:[{original:'I coffee',improved:'I want coffee.',explanation:'동사를 넣어요'},{original:'fabricated',improved:'x',explanation:'x'}],practice:['I want coffee.']}));
 const r=await a.play([{role:'model',text:'Hello'},{role:'user',text:'I coffee'}],'review');assert.equal(r.status,200);assert.equal(r.body.corrections.length,1);
});
test('quota latches limited mode without exposing upstream details',async t=>{
 let calls=0;const a=await setup(t,async()=>{calls++;return new Response('SECRET upstream',{status:429});});
 assert.equal((await a.play()).status,429);assert.equal((await a.play()).status,429);assert.equal(calls,1);
 const statusResponse=(await a.call('/api/status')).body;
 assert.equal(statusResponse.ai.status,'limited');
 assert.equal(statusResponse.quotaBlocked,true);
 const r=await a.play();assert.equal(r.status,429);assert.equal(r.body.error.code,'QUOTA_EXCEEDED');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.equal(calls,1);
});
test('only one request runs and body API keys are ignored',async t=>{
 let sentKey;let release;const a=await setup(t,(_url,init)=>{sentKey=init.headers['x-goog-api-key'];return new Promise(r=>{release=r;});});const pending=a.call('/api/roleplay',{action:'start',scenario,level:'beginner',messages:[],apiKey:'browser-key'});
 while(!release) await new Promise(r=>setTimeout(r,5));assert.equal((await a.play()).body.error.code,'BUSY');release(upstream());await pending;
 assert.equal(sentKey,'server-key');
});
test('upstream timeout aborts and returns friendly timeout',async t=>{
 const a=await setup(t,(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))),{timeoutMs:20,geminiApiKey:'server-key'});assert.equal((await a.play()).status,504);
});
test('missing origin, oversized bodies and turn bounds make zero upstream calls',async t=>{
 let calls=0;const a=await setup(t,async()=>{calls++;return upstream();});
 const absentStatus = await new Promise((resolve, reject) => { const request = http.request(a.base + '/api/roleplay', { method:'POST', headers:{'Content-Type':'application/json'} }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(JSON.stringify({action:'start',scenario,level:'beginner',messages:[]})); }); assert.equal(absentStatus,400);
 assert.equal((await a.call('/api/roleplay',{action:'start',scenario:{...scenario,title:'x'.repeat(33000)},level:'beginner',messages:[]})).status,400);
 assert.equal((await a.play(Array.from({length:14},(_,i)=>({role:i%2?'user':'model',text:'hello'})),'reply')).status,400);assert.equal(calls,0);
});
test('six learner replies force completion',async t=>{
 const a=await setup(t);const messages=Array.from({length:12},(_,i)=>({role:i%2?'user':'model',text:'Hello'}));
 assert.equal((await a.play(messages,'reply')).body.goalReached,true);
});
test('client disconnect aborts upstream request',async t=>{
 let began;const ready=new Promise(r=>{began=r;});let aborted;
 const stopped=new Promise(r=>{aborted=r;});
 const a=await setup(t,(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted();reject(signal.reason);});began();}));
 const request=http.request(a.base+'/api/roleplay',{method:'POST',headers:{Origin:a.base,'Content-Type':'application/json'}});request.on('error',()=>{});
 request.end(JSON.stringify({action:'start',scenario,level:'beginner',messages:[]}));await ready;request.destroy();
 await Promise.race([stopped,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('disconnect did not abort')),1000);timer.unref();})]);
});

test('blocked safety ratings are rejected even with STOP',async t=>{
 const a=await setup(t,async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',safetyRatings:[{blocked:true}],content:{parts:[{text:JSON.stringify(turn)}]}}]})));assert.equal((await a.play()).status,502);
});


test('start instruction persists at the front of subsequent histories', async t => {
  const requests = [];
  const a = await setup(t, async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return upstream();
  });
  await a.play();
  const messages = [{role:'model',text:'Hello!'}, {role:'user',text:'Coffee please.'}];
  await a.play(messages, 'reply');
  await a.play(messages, 'review');
  assert.equal(requests[0].contents[0].role, 'user');
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.contents[0], requests[0].contents[0]);
    assert.equal(request.contents[1].role, 'model');
    assert.equal(request.contents[2].parts[0].text, 'Coffee please.');
  }
});

test('sixth reply prompt closes without inviting another learner turn', async t => {
  let prompt;
  const a = await setup(t, async (_url, init) => {
    prompt = JSON.parse(init.body).systemInstruction.parts[0].text;
    return upstream();
  });
  await a.play(Array.from({length:12}, (_,i) => ({role:i%2?'user':'model',text:'Hello'})), 'reply');
  assert.match(prompt, /no further question/i);
  assert.doesNotMatch(prompt, /one closing question/i);
});

test('missing server key reports limited status and roleplay fallback error', async t => {
  let calls = 0;
  const a = await setup(t, async () => { calls++; return upstream(); }, { geminiApiKey: '' });
  const status = (await a.call('/api/status')).body;
  assert.equal(status.configured, false);
  assert.equal(status.ai.status, 'limited');
  assert.equal(status.ai.reason, 'not_configured');
  const result = await a.play();
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('process environment key configures AI when no injected key is provided', async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'env-key';
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
  let sentKey;
  const a = await setup(t, async (_url, init) => {
    sentKey = init.headers['x-goog-api-key'];
    return upstream();
  }, {});
  assert.equal((await a.call('/api/status')).body.ai.status, 'available');
  assert.equal((await a.play()).status, 200);
  assert.equal(sentKey, 'env-key');
});

test('local mock auth session invite and logout flow works without Supabase', async t => {
  // Given
  const a = await setup(t);
  const admin = (await a.call('/api/auth/login', { email: 'owner@example.com', password: 'owner-pass' })).body.session.token;

  // When
  const created = await a.call('/api/admin/invites', { maxUses: 1 }, 'POST', { Authorization: `Bearer ${admin}` });
  const signup = await a.call('/api/auth/signup', {
    email: 'learner@example.com',
    password: 'pass1234',
    displayName: 'Learner',
    inviteCode: created.body.code,
  });
  const session = await a.call('/api/session', null, 'GET', { Authorization: `Bearer ${signup.body.session.token}` });
  const login = await a.call('/api/auth/login', { email: 'learner@example.com', password: 'pass1234' });
  const afterLogout = await a.call('/api/auth/logout', null, 'POST', { Authorization: `Bearer ${login.body.session.token}` });

  // Then
  assert.equal(created.status, 200);
  assert.equal(signup.status, 200);
  assert.equal(session.body.user.email, 'learner@example.com');
  assert.equal(session.body.user.displayName, 'Learner');
  assert.equal(session.body.user.role, 'user');
  assert.equal(login.status, 200);
  assert.equal(afterLogout.status, 200);
  assert.equal((await a.call('/api/session', null, 'GET', { Authorization: `Bearer ${login.body.session.token}` })).status, 401);
});

test('local mock progress rewards and admin claim updates are deterministic', async t => {
  // Given
  const a = await setup(t);
  const admin = (await a.call('/api/auth/login', { email: 'owner@example.com', password: 'owner-pass' })).body.session.token;
  const invite = await a.call('/api/admin/invites', { maxUses: 1 }, 'POST', { Authorization: `Bearer ${admin}` });
  const signup = await a.call('/api/auth/signup', {
    email: 'reward@example.com',
    password: 'pass1234',
    displayName: 'Reward User',
    inviteCode: invite.body.code,
  });
  const token = signup.body.session.token;

  // When
  const progress = await a.call('/api/progress/activity', {
    clientEventId: 'curriculum:reward-1',
    kind: 'curriculum',
    sourceId: 'reward-1',
    xpDelta: 120,
    occurredAt: '2026-09-04T00:00:00.000Z',
  }, 'POST', { Authorization: `Bearer ${token}` });
  const rewards = await a.call('/api/rewards', null, 'GET', { Authorization: `Bearer ${token}` });
  const claim = await a.call('/api/rewards/claim', { ruleId: 'coffee_100' }, 'POST', { Authorization: `Bearer ${token}` });
  const updated = await a.call(`/api/admin/claims/${claim.body.claim.id}`, { status: 'approved', adminNote: 'ready' }, 'PATCH', { Authorization: `Bearer ${admin}` });

  // Then
  assert.equal(progress.status, 200);
  assert.equal(progress.body.awarded, true);
  assert.equal(progress.body.progress.xp, 120);
  assert.equal(rewards.body.summary.xp, 120);
  assert.equal(rewards.body.rules.find(rule => rule.id === 'coffee_100').eligible, true);
  assert.equal(claim.status, 200);
  assert.equal(updated.body.claim.status, 'approved');
  assert.equal((await a.call('/api/admin/claims', null, 'GET', { Authorization: `Bearer ${admin}` })).body.claims.length, 1);
});

test('local mock progress import migrates local XP once and then blocks re-import', async t => {
  // Given
  const a = await setup(t);
  const admin = (await a.call('/api/auth/login', { email: 'owner@example.com', password: 'owner-pass' })).body.session.token;
  const invite = await a.call('/api/admin/invites', { maxUses: 1 }, 'POST', { Authorization: `Bearer ${admin}` });
  const signup = await a.call('/api/auth/signup', {
    email: 'migrate@example.com',
    password: 'pass1234',
    displayName: 'Migrate User',
    inviteCode: invite.body.code,
  });
  const token = signup.body.session.token;
  const localProgress = {
    version: 1,
    progress: {
      xp: 240,
      rewardedIds: ['curriculum:1', 'flashcard:2'],
      activityDates: ['2026-09-02', '2026-09-03'],
      currentStreak: 2,
      longestStreak: 2,
      lastActivityDate: '2026-09-03',
      unlockedBadges: ['first_step'],
      curriculumCount: 1,
      roleplayCount: 0,
      flashcardCount: 1,
    },
  };

  // When
  const imported = await a.call('/api/progress/import', localProgress, 'POST', { Authorization: `Bearer ${token}` });
  const repeated = await a.call('/api/progress/import', localProgress, 'POST', { Authorization: `Bearer ${token}` });
  const session = await a.call('/api/session', null, 'GET', { Authorization: `Bearer ${token}` });

  // Then
  assert.equal(imported.status, 200);
  assert.equal(imported.body.summary.xp, 240);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error.code, 'ALREADY_IMPORTED');
  assert.equal(session.body.user.localProgressImportedAt !== null, true);
});
