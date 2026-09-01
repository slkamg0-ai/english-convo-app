// ---- Tab navigation ----
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function showTab(name) {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === name));
  if (name === "progress") renderProgressTab();
}

tabButtons.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.goto));
});

// ---- Speech synthesis (TTS) ----
// Web Speech API renders through whatever TTS engine the OS/browser provides
// (Siri voices on iOS, Google TTS on Android, SAPI voices on Windows Chrome —
// quality varies a lot by device). We auto-pick the best-sounding available
// English voice, but let the user override it from the dropdown.
const VOICE_STORAGE_KEY = "englishConvoApp.selectedVoiceURI";
const voiceSelectEl = document.getElementById("voice-select");
const voiceTestBtn = document.getElementById("voice-test-btn");

// Rough quality ranking: cloud/neural voices sound far more natural than the
// default local OS voices, so name-sniff for common high-quality engines.
const PREFERRED_VOICE_HINTS = [
  "neural", "natural", "premium", "enhanced", "online",
  "google us english", "google uk english", "samantha", "siri",
];

function scoreVoice(voice) {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (voice.lang === "en-US") score += 3;
  else if (voice.lang && voice.lang.startsWith("en")) score += 1;
  if (voice.localService === false) score += 2; // usually a higher-quality network voice
  if (PREFERRED_VOICE_HINTS.some((hint) => name.includes(hint))) score += 3;
  return score;
}

function getEnglishVoices() {
  const all = window.speechSynthesis.getVoices();
  const english = all.filter((v) => v.lang && v.lang.startsWith("en"));
  // Some systems only have non-English voices installed (e.g. Korean-only
  // Windows setups) — fall back to whatever exists so the picker isn't empty.
  return english.length > 0 ? english : all;
}

function populateVoiceSelect() {
  const voices = getEnglishVoices();
  if (voices.length === 0) return;

  const sorted = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  const savedURI = localStorage.getItem(VOICE_STORAGE_KEY);

  voiceSelectEl.innerHTML = "";
  sorted.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelectEl.appendChild(option);
  });

  const savedVoiceExists = savedURI && sorted.some((v) => v.voiceURI === savedURI);
  voiceSelectEl.value = savedVoiceExists ? savedURI : sorted[0].voiceURI;
  if (!savedVoiceExists) localStorage.setItem(VOICE_STORAGE_KEY, sorted[0].voiceURI);
}

if ("speechSynthesis" in window) {
  populateVoiceSelect();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoiceSelect);
}

voiceSelectEl.addEventListener("change", () => {
  localStorage.setItem(VOICE_STORAGE_KEY, voiceSelectEl.value);
});

voiceTestBtn.addEventListener("click", () => {
  speak("Hi! This is what I sound like. Nice to meet you.");
});

// ---- Mic permission check ----
// The Web Speech API has no way to pick which microphone device to use (OS
// default only) — this just surfaces whether mic access is granted at all,
// so the user isn't surprised by a permission popup once they're mid-scenario.
const micCheckBtn = document.getElementById("mic-check-btn");
const micCheckStatusEl = document.getElementById("mic-check-status");

async function checkMicAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    micCheckStatusEl.textContent = "❌ 이 브라우저는 마이크 접근을 지원하지 않습니다. 텍스트로 입력해주세요.";
    micCheckStatusEl.className = "note mic-check-status status-error";
    return;
  }

  micCheckStatusEl.textContent = "확인 중...";
  micCheckStatusEl.className = "note mic-check-status";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    micCheckStatusEl.textContent = "✅ 마이크 사용 가능합니다. 상황극에서 바로 말씀하시면 돼요.";
    micCheckStatusEl.className = "note mic-check-status status-ok";
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      micCheckStatusEl.textContent = "❌ 마이크 권한이 거부되었습니다. 브라우저 주소창 옆 자물쇠 아이콘에서 마이크 권한을 허용해주세요.";
    } else if (err.name === "NotFoundError") {
      micCheckStatusEl.textContent = "❌ 연결된 마이크를 찾을 수 없습니다. 텍스트로 입력하셔도 됩니다.";
    } else {
      micCheckStatusEl.textContent = `❌ 마이크 확인 중 오류가 발생했습니다: ${err.message}`;
    }
    micCheckStatusEl.className = "note mic-check-status status-error";
  }
}

