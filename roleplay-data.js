// Generates ~200 short 2-turn roleplay scenarios from the 50 curriculum
// categories (CATEGORY_TEMPLATES, defined in curriculum-data.js) so we don't
// hand-author 200 unique deep dialogue trees. Each scenario: NPC opens with
// the category's line, the learner responds using one of the category's
// items, NPC gives a short closing reaction. The two hand-crafted deep
// scenarios in scenarios.js (restaurant, airport) stay separate as "심화" scenarios.

const VARIANT_ITEM_INDEXES = [0, 5, 10, 15]; // 4 variants per category, spread across the item pool

const CLOSING_LINES = [
  "Perfect, thanks!",
  "Got it, thank you.",
  "Great, that works.",
  "Sounds good, thanks for letting me know.",
];

const CLOSING_LINES_KO = [
  "완벽해요, 감사합니다!",
  "알겠습니다, 감사합니다.",
  "좋아요, 그렇게 할게요.",
  "좋습니다, 알려주셔서 감사해요.",
];

function extractKeywords(item) {
  return item
    .replace(/^(a |an |the )/i, "")
    .split(/[\s,]+/)
    .filter((w) => w.length > 2);
}

function buildGeneratedScenarios() {
  const generated = {};
  CATEGORY_TEMPLATES.forEach((cat) => {
    VARIANT_ITEM_INDEXES.forEach((itemIndex, variantIndex) => {
      const item = cat.items[itemIndex];
      if (!item) return;
      const key = `${cat.id}_${variantIndex + 1}`;
      const answer = cat.template(item);
      const answerKo = cat.answersKo[itemIndex];
      const closingIndex = variantIndex % CLOSING_LINES.length;
      const closing = CLOSING_LINES[closingIndex];
      const closingKo = CLOSING_LINES_KO[closingIndex];

      generated[key] = {
        title: `${cat.title} ${variantIndex + 1}`,
        description: cat.npc,
        descriptionKo: cat.npcKo,
        startNode: "start",
        nodes: {
          start: {
            npc: cat.npc,
            npcKo: cat.npcKo,
            options: [
              {
                keywords: extractKeywords(item),
                hint: answer,
                hintKo: answerKo,
                feedback: "좋아요, 자연스러운 답변이에요.",
                next: "end",
              },
            ],
          },
          end: {
            npc: closing,
            npcKo: closingKo,
            options: [],
          },
        },
      };
    });
  });
  return generated;
}

Object.assign(SCENARIOS, buildGeneratedScenarios());
