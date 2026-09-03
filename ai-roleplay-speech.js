const AIRoleplaySpeech = (() => {
  function create({ el, getSession, submit }) {
    let recognition = null;
    let generation = 0;
    let listenTimer = null;

    function stopListening() {
      clearTimeout(listenTimer);
      const previous = recognition;
      recognition = null;
      previous?.abort();
      el('ai-mic').textContent = '눌러서 말하기';
      el('ai-mic').classList.remove('listening');
    }

    function stop() {
      generation++;
      stopListening();
      window.speechSynthesis?.cancel();
    }

    function say(text, rate = 0.95, autoListen = false) {
      stop();
      if (!('speechSynthesis' in window)) {
        el('ai-mic-status').textContent = '이 브라우저에서는 읽어주기를 사용할 수 없습니다. 대화 내용을 읽고 답해주세요.';
        return;
      }
      const token = generation;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = rate;
      try {
        const uri = localStorage.getItem('englishConvoApp.selectedVoiceURI');
        const voice = window.speechSynthesis.getVoices().find(item => item.voiceURI === uri && item.lang.startsWith('en'));
        if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      } catch { /* Reading still works when browser storage is unavailable. */ }
      utterance.onend = () => {
        if (token === generation && autoListen && el('ai-handsfree').checked && getSession().state.phase === 'active' && !document.hidden) {
          listenTimer = setTimeout(listen, 350);
        }
      };
      utterance.onerror = () => {
        if (token === generation) el('ai-mic-status').textContent = '읽어주기를 완료하지 못했습니다. 다시 듣거나 직접 답변해주세요.';
      };
      window.speechSynthesis.speak(utterance);
    }

    function listen() {
      const session = getSession();
      if (session.state.phase !== 'active' || document.hidden || el('ai-play').classList.contains('hidden') || recognition) return;
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) return;
      stop();
      const currentId = session.state.sessionId;
      const recorder = new Ctor();
      let received = false;
      recorder.lang = 'en-US';
      recorder.interimResults = false;
      recorder.maxAlternatives = 1;
      recognition = recorder;
      recorder.onresult = event => {
        const activeSession = getSession();
        if (recognition !== recorder || activeSession.state.sessionId !== currentId || activeSession.state.phase !== 'active') return;
        const text = event.results[0][0].transcript.trim();
        if (!text) return;
        received = true;
        el('ai-mic-status').textContent = `인식한 답변: ${text}`;
        submit(text);
      };
      recorder.onerror = event => {
        if (recognition !== recorder) return;
        el('ai-handsfree').checked = false;
        const messages = {
          'not-allowed': '마이크 권한을 허용하거나 아래에 답변을 입력해주세요.',
          'audio-capture': '마이크를 찾을 수 없습니다. 텍스트로 답변해주세요.',
          'no-speech': '말소리를 인식하지 못했습니다. 다시 누르거나 텍스트로 답변해주세요.',
          network: '음성인식 연결에 실패했습니다. 텍스트로 답변할 수 있습니다.',
        };
        el('ai-mic-status').textContent = messages[event.error] || '음성인식이 멈췄습니다. 다시 누르거나 텍스트로 답변해주세요.';
      };
      recorder.onend = () => {
        if (recognition !== recorder) return;
        recognition = null;
        el('ai-mic').textContent = '눌러서 말하기';
        el('ai-mic').classList.remove('listening');
        if (!received) el('ai-handsfree').checked = false;
      };
      try {
        recorder.start();
        el('ai-mic').textContent = '듣는 중 · 누르면 멈춤';
        el('ai-mic').classList.add('listening');
        el('ai-mic-status').textContent = '영어로 말씀해주세요.';
      } catch {
        recognition = null;
        el('ai-handsfree').checked = false;
        el('ai-mic-status').textContent = '마이크를 시작하지 못했습니다. 텍스트로 답변해주세요.';
      }
    }
    return { stop, stopListening, say, listen, isListening: () => recognition !== null };
  }
  return { create };
})();