micCheckBtn.addEventListener("click", checkMicAccess);

// If the browser already knows the permission state (Chrome supports this),
// show it without prompting the user.
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions
    .query({ name: "microphone" })
    .then((status) => {
      if (status.state === "granted") {
        micCheckStatusEl.textContent = "✅ 마이크 권한이 이미 허용되어 있습니다.";
        micCheckStatusEl.className = "note mic-check-status status-ok";
      } else if (status.state === "denied") {
        micCheckStatusEl.textContent = "❌ 마이크 권한이 거부되어 있습니다. 브라우저 설정에서 허용해주세요.";
        micCheckStatusEl.className = "note mic-check-status status-error";
      }
    })
    .catch(() => {
      // Permissions API doesn't support querying "microphone" on this browser
      // (e.g. Safari) — the user just uses the check button instead.
    });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;

  const savedURI = localStorage.getItem(VOICE_STORAGE_KEY);
  const voice = getEnglishVoices().find((v) => v.voiceURI === savedURI);
  // Match lang to whichever voice actually got selected (falls back to en-US
  // when no voice was found, e.g. voices haven't loaded yet).
  utterance.lang = voice ? voice.lang : "en-US";
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

// ---- Speech recognition (STT) ----
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognitionCtor) {
  recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
}

// ================= Roleplay =================
const scenarioListEl = document.getElementById("scenario-list");
const scenarioSearchEl = document.getElementById("scenario-search");
const scenarioCountEl = document.getElementById("scenario-count");
const scenarioSelectEl = document.getElementById("scenario-select");
const scenarioPlayEl = document.getElementById("scenario-play");
const scenarioTitleEl = document.getElementById("scenario-title");
const npcTextEl = document.getElementById("npc-text");
const npcTextKoEl = document.getElementById("npc-text-ko");
const translateNpcBtn = document.getElementById("translate-npc");
const hintTextKoEl = document.getElementById("hint-text-ko");
const micBtn = document.getElementById("mic-btn");
const micStatusEl = document.getElementById("mic-status");
const transcriptEl = document.getElementById("transcript");
const feedbackBoxEl = document.getElementById("feedback-box");
const feedbackTextEl = document.getElementById("feedback-text");
const nextBtn = document.getElementById("next-btn");
const hintBtn = document.getElementById("hint-btn");
const hintTextEl = document.getElementById("hint-text");
const scenarioEndEl = document.getElementById("scenario-end");
const replayNpcBtn = document.getElementById("replay-npc");

let currentScenarioKey = null;
let currentNodeKey = null;
let pendingOption = null;

function renderScenarioList() {
  const query = scenarioSearchEl.value.trim().toLowerCase();
  scenarioListEl.innerHTML = "";
  const entries = Object.entries(SCENARIOS).filter(([, scenario]) => {
    if (!query) return true;
    return scenario.title.toLowerCase().includes(query) || scenario.description.toLowerCase().includes(query);
  });

  scenarioCountEl.textContent = `${entries.length}개 상황 (전체 ${Object.keys(SCENARIOS).length}개)`;

  entries.forEach(([key, scenario]) => {
    const item = document.createElement("div");
    item.className = "scenario-item";
    item.innerHTML = `<div><h3>${scenario.title}</h3><p>${scenario.description}</p></div><span>▶</span>`;
    item.addEventListener("click", () => startScenario(key));
    scenarioListEl.appendChild(item);
  });
}

scenarioSearchEl.addEventListener("input", renderScenarioList);

function startScenario(key) {
  currentScenarioKey = key;
  currentNodeKey = SCENARIOS[key].startNode;
  scenarioSelectEl.classList.add("hidden");
  scenarioPlayEl.classList.remove("hidden");
  scenarioEndEl.classList.add("hidden");
  scenarioTitleEl.textContent = SCENARIOS[key].title;
  renderNode();
}

