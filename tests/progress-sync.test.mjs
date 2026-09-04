import assert from "node:assert/strict";
import test from "node:test";

import {
  applyActivity,
  buildMigrationPayload,
  createEmptyProgress,
  rewardEligibility,
  summarizeProgress,
} from "../progress-domain.mjs";

test("applyActivity awards one activity once when the id is repeated", () => {
  // Given
  const started = createEmptyProgress();

  // When
  const first = applyActivity(started, {
    clientEventId: "curriculum:greeting:complete",
    kind: "curriculum",
    sourceId: "greeting",
    xpDelta: 25,
    occurredAt: "2026-09-03T10:15:00.000Z",
  });
  const second = applyActivity(first.progress, {
    clientEventId: "curriculum:greeting:complete",
    kind: "curriculum",
    sourceId: "greeting",
    xpDelta: 25,
    occurredAt: "2026-09-03T10:15:00.000Z",
  });

  // Then
  assert.equal(first.awarded, true);
  assert.equal(second.awarded, false);
  assert.equal(second.progress.xp, 25);
  assert.equal(second.progress.rewardedIds.length, 1);
  assert.equal(second.progress.curriculumCount, 1);
});

test("applyActivity rejects invalid client event ids without changing progress", () => {
  // Given
  const started = createEmptyProgress();

  // When
  const missingId = applyActivity(started, {
    kind: "curriculum",
    xpDelta: 25,
    occurredAt: "2026-09-03T10:15:00.000Z",
  });
  const blankId = applyActivity(started, {
    clientEventId: "   ",
    kind: "curriculum",
    xpDelta: 25,
    occurredAt: "2026-09-03T10:15:00.000Z",
  });

  // Then
  assert.deepEqual(missingId, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
  assert.deepEqual(blankId, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
});

test("applyActivity rejects invalid xp deltas without changing progress", () => {
  // Given
  const started = createEmptyProgress();
  const baseActivity = {
    clientEventId: "curriculum:greeting:complete",
    kind: "curriculum",
    occurredAt: "2026-09-03T10:15:00.000Z",
  };

  // When
  const stringXp = applyActivity(started, { ...baseActivity, xpDelta: "25" });
  const nanXp = applyActivity(started, { ...baseActivity, clientEventId: "nan", xpDelta: Number.NaN });
  const negativeXp = applyActivity(started, { ...baseActivity, clientEventId: "negative", xpDelta: -1 });
  const fractionalXp = applyActivity(started, { ...baseActivity, clientEventId: "fractional", xpDelta: 1.5 });
  const infiniteXp = applyActivity(started, { ...baseActivity, clientEventId: "infinite", xpDelta: Infinity });

  // Then
  assert.deepEqual(stringXp, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
  assert.deepEqual(nanXp, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
  assert.deepEqual(negativeXp, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
  assert.deepEqual(fractionalXp, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
  assert.deepEqual(infiniteXp, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
});

test("applyActivity rejects invalid occurredAt values without changing progress", () => {
  // Given
  const started = createEmptyProgress();

  // When
  const invalidDate = applyActivity(started, {
    clientEventId: "curriculum:greeting:complete",
    kind: "curriculum",
    xpDelta: 25,
    occurredAt: "2026-99-99T10:15:00.000Z",
  });

  // Then
  assert.deepEqual(invalidDate, { awarded: false, progress: started, error: "INVALID_ACTIVITY" });
});

test("rewardEligibility reports active requiredXp milestones until claimed", () => {
  // Given
  const summary = summarizeProgress({
    ...createEmptyProgress(),
    xp: 125,
  });
  const rewardRules = [
    { id: "xp_100", requiredXp: 100, active: true, label: "100 XP" },
    { id: "xp_200", requiredXp: 200, active: true, label: "200 XP" },
    { id: "retired_50", requiredXp: 50, active: false, label: "Retired" },
  ];

  // When
  const beforeClaim = rewardEligibility(summary, rewardRules, []);
  const afterClaim = rewardEligibility(summary, rewardRules, [{ rewardRuleId: "xp_100" }]);

  // Then
  assert.deepEqual(beforeClaim, [
    { id: "xp_100", requiredXp: 100, active: true, eligible: true, claimed: false },
    { id: "xp_200", requiredXp: 200, active: true, eligible: false, claimed: false },
    { id: "retired_50", requiredXp: 50, active: false, eligible: false, claimed: false },
  ]);
  assert.deepEqual(afterClaim[0], {
    id: "xp_100",
    requiredXp: 100,
    active: true,
    eligible: false,
    claimed: true,
  });
});

test("summarizeProgress returns the current progress summary fields", () => {
  // Given
  const progress = {
    ...createEmptyProgress(),
    xp: 130,
    rewardedIds: ["a", "b"],
    currentStreak: 2,
    longestStreak: 4,
    curriculumCount: 1,
    roleplayCount: 1,
    flashcardCount: 0,
    unlockedBadges: ["first_step"],
    activityDates: ["2026-09-02", "2026-09-03"],
  };

  // When
  const summary = summarizeProgress(progress);

  // Then
  assert.equal(summary.xp, 130);
  assert.equal(summary.level, 2);
  assert.equal(summary.xpIntoLevel, 30);
  assert.equal(summary.xpForNextLevel, 140);
  assert.equal(summary.currentStreak, 2);
  assert.equal(summary.longestStreak, 4);
  assert.equal(summary.totalActivities, 2);
  assert.equal(summary.curriculumCount, 1);
  assert.equal(summary.roleplayCount, 1);
  assert.equal(summary.flashcardCount, 0);
  assert.deepEqual(summary.unlockedBadges, ["first_step"]);
  assert.deepEqual(summary.activityDates, ["2026-09-02", "2026-09-03"]);
});

test("buildMigrationPayload maps local progress into one secret-free import payload", () => {
  // Given
  const localProgress = {
    xp: 90,
    rewardedIds: ["curriculum:1", "flashcard:7"],
    activityDates: ["2026-09-01", "2026-09-03"],
    currentStreak: 1,
    longestStreak: 3,
    lastActivityDate: "2026-09-03",
    unlockedBadges: ["first_step"],
    curriculumCount: 1,
    roleplayCount: 0,
    flashcardCount: 1,
    token: "secret",
    password: "secret",
  };

  // When
  const payload = buildMigrationPayload(localProgress);

  // Then
  assert.deepEqual(payload, {
    version: 1,
    progress: {
      xp: 90,
      rewardedIds: ["curriculum:1", "flashcard:7"],
      activityDates: ["2026-09-01", "2026-09-03"],
      currentStreak: 1,
      longestStreak: 3,
      lastActivityDate: "2026-09-03",
      unlockedBadges: ["first_step"],
      curriculumCount: 1,
      roleplayCount: 0,
      flashcardCount: 1,
    },
  });
  assert.equal(JSON.stringify(payload).includes("token"), false);
  assert.equal(JSON.stringify(payload).includes("password"), false);
});
