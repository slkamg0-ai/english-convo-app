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
    id: "curriculum:greeting:complete",
    xp: 25,
    kind: "curriculum",
    date: "2026-09-03",
  });
  const second = applyActivity(first.progress, {
    id: "curriculum:greeting:complete",
    xp: 25,
    kind: "curriculum",
    date: "2026-09-03",
  });

  // Then
  assert.equal(first.awarded, true);
  assert.equal(second.awarded, false);
  assert.equal(second.progress.xp, 25);
  assert.equal(second.progress.rewardedIds.length, 1);
  assert.equal(second.progress.curriculumCount, 1);
});

test("rewardEligibility makes earned milestones claimable until claimed", () => {
  // Given
  const summary = summarizeProgress({
    ...createEmptyProgress(),
    xp: 125,
  });
  const rewardRules = [
    { id: "xp_100", xp: 100, label: "100 XP" },
    { id: "xp_200", xp: 200, label: "200 XP" },
  ];

  // When
  const beforeClaim = rewardEligibility(summary, rewardRules, []);
  const afterClaim = rewardEligibility(summary, rewardRules, ["xp_100"]);

  // Then
  assert.deepEqual(
    beforeClaim.map((reward) => reward.id),
    ["xp_100"],
  );
  assert.deepEqual(afterClaim, []);
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
