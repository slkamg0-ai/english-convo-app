const AIRoleplayReviews = (() => {
  function create({ el, textNode, say, restart, reward }) {
    const savedSessions = new Set();

    function content(review, container) {
      container.replaceChildren();
      container.append(textNode('p', review.summary), textNode('p', `잘한 점: ${review.strength}`, 'ai-strength'));
      if (!review.corrections.length) container.append(textNode('p', '이번 대화에서는 꼭 고칠 표현이 없어요. 아래 표현으로 한 번 더 연습해보세요.', 'note'));
      review.corrections.forEach(item => {
        const card = textNode('div', '', 'ai-correction');
        card.append(textNode('span', '내가 말한 문장', 'ai-speaker'));
        const original = textNode('p', item.original);
        original.lang = 'en';
        const improved = textNode('p', item.improved, 'ai-improved');
        improved.lang = 'en';
        const listen = textNode('button', '교정 문장 듣기', 'secondary-btn');
        listen.type = 'button';
        listen.addEventListener('click', () => say(item.improved));
        card.append(original, textNode('span', '이렇게 말해보세요', 'ai-speaker'), improved, textNode('p', item.explanation, 'note'), listen);
        container.append(card);
      });
      if (review.practice.length) {
        container.append(textNode('h4', '다음 대화에 써볼 표현'));
        const list = document.createElement('ul');
        review.practice.forEach(value => {
          const item = textNode('li', value);
          item.lang = 'en';
          list.append(item);
        });
        container.append(list);
      }
    }

    function renderSaved() {
      const list = el('ai-saved-list');
      list.replaceChildren();
      let records = [];
      try { records = AIRoleplayCore.readReviews(localStorage); } catch { /* Storage can be disabled. */ }
      el('ai-clear-reviews').disabled = records.length === 0;
      if (!records.length) {
        list.append(textNode('p', 'AI 대화를 마치면 나만의 복습 노트가 여기에 쌓입니다.', 'note'));
        return;
      }
      records.forEach(record => {
        const details = document.createElement('details');
        const date = new Date(record.date);
        details.append(textNode('summary', `${record.title} · ${Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR')}`));
        const body = document.createElement('div');
        content(record.review, body);
        const button = textNode('button', '이 상황 다시 연습', 'secondary-btn');
        button.type = 'button';
        button.addEventListener('click', () => restart(record.scenarioKey, record.review.corrections.map(item => item.improved).concat(record.review.practice).slice(0, 3), record.level));
        details.append(body, button);
        list.append(details);
      });
    }

    function persist(state) {
      if (savedSessions.has(state.sessionId)) return;
      savedSessions.add(state.sessionId);
      let saved = false;
      try {
        saved = AIRoleplayCore.saveReview(localStorage, { id: state.sessionId, scenarioKey: state.scenarioKey, title: state.scenario.title, date: new Date().toISOString(), level: state.level, review: state.review });
      } catch { /* Visible review remains available. */ }
      el('ai-save-status').textContent = saved ? '교정 표현을 이 브라우저에 저장했습니다.' : '브라우저 저장 공간을 사용할 수 없어 이번 복습은 화면에서만 볼 수 있습니다.';
      if (state.turnCount >= 3) reward(state.sessionId);
      renderSaved();
    }
    return { content, renderSaved, persist };
  }
  return { create };
})();