function renderNode() {
  const scenario = SCENARIOS[currentScenarioKey];
  const node = scenario.nodes[currentNodeKey];
  npcTextEl.textContent = node.npc;
  npcTextKoEl.textContent = node.npcKo || "";
  npcTextKoEl.classList.add("hidden");
  speak(node.npc);
  transcriptEl.textContent = "";
  feedbackBoxEl.classList.add("hidden");
  hintTextEl.classList.add("hidden");
  hintTextKoEl.classList.add("hidden");
  nextBtn.classList.add("hidden");
  pendingOption = null;

  if (node.options.length === 0) {
    micBtn.classList.add("hidden");
    hintBtn.classList.add("hidden");
    scenarioEndEl.classList.remove("hidden");
    handleActivityResult(recordActivity(`roleplay:${currentScenarioKey}`, 8, "roleplay"));
  } else {
    micBtn.classList.remove("hidden");
    hintBtn.classList.remove("hidden");
    scenarioEndEl.classList.add("hidden");
  }
}

replayNpcBtn.addEventListener("click", () => {
  const scenario = SCENARIOS[currentScenarioKey];
  if (scenario) speak(scenario.nodes[currentNodeKey].npc);
});

translateNpcBtn.addEventListener("click", () => {
  npcTextKoEl.classList.toggle("hidden");
});

hintBtn.addEventListener("click", () => {
  const scenario = SCENARIOS[currentScenarioKey];
  const node = scenario.nodes[currentNodeKey];
  const option = node.options[0];
  const hint = option ? option.hint : "";
  const hintKo = option ? option.hintKo : "";
  hintTextEl.textContent = `예문: "${hint}"`;
  hintTextEl.classList.remove("hidden");
  if (hintKo) {
    hintTextKoEl.textContent = `해석: "${hintKo}"`;
    hintTextKoEl.classList.remove("hidden");
  }
});

function matchOption(transcript, node) {
  const lower = transcript.toLowerCase();
  return node.options.find((option) => option.keywords.some((kw) => lower.includes(kw.toLowerCase())));
}

function handleUserSpeech(transcript) {
  transcriptEl.textContent = `"${transcript}"`;
  const scenario = SCENARIOS[currentScenarioKey];
  const node = scenario.nodes[currentNodeKey];
  const matched = matchOption(transcript, node);

  feedbackBoxEl.classList.remove("hidden");
  if (matched) {
    feedbackBoxEl.className = "feedback-box correct";
    feedbackTextEl.textContent = `✅ ${matched.feedback}`;
    pendingOption = matched;
    nextBtn.classList.remove("hidden");
  } else {
    feedbackBoxEl.className = "feedback-box incorrect";
    feedbackTextEl.textContent = "🤔 다시 말해보시겠어요? 아래 힌트를 참고해보세요.";
    hintBtn.click();
  }
}

nextBtn.addEventListener("click", () => {
  if (!pendingOption) return;
  currentNodeKey = pendingOption.next;
  renderNode();
});

micBtn.addEventListener("click", () => {
  if (!recognition) {
    micStatusEl.textContent = "이 브라우저는 음성인식을 지원하지 않습니다. Chrome을 사용해주세요.";
    return;
  }
  micBtn.classList.add("listening");
  micStatusEl.textContent = "듣는 중...";
  recognition.start();
});

if (recognition) {
  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    handleUserSpeech(transcript);
  });
  recognition.addEventListener("end", () => {
    micBtn.classList.remove("listening");
    micStatusEl.textContent = "";
  });
  recognition.addEventListener("error", (event) => {
    micBtn.classList.remove("listening");
    micStatusEl.textContent = `오류: ${event.error}`;
  });
}

const textAnswerInput = document.getElementById("text-answer-input");
const textAnswerSubmit = document.getElementById("text-answer-submit");

function submitTextAnswer() {
  const value = textAnswerInput.value.trim();
  if (!value) return;
  handleUserSpeech(value);
  textAnswerInput.value = "";
}

textAnswerSubmit.addEventListener("click", submitTextAnswer);
textAnswerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitTextAnswer();
});

if (!recognition) {
  micBtn.classList.add("hidden");
  micStatusEl.textContent = "이 브라우저는 음성인식을 지원하지 않아요. 아래에 텍스트로 입력해주세요.";
}

