import { applyActivity, createEmptyProgress, rewardEligibility, summarizeProgress } from './progress-domain.mjs';

const REWARD_RULES = [
  { id: 'coffee_100', label: '커피 쿠폰', description: '100 XP 달성 후 운영자 승인으로 전달', requiredXp: 100, active: true },
  { id: 'coffee_300', label: '커피 쿠폰+', description: '300 XP 달성 보상', requiredXp: 300, active: true },
  { id: 'review_700', label: '1:1 표현 점검', description: '700 XP 달성 후 수동 일정 조율', requiredXp: 700, active: true },
];
const ADMIN = { id: 'admin-local', email: 'owner@example.com', password: 'owner-pass', displayName: 'Owner', role: 'admin' };

function token() {
  return `local-${crypto.randomUUID()}`;
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, localProgressImportedAt: user.localProgressImportedAt || null };
}

export function createLocalMockApi() {
  const users = new Map([[ADMIN.email, { ...ADMIN, progress: createEmptyProgress(), localProgressImportedAt: null }]]);
  const sessions = new Map();
  const invites = [{ id: 'invite-open', code: 'LAKE-LOCAL', maxUses: 20, uses: 0, expiresAt: null, createdBy: ADMIN.id, createdAt: new Date(0).toISOString() }];
  const claims = [];

  function sessionFrom(request) {
    const header = request.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const userId = match ? sessions.get(match[1]) : null;
    if (!userId) return null;
    return [...users.values()].find((user) => user.id === userId) || null;
  }

  function issue(user) {
    const next = token();
    sessions.set(next, user.id);
    return { token: next };
  }

  function rewardsFor(user) {
    const summary = summarizeProgress(user.progress);
    const eligibility = rewardEligibility(summary, REWARD_RULES, claims.filter((claim) => claim.userId === user.id));
    const rules = REWARD_RULES.map((rule) => ({ ...rule, ...eligibility.find((item) => item.id === rule.id) }));
    return { summary, rules, claims: claims.filter((claim) => claim.userId === user.id).map(({ userId, ...claim }) => claim) };
  }

  function requireUser(request) {
    const user = sessionFrom(request);
    if (!user) return { status: 401, body: { error: { code: 'UNAUTHORIZED' } } };
    return { user };
  }

  function requireAdmin(request) {
    const auth = requireUser(request);
    if (auth.body) return auth;
    if (auth.user.role !== 'admin') return { status: 403, body: { error: { code: 'FORBIDDEN' } } };
    return auth;
  }

  async function handle(pathname, req, readJson) {
    if (pathname === '/api/session' && req.method === 'GET') {
      const auth = requireUser(req);
      if (auth.body) return auth;
      return { status: 200, body: { user: publicUser(auth.user), session: { active: true } } };
    }
    if (pathname === '/api/auth/signup' && req.method === 'POST') {
      const body = await readJson(req);
      const code = String(body.inviteCode || '').trim().toUpperCase();
      const invite = invites.find((item) => item.code === code && item.uses < item.maxUses);
      if (!invite || users.has(body.email)) return { status: 403, body: { error: { code: 'INVITE_UNAVAILABLE' } } };
      invite.uses += 1;
      const user = { id: `user-${users.size}`, email: body.email, password: body.password, displayName: body.displayName || body.email, role: 'user', progress: createEmptyProgress(), localProgressImportedAt: null };
      users.set(user.email, user);
      return { status: 200, body: { user: publicUser(user), session: issue(user) } };
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      const user = users.get(body.email);
      if (!user || user.password !== body.password) return { status: 401, body: { error: { code: 'UNAUTHORIZED' } } };
      return { status: 200, body: { user: publicUser(user), session: issue(user) } };
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const header = req.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (match) sessions.delete(match[1]);
      return { status: 200, body: { ok: true } };
    }
    if ((pathname === '/api/progress' && req.method === 'GET') || (pathname === '/api/rewards' && req.method === 'GET')) {
      const auth = requireUser(req);
      if (auth.body) return auth;
      return { status: 200, body: rewardsFor(auth.user) };
    }
    if (pathname === '/api/progress/activity' && req.method === 'POST') {
      const auth = requireUser(req);
      if (auth.body) return auth;
      const result = applyActivity(auth.user.progress, await readJson(req));
      auth.user.progress = result.progress;
      return { status: result.error ? 400 : 200, body: result };
    }
    if (pathname === '/api/progress/import' && req.method === 'POST') {
      const auth = requireUser(req);
      if (auth.body) return auth;
      if (auth.user.localProgressImportedAt) return { status: 409, body: { error: { code: 'ALREADY_IMPORTED' } } };
      const existingSummary = summarizeProgress(auth.user.progress);
      if (existingSummary.totalActivities > 0) return { status: 409, body: { error: { code: 'ALREADY_HAS_PROGRESS' } } };
      const body = await readJson(req);
      const progress = body.progress || {};
      if (!Number.isInteger(progress.xp) || progress.xp < 0 || !Number.isInteger(progress.currentStreak) || progress.currentStreak < 0) {
        return { status: 400, body: { error: { code: 'INVALID_REQUEST' } } };
      }
      auth.user.progress = {
        ...createEmptyProgress(),
        xp: progress.xp,
        rewardedIds: Array.isArray(progress.rewardedIds) ? progress.rewardedIds : [],
        activityDates: Array.isArray(progress.activityDates) ? progress.activityDates : [],
        currentStreak: progress.currentStreak,
        longestStreak: Number.isInteger(progress.longestStreak) ? progress.longestStreak : progress.currentStreak,
        lastActivityDate: progress.lastActivityDate || null,
        unlockedBadges: Array.isArray(progress.unlockedBadges) ? progress.unlockedBadges : [],
        curriculumCount: Number.isInteger(progress.curriculumCount) ? progress.curriculumCount : 0,
        roleplayCount: Number.isInteger(progress.roleplayCount) ? progress.roleplayCount : 0,
        flashcardCount: Number.isInteger(progress.flashcardCount) ? progress.flashcardCount : 0,
      };
      auth.user.localProgressImportedAt = new Date().toISOString();
      return { status: 200, body: { summary: summarizeProgress(auth.user.progress) } };
    }
    if (pathname === '/api/rewards/claim' && req.method === 'POST') {
      const auth = requireUser(req);
      if (auth.body) return auth;
      const body = await readJson(req);
      const current = rewardsFor(auth.user).rules.find((rule) => rule.id === body.ruleId);
      if (!current?.eligible) return { status: 400, body: { error: { code: 'REWARD_UNAVAILABLE' } } };
      const claim = { id: `claim-${claims.length + 1}`, rewardRuleId: current.id, rewardLabel: current.label, status: 'pending', adminNote: '', createdAt: new Date().toISOString(), userId: auth.user.id, userEmail: auth.user.email, displayName: auth.user.displayName };
      claims.push(claim);
      return { status: 200, body: { claim: { ...claim, userId: undefined } } };
    }
    if (pathname === '/api/admin/invites') {
      const auth = requireAdmin(req);
      if (auth.body) return auth;
      if (req.method === 'GET') return { status: 200, body: { invites } };
      if (req.method === 'POST') {
        const body = await readJson(req);
        const invite = { id: `invite-${invites.length + 1}`, code: `LAKE-${String(invites.length + 1).padStart(4, '0')}`, maxUses: body.maxUses || 1, uses: 0, expiresAt: body.expiresAt || null, createdBy: auth.user.id, createdAt: new Date().toISOString() };
        invites.push(invite);
        return { status: 200, body: { code: invite.code, invite } };
      }
    }
    if (pathname === '/api/admin/claims' && req.method === 'GET') {
      const auth = requireAdmin(req);
      if (auth.body) return auth;
      return { status: 200, body: { claims } };
    }
    const claimMatch = /^\/api\/admin\/claims\/([^/]+)$/.exec(pathname);
    if (claimMatch && req.method === 'PATCH') {
      const auth = requireAdmin(req);
      if (auth.body) return auth;
      const claim = claims.find((item) => item.id === claimMatch[1]);
      if (!claim) return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
      const body = await readJson(req);
      claim.status = body.status;
      claim.adminNote = body.adminNote || '';
      claim.reviewedAt = new Date().toISOString();
      return { status: 200, body: { claim } };
    }
    return null;
  }

  return { handle };
}
