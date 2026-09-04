// Local gamification layer: XP, levels, streaks, badges. Everything lives in
// localStorage, so each person gets their own independent progress just by
// opening the app on their own phone/browser — no accounts or backend needed.

const PROGRESS_KEY = "englishConvoApp.progress";

const LEVEL_TITLES = [
  "새싹 학습자", "꾸준한 초보자", "성장하는 학습자", "열정 학습자", "숙련된 학습자",
  "베테랑 학습자", "고급 학습자", "달인", "마스터", "전설의 학습자",
];

const BADGE_DEFS = [
  { id: "first_step", label: "첫 걸음", icon: "", desc: "학습을 처음 시작했어요", check: (p) => p.totalActivities >= 1 },
  { id: "streak_3", label: "3일 연속", icon: "", desc: "3일 연속 학습", check: (p) => p.longestStreak >= 3 },
  { id: "streak_7", label: "일주일 연속", icon: "", desc: "7일 연속 학습", check: (p) => p.longestStreak >= 7 },
  { id: "streak_30", label: "한 달 연속", icon: "", desc: "30일 연속 학습", check: (p) => p.longestStreak >= 30 },
  { id: "curriculum_10", label: "코스 입문", icon: "", desc: "커리큘럼 10개 완료", check: (p) => p.curriculumCount >= 10 },
  { id: "curriculum_50", label: "코스 절반", icon: "", desc: "커리큘럼 50개 완료", check: (p) => p.curriculumCount >= 50 },
  { id: "curriculum_200", label: "코스 마스터", icon: "", desc: "커리큘럼 200개 완료", check: (p) => p.curriculumCount >= 200 },
  { id: "roleplay_10", label: "상황극 입문", icon: "", desc: "상황극 10개 완료", check: (p) => p.roleplayCount >= 10 },
  { id: "roleplay_50", label: "상황극 숙련", icon: "", desc: "상황극 50개 완료", check: (p) => p.roleplayCount >= 50 },
  { id: "flashcard_10", label: "단어 수집가", icon: "", desc: "단어 카드 10개 암기", check: (p) => p.flashcardCount >= 10 },
  { id: "level_5", label: "레벨 5 달성", icon: "", desc: "레벨 5에 도달", check: (p) => p.level >= 5 },
  { id: "level_10", label: "레벨 10 달성", icon: "", desc: "레벨 10에 도달", check: (p) => p.level >= 10 },
];

function createEmptyLocalProgress() {
  return {
    xp: 0,
    rewardedIds: [],
    activityDates: [],
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: null,
    unlockedBadges: [],
    curriculumCount: 0,
    roleplayCount: 0,
    flashcardCount: 0,
  };
}

function xpForLevel(level) {
  // Level N requires progressively more XP: 100, 220, 360, 520, ...
  return 100 * level + 20 * level * (level - 1);
}

function levelFromXP(xp) {
  let level = 1;
  while (xp >= xpForLevel(level)) level++;
  return level;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

function loadProgress() {
  const raw = localStorage.getItem(PROGRESS_KEY);
  if (!raw) {
    return createEmptyLocalProgress();
  }
  const parsed = JSON.parse(raw);
  parsed.rewardedIds = parsed.rewardedIds || [];
  parsed.activityDates = parsed.activityDates || [];
  parsed.unlockedBadges = parsed.unlockedBadges || [];
  parsed.curriculumCount = parsed.curriculumCount || 0;
  parsed.roleplayCount = parsed.roleplayCount || 0;
  parsed.flashcardCount = parsed.flashcardCount || 0;
  return parsed;
}

function saveProgress(progress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

// Records one activity (curriculum answer, roleplay completion, flashcard
// learned). `uniqueId` must be stable and unique per activity instance so
// re-triggering the same one (e.g. revisiting a completed card) doesn't
// double-award XP. Returns info about what changed, for UI feedback.
function recordActivity(uniqueId, xpAmount, kind) {
  const progress = loadProgress();
  if (progress.rewardedIds.includes(uniqueId)) {
    return { awarded: false, progress: summarize(progress) };
  }

  progress.rewardedIds.push(uniqueId);
  progress.xp += xpAmount;
  if (kind === "curriculum") progress.curriculumCount++;
  if (kind === "roleplay") progress.roleplayCount++;
  if (kind === "flashcard") progress.flashcardCount++;

  const today = todayString();
  if (progress.lastActivityDate !== today) {
    if (progress.lastActivityDate && daysBetween(progress.lastActivityDate, today) === 1) {
      progress.currentStreak += 1;
    } else {
      progress.currentStreak = 1;
    }
    progress.lastActivityDate = today;
    progress.activityDates.push(today);
    progress.longestStreak = Math.max(progress.longestStreak, progress.currentStreak);
  }

  const summary = summarize(progress);
  const newlyUnlocked = [];
  BADGE_DEFS.forEach((badge) => {
    if (!progress.unlockedBadges.includes(badge.id) && badge.check(summary)) {
      progress.unlockedBadges.push(badge.id);
      newlyUnlocked.push(badge);
    }
  });

  saveProgress(progress);
  const result = { awarded: true, xpAmount, newlyUnlocked, progress: summarize(progress) };
  if (window.CloudClient?.hasToken()) {
    window.CloudClient.recordActivity({
      clientEventId: uniqueId,
      kind,
      sourceId: uniqueId.split(":").slice(1).join(":") || uniqueId,
      xpDelta: xpAmount,
      occurredAt: new Date().toISOString(),
    }).then(() => window.RewardsUI?.refresh()).catch(() => {});
  }
  return result;
}

function summarize(progress) {
  const level = levelFromXP(progress.xp);
  const currentLevelXP = level === 1 ? 0 : xpForLevel(level - 1);
  const nextLevelXP = xpForLevel(level);
  return {
    xp: progress.xp,
    level,
    levelTitle: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    xpIntoLevel: progress.xp - currentLevelXP,
    xpForNextLevel: nextLevelXP - currentLevelXP,
    currentStreak: progress.currentStreak,
    longestStreak: progress.longestStreak,
    totalActivities: progress.rewardedIds.length,
    curriculumCount: progress.curriculumCount,
    roleplayCount: progress.roleplayCount,
    flashcardCount: progress.flashcardCount,
    unlockedBadges: progress.unlockedBadges,
    activityDates: progress.activityDates,
  };
}

function getProgressSummary() {
  return summarize(loadProgress());
}

// Checks today's streak status without recording new activity — used so the
// UI can show "스트릭이 끊길 위험" style nudges without side effects.
function isStreakActiveToday() {
  const progress = loadProgress();
  return progress.lastActivityDate === todayString();
}