document.getElementById("back-to-scenarios").addEventListener("click", () => {
  window.speechSynthesis.cancel();
  scenarioPlayEl.classList.add("hidden");
  scenarioSelectEl.classList.remove("hidden");
});

document.getElementById("restart-scenario").addEventListener("click", () => {
  startScenario(currentScenarioKey);
});

renderScenarioList();

// ================= Flashcards =================
const FLASH_STORAGE_KEY = "englishConvoApp.knownCards";
let knownCards = new Set(JSON.parse(localStorage.getItem(FLASH_STORAGE_KEY) || "[]"));
let flashIndex = 0;
let dueCards = FLASHCARDS.map((_, i) => i).filter((i) => !knownCards.has(i));

const flashcardEl = document.getElementById("flashcard");
const flashFrontTextEl = document.getElementById("flash-front-text");
const flashBackTextEl = document.getElementById("flash-back-text");
const flashExampleTextEl = document.getElementById("flash-example-text");
const flashExampleKoTextEl = document.getElementById("flash-example-ko-text");
const flashCountEl = document.getElementById("flash-count");
const flashKnownCountEl = document.getElementById("flash-known-count");
const flashSpeakBtn = document.getElementById("flash-speak");

function saveKnownCards() {
  localStorage.setItem(FLASH_STORAGE_KEY, JSON.stringify([...knownCards]));
}

function renderFlashcard() {
  flashcardEl.classList.remove("flipped");
  if (dueCards.length === 0) {
    flashFrontTextEl.textContent = "🎉 전부 외웠습니다!";
    flashBackTextEl.textContent = "";
    flashExampleTextEl.textContent = "";
    flashExampleKoTextEl.textContent = "";
    flashCountEl.textContent = "복습할 카드 없음";
    flashKnownCountEl.textContent = `외운 단어: ${knownCards.size} / ${FLASHCARDS.length}`;
    return;
  }
  const cardIndex = dueCards[flashIndex % dueCards.length];
  const card = FLASHCARDS[cardIndex];
  flashFrontTextEl.textContent = card.front;
  flashBackTextEl.textContent = card.back;
  flashExampleTextEl.textContent = card.example;
  flashExampleKoTextEl.textContent = card.exampleKo || "";
  flashCountEl.textContent = `${(flashIndex % dueCards.length) + 1} / ${dueCards.length}`;
  flashKnownCountEl.textContent = `외운 단어: ${knownCards.size} / ${FLASHCARDS.length}`;
}

flashcardEl.addEventListener("click", () => {
  flashcardEl.classList.toggle("flipped");
});

flashSpeakBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const cardIndex = dueCards[flashIndex % dueCards.length];
  if (cardIndex !== undefined) speak(FLASHCARDS[cardIndex].front);
});

document.getElementById("flash-know").addEventListener("click", () => {
  if (dueCards.length === 0) return;
  const cardIndex = dueCards[flashIndex % dueCards.length];
  knownCards.add(cardIndex);
  saveKnownCards();
  dueCards = dueCards.filter((i) => i !== cardIndex);
  handleActivityResult(recordActivity(`flashcard:${cardIndex}`, 5, "flashcard"));
  renderFlashcard();
});

document.getElementById("flash-dontknow").addEventListener("click", () => {
  if (dueCards.length === 0) return;
  flashIndex = (flashIndex + 1) % dueCards.length;
  renderFlashcard();
});

document.getElementById("flash-reset").addEventListener("click", () => {
  knownCards = new Set();
  saveKnownCards();
  dueCards = FLASHCARDS.map((_, i) => i);
  flashIndex = 0;
  renderFlashcard();
});

renderFlashcard();

// ================= 200-day curriculum =================
const CURR_COMPLETED_KEY = "englishConvoApp.curriculumCompleted";
const CURR_DAY_KEY = "englishConvoApp.curriculumCurrentDay";

let completedScenarioIds = new Set(JSON.parse(localStorage.getItem(CURR_COMPLETED_KEY) || "[]"));
let currentDay = Number(localStorage.getItem(CURR_DAY_KEY)) || 1;

