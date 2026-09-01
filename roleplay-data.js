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
      const closing = CLOSING_LINES[variantIndex % CLOSING_LINES.length];

      generated[key] = {
        title: `${cat.title} ${variantIndex + 1}`,
        description: cat.npc,
        startNode: "start",
        nodes: {
          start: {
            npc: cat.npc,
            options: [
              {
                keywords: extractKeywords(item),
                hint: answer,
                feedback: "좋아요, 자연스러운 답변이에요.",
                next: "end",
              },
            ],
          },
          end: {
            npc: closing,
            options: [],
          },
        },
      };
    });
  });
  return generated;
}

Object.assign(SCENARIOS, buildGeneratedScenarios());
