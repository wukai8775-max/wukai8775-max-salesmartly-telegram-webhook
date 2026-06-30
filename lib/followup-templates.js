const FOLLOWUP_TEMPLATES = [
  {
    id: "stage_3h_goal_filter",
    stages: ["3h"],
    statuses: ["price_requested", "price_list_requested", "later_followup"],
    keywords: ["catalog", "price list", "product list", "menu", "goal"],
    text:
      "I know the product list can be a bit much to review at first. If you tell me your main goal, I can help narrow it down to 2-3 suitable options so you don't have to compare everything one by one. Are you mainly looking for weight management, recovery, anti-aging support, sleep/focus, or skin care?",
  },
  {
    id: "stage_6h_product_price",
    stages: ["6h"],
    statuses: [
      "price_requested",
      "price_list_requested",
      "quote_sent_no_reply",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["price", "size", "specification", "product"],
    text:
      "Just following up on the product you were checking earlier. If you're comparing prices, I can help explain the difference between the available sizes so you don't have to judge only by the unit price. Would you like me to suggest a more cost-effective first test option?",
  },
  {
    id: "stage_9h_quality_caution",
    stages: ["9h"],
    statuses: [
      "price_requested",
      "price_list_requested",
      "quote_sent_no_reply",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["coa", "quality", "authentic", "factory", "real"],
    text:
      "It's completely normal to be cautious for a first order. You don't have to rely only on what I say - you can check the product list, batch details, product photos, payment process, and shipping rules first. If your main concern is quality or authenticity, I can help prepare the key information for you to review.",
  },
  {
    id: "stage_24h_basic_test_order",
    stages: ["24h"],
    statuses: ["quote_sent_no_reply", "high_intent_no_reply", "price_requested", "price_objection"],
    keywords: ["quote", "order", "budget", "minimum"],
    text:
      "I reviewed the quote we discussed yesterday. If the full order feels a bit high for a first purchase, we can also start with a more basic test order, keeping only the core products while still meeting the minimum order requirement. That way you can test the product, shipping, and service first before considering a larger order.",
  },
  {
    id: "stage_48h_blocker_check",
    stages: ["48h"],
    statuses: [
      "quote_sent_no_reply",
      "payment_interest_no_reply",
      "shipping_question_no_reply",
      "price_requested",
      "price_list_requested",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["quote", "shipping", "payment", "quality", "minimum"],
    text:
      "I don't want to keep pushing before everything is clear. I just wanted to check what is holding you back right now - product price, minimum order amount, shipping cost, payment method, or quality documents? If you tell me which part matters most, I can help explain that part clearly first.",
  },
  {
    id: "stage_72h_final_stop",
    stages: ["72h"],
    statuses: [
      "quote_sent_no_reply",
      "payment_interest_no_reply",
      "shipping_question_no_reply",
      "later_followup",
      "price_requested",
      "price_list_requested",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["final", "later"],
    text:
      "I won't keep bothering you for now. If you need peptide products later, you can contact me here anytime and I'll help confirm the latest stock, price, and shipping cost again. Prices and inventory may change, so I can recheck everything when you're ready.",
  },
  {
    id: "price_list_no_reply",
    stages: ["3h", "6h", "24h"],
    statuses: ["price_requested", "price_list_requested"],
    keywords: ["price list", "catalog", "menu"],
    text:
      "The full price list is useful as a reference, but most customers don't need to review every product. If you'd like, I can help narrow it down based on your goal and budget so you only need to compare a few relevant options. What direction are you mainly looking for?",
  },
  {
    id: "stage_3h_order_intent",
    stages: ["3h"],
    statuses: ["high_intent_no_reply"],
    keywords: ["order", "buy", "ready", "place order"],
    text:
      "I can help you keep the order simple. Before moving forward, please confirm the products and quantities you want, and I can help make sure the order details are clear before any payment step.",
  },
  {
    id: "stage_3h_price_objection",
    stages: ["3h"],
    statuses: ["price_objection"],
    keywords: ["expensive", "high", "cheaper", "compared to", "price"],
    text:
      "I understand price matters, especially for a first order. If the current total feels high, I can help check whether a smaller test order or a more practical product combination would make more sense before you decide.",
  },
  {
    id: "stage_3h_product_question",
    stages: ["3h"],
    statuses: ["product_question_no_reply"],
    keywords: ["do you carry", "do you have", "pills", "oils", "product"],
    text:
      "I can help check the product options for you. If you tell me the specific product form or goal you are looking for, I can narrow it down instead of sending too many unrelated options.",
  },
  {
    id: "stage_3h_general_blocker",
    stages: ["3h"],
    statuses: [
      "quote_sent_no_reply",
      "payment_interest_no_reply",
      "shipping_question_no_reply",
      "later_followup",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["quote", "payment", "shipping", "later", "order", "delivery"],
    text:
      "Just checking in on the question from earlier. If anything is unclear, you can tell me the main point you want to confirm first - product, quantity, shipping, or payment - and I can help keep the next step simple.",
  },
  {
    id: "quote_no_reply",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["quote_sent_no_reply", "high_intent_no_reply", "price_objection"],
    keywords: ["quote", "total", "hidden charges", "budget"],
    text:
      "I just wanted to check whether the quote was clear. The total includes product cost, shipping, and payment-related fees, so there won't be hidden charges before payment. If the total is higher than your expected budget, I can help adjust it into a more basic first test order.",
  },
  {
    id: "one_box_no_reply",
    stages: ["6h", "9h", "24h"],
    statuses: ["price_requested", "quote_sent_no_reply", "price_objection"],
    keywords: ["one box", "1 box", "small order", "minimum"],
    text:
      "Starting with a small test order is completely understandable. The main issue is that one box usually doesn't meet our minimum online order amount. I can help build a lowest-cost test order without adding unnecessary products, just enough to meet the minimum requirement. Would you prefer adding the same product or a lower-cost item that may still be useful later?",
  },
  {
    id: "shipping_cost_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["shipping_question_no_reply", "quote_sent_no_reply", "price_objection"],
    keywords: ["shipping cost", "freight", "delivery fee"],
    text:
      "International shipping can feel expensive for small orders because the basic handling and transport cost is relatively fixed. A more practical option is to make the order more balanced so the shipping cost is spread across more products, lowering the average cost per box. If you send me the final products and quantities you're considering, I can help recalculate a better total.",
  },
  {
    id: "payment_method_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["payment_interest_no_reply", "quote_sent_no_reply"],
    keywords: ["payment", "alibaba", "crypto", "btc", "usdt"],
    text:
      "For payment, we usually recommend Alibaba secure payment when available, because the order record is clearer and it gives both sides more protection. Before payment, I'll list the products, quantity, shipping cost, fees, and total clearly for you to confirm. If anything is unclear, you can ask first - no need to rush the payment.",
  },
  {
    id: "shipping_time_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["shipping_question_no_reply"],
    keywords: ["delivery", "how long", "tracking", "transit"],
    text:
      "For the U.S. route, after payment is confirmed, we usually need 24-48 hours to verify the order, pack it, and complete the final quality check. The 3-7 days refers to the estimated transit time after the package is handed over to the carrier. Once the tracking number is available, I'll send it to you and keep following it until delivery.",
  },
  {
    id: "coa_quality_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["price_requested", "price_list_requested", "quote_sent_no_reply", "product_question_no_reply"],
    keywords: ["coa", "quality", "batch", "test result"],
    text:
      "Quality documents are definitely worth checking carefully, especially for a first order. You can focus on the product name, batch information, test result, and report details before deciding. If you send me the products you're considering, I can help confirm whether the corresponding batch documents are available.",
  },
  {
    id: "bulk_resale_followup",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["price_requested", "price_list_requested", "quote_sent_no_reply", "product_question_no_reply"],
    keywords: ["bulk", "resale", "reseller", "wholesale", "long-term"],
    text:
      "If you're buying for resale or bulk purchase, I'd suggest starting with a smaller test order first. It's better to confirm product quality, shipping speed, and communication stability before discussing long-term pricing, stable supply, or label printing. Which product would you like to test first?",
  },
  {
    id: "custom_label_followup",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["price_requested", "price_list_requested", "quote_sent_no_reply", "product_question_no_reply"],
    keywords: ["custom label", "label", "oem", "private label"],
    text:
      "For custom labels, we can currently support separate label printing. The label cost depends on material, size, design, and quantity. We do not provide full OEM manufacturing or label application service at the moment. If you're still testing, it may be better to start with regular products first, then discuss label printing after the product and shipping are confirmed stable.",
  },
  {
    id: "scam_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["price_requested", "price_list_requested", "quote_sent_no_reply", "price_objection"],
    keywords: ["scam", "trust", "real", "cautious", "safe"],
    text:
      "I understand why you'd be cautious for a first order. This market really does require careful checking. You can review product photos, order details, batch documents, payment process, and shipping rules first. After everything is clear, you can decide whether to continue - you don't have to rely only on a salesperson's words.",
  },
  {
    id: "shipping_customs_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["shipping_question_no_reply"],
    keywords: ["customs", "shipping", "country", "delivery"],
    text:
      "It's normal to be concerned about shipping and customs. After the goods are shipped, we keep following the logistics until delivery. If there is a serious shipping issue or customs problem, we will help handle it based on the order and tracking status, rather than leaving you to deal with the carrier alone. You can confirm the product and country first, and I'll check the current route and estimated delivery time.",
  },
  {
    id: "usable_period_concern",
    stages: ["6h", "9h", "24h", "48h"],
    statuses: ["price_requested", "quote_sent_no_reply"],
    keywords: ["how long", "period", "last", "cycle", "budget"],
    text:
      "The usable period mainly depends on the size you choose and the amount used each time. For a first purchase, I usually suggest not only looking at the single-box price, but also whether the quantity can cover a reasonable observation period. If you tell me your goal and budget, I can help keep the quantity within a more reasonable range.",
  },
  {
    id: "final_before_stop",
    stages: ["72h"],
    statuses: [
      "price_requested",
      "price_list_requested",
      "quote_sent_no_reply",
      "payment_interest_no_reply",
      "shipping_question_no_reply",
      "later_followup",
      "high_intent_no_reply",
      "price_objection",
      "product_question_no_reply",
    ],
    keywords: ["final", "stock", "price", "coa"],
    text:
      "I won't keep bothering you. If you need the latest price, stock, COA documents, or shipping information later, you can contact me here anytime and I'll help recheck everything for you. Have a good day.",
  },
];

function parseRawResult(rawResult) {
  if (!rawResult) {
    return {};
  }

  if (typeof rawResult === "object") {
    return rawResult;
  }

  try {
    return JSON.parse(rawResult);
  } catch {
    return {};
  }
}

function getUsedTemplateIds(logs = [], tasks = []) {
  const ids = new Set();

  for (const log of logs) {
    const raw = parseRawResult(log.raw_result);
    if (raw.template_id) {
      ids.add(raw.template_id);
    }
  }

  for (const task of tasks) {
    const raw = parseRawResult(task.raw_result);
    if (raw.template_id) {
      ids.add(raw.template_id);
    }
  }

  return ids;
}

function scoreTemplate(template, contextText) {
  const normalized = String(contextText || "").toLowerCase();
  let score = 0;

  for (const keyword of template.keywords || []) {
    if (normalized.includes(keyword.toLowerCase())) {
      score += 2;
    }
  }

  return score;
}

function selectFollowupTemplate({ status, stage, recentText, logs = [], tasks = [] }) {
  const usedIds = getUsedTemplateIds(logs, tasks);
  const candidates = FOLLOWUP_TEMPLATES
    .filter((template) => template.stages.includes(stage))
    .filter((template) => template.statuses.includes(status))
    .filter((template) => !usedIds.has(template.id))
    .sort((a, b) => scoreTemplate(b, recentText) - scoreTemplate(a, recentText));

  if (candidates[0]) {
    return candidates[0];
  }

  return FOLLOWUP_TEMPLATES.find((template) => template.stages.includes(stage) && !usedIds.has(template.id)) || null;
}

module.exports = {
  FOLLOWUP_TEMPLATES,
  getUsedTemplateIds,
  selectFollowupTemplate,
};