const currDayTitleEl = document.getElementById("curr-day-title");
const currDaySubEl = document.getElementById("curr-day-sub");
const currCardsEl = document.getElementById("curr-cards");
const currProgressFillEl = document.getElementById("curr-progress-fill");
const currProgressTextEl = document.getElementById("curr-progress-text");

function saveCurrState() {
  localStorage.setItem(CURR_COMPLETED_KEY, JSON.stringify([...completedScenarioIds]));
  localStorage.setItem(CURR_DAY_KEY, String(currentDay));
}

function scenariosForDay(day) {
  return CURRICULUM.filter((s) => s.day === day);
}

function isDayComplete(day) {
  return scenariosForDay(day).every((s) => completedScenarioIds.has(s.id));
}

function findNextIncompleteDay() {
  for (let d = 1; d <= CURRICULUM_TOTAL_DAYS; d++) {
    if (!isDayComplete(d)) return d;
  }
  return CURRICULUM_TOTAL_DAYS;
}

function checkCurriculumAnswer(scenario, userText) {
  const keywordWords = scenario.keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const lower = userText.toLowerCase();
  if (keywordWords.length === 0) return lower.trim().length > 0;
  return keywordWords.some((w) => lower.includes(w));
}

function renderCurriculumDay() {
  currDayTitleEl.textContent = `Day ${currentDay}`;
  currDaySubEl.textContent = `/ ${CURRICULUM_TOTAL_DAYS}일`;

  const dayScenarios = scenariosForDay(currentDay);
  const doneCount = dayScenarios.filter((s) => completedScenarioIds.has(s.id)).length;
  currProgressFillEl.style.width = `${(doneCount / dayScenarios.length) * 100}%`;
  currProgressTextEl.textContent = `오늘 진행: ${doneCount} / ${dayScenarios.length}   |   전체 완료: ${completedScenarioIds.size} / ${CURRICULUM.length}`;

  currCardsEl.innerHTML = "";
  dayScenarios.forEach((scenario) => {
    const done = completedScenarioIds.has(scenario.id);
    const card = document.createElement("div");
    card.className = `curriculum-card${done ? " completed" : ""}`;
    card.innerHTML = `
      <div class="curriculum-card-header">
        <span>${scenario.categoryTitle}</span>
        <span>${done ? "✅ 완료" : ""}</span>
      </div>
      <p class="curriculum-card-npc">${scenario.npc}</p>
      <p class="curriculum-card-npc-ko hidden">${scenario.npcKo}</p>
      <div class="curriculum-card-btn-row">
        <button class="icon-btn curr-speak-btn" type="button">🔊 들어보기</button>
        <button class="icon-btn curr-translate-btn" type="button">🇰🇷 해석 보기</button>
      </div>
      <div class="curriculum-card-row">
        <input type="text" class="curr-answer-input" placeholder="영어로 답해보세요" />
        <button class="secondary-btn curr-check-btn" type="button">확인</button>
      </div>
      <div class="curriculum-card-feedback hidden"></div>
      <p class="curriculum-card-answer hidden">모범 답안: "${scenario.answer}"</p>
      <p class="curriculum-card-answer-ko hidden">해석: "${scenario.answerKo}"</p>
    `;

    const speakBtn = card.querySelector(".curr-speak-btn");
    const translateBtn = card.querySelector(".curr-translate-btn");
    const npcKoEl = card.querySelector(".curriculum-card-npc-ko");
    const input = card.querySelector(".curr-answer-input");
    const checkBtn = card.querySelector(".curr-check-btn");
    const feedbackEl = card.querySelector(".curriculum-card-feedback");
    const answerEl = card.querySelector(".curriculum-card-answer");
    const answerKoEl = card.querySelector(".curriculum-card-answer-ko");

    speakBtn.addEventListener("click", () => speak(scenario.npc));
    translateBtn.addEventListener("click", () => {
      npcKoEl.classList.toggle("hidden");
    });

    function submitAnswer() {
      const value = input.value.trim();
      if (!value) return;
      const correct = checkCurriculumAnswer(scenario, value);
      feedbackEl.classList.remove("hidden");
      answerEl.classList.remove("hidden");
      answerKoEl.classList.remove("hidden");
      if (correct) {
        feedbackEl.className = "curriculum-card-feedback correct";
        feedbackEl.textContent = "✅ 좋아요! 자연스러운 답변이에요.";
        completedScenarioIds.add(scenario.id);
        card.classList.add("completed");
        card.querySelector(".curriculum-card-header span:last-child").textContent = "✅ 완료";
        saveCurrState();
        handleActivityResult(recordActivity(`curriculum:${scenario.id}`, 10, "curriculum"));
        renderCurriculumDay();
      } else {
        feedbackEl.className = "curriculum-card-feedback incorrect";
        feedbackEl.textContent = "🤔 조금 다른 것 같아요. 아래 모범 답안을 참고해서 다시 시도해보세요.";
      }
    }

    checkBtn.addEventListener("click", submitAnswer);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitAnswer();
    });

    currCardsEl.appendChild(card);
  });
}

