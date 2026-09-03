const LEVEL_TITLES = [
  "새싹 학습자",
  "꾸준한 초보자",
  "성장하는 학습자",
  "열정 학습자",
  "숙련된 학습자",
  "베테랑 학습자",
  "고급 학습자",
  "달인",
  "마스터",
  "전설의 학습자",
];

function xpForLevel(level) {
  return 100 * level + 20 * level * (level - 1);
}

function levelFromXP(xp) {
  let level = 1;
  while (xp >= xpForLevel(level)) level++;
  return level;
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

function countFieldForKind(kind) {
  if (kind === "curriculum") return "curriculumCount";
  if (kind === "roleplay") return "roleplayCount";
  if (kind === "flashcard") return "flashcardCount";
  return null;
}

function copyStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isValidClientEventId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidXpDelta(value) {
  return Number.isInteger(value) && value >= 0;
}

function activityDateFromOccurredAt(value) {
  if (!value) return null;
  if (typeof value !== "string") return undefined;

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return undefined;

  const activityDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) return undefined;
  if (parsedDate.toISOString().slice(0, 10) !== activityDate) return undefined;
  return activityDate;
}

function normalizeProgress(progress) {
  return {
    xp: Number.isFinite(progress?.xp) ? progress.xp : 0,
    rewardedIds: copyStringList(progress?.rewardedIds),
    activityDates: copyStringList(progress?.activityDates),
    currentStreak: Number.isFinite(progress?.currentStreak) ? progress.currentStreak : 0,
    longestStreak: Number.isFinite(progress?.longestStreak) ? progress.longestStreak : 0,
    lastActivityDate: typeof progress?.lastActivityDate === "string" ? progress.lastActivityDate : null,
    unlockedBadges: copyStringList(progress?.unlockedBadges),
    curriculumCount: Number.isFinite(progress?.curriculumCount) ? progress.curriculumCount : 0,
    roleplayCount: Number.isFinite(progress?.roleplayCount) ? progress.roleplayCount : 0,
    flashcardCount: Number.isFinite(progress?.flashcardCount) ? progress.flashcardCount : 0,
  };
}

export function createEmptyProgress() {
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

export function applyActivity(progress, activity) {
  const nextProgress = normalizeProgress(progress);
  const activityDate = activityDateFromOccurredAt(activity?.occurredAt);
  if (
    !isValidClientEventId(activity?.clientEventId) ||
    !isValidXpDelta(activity?.xpDelta) ||
    activityDate === undefined
  ) {
    return { awarded: false, progress: nextProgress, error: "INVALID_ACTIVITY" };
  }

  if (nextProgress.rewardedIds.includes(activity.clientEventId)) {
    return { awarded: false, progress: nextProgress };
  }

  nextProgress.rewardedIds = [...nextProgress.rewardedIds, activity.clientEventId];
  nextProgress.xp += activity.xpDelta;

  const countField = countFieldForKind(activity.kind);
  if (countField) nextProgress[countField] += 1;

  if (activityDate && nextProgress.lastActivityDate !== activityDate) {
    const continuesStreak =
      nextProgress.lastActivityDate && daysBetween(nextProgress.lastActivityDate, activityDate) === 1;
    nextProgress.currentStreak = continuesStreak ? nextProgress.currentStreak + 1 : 1;
    nextProgress.lastActivityDate = activityDate;
    nextProgress.activityDates = [...nextProgress.activityDates, activityDate];
    nextProgress.longestStreak = Math.max(nextProgress.longestStreak, nextProgress.currentStreak);
  }

  return { awarded: true, xpAmount: activity.xpDelta, progress: nextProgress };
}

export function summarizeProgress(progress) {
  const normalized = normalizeProgress(progress);
  const level = levelFromXP(normalized.xp);
  const currentLevelXP = level === 1 ? 0 : xpForLevel(level - 1);
  const nextLevelXP = xpForLevel(level);
  return {
    xp: normalized.xp,
    level,
    levelTitle: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    xpIntoLevel: normalized.xp - currentLevelXP,
    xpForNextLevel: nextLevelXP - currentLevelXP,
    currentStreak: normalized.currentStreak,
    longestStreak: normalized.longestStreak,
    totalActivities: normalized.rewardedIds.length,
    curriculumCount: normalized.curriculumCount,
    roleplayCount: normalized.roleplayCount,
    flashcardCount: normalized.flashcardCount,
    unlockedBadges: [...normalized.unlockedBadges],
    activityDates: [...normalized.activityDates],
  };
}

export function rewardEligibility(summary, rewardRules, claims) {
  const claimedIds = new Set(claims.map((claim) => claim.rewardRuleId));
  return rewardRules.map((rule) => {
    const claimed = claimedIds.has(rule.id);
    return {
      id: rule.id,
      requiredXp: rule.requiredXp,
      active: rule.active,
      eligible: rule.active && summary.xp >= rule.requiredXp && !claimed,
      claimed,
    };
  });
}

export function buildMigrationPayload(localProgress) {
  const progress = normalizeProgress(localProgress);
  return {
    version: 1,
    progress,
  };
}
