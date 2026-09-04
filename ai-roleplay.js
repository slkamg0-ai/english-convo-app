(() => {
  const el = id => document.getElementById(id);
  const panel = el('ai-play');
  const api = (path, options) => AIRoleplayConnection.request(path, options);
  let session;
  const speech = AIRoleplaySpeech.create({ el, getSession: () => session, submit: value => submitAnswer(value) });
  const reviews = AIRoleplayReviews.create({ el, textNode, say: (...args) => speech.say(...args), restart: (...args) => start(...args), reward: sessionId => { try { handleActivityResult(recordActivity(`ai-roleplay:${sessionId}`, 8, 'roleplay')); } catch { el('ai-save-status').textContent += ' 학습 성과를 저장하지 못했습니다.'; } } });
  let connection = { configured: false, quotaBlocked: false };
  let serverAvailable = false;
  let selectedKey = null;
  let lastRenderedReply = '';

  function textNode(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderConnection(message) {
    el('ai-connection-status').textContent = message || (connection.quotaBlocked
      ? '무료 사용 한도에 도달해 AI 호출을 중단했습니다. 기본 상황극을 이용해주세요.'
      : connection.configured ? 'AI 연결 준비됨 · 운영자 설정으로 대화합니다.'
        : 'AI 연결 전입니다. 운영자 서버 설정이 준비되면 사용할 수 있습니다.');
  }

  async function refreshConnection() {
    try {
      connection = await api('/api/status');
      serverAvailable = true;
      renderConnection();
    } catch (error) {
      serverAvailable = false;
      renderConnection(error.message);
    }
  }

  document.querySelectorAll('input[name="roleplay-mode"]').forEach(input => {
    input.addEventListener('change', () => {
      el('ai-level').disabled = !isSelected();
    });
  });
  el('ai-level').disabled = true;

  function renderSession(state) {
    if (state.phase === 'idle') return;
    const busy = state.phase === 'waiting';
    const canReply = state.phase === 'active';
    const completed = state.phase === 'review';
    if (busy || state.phase === 'error' || completed) speech.stop();
    el('ai-scenario-title').textContent = state.scenario.title;
    el('ai-session-info').textContent = `${state.level === 'beginner' ? '초급' : '중급'} · 내 답변 ${state.turnCount} / ${AIRoleplayCore.MAX_TURNS}회 · 대화 후 함께 복습해요`;
    el('ai-messages').replaceChildren();
    state.messages.forEach(message => {
      const li = textNode('li', '', `ai-message ai-message-${message.role}`);
      li.append(textNode('span', message.role === 'user' ? '나' : '상대방', 'ai-speaker'));
      const content = textNode('p', message.text); content.lang = 'en'; li.append(content);
      el('ai-messages').append(li);
    });
    if (state.pendingText) {
      const pending = textNode('li', '', 'ai-message ai-message-user ai-pending');
      pending.append(textNode('span', busy ? '나 · 보내는 중' : '나 · 아직 반영되지 않은 답변', 'ai-speaker'), textNode('p', state.pendingText));
      el('ai-messages').append(pending);
    }
    el('ai-status').textContent = state.error?.message || (busy ? state.action === 'review' ? '대화에서 복습할 표현을 정리하고 있어요…' : '상대방이 답변을 준비하고 있어요…' : state.phase === 'ready-review' ? '대화를 마쳤어요. 복습에서 내 표현을 돌아보세요.' : completed ? '이번 연습을 마쳤습니다.' : '상대방에게 자유롭게 답해주세요.');
    el('ai-status').classList.toggle('ai-error', state.phase === 'error');
    if (state.error?.code === 'QUOTA_EXCEEDED') { connection.quotaBlocked = true; renderConnection(); }
    el('ai-answer').disabled = !canReply;
    el('ai-send').disabled = !canReply;
    el('ai-mic').disabled = !canReply;
    el('ai-handsfree').disabled = !canReply;
    el('ai-finish').disabled = busy || completed || state.turnCount < 1 || connection.quotaBlocked;
    el('ai-finish').classList.toggle('hidden', completed);
    el('ai-retry').classList.toggle('hidden', state.phase !== 'error' || ['QUOTA_EXCEEDED', 'NOT_CONFIGURED', 'INVALID_KEY', 'LOCAL_SERVER'].includes(state.error?.code));
    el('ai-input-area').classList.toggle('hidden', completed || state.phase === 'ready-review');
    el('ai-assistance').classList.toggle('hidden', !state.reply || completed);
    el('ai-replay').disabled = busy;
    el('ai-slow').disabled = busy;
    if (state.reply) {
      el('ai-translation-text').textContent = state.reply.translation;
      el('ai-hint-text').textContent = state.reply.hint;
      el('ai-hint-ko').textContent = state.reply.hintKo;
    }
    el('ai-review').classList.toggle('hidden', !completed);
    if (completed) { reviews.content(state.review, el('ai-review-content')); reviews.persist(state); }
    const replyId = `${state.sessionId}:${state.messages.length}`;
    if (!busy && !state.error && state.reply && !completed && !document.hidden && replyId !== lastRenderedReply) {
      lastRenderedReply = replyId;
      el('ai-translation').open = false;
      el('ai-hint').open = false;
      el('ai-mic-status').textContent = (window.SpeechRecognition || window.webkitSpeechRecognition) ? '' : '이 브라우저에서는 음성인식이 지원되지 않습니다. 텍스트로 답변해주세요.';
      el('ai-messages').scrollTop = el('ai-messages').scrollHeight;
      if (el('ai-autoplay').checked) speech.say(state.reply.reply, 0.95, canReply);
      else if (canReply && el('ai-handsfree').checked) setTimeout(() => speech.listen(), 350);
    }
  }

  session = AIRoleplayCore.createSession({ request: (body, signal) => api('/api/roleplay', { method: 'POST', body, signal }), onChange: renderSession, makeId: () => crypto.randomUUID() });

  function isSelected() { return document.querySelector('input[name="roleplay-mode"]:checked')?.value === 'ai'; }

  function leave() {
    speech.stop();
    el('ai-handsfree').checked = false;
    session.cancel();
    panel.classList.add('hidden');
    el('scenario-play').classList.add('hidden');
    el('ai-controls').classList.remove('hidden');
    el('ai-saved').classList.remove('hidden');
    el('scenario-select').classList.remove('hidden');
    selectedKey = null;
  }

  async function start(key, retryExpressions = [], level = el('ai-level').value) {
    if (!SCENARIOS[key]) return;
    speech.stop();
    if (!connection.configured || connection.quotaBlocked || !serverAvailable) {
      renderConnection();
      el('ai-connection-status').textContent = !serverAvailable ? '서버 연결을 확인하지 못했습니다. 인터넷 연결을 확인해주세요.' : connection.quotaBlocked ? '한도가 회복된 뒤 다시 시도해주세요. 기본 상황극은 계속 사용할 수 있습니다.' : '운영자 Gemini 연결이 아직 준비되지 않았습니다. 기본 상황극을 선택하세요.';
      return;
    }
    selectedKey = key;
    lastRenderedReply = '';
    document.querySelector('input[name="roleplay-mode"][value="ai"]').checked = true;
    const scenario = SCENARIOS[key];
    const opening = scenario.nodes[scenario.startNode];
    const hint = opening.options[0];
    el('ai-controls').classList.add('hidden');
    el('ai-saved').classList.add('hidden');
    el('scenario-select').classList.add('hidden');
    el('scenario-play').classList.add('hidden');
    panel.classList.remove('hidden');
    el('ai-answer').value = '';
    el('ai-handsfree').checked = false;
    el('ai-retry-goal').textContent = retryExpressions.length ? `이번에 써볼 표현: ${retryExpressions.join(' / ')}` : '';
    el('ai-retry-goal').classList.toggle('hidden', !retryExpressions.length);
    await session.start({ title: scenario.title, description: scenario.description, opening: opening.npc, openingKo: opening.npcKo || '', hint: hint?.hint || '', hintKo: hint?.hintKo || '' }, key, level, retryExpressions);
  }

  async function submitAnswer(value) {
    if (session.state.phase !== 'active' || !value.trim()) return;
    speech.stop();
    el('ai-answer').value = '';
    await session.send(value);
  }

  el('ai-answer-form').addEventListener('submit', event => { event.preventDefault(); submitAnswer(el('ai-answer').value); });
  el('ai-mic').addEventListener('click', () => { if (speech.isListening()) { el('ai-handsfree').checked = false; speech.stop(); el('ai-mic-status').textContent = '마이크를 멈췄습니다.'; } else speech.listen(); });
  el('ai-handsfree').addEventListener('change', () => { if (el('ai-handsfree').checked) speech.listen(); else speech.stopListening(); });
  el('ai-autoplay').addEventListener('change', () => { if (!el('ai-autoplay').checked) speech.stop(); });
  el('ai-replay').addEventListener('click', () => { if (session.state.reply) speech.say(session.state.reply.reply); });
  el('ai-slow').addEventListener('click', () => { if (session.state.reply) speech.say(session.state.reply.reply, 0.75); });
  el('ai-finish').addEventListener('click', () => { speech.stop(); el('ai-handsfree').checked = false; session.finish(); });
  el('ai-retry').addEventListener('click', () => session.retry());
  el('ai-back').addEventListener('click', () => { leave(); refreshConnection(); });
  el('ai-fallback').addEventListener('click', () => { const key = selectedKey; leave(); document.querySelector('input[name="roleplay-mode"][value="scripted"]').checked = true; el('ai-level').disabled = true; if (key) startScenario(key, true); });
  el('ai-practice-again').addEventListener('click', () => { const state = session.state; if (state.review) start(state.scenarioKey, state.review.corrections.map(item => item.improved).concat(state.review.practice).slice(0, 3), state.level); });
  el('ai-clear-reviews').addEventListener('click', () => {
    if (!window.confirm('이 브라우저에 저장된 AI 복습 노트를 지울까요? 기존 학습 성과는 유지됩니다.')) return;
    try { localStorage.removeItem(AIRoleplayCore.REVIEW_KEY); reviews.renderSaved(); }
    catch { el('ai-saved-list').append(textNode('p', '저장 공간에 접근하지 못해 기록을 지우지 못했습니다.', 'note')); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { el('ai-handsfree').checked = false; speech.stop(); } });
  window.addEventListener('pagehide', () => { speech.stop(); session.cancel(); });
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    el('ai-mic').classList.add('hidden');
    el('ai-handsfree').parentElement.classList.add('hidden');
    el('ai-mic-status').textContent = '이 브라우저에서는 음성인식이 지원되지 않습니다. 텍스트로 답변해주세요.';
  }
  window.AIRoleplay = { start, leave, pause: leave, isSelected };
  reviews.renderSaved();
  refreshConnection();
})();