document.getElementById("curr-prev-day").addEventListener("click", () => {
  currentDay = Math.max(1, currentDay - 1);
  saveCurrState();
  renderCurriculumDay();
});

document.getElementById("curr-next-day").addEventListener("click", () => {
  currentDay = Math.min(CURRICULUM_TOTAL_DAYS, currentDay + 1);
  saveCurrState();
  renderCurriculumDay();
});

document.getElementById("curr-jump-today").addEventListener("click", () => {
  currentDay = findNextIncompleteDay();
  saveCurrState();
  renderCurriculumDay();
});

renderCurriculumDay();

// ================= Gamification (XP, streaks, badges) =================
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function handleActivityResult(result) {
  if (!result.awarded) return;
  renderHeaderStats();
  const messages = [`✨ +${result.xpAmount} XP`];
  result.newlyUnlocked.forEach((badge) => messages.push(`${badge.icon} 뱃지 획득: ${badge.label}`));
  showToast(messages.join("  "));
}

function renderHeaderStats() {
  const summary = getProgressSummary();
  const headerStatsEl = document.getElementById("header-stats");
  headerStatsEl.innerHTML = `
    <span>Lv.${summary.level} <strong>${summary.levelTitle}</strong></span>
    <span>🔥 <strong>${summary.currentStreak}</strong>일 연속</span>
    <span>✨ <strong>${summary.xp}</strong> XP</span>
  `;
}

function renderProgressTab() {
  const summary = getProgressSummary();

  document.getElementById("progress-level-badge").textContent = `Lv.${summary.level}`;
  document.getElementById("progress-level-title").textContent = summary.levelTitle;
  document.getElementById("progress-xp-text").textContent =
    `${summary.xpIntoLevel} / ${summary.xpForNextLevel} XP · 다음 레벨까지 ${summary.xpForNextLevel - summary.xpIntoLevel} XP`;
  document.getElementById("progress-xp-fill").style.width =
    `${Math.min(100, (summary.xpIntoLevel / summary.xpForNextLevel) * 100)}%`;

  document.getElementById("progress-streak").textContent = summary.currentStreak;
  document.getElementById("progress-longest-streak").textContent = summary.longestStreak;
  document.getElementById("progress-total").textContent = summary.totalActivities;

  const nudgeEl = document.getElementById("progress-streak-nudge");
  if (summary.currentStreak > 0 && !isStreakActiveToday()) {
    nudgeEl.textContent = `⏰ 오늘 아직 학습 안 하셨어요! 스트릭이 끊기기 전에 하나만 풀어보세요.`;
  } else if (summary.currentStreak === 0) {
    nudgeEl.textContent = `오늘부터 학습을 시작해서 스트릭을 쌓아보세요!`;
  } else {
    nudgeEl.textContent = `오늘도 학습 완료! 내일도 이어가 볼까요?`;
  }

  const badgeGridEl = document.getElementById("badge-grid");
  badgeGridEl.innerHTML = "";
  BADGE_DEFS.forEach((badge) => {
    const unlocked = summary.unlockedBadges.includes(badge.id);
    const el = document.createElement("div");
    el.className = `badge-item${unlocked ? " unlocked" : ""}`;
    el.innerHTML = `<span class="badge-icon">${badge.icon}</span>${badge.label}`;
    el.title = badge.desc;
    badgeGridEl.appendChild(el);
  });
}

renderHeaderStats();
