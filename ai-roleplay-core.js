const AIRoleplayCore = (() => {
  const REVIEW_KEY = 'englishConvoApp.aiReviews.v1';
  const MAX_TURNS = 6;

  function validReview(value) {
    return value && typeof value.summary === 'string' && typeof value.strength === 'string'
      && Array.isArray(value.corrections) && value.corrections.length <= 3
      && value.corrections.every(item => item && ['original', 'improved', 'explanation'].every(key => typeof item[key] === 'string' && item[key].length <= 2000))
      && Array.isArray(value.practice) && value.practice.length <= 3
      && value.practice.every(item => typeof item === 'string' && item.length <= 1000);
  }

  function validRecord(value) {
    return value && ['id', 'scenarioKey', 'title', 'date', 'level'].every(key => typeof value[key] === 'string') && validReview(value.review);
  }

  function readReviews(storage) {
    try {
      const values = JSON.parse(storage.getItem(REVIEW_KEY) || '[]');
      return Array.isArray(values) ? values.filter(validRecord).slice(0, 20) : [];
    } catch { return []; }
  }

  function saveReview(storage, record) {
    if (!validRecord(record)) return false;
    const { id, scenarioKey, title, date, level } = record;
    const review = {
      summary: record.review.summary,
      strength: record.review.strength,
      corrections: record.review.corrections.map(({ original, improved, explanation }) => ({ original, improved, explanation })),
      practice: [...record.review.practice],
    };
    try {
      const records = readReviews(storage).filter(value => value.id !== id);
      storage.setItem(REVIEW_KEY, JSON.stringify([{ id, scenarioKey, title, date, level, review }, ...records].slice(0, 20)));
      return true;
    } catch { return false; }
  }

  function createSession({ request, onChange = () => {}, makeId = () => `ai-${Date.now()}-${Math.random().toString(36).slice(2)}` }) {
    let controller = null;
    let revision = 0;
    let failedRequest = null;
    let state = emptyState();

    function emptyState() {
      return { phase: 'idle', messages: [], turnCount: 0, scenario: null, scenarioKey: '', level: 'beginner', retryExpressions: [], sessionId: '', reply: null, review: null, error: null, pendingText: '', action: null };
    }
    function change(patch) { state = { ...state, ...patch }; onChange(state); }
    function cancel() {
      revision++;
      controller?.abort();
      controller = null;
      failedRequest = null;
      state = emptyState();
      onChange(state);
    }
    async function perform(action, messages, pendingText = '') {
      if (state.phase === 'waiting') return;
      const currentRevision = revision;
      const nextController = new AbortController();
      controller = nextController;
      const body = { action, scenario: state.scenario, level: state.level, messages, retryExpressions: state.retryExpressions };
      failedRequest = { action, messages, pendingText };
      change({ phase: 'waiting', error: null, action, pendingText });
      try {
        const result = await request(body, nextController.signal);
        if (currentRevision !== revision) return;
        if (action === 'review') {
          if (!validReview(result)) throw new Error('복습 내용을 읽을 수 없습니다. 다시 시도해주세요.');
          change({ phase: 'review', review: result, pendingText: '', action: null });
        } else {
          if (!result || !['reply', 'translation', 'hint', 'hintKo'].every(key => typeof result[key] === 'string') || !result.reply.trim()) {
            throw new Error('AI 답변을 읽을 수 없습니다. 다시 시도해주세요.');
          }
          const turns = messages.filter(message => message.role === 'user').length;
          const nextMessages = [...messages, { role: 'model', text: result.reply }];
          change({
            phase: turns >= MAX_TURNS || (turns >= 3 && result.goalReached === true) ? 'ready-review' : 'active',
            messages: nextMessages, turnCount: turns, reply: result, pendingText: '', action: null,
          });
        }
        failedRequest = null;
      } catch (error) {
        if (currentRevision !== revision) return;
        change({ phase: 'error', error: { code: error.code || 'NETWORK', message: error.message || '연결을 확인해주세요.' }, action, pendingText });
      } finally {
        if (controller === nextController) controller = null;
      }
    }
    async function start(scenario, scenarioKey, level = 'beginner', retryExpressions = []) {
      cancel();
      state = { ...emptyState(), scenario, scenarioKey, level, retryExpressions: retryExpressions.slice(0, 3), sessionId: makeId() };
      await perform('start', []);
    }
    async function send(text) {
      const trimmed = String(text).trim();
      if (state.phase !== 'active' || !trimmed || trimmed.length > 1000 || state.turnCount >= MAX_TURNS) return;
      await perform('reply', [...state.messages, { role: 'user', text: trimmed }], trimmed);
    }
    async function finish() {
      if (state.phase === 'waiting' || state.phase === 'review' || state.turnCount < 1 || state.error?.code === 'QUOTA_EXCEEDED') return;
      await perform('review', [...state.messages]);
    }
    async function retry() {
      if (state.phase !== 'error' || !failedRequest || ['QUOTA_EXCEEDED', 'NOT_CONFIGURED', 'INVALID_KEY'].includes(state.error?.code)) return;
      const { action, messages, pendingText } = failedRequest;
      await perform(action, messages, pendingText);
    }
    return { get state() { return state; }, start, send, finish, retry, cancel };
  }

  return { createSession, readReviews, saveReview, validReview, REVIEW_KEY, MAX_TURNS };
})();
