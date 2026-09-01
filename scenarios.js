// Branching roleplay scenarios. Each node: NPC line (spoken via TTS, with a
// Korean translation in npcKo), a list of acceptable keyword sets the learner's
// speech should contain, a model answer shown as a hint (with hintKo), and the
// id of the next node per branch. "end" nodes have no options and close the scenario.

const SCENARIOS = {
  restaurant: {
    title: "레스토랑에서 주문하기",
    description: "웨이터와 대화하며 자리를 안내받고 음식을 주문해보세요.",
    startNode: "greet",
    nodes: {
      greet: {
        npc: "Good evening! Welcome to Luigi's. Do you have a reservation?",
        npcKo: "안녕하세요! 루이지스에 오신 걸 환영합니다. 예약하셨나요?",
        options: [
          {
            keywords: ["yes", "reservation"],
            hint: "Yes, I have a reservation.",
            hintKo: "네, 예약했어요.",
            feedback: "Great, that's a natural way to confirm a reservation.",
            next: "seated",
          },
          {
            keywords: ["no", "table for", "two", "one", "three"],
            hint: "No, I don't. Table for two, please.",
            hintKo: "아니요, 안 했어요. 두 명 자리로 부탁드려요.",
            feedback: "Good — that's exactly how you'd ask for a walk-in table.",
            next: "seated",
          },
        ],
      },
      seated: {
        npc: "Right this way. Here are your menus. Can I start you off with something to drink?",
        npcKo: "이쪽으로 오세요. 메뉴판입니다. 음료부터 주문하시겠어요?",
        options: [
          {
            keywords: ["water", "coke", "juice", "wine", "coffee", "tea", "just"],
            hint: "Just water for now, thanks.",
            hintKo: "일단 물이면 될 것 같아요, 감사합니다.",
            feedback: "Nicely done ordering a drink.",
            next: "order",
          },
        ],
      },
      order: {
        npc: "Great choice. Are you ready to order, or do you need a few more minutes?",
        npcKo: "좋은 선택이에요. 주문하시겠어요, 아니면 시간이 좀 더 필요하세요?",
        options: [
          {
            keywords: ["ready", "like", "have the", "i'll have", "order"],
            hint: "I'm ready. I'll have the grilled salmon.",
            hintKo: "네, 주문할게요. 구운 연어로 할게요.",
            feedback: "Perfect — 'I'll have the ___' is the standard way to order.",
            next: "confirm",
          },
          {
            keywords: ["few more minutes", "not yet", "need"],
            hint: "Could we have a few more minutes, please?",
            hintKo: "시간을 좀 더 주시겠어요?",
            feedback: "Good, polite way to ask for more time.",
            next: "order",
          },
        ],
      },
      confirm: {
        npc: "Excellent choice. Anything else for you?",
        npcKo: "훌륭한 선택이에요. 더 필요하신 거 있으세요?",
        options: [
          {
            keywords: ["no", "that's all", "that's it"],
            hint: "No, that's all, thank you.",
            hintKo: "아니요, 그게 다예요, 감사합니다.",
            feedback: "You're all set!",
            next: "end",
          },
          {
            keywords: ["yes", "also", "and", "could i"],
            hint: "Yes, could I also get a side salad?",
            hintKo: "네, 사이드 샐러드도 추가할 수 있을까요?",
            feedback: "Nice, adding an extra item smoothly.",
            next: "end",
          },
        ],
      },
      end: {
        npc: "Perfect, I'll put that order in right away. Enjoy your meal!",
        npcKo: "좋습니다, 바로 주문 넣어드릴게요. 맛있게 드세요!",
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
        npcKo: "좋은 아침입니다! 여권과 항공권 좀 보여주시겠어요?",
        options: [
          {
            keywords: ["here", "you go", "here it is", "sure"],
            hint: "Sure, here you go.",
            hintKo: "네, 여기 있어요.",
            feedback: "Simple and natural.",
            next: "bags",
          },
        ],
      },
      bags: {
        npc: "Thank you. Are you checking any bags today?",
        npcKo: "감사합니다. 오늘 부치실 짐이 있으신가요?",
        options: [
          {
            keywords: ["yes", "one bag", "two bags", "checking"],
            hint: "Yes, I have one bag to check.",
            hintKo: "네, 부칠 가방이 하나 있어요.",
            feedback: "Good — clearly stating the number of bags.",
            next: "seat",
          },
          {
            keywords: ["no", "just", "carry-on", "carry on"],
            hint: "No, just this carry-on.",
            hintKo: "아니요, 이 기내용 가방뿐이에요.",
            feedback: "Nice, that's how you'd say you're only carrying hand luggage.",
            next: "seat",
          },
        ],
      },
      seat: {
        npc: "Would you like a window or an aisle seat?",
        npcKo: "창가 좌석과 통로 좌석 중 어떤 걸 원하세요?",
        options: [
          {
            keywords: ["window"],
            hint: "Window seat, please.",
            hintKo: "창가 좌석으로 부탁드려요.",
            feedback: "Got it, window seat.",
            next: "end",
          },
          {
            keywords: ["aisle"],
            hint: "Aisle seat, please.",
            hintKo: "통로 좌석으로 부탁드려요.",
            feedback: "Got it, aisle seat.",
            next: "end",
          },
        ],
      },
      end: {
        npc: "Here's your boarding pass. Boarding starts at gate 22 in one hour. Have a great flight!",
        npcKo: "여기 탑승권입니다. 탑승은 한 시간 뒤 22번 게이트에서 시작해요. 즐거운 비행 되세요!",
        options: [],
      },
    },
  },
};
