// Branching roleplay scenarios. Each node: NPC line (spoken via TTS),
// a list of acceptable keyword sets the learner's speech should contain,
// a model answer shown as a hint, and the id of the next node per branch.
// "end" nodes have no options and close the scenario.

const SCENARIOS = {
  restaurant: {
    title: "레스토랑에서 주문하기",
    description: "웨이터와 대화하며 자리를 안내받고 음식을 주문해보세요.",
    startNode: "greet",
    nodes: {
      greet: {
        npc: "Good evening! Welcome to Luigi's. Do you have a reservation?",
        options: [
          {
            keywords: ["yes", "reservation"],
            hint: "Yes, I have a reservation.",
            feedback: "Great, that's a natural way to confirm a reservation.",
            next: "seated",
          },
          {
            keywords: ["no", "table for", "two", "one", "three"],
            hint: "No, I don't. Table for two, please.",
            feedback: "Good — that's exactly how you'd ask for a walk-in table.",
            next: "seated",
          },
        ],
      },
      seated: {
        npc: "Right this way. Here are your menus. Can I start you off with something to drink?",
        options: [
          {
            keywords: ["water", "coke", "juice", "wine", "coffee", "tea", "just"],
            hint: "Just water for now, thanks.",
            feedback: "Nicely done ordering a drink.",
            next: "order",
          },
        ],
      },
      order: {
        npc: "Great choice. Are you ready to order, or do you need a few more minutes?",
        options: [
          {
            keywords: ["ready", "like", "have the", "i'll have", "order"],
            hint: "I'm ready. I'll have the grilled salmon.",
            feedback: "Perfect — 'I'll have the ___' is the standard way to order.",
            next: "confirm",
          },
          {
            keywords: ["few more minutes", "not yet", "need"],
            hint: "Could we have a few more minutes, please?",
            feedback: "Good, polite way to ask for more time.",
            next: "order",
          },
        ],
      },
      confirm: {
        npc: "Excellent choice. Anything else for you?",
        options: [
          {
            keywords: ["no", "that's all", "that's it"],
            hint: "No, that's all, thank you.",
            feedback: "You're all set!",
            next: "end",
          },
          {
            keywords: ["yes", "also", "and", "could i"],
            hint: "Yes, could I also get a side salad?",
            feedback: "Nice, adding an extra item smoothly.",
            next: "end",
          },
        ],
      },
      end: {
        npc: "Perfect, I'll put that order in right away. Enjoy your meal!",
        options: [],
      },
    },
  },

  airport: {
    title: "공항 체크인",
    description: "체크인 카운터에서 직원과 대화하며 탑승 수속을 진행해보세요.",
    startNode: "checkin",
    nodes: {
      checkin: {
        npc: "Good morning! May I see your passport and ticket, please?",
        options: [
          {
            keywords: ["here", "you go", "here it is", "sure"],
            hint: "Sure, here you go.",
            feedback: "Simple and natural.",
            next: "bags",
          },
        ],
      },
      bags: {
        npc: "Thank you. Are you checking any bags today?",
        options: [
          {
            keywords: ["yes", "one bag", "two bags", "checking"],
            hint: "Yes, I have one bag to check.",
            feedback: "Good — clearly stating the number of bags.",
            next: "seat",
          },
          {
            keywords: ["no", "just", "carry-on", "carry on"],
            hint: "No, just this carry-on.",
            feedback: "Nice, that's how you'd say you're only carrying hand luggage.",
            next: "seat",
          },
        ],
      },
      seat: {
        npc: "Would you like a window or an aisle seat?",
        options: [
          {
            keywords: ["window"],
            hint: "Window seat, please.",
            feedback: "Got it, window seat.",
            next: "end",
          },
          {
            keywords: ["aisle"],
            hint: "Aisle seat, please.",
            feedback: "Got it, aisle seat.",
            next: "end",
          },
        ],
      },
      end: {
        npc: "Here's your boarding pass. Boarding starts at gate 22 in one hour. Have a great flight!",
        options: [],
      },
    },
  },
};
