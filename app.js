(function () {
  "use strict";

  var META_KEY = "restaurant-ai-demo-preview-v2-meta";
  var ORG_PREFIX = "restaurant-ai-demo-preview-v2-org-";
  var LEGACY_KEY = "restaurant-ai-demo-preview-v1";
  var THEME_KEY = "restaurant-ai-demo-preview-hym-theme";
  var CHROME_KEY = "restaurant-ai-demo-preview-t3-chrome";
  var SCREENS = ["tables", "wait", "pos", "hq", "finance", "guest", "compete", "settings"];

  var PEAK_SCREENS = ["tables", "wait", "pos"];
  var INSIGHT_SCREENS = ["hq", "finance", "guest", "compete", "settings"];
  var OVERDUE_WARN_MIN = 45;
  var OVERDUE_CRIT_MIN = 90;
  var INVITE_HOLD_MIN = 8; /* N1 原子補位 mock 倒數 */
  var DEFAULT_RESERVE_GRACE_MIN = 15; /* N5 訂位寬限（遲到／未到） */
  var LATE_APPROACH_MIN = 5; /* 距寬限結束 ≤5 分 → AI 建議釋放 */
  var DEFAULT_CLEAR_MIN = 8; /* N6 待清示意分鐘 */
  var DEFAULT_AVG_TURN_MIN = 25; /* N6 翻桌示意分鐘 */

  var selectedTableId = null;
  var waitFocusId = null;
  var statsExpanded = false;
  var moreOpen = false;
  var overflowOpen = false;
  /* Layout C 單焦點舞台 */
  var infoDrawerOpen = false;
  var posMenuOpen = false;
  var LAYOUT_DEFAULT = "C"; /* Owner lock 2026-09-13 */
  var undoTimer = null;
  var undoPayload = null;
  var hqPeriod = "day"; /* day | week — HQ report toggle */
  var aiDismissed = {}; /* mock AiSuggestion id → dismissed (session) */
  var SUGGESTION_TRAIL_MAX = 40; /* N4 durable accept/skip audit */
  var _trailSurface = null; /* last click surface: nowdo|null */
  /* N3 廚票齡：分鐘 since fire（sent_at）；綠／黃／紅 */
  var TICKET_AGE_OK_MAX = 8;      /* age < 8 → ok（綠） */
  var TICKET_AGE_WARN_MIN = 8;    /* age >= 8 → warn */
  var TICKET_AGE_CRIT_MIN = 15;   /* age >= 15 → crit */
  var QUEUE_DEPTH_PENALTY_MIN = 2; /* 佇列前每一單 +2 分剩餘 ETA */
  var KITCHEN_WARN_RATIO = 1.0;  /* legacy alias · 仍供註解對照 */
  var KITCHEN_CRIT_RATIO = 1.6;
  var selectedPartId = null; /* split part id on focused table */
  var pendingAssign = null; /* mock AI seat suggestions; never auto-commit */
  var backfillTargetTableId = null; /* Layout C：補位目標桌（空／已清） */
  var backfillPickIds = {}; /* 候位多選：partyId → true（跨 render 保留） */



  var CYCLE = ["empty", "dining", "dirty"];
  var LABEL = { empty: "空桌", dining: "用餐中", dirty: "待清", invited: "補位中", reserved: "訂位保留" };
  var PAY = ["現金", "刷卡", "LINE Pay"];

  var FEATURE_DEFS = [
    { key: "restaurant.reservation", label: "訂位／候位" },
    { key: "restaurant.pos1", label: "POS-1" },
    { key: "restaurant.device.t3", label: "桌況 T3" },
    { key: "restaurant.waitlist.multi_invite", label: "多組補位" },
    { key: "restaurant.analytics.store", label: "本店分析" },
    { key: "restaurant.analytics.cross_store", label: "跨店分析" }
  ];

  var PLAN_DEFS = {
    trial: {
      slug: "trial",
      name: "試營運",
      price: 0,
      priceLabel: "NT$ 0／60 天",
      l0Hint: "可用訂位／桌況／POS-1；多組補位需升級小店",
      features: [
        "restaurant.reservation",
        "restaurant.pos1",
        "restaurant.device.t3"
      ]
    },
    shop_small: {
      slug: "shop_small",
      name: "小店",
      price: 1980,
      priceLabel: "NT$ 1,980／月（假設）",
      l0Hint: "含多組補位與本店分析（示意）",
      features: [
        "restaurant.reservation",
        "restaurant.pos1",
        "restaurant.device.t3",
        "restaurant.waitlist.multi_invite",
        "restaurant.analytics.store"
      ]
    },
    shop_mid: {
      slug: "shop_mid",
      name: "中價",
      price: 4980,
      priceLabel: "NT$ 4,980／月（假設）",
      l0Hint: "含多組補位與本店分析（示意）",
      features: [
        "restaurant.reservation",
        "restaurant.pos1",
        "restaurant.device.t3",
        "restaurant.waitlist.multi_invite",
        "restaurant.analytics.store"
      ]
    },
    shop_high: {
      slug: "shop_high",
      name: "高端",
      price: 9800,
      priceLabel: "NT$ 9,800／月（假設）",
      l0Hint: "含跨店分析；仍需開啟跨店資料授權",
      features: [
        "restaurant.reservation",
        "restaurant.pos1",
        "restaurant.device.t3",
        "restaurant.waitlist.multi_invite",
        "restaurant.analytics.store",
        "restaurant.analytics.cross_store"
      ]
    }
  };

  var ORG_CATALOG = [
    {
      orgId: "org-demo-a",
      shortCode: "A7F2",
      name: "示範食堂 A",
      product: "restaurant",
      defaultPlan: "trial",
      trialDaysLeft: 47,
      subOrgs: []
    },
    {
      orgId: "org-demo-b",
      shortCode: "B3C9",
      name: "示範食堂 B",
      product: "restaurant",
      defaultPlan: "shop_mid",
      trialDaysLeft: 0,
      subOrgs: [{ id: "sub-b1", name: "忠孝分店（示意）" }]
    }
  ];

  var MENU = [
    { cat: "前菜／小食", items: [
      { id: "m1", name: "涼拌小黃瓜", price: 80, prepMinutes: 4, serveMinutes: 2 },
      { id: "m2", name: "蒜泥白肉", price: 160, prepMinutes: 8, serveMinutes: 3 },
      { id: "m3", name: "皮蛋豆腐", price: 90, prepMinutes: 3, serveMinutes: 2 }
    ]},
    { cat: "主食", items: [
      { id: "m4", name: "紅燒牛肉麵", price: 240, prepMinutes: 12, serveMinutes: 4 },
      { id: "m5", name: "蛤蜊絲瓜麵", price: 200, prepMinutes: 10, serveMinutes: 4 },
      { id: "m6", name: "滷肉飯", price: 90, prepMinutes: 5, serveMinutes: 2 },
      { id: "m7", name: "排骨便當", price: 160, prepMinutes: 9, serveMinutes: 3 }
    ]},
    { cat: "熱炒", items: [
      { id: "m8", name: "宮保雞丁", price: 280, prepMinutes: 14, serveMinutes: 5 },
      { id: "m9", name: "糖醋排骨", price: 320, prepMinutes: 16, serveMinutes: 5 },
      { id: "m10", name: "清炒時蔬", price: 160, prepMinutes: 7, serveMinutes: 3 }
    ]},
    { cat: "飲品", items: [
      { id: "m11", name: "古早味紅茶", price: 40, prepMinutes: 2, serveMinutes: 1 },
      { id: "m12", name: "檸檬愛玉", price: 70, prepMinutes: 3, serveMinutes: 1 },
      { id: "m13", name: "熱豆漿", price: 35, prepMinutes: 2, serveMinutes: 1 }
    ]}
  ];


  /* HQ multi-store mock — fake chain only; no real data / no GitHub sync */
  var HQ_MOCK = {
    day: {
      stores: [
        { id: "A", name: "示範食堂 A", area: "本館", covers: 86, revenue: 42800, turns: 12, waitConv: 68, avgPrepMin: 9.2, avgServeMin: 3.4 },
        { id: "B", name: "示範食堂 B", area: "忠孝", covers: 112, revenue: 61500, turns: 15, waitConv: 74, avgPrepMin: 8.1, avgServeMin: 2.9 },
        { id: "C", name: "示範食堂 C", area: "南港", covers: 64, revenue: 29100, turns: 9, waitConv: 55, avgPrepMin: 11.5, avgServeMin: 4.2 }
      ],
      anon: [
        { label: "店別甲", coversIdx: 58, turnIdx: 62, waitIdx: 51 },
        { label: "店別乙", coversIdx: 71, turnIdx: 55, waitIdx: 66 },
        { label: "店別丙", coversIdx: 44, turnIdx: 48, waitIdx: 40 }
      ]
    },
    week: {
      stores: [
        { id: "A", name: "示範食堂 A", area: "本館", covers: 512, revenue: 268400, turns: 71, waitConv: 66, avgPrepMin: 9.6, avgServeMin: 3.6 },
        { id: "B", name: "示範食堂 B", area: "忠孝", covers: 648, revenue: 381200, turns: 88, waitConv: 72, avgPrepMin: 8.4, avgServeMin: 3.1 },
        { id: "C", name: "示範食堂 C", area: "南港", covers: 390, revenue: 179800, turns: 54, waitConv: 58, avgPrepMin: 11.8, avgServeMin: 4.5 }
      ],
      anon: [
        { label: "店別甲", coversIdx: 61, turnIdx: 64, waitIdx: 53 },
        { label: "店別乙", coversIdx: 73, turnIdx: 57, waitIdx: 69 },
        { label: "店別丙", coversIdx: 47, turnIdx: 50, waitIdx: 42 }
      ]
    }
  };

  function moneyFmt(n) {
    return "NT$ " + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function defaultMeta() {
    return {
      currentOrgId: "org-demo-a",
      role: "manager",
      consentCrossStore: false
    };
  }

  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return defaultMeta();
      var m = JSON.parse(raw);
      if (!m || !m.currentOrgId) return defaultMeta();
      if (m.role !== "manager" && m.role !== "staff") m.role = "manager";
      if (typeof m.consentCrossStore !== "boolean") m.consentCrossStore = false;
      return m;
    } catch (e) {
      return defaultMeta();
    }
  }

  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
  }

  function orgKey(orgId) {
    return ORG_PREFIX + orgId;
  }

  function findOrg(orgId) {
    return ORG_CATALOG.find(function (o) { return o.orgId === orgId; }) || ORG_CATALOG[0];
  }

  function seedForOrg(orgId) {
    var org = findOrg(orgId);
    var now = Date.now();
    function ago(min) { return now - min * 60000; }
    if (orgId === "org-demo-b") {
      return decorateOrgState({
        orgId: orgId,
        shop: org.name,
        screen: "tables",
        plan: org.defaultPlan,
        seq: 40,
        covers: 62,
        turns: 18,
        tables: [
          { id: 1, name: "B1", seats: 2, status: "dining", party: "吳小姐", guests: 2, statusSince: ago(38) },
          { id: 2, name: "B2", seats: 2, status: "empty", party: "", guests: 0, statusSince: ago(5) },
          { id: 3, name: "B3", seats: 4, status: "dirty", party: "", guests: 0, statusSince: ago(12) },
          { id: 4, name: "B4", seats: 4, status: "dining", party: "鄭府上", guests: 3, statusSince: ago(72) },
          { id: 5, name: "B5", seats: 4, status: "reserved", party: "簡先生（訂位）", guests: 4, statusSince: ago(12),
            holdKind: "reservation", reservePartyId: 25, holdUntil: now + 3 * 60000 /* 約 3 分後逾寬限；可「加速遲到」 */ },
          { id: 6, name: "B6", seats: 6, status: "dining", party: "蔡先生", guests: 6, statusSince: ago(95) },
          { id: 7, name: "B7", seats: 6, capacity: 6, split: true, splitParts: [4, 2], status: "empty", party: "", guests: 0, statusSince: ago(8), prefZone: "大廳" },
          { id: 8, name: "B8", seats: 8, capacity: 8, splitParts: [4, 4], status: "dirty", party: "", guests: 0, statusSince: ago(50) }
        ],
        waitlist: [
          { id: 21, name: "謝小姐", size: 2, partySize: 2, waited: 6, member: true, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
          { id: 22, name: "馮先生", size: 4, partySize: 4, waited: 15, member: false, status: "waiting", guestType: "guest", channel: "線上", kind: "waitlist" },
          { id: 23, name: "鄧府上", size: 5, partySize: 5, waited: 9, member: true, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
          { id: 24, name: "潘小姐", size: 2, partySize: 2, waited: 3, member: false, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
          { id: 25, name: "簡先生", size: 4, partySize: 4, waited: 0, member: true, status: "held", guestType: "guest", channel: "線上", kind: "reservation", slot: "18:30", pref: "靠窗",
            reserveTableId: 5, heldAt: ago(12), reserveUntil: now + 3 * 60000 },
          { id: 26, name: "曹府上", size: 6, partySize: 6, waited: 0, member: false, status: "waiting", guestType: "guest", channel: "線上", kind: "reservation", slot: "19:00", pref: "" }
        ],
        ticket: { tableId: 1, pay: "刷卡", lines: [] },
        receipts: [
          { id: 31, time: "11:42", table: "B4", pay: "現金", amount: 560, items: 3 },
          { id: 32, time: "12:18", table: "B1", pay: "刷卡", amount: 880, items: 4 }
        ],
        staff: [
          { id: "s1", name: "林店長", role: "manager" },
          { id: "s2", name: "小美", role: "staff" }
        ],
        kitchenQueue: mockKitchenSeed(orgId),
        backfillRounds: [],
        soldOut: {},
        orderEvents: [],
        suggestionTrail: [],
        policy: { reservationGraceMin: DEFAULT_RESERVE_GRACE_MIN, noShowMin: DEFAULT_RESERVE_GRACE_MIN, clearMin: DEFAULT_CLEAR_MIN, avgTurnMin: DEFAULT_AVG_TURN_MIN },
        lateEvents: []
      });
    }
    return decorateOrgState({
      orgId: orgId,
      shop: org.name,
      screen: "tables",
      plan: org.defaultPlan,
      seq: 20,
      covers: 47,
      turns: 11,
      tables: [
        { id: 1, name: "T1", seats: 2, status: "empty", party: "", guests: 0, statusSince: ago(10) },
        { id: 2, name: "T2", seats: 2, status: "dining", party: "林先生", guests: 2, statusSince: ago(28) },
        { id: 3, name: "T3", seats: 4, status: "dining", party: "陳小姐", guests: 4, statusSince: ago(55) },
        { id: 4, name: "T4", seats: 4, capacity: 4, splitParts: [2, 2], status: "reserved", party: "趙先生（訂位）", guests: 4, statusSince: ago(12), prefZone: "靠窗",
          holdKind: "reservation", reservePartyId: 16, holdUntil: now + 3 * 60000 },
        { id: 5, name: "T5", seats: 4, status: "dirty", party: "", guests: 0, statusSince: ago(18) },
        { id: 6, name: "T6", seats: 6, status: "dining", party: "王府上", guests: 5, statusSince: ago(100) },
        { id: 7, name: "T7", seats: 6, capacity: 6, split: true, splitParts: [4, 2], status: "empty", party: "", guests: 0, statusSince: ago(15), prefZone: "大廳" },
        { id: 8, name: "T8", seats: 8, capacity: 8, splitParts: [4, 4], status: "empty", party: "", guests: 0, statusSince: ago(40) }
      ],
      waitlist: [
        { id: 11, name: "張小姐", size: 2, partySize: 2, waited: 12, member: true, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
        { id: 12, name: "黃先生", size: 4, partySize: 4, waited: 8, member: false, status: "waiting", guestType: "guest", channel: "線上", kind: "waitlist" },
        { id: 13, name: "劉府上", size: 6, partySize: 6, waited: 18, member: true, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
        { id: 14, name: "周小姐", size: 2, partySize: 2, waited: 5, member: false, status: "waiting", guestType: "guest", channel: "現場", kind: "waitlist" },
        { id: 15, name: "許先生", size: 3, partySize: 3, waited: 22, member: true, status: "waiting", guestType: "guest", channel: "線上", kind: "waitlist" },
        { id: 16, name: "趙先生", size: 4, partySize: 4, waited: 0, member: true, status: "held", guestType: "guest", channel: "線上", kind: "reservation", slot: "18:30", pref: "靠窗",
          reserveTableId: 4, heldAt: ago(12), reserveUntil: now + 3 * 60000 },
        { id: 17, name: "何府上", size: 6, partySize: 6, waited: 0, member: false, status: "waiting", guestType: "guest", channel: "線上", kind: "reservation", slot: "19:00", pref: "" }
      ],
      ticket: { tableId: 2, pay: "現金", lines: [] },
      receipts: [
        { id: 16, time: "11:20", table: "T2", pay: "現金", amount: 420, items: 3 },
        { id: 17, time: "12:05", table: "T6", pay: "LINE Pay", amount: 960, items: 5 }
      ],
      staff: [
        { id: "s1", name: "王店長", role: "manager" },
        { id: "s2", name: "阿華", role: "staff" }
      ],
      kitchenQueue: mockKitchenSeed(orgId),
      backfillRounds: [],
      soldOut: {},
      orderEvents: [],
      suggestionTrail: [],
      policy: { reservationGraceMin: DEFAULT_RESERVE_GRACE_MIN, noShowMin: DEFAULT_RESERVE_GRACE_MIN, clearMin: DEFAULT_CLEAR_MIN, avgTurnMin: DEFAULT_AVG_TURN_MIN },
      lateEvents: []
    });
  }

  function loadOrgState(orgId) {
    try {
      var raw = localStorage.getItem(orgKey(orgId));
      if (!raw) return seedForOrg(orgId);
      var data = JSON.parse(raw);
      if (!data || data.orgId !== orgId || !data.tables || !data.waitlist) {
        return seedForOrg(orgId);
      }
      if (!data.plan || !PLAN_DEFS[data.plan]) data.plan = findOrg(orgId).defaultPlan;
      if (!data.staff) data.staff = seedForOrg(orgId).staff;
      if (!data.shop) data.shop = findOrg(orgId).name;
      if (!data.receipts) data.receipts = [];
      if (!Array.isArray(data.kitchenQueue)) data.kitchenQueue = [];
      if (!Array.isArray(data.backfillRounds)) data.backfillRounds = [];
      if (!data.soldOut || typeof data.soldOut !== "object") data.soldOut = {};
      if (!Array.isArray(data.orderEvents)) data.orderEvents = [];
      if (!Array.isArray(data.suggestionTrail)) data.suggestionTrail = [];
      if (!Array.isArray(data.lateEvents)) data.lateEvents = [];
      if (!data.policy) data.policy = { reservationGraceMin: DEFAULT_RESERVE_GRACE_MIN, noShowMin: DEFAULT_RESERVE_GRACE_MIN, clearMin: DEFAULT_CLEAR_MIN, avgTurnMin: DEFAULT_AVG_TURN_MIN };
      data.kitchenQueue.forEach(function (o) {
        if (!o.sent_at && o.at) o.sent_at = o.at;
        (o.lines || []).forEach(function (l) {
          var t = dishTiming(l.id);
          if (l.prepMinutes == null) l.prepMinutes = t.prepMinutes;
          if (l.serveMinutes == null) l.serveMinutes = t.serveMinutes;
        });
      });
      data.tables.forEach(function (t) {
        if (!t.statusSince) t.statusSince = Date.now() - 15 * 60000;
        if (t.split == null && (t.name === "T7" || t.name === "B7") && t.status === "empty") {
          t.split = true;
          t.splitParts = t.splitParts || [4, 2];
        }
      });
      data.waitlist.forEach(function (p) {
        if (!p.channel) p.channel = p.member ? "線上" : "現場";
      });
      return decorateOrgState(data);
    } catch (e) {
      return seedForOrg(orgId);
    }
  }

  function saveOrgState() {
    if (!state || !state.orgId) return;
    try { localStorage.setItem(orgKey(state.orgId), JSON.stringify(state)); } catch (e) {}
  }

  function mockApiGet(resource, requestedOrgId) {
    if (requestedOrgId !== meta.currentOrgId) {
      return { ok: false, status: 404, error: "org_mismatch", data: null };
    }
    if (resource === "tables") return { ok: true, status: 200, data: state.tables.slice() };
    if (resource === "waitlist") return { ok: true, status: 200, data: state.waitlist.slice() };
    if (resource === "receipts") return { ok: true, status: 200, data: state.receipts.slice() };
    if (resource === "kitchenQueue") return { ok: true, status: 200, data: (state.kitchenQueue || []).slice() };
    if (resource === "soldOut") return { ok: true, status: 200, data: Object.assign({}, state.soldOut || {}) };
    if (resource === "openOrders") {
      return {
        ok: true,
        status: 200,
        data: (state.kitchenQueue || []).filter(function (o) { return isOpenCheck(o); })
      };
    }
    if (resource === "aiSuggestions") {
      return { ok: true, status: 200, data: mockAiSuggestions(), label: "mock · 建議＋確認 · 不自動改單" };
    }
    if (resource === "suggestionTrail") {
      return {
        ok: true,
        status: 200,
        data: (state.suggestionTrail || []).slice(),
        label: "N4 · 建議採納軌跡 · accept|skip"
      };
    }
    if (resource === "latePolicy") {
      return {
        ok: true,
        status: 200,
        data: getPolicy(),
        label: "N5 · 遲到／No-show 寬限（分）"
      };
    }
    if (resource === "lateEvents") {
      return {
        ok: true,
        status: 200,
        data: (state.lateEvents || []).slice(),
        label: "N5 · 遲到釋放時間軸"
      };
    }
    if (resource === "aiSeatAssign") {
      return {
        ok: true,
        status: 200,
        data: pendingAssign || [],
        label: "模擬 AI · 建議＋確認 · 不自動入座"
      };
    }
    if (resource === "analytics") {
      return {
        ok: true,
        status: 200,
        data: { covers: state.covers, turns: state.turns, shop: state.shop }
      };
    }
    if (resource === "hqAnalytics") {
      var pack = HQ_MOCK[hqPeriod] || HQ_MOCK.day;
      return {
        ok: true,
        status: 200,
        data: {
          period: hqPeriod,
          stores: pack.stores.slice(),
          consent: !!meta.consentCrossStore,
          anon: meta.consentCrossStore ? pack.anon.slice() : null,
          label: "示意·非正式／待 Owner"
        }
      };
    }
    if (resource === "waitSeatEta") {
      return {
        ok: true,
        status: 200,
        data: refreshWaitEtas(),
        label: "N6 · 候位座位 ETA · 與桌況同源 · 示意·非保證"
      };
    }
    return { ok: false, status: 404, error: "not_found", data: null };
  }

  function hasFeature(key) {
    var plan = PLAN_DEFS[state.plan] || PLAN_DEFS.trial;
    return plan.features.indexOf(key) !== -1;
  }

  function isManager() {
    return meta.role === "manager";
  }

  function featureLabel(key) {
    var f = FEATURE_DEFS.find(function (x) { return x.key === key; });
    return f ? f.label : "此功能";
  }

  function unlockPlanName(key) {
    if (key === "restaurant.analytics.cross_store") return "高端";
    if (key === "restaurant.waitlist.multi_invite" || key === "restaurant.analytics.store") return "小店";
    return "更高方案";
  }

  function unlockSlug(key) {
    if (key === "restaurant.analytics.cross_store") return "shop_high";
    if (key === "restaurant.waitlist.multi_invite" || key === "restaurant.analytics.store") return "shop_small";
    return null;
  }

  function lockedWhy(key) {
    return "方案不足。升級至「" + unlockPlanName(key) + "」後開啟。點此看升級示意（無真實扣款）。";
  }

  var meta = loadMeta();
  var state = loadOrgState(meta.currentOrgId);
  var simOffline = false;

  (function migrateLegacy() {
    try {
      if (localStorage.getItem(orgKey("org-demo-a"))) return;
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      var old = JSON.parse(raw);
      if (!old || !old.tables) return;
      var seeded = seedForOrg("org-demo-a");
      seeded.tables = old.tables;
      seeded.waitlist = (old.waitlist || []).map(function (p) {
        return Object.assign({ guestType: "guest" }, p);
      });
      seeded.covers = old.covers || seeded.covers;
      seeded.turns = old.turns || seeded.turns;
      seeded.ticket = old.ticket || seeded.ticket;
      seeded.receipts = old.receipts || seeded.receipts;
      seeded.seq = old.seq || seeded.seq;
      seeded.screen = old.screen || "tables";
      localStorage.setItem(orgKey("org-demo-a"), JSON.stringify(seeded));
      state = loadOrgState(meta.currentOrgId);
    } catch (e) {}
  })();

  function nextId() {
    state.seq += 1;
    return state.seq;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function hm(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function mdhm(d) { return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + hm(d); }

  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    var el = document.getElementById("toast");
    el.hidden = false;
    var actionHtml = "";
    if (opts.undo) {
      actionHtml = '<button type="button" class="toast-action ghost-action" id="toast-undo">復原</button>';
    } else if (opts.action && (opts.screen || opts.backfillTableId != null)) {
      actionHtml = '<button type="button" class="toast-action" id="toast-go" data-go-screen="' +
        esc(opts.screen || "wait") + '"' +
        (opts.backfillTableId != null
          ? (' data-backfill-table="' + esc(String(opts.backfillTableId)) + '"')
          : "") +
        ">" + esc(opts.action) + "</button>";
    }
    el.innerHTML = '<span class="toast-msg">' + esc(msg) + "</span>" + actionHtml;
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      el.hidden = true;
      el.innerHTML = "";
    }, opts.undo ? 30000 : 4200);
  }

  function countsNow() { return counts(); }

  function counts() {
    var empty = 0, dining = 0, dirty = 0, seated = 0;
    state.tables.forEach(function (t) {
      if (t.mergedInto) return;
      if (t.split && t.parts && t.parts.length) {
        t.parts.forEach(function (p) {
          if (p.status === "empty") empty += 1;
          if (p.status === "dining") { dining += 1; seated += p.guests || p.seats; }
          if (p.status === "dirty") dirty += 1;
        });
        return;
      }
      if (t.status === "empty") empty += 1;
      if (t.status === "dining") { dining += 1; seated += t.guests || tableCapacity(t); }
      if (t.status === "dirty") dirty += 1;
    });
    var waiting = state.waitlist.filter(function (p) {
      return p.status === "waiting" || p.status === "invited" || p.status === "held";
    }).length;
    var rate = (state.turns / state.tables.length).toFixed(1);
    return { empty: empty, dining: dining, dirty: dirty, seated: seated, waiting: waiting, rate: rate };
  }

  function partySizeOf(p) {
    return Number(p && (p.partySize != null ? p.partySize : p.size) || 0);
  }

  function tableCapacity(t) {
    return Number(t && (t.capacity != null ? t.capacity : t.seats) || 0);
  }

  function defaultSplitParts(cap) {
    cap = Number(cap) || 0;
    if (cap >= 8) return [4, 4];
    if (cap >= 6) return [4, 2];
    if (cap >= 4) return [2, 2];
    return null;
  }

  function splitLabel(parts) {
    return (parts || []).join("+");
  }

  function makeParts(sizes) {
    return (sizes || []).map(function (n, i) {
      return {
        id: String.fromCharCode(97 + i),
        seats: n,
        status: "empty",
        party: "",
        guests: 0,
        statusSince: Date.now()
      };
    });
  }

  function normalizeParty(p) {
    if (!p) return p;
    if (p.partySize == null) p.partySize = p.size;
    if (p.size == null) p.size = p.partySize;
    if (!p.kind) p.kind = p.slot ? "reservation" : "waitlist";
    if (p.pref == null) p.pref = "";
    if (p.slot == null) p.slot = "";
    if (p.reserveTableId == null) p.reserveTableId = null;
    if (p.reserveUntil == null) p.reserveUntil = null;
    if (p.heldAt == null) p.heldAt = null;
    if (p.lateReleasedAt == null) p.lateReleasedAt = null;
    return p;
  }

  function normalizeTable(t) {
    if (!t) return t;
    if (t.capacity == null) t.capacity = t.seats || 4;
    if (t.seats == null) t.seats = t.capacity;
    if (t.splitParts === undefined) t.splitParts = defaultSplitParts(tableCapacity(t));
    if (typeof t.split !== "boolean") t.split = !!(t.parts && t.parts.length);
    if (!Array.isArray(t.parts)) t.parts = [];
    if (t.split && !t.parts.length && t.splitParts && t.splitParts.length) {
      t.parts = makeParts(t.splitParts);
    }
    if (!t.prefZone) t.prefZone = "";
    if (t.mergedWith == null) t.mergedWith = null;
    if (t.mergedInto == null) t.mergedInto = null;
    if (t.holdId == null) t.holdId = null;
    if (t.holdUntil == null) t.holdUntil = null;
    if (t.holdKind == null) t.holdKind = t.status === "reserved" ? "reservation" : (t.holdId ? "backfill" : null);
    if (t.reservePartyId == null) t.reservePartyId = null;
    if (t.split) syncParentFromParts(t);
    return t;
  }

  function decorateOrgState(data) {
    if (!data) return data;
    if (!Array.isArray(data.backfillRounds)) data.backfillRounds = [];
    if (!data.soldOut || typeof data.soldOut !== "object") data.soldOut = {};
    if (!Array.isArray(data.orderEvents)) data.orderEvents = [];
    if (!Array.isArray(data.suggestionTrail)) data.suggestionTrail = [];
    if (!Array.isArray(data.lateEvents)) data.lateEvents = [];
    if (!Array.isArray(data.kitchenQueue)) data.kitchenQueue = [];
    data.policy = normalizePolicy(data.policy);
    data.kitchenQueue.forEach(migrateKitchenOrder);
    (data.tables || []).forEach(normalizeTable);
    (data.waitlist || []).forEach(normalizeParty);
    return data;
  }

  function normalizePolicy(p) {
    p = p && typeof p === "object" ? p : {};
    var g = Number(p.reservationGraceMin);
    if (!isFinite(g) || g < 1) g = DEFAULT_RESERVE_GRACE_MIN;
    if (g > 120) g = 120;
    var n = Number(p.noShowMin);
    if (!isFinite(n) || n < 1) n = g;
    if (n > 120) n = 120;
    var c = Number(p.clearMin);
    if (!isFinite(c) || c < 1) c = DEFAULT_CLEAR_MIN;
    if (c > 60) c = 60;
    var t = Number(p.avgTurnMin);
    if (!isFinite(t) || t < 5) t = DEFAULT_AVG_TURN_MIN;
    if (t > 180) t = 180;
    return {
      reservationGraceMin: Math.round(g),
      noShowMin: Math.round(n),
      clearMin: Math.round(c),
      avgTurnMin: Math.round(t)
    };
  }

  function getPolicy() {
    if (!state) return normalizePolicy(null);
    state.policy = normalizePolicy(state.policy);
    return state.policy;
  }

  function setPolicyField(key, val) {
    var p = getPolicy();
    var n = Number(val);
    if (!isFinite(n)) return;
    if (key === "clearMin") {
      n = Math.max(1, Math.min(60, Math.round(n)));
      p.clearMin = n;
    } else if (key === "avgTurnMin") {
      n = Math.max(5, Math.min(180, Math.round(n)));
      p.avgTurnMin = n;
    } else {
      n = Math.max(1, Math.min(120, Math.round(n)));
      if (key === "reservationGraceMin") p.reservationGraceMin = n;
      if (key === "noShowMin") p.noShowMin = n;
    }
    state.policy = p;
    saveOrgState();
  }

  /**
   * N6：座位候位 ETA（與桌況同源）。
   * 讀當下 tables + waiting 佇列順位 + 人數；非廚房出餐 ETA。
   */
  function listSeatEtaSlots() {
    var pol = getPolicy();
    var clearMin = pol.clearMin;
    var avgTurn = pol.avgTurnMin;
    var slots = [];
    (state.tables || []).forEach(function (t) {
      if (!t || t.mergedInto) return;
      if (t.holdId || t.status === "invited" || t.status === "reserved") return;
      if (t.split && t.parts && t.parts.length) {
        t.parts.forEach(function (part) {
          if (!part) return;
          var st = part.status;
          if (st !== "empty" && st !== "dirty" && st !== "dining") return;
          var waitMin = 0;
          var kind = "empty";
          if (st === "dirty") {
            kind = "dirty";
            waitMin = clearMin;
          } else if (st === "dining") {
            kind = "dining";
            var el = elapsedMin({ statusSince: part.statusSince || t.statusSince });
            waitMin = Math.max(5, avgTurn - (isFinite(el) ? el : 0));
          }
          slots.push({
            tableId: t.id,
            partId: part.id,
            name: t.name + "-" + String(part.id).toUpperCase(),
            seats: Number(part.seats) || 0,
            kind: kind,
            waitMin: waitMin,
            claimed: false
          });
        });
        return;
      }
      var st2 = t.status;
      if (st2 !== "empty" && st2 !== "dirty" && st2 !== "dining") return;
      var cap = tableCapacity(t);
      if (t.mergedWith) {
        var other = state.tables.find(function (x) { return x.id === t.mergedWith; });
        if (other) cap += tableCapacity(other);
      }
      var waitMin2 = 0;
      var kind2 = "empty";
      if (st2 === "dirty") {
        kind2 = "dirty";
        waitMin2 = clearMin;
      } else if (st2 === "dining") {
        kind2 = "dining";
        var el2 = elapsedMin(t);
        waitMin2 = Math.max(5, avgTurn - (isFinite(el2) ? el2 : 0));
      }
      slots.push({
        tableId: t.id,
        partId: null,
        name: t.name,
        seats: cap,
        kind: kind2,
        waitMin: waitMin2,
        claimed: false
      });
    });
    return slots;
  }

  function pickSlotForSize(slots, size) {
    size = Number(size) || 0;
    var cands = slots.filter(function (s) {
      return !s.claimed && s.seats >= size;
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      if (a.waitMin !== b.waitMin) return a.waitMin - b.waitMin;
      var rank = { empty: 0, dirty: 1, dining: 2 };
      var ra = rank[a.kind] != null ? rank[a.kind] : 9;
      var rb = rank[b.kind] != null ? rank[b.kind] : 9;
      if (ra !== rb) return ra - rb;
      return a.seats - b.seats;
    });
    return cands[0];
  }

  function seatEtaBandFromSlot(slot) {
    if (!slot) {
      return {
        band: "none",
        reason: "暫無",
        reasonChip: "暫無",
        minLo: null,
        minHi: null,
        seatEtaLabel: "暫無可配桌（示意·非保證）",
        guestLine: "目前位子較緊，有桌會再通知（示意·非保證）"
      };
    }
    if (slot.kind === "empty" || slot.waitMin <= 0) {
      return {
        band: "ready",
        reason: "空桌",
        reasonChip: "空桌",
        minLo: 0,
        minHi: 5,
        seatEtaLabel: "可叫號／較快（示意·非保證）",
        guestLine: "位子較快有空，店員可能很快叫號（示意·非保證）"
      };
    }
    if (slot.kind === "dirty") {
      var c = Math.max(1, Math.round(slot.waitMin));
      return {
        band: "clear",
        reason: "待清",
        reasonChip: "待清",
        minLo: Math.max(1, c - 2),
        minHi: c + 3,
        seatEtaLabel: "約 " + Math.max(1, c - 2) + "–" + (c + 3) + " 分·待清（示意·非保證）",
        guestLine: "還要一點時間清桌，大約再等等（示意·非保證）"
      };
    }
    var t = Math.max(5, Math.round(slot.waitMin));
    return {
      band: "turn",
      reason: "等翻桌",
      reasonChip: "等翻桌",
      minLo: Math.max(8, t - 5),
      minHi: t + 10,
      seatEtaLabel: "約 " + Math.max(8, t - 5) + "–" + (t + 10) + " 分·等翻桌（示意·非保證）",
      guestLine: "目前要等翻桌，大約還要一些時間（示意·非保證）"
    };
  }

  function computeSeatWaitEta(party, opts) {
    opts = opts || {};
    var list = refreshWaitEtas();
    if (!party) return null;
    var id = party.id != null ? party.id : party;
    for (var i = 0; i < list.length; i++) {
      if (list[i].partyId === id) return list[i];
    }
    return null;
  }

  function refreshWaitEtas() {
    var waiting = (state.waitlist || []).filter(function (p) {
      return p && p.status === "waiting";
    });
    var slots = listSeatEtaSlots();
    var out = [];
    waiting.forEach(function (p, idx) {
      var size = partySizeOf(p);
      var slot = pickSlotForSize(slots, size);
      if (slot) slot.claimed = true;
      var band = seatEtaBandFromSlot(slot);
      out.push({
        partyId: p.id,
        name: p.name,
        size: size,
        queuePos: idx + 1,
        band: band.band,
        reason: band.reason,
        reasonChip: band.reasonChip,
        minLo: band.minLo,
        minHi: band.minHi,
        seatEtaLabel: band.seatEtaLabel,
        guestLine: band.guestLine,
        tableHint: slot ? slot.name : "",
        tableKind: slot ? slot.kind : "",
        label: "示意·非保證 · 與桌況同源"
      });
    });
    return out;
  }

  function seatEtaByPartyId(partyId) {
    var list = refreshWaitEtas();
    for (var i = 0; i < list.length; i++) {
      if (list[i].partyId === partyId) return list[i];
    }
    return null;
  }

  function seatEtaChipHtml(eta) {
    if (!eta) return "";
    return (
      '<span class="seat-eta-chip band-' + esc(eta.band) + '" title="' +
        esc(eta.label || "示意·非保證") + '">' +
        '<span class="seat-eta-pos">第 ' + eta.queuePos + " 組</span>" +
        '<span class="seat-eta-lab">' + esc(eta.seatEtaLabel) + "</span>" +
        '<span class="seat-eta-reason">' + esc(eta.reasonChip) + "</span>" +
      "</span>"
    );
  }

  function longestWaitEta() {
    var list = refreshWaitEtas();
    if (!list.length) return null;
    var rank = { none: 3, turn: 2, clear: 1, ready: 0 };
    var best = list[0];
    list.forEach(function (e) {
      var rb = rank[best.band] != null ? rank[best.band] : 0;
      var re = rank[e.band] != null ? rank[e.band] : 0;
      if (re > rb || (re === rb && e.queuePos > best.queuePos)) best = e;
    });
    return best;
  }

  /** Demo：找一張待清桌清成空桌，讓候位 ETA 同源變短 */
  function demoClearOneForEta() {
    var dirty = (state.tables || []).find(function (t) {
      return t && !t.mergedInto && t.status === "dirty" && !t.split;
    });
    if (!dirty) {
      dirty = (state.tables || []).find(function (t) {
        return t && !t.mergedInto && t.split && t.parts &&
          t.parts.some(function (p) { return p.status === "dirty"; });
      });
      if (dirty) {
        var part = dirty.parts.find(function (p) { return p.status === "dirty"; });
        setTableStatus(dirty.id, "empty", { partId: part && part.id });
        toast("示範：已清 " + dirty.name + " → 空桌 · 候位 ETA 同源更新（示意·非保證）");
        return;
      }
      /* 若無待清：把一張用餐中標待清再清，方便 demo */
      var dining = (state.tables || []).find(function (t) {
        return t && !t.mergedInto && t.status === "dining" && !t.split;
      });
      if (dining) {
        setTableStatus(dining.id, "dirty", { silent: true });
        setTableStatus(dining.id, "empty");
        toast("示範：已結束並清 " + dining.name + " → 空桌 · 看候位 ETA（示意·非保證）");
        return;
      }
      toast("沒有可清的桌（可先在桌況把一桌標成待清）");
      return;
    }
    setTableStatus(dirty.id, "empty");
    toast("示範：已清 " + dirty.name + " → 空桌 · 候位 ETA 同源更新（示意·非保證）");
  }

  function migrateKitchenOrder(o) {
    if (!o) return o;
    if (o.checkClosed == null) o.checkClosed = false;
    if (!Array.isArray(o.sources) || !o.sources.length) {
      o.sources = [o.actor === "guest_device" ? "guest_device" : "pos"];
    }
    (o.lines || []).forEach(function (l) {
      if (!l.source) l.source = o.actor === "guest_device" ? "guest_device" : "pos";
    });
    return o;
  }

  function isOpenCheck(o) {
    return !!(o && !o.checkClosed && o.status !== "void");
  }

  function findOpenOrderForTable(tableId) {
    if (tableId == null || tableId === "" || Number(tableId) === 0) return null;
    var q = state.kitchenQueue || [];
    for (var i = 0; i < q.length; i++) {
      var o = q[i];
      if (isOpenCheck(o) && Number(o.tableId) === Number(tableId)) return o;
    }
    return null;
  }

  function spineOrderId() {
    return "o" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function sourceLabel(src) {
    if (src === "guest_device") return "桌邊QR";
    if (src === "pos") return "櫃台";
    return "—";
  }

  function sourceChipsHtml(sources) {
    var set = {};
    (sources || []).forEach(function (s) { set[s] = true; });
    var html = "";
    if (set.pos) html += '<span class="src-chip src-pos" title="櫃台 POS">櫃台</span>';
    if (set.guest_device) html += '<span class="src-chip src-qr" title="桌邊掃碼">桌邊QR</span>';
    return html || '<span class="src-chip">—</span>';
  }

  function lineSourceChip(src) {
    return '<span class="src-chip tiny ' +
      (src === "guest_device" ? "src-qr" : "src-pos") + '">' +
      esc(sourceLabel(src)) + "</span>";
  }

  function pushOrderEvent(tableId, tableLabel, kind, text, meta) {
    if (!Array.isArray(state.orderEvents)) state.orderEvents = [];
    state.orderEvents.unshift({
      id: "ev" + Date.now().toString(36) + Math.floor(Math.random() * 100).toString(36),
      at: Date.now(),
      tableId: tableId == null ? null : Number(tableId),
      table: tableLabel || "",
      kind: kind,
      text: text,
      source: meta && meta.source ? meta.source : null,
      orderId: meta && meta.orderId ? meta.orderId : null
    });
    if (state.orderEvents.length > 100) state.orderEvents.length = 100;
  }


  /* ——— N4 AiSuggestion 採納軌跡（durable accept|skip）——— */
  function suggestionKindLabel(kind) {
    if (kind === "seat") return "分配";
    if (kind === "rush") return "催菜";
    if (kind === "mix") return "混單";
    if (kind === "nowdo") return "現在該做";
    if (kind === "nudge") return "節奏";
    if (kind === "late" || kind === "release") return "遲到釋放";
    if (kind === "wait_eta") return "座位候位";
    return kind || "建議";
  }

  function recordSuggestionDecision(opts) {
    opts = opts || {};
    if (!Array.isArray(state.suggestionTrail)) state.suggestionTrail = [];
    var rec = {
      id: "sug" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      suggestionId: opts.suggestionId || opts.id || "",
      kind: opts.kind || "nudge",
      target: opts.target == null ? "" : String(opts.target),
      decision: opts.decision === "accept" ? "accept" : "skip",
      at: Date.now(),
      reason: opts.reason || ""
    };
    state.suggestionTrail.unshift(rec);
    if (state.suggestionTrail.length > SUGGESTION_TRAIL_MAX) {
      state.suggestionTrail.length = SUGGESTION_TRAIL_MAX;
    }
    return rec;
  }

  function suggestionTrailHtml(opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    var compact = !!opts.compact;
    var trail = (state.suggestionTrail || []).slice(0, limit);
    if (!trail.length) {
      return (
        '<div class="suggestion-trail" aria-label="建議紀錄">' +
          '<div class="suggestion-trail-h">建議紀錄' +
            '<span class="line-fake-badge">N4 · 採納軌跡</span></div>' +
          '<p class="help">確認／略過 AI 建議後寫入此處（可稽核，非僅 toast）</p>' +
        "</div>"
      );
    }
    var lis = trail.map(function (r) {
      var t = new Date(r.at);
      var dec = r.decision === "accept" ? "採納" : "略過";
      var decCls = r.decision === "accept" ? "trail-accept" : "trail-skip";
      var tgt = r.target ? (" · " + esc(r.target)) : "";
      return (
        '<li class="suggestion-trail-item">' +
          '<div class="suggestion-trail-top">' +
            "<strong>" + hm(t) + "</strong>" +
            '<span class="src-chip tiny">' + esc(suggestionKindLabel(r.kind)) + "</span>" +
            '<span class="trail-decision ' + decCls + '">' + dec + "</span>" +
          "</div>" +
          '<div class="suggestion-trail-body">' +
            esc(r.reason || r.suggestionId || "") + tgt +
          "</div>" +
        "</li>"
      );
    }).join("");
    return (
      '<div class="suggestion-trail' + (compact ? " is-compact" : "") +
        '" aria-label="建議紀錄">' +
        '<div class="suggestion-trail-h">建議紀錄' +
          '<span class="line-fake-badge">N4 · 最近 ' + trail.length + "</span></div>" +
        "<ol>" + lis + "</ol>" +
      "</div>"
    );
  }

  function renderInsightTrail() {
    var host = document.getElementById("suggestion-trail-slot");
    if (!host) return;
    host.innerHTML = suggestionTrailHtml({ limit: 10 });
  }

  function orderEventsForTable(tableId, limit) {
    var n = limit || 8;
    return (state.orderEvents || []).filter(function (ev) {
      return Number(ev.tableId) === Number(tableId);
    }).slice(0, n);
  }

  function orderTimelineHtml(tableId) {
    var evs = orderEventsForTable(tableId, 8);
    if (!evs.length) {
      return (
        '<div class="bf-timeline order-spine-tl" aria-label="點餐來源時間軸">' +
          '<div class="bf-timeline-h">點餐來源 · 訂單脊柱</div>' +
          '<div class="bf-timeline-sub">尚無本桌點餐事件（櫃台送廚或桌邊 QR 送廚後出現）</div>' +
        "</div>"
      );
    }
    var open = findOpenOrderForTable(tableId);
    var head = open
      ? ("開單中 · #" + String(open.id).slice(-8) + " · " + sourceChipsHtml(open.sources))
      : "本桌近期事件";
    var lis = evs.map(function (ev) {
      var t = new Date(ev.at);
      return (
        "<li><strong>" + hm(t) + "</strong>　" + esc(ev.text) +
        (ev.source ? "　" + lineSourceChip(ev.source) : "") +
        "</li>"
      );
    }).join("");
    return (
      '<div class="bf-timeline order-spine-tl" aria-label="點餐來源時間軸">' +
        '<div class="bf-timeline-h">點餐來源 · 訂單脊柱</div>' +
        '<div class="bf-timeline-sub">' + head + "</div>" +
        "<ol>" + lis + "</ol>" +
      "</div>"
    );
  }

  function recomputeOrderTotals(order) {
    var amount = 0, prep = 0, serve = 0;
    var sources = {};
    (order.lines || []).forEach(function (l) {
      amount += (l.price || 0) * (l.qty || 0);
      var p = l.prepMinutes != null ? l.prepMinutes : 8;
      var s = l.serveMinutes != null ? l.serveMinutes : 3;
      if (p > prep) prep = p;
      if (s > serve) serve = s;
      if (l.source) sources[l.source] = true;
    });
    order.amount = amount;
    order.prepMinutes = prep || 8;
    order.serveMinutes = serve || 3;
    order.sources = Object.keys(sources);
    if (!order.sources.length) {
      order.sources = [order.actor === "guest_device" ? "guest_device" : "pos"];
    }
    return order;
  }

  function appendLinesToOpenOrder(opts) {
    if (!Array.isArray(state.kitchenQueue)) state.kitchenQueue = [];
    var now = new Date();
    var actor = opts.actor || "pos";
    var tableId = opts.tableId != null ? Number(opts.tableId) : 0;
    var tableLabel = opts.tableLabel || "外帶";
    var mapped = (opts.lines || []).map(function (l) {
      enrichLine(l);
      return {
        id: l.id,
        name: l.name,
        price: l.price,
        qty: l.qty,
        prepMinutes: l.prepMinutes,
        serveMinutes: l.serveMinutes,
        sent_at: now.getTime(),
        source: actor
      };
    });
    if (!mapped.length) return null;

    var open = tableId ? findOpenOrderForTable(tableId) : null;
    if (open) {
      mapped.forEach(function (nl) {
        var existing = (open.lines || []).find(function (x) {
          return x.id === nl.id && x.source === nl.source;
        });
        if (existing) existing.qty += nl.qty;
        else {
          if (!open.lines) open.lines = [];
          open.lines.push(nl);
        }
      });
      if (open.status === "done") {
        open.status = "sent";
        open.prep_started_at = null;
        open.ready_at = null;
        open.served_at = null;
      }
      open.actor = actor;
      open.time = hm(now);
      open.at = now.getTime();
      if (!open.sent_at) open.sent_at = now.getTime();
      if (opts.note) open.note = opts.note;
      recomputeOrderTotals(open);
      state.kitchenQueue = state.kitchenQueue.filter(function (o) { return o.id !== open.id; });
      state.kitchenQueue.unshift(open);
      pushOrderEvent(tableId, tableLabel, "append",
        sourceLabel(actor) + " 加點併入同一單 #" + String(open.id).slice(-8),
        { source: actor, orderId: open.id });
      return open;
    }

    var order = {
      id: spineOrderId(),
      actor: actor,
      sources: [actor],
      tableId: tableId,
      table: tableLabel,
      time: hm(now),
      at: now.getTime(),
      sent_at: now.getTime(),
      prep_started_at: null,
      ready_at: null,
      served_at: null,
      status: "sent",
      checkClosed: false,
      lines: mapped,
      amount: 0,
      note: opts.note || (actor === "guest_device" ? "桌邊客人送廚" : "櫃台 POS 送廚")
    };
    recomputeOrderTotals(order);
    state.kitchenQueue.unshift(order);
    pushOrderEvent(tableId, tableLabel, "open",
      "開單 · " + sourceLabel(actor) + " · #" + String(order.id).slice(-8),
      { source: actor, orderId: order.id });
    return order;
  }

  function closeOpenCheckForTable(tableId) {
    if (!tableId) return;
    var open = findOpenOrderForTable(tableId);
    if (!open) return;
    open.checkClosed = true;
    if (open.status !== "done") {
      open.status = "done";
      open.served_at = open.served_at || Date.now();
      open.ready_at = open.ready_at || open.served_at;
    }
    pushOrderEvent(tableId, open.table, "close",
      "結帳關單 · #" + String(open.id).slice(-8),
      { orderId: open.id });
  }

  function isSoldOut(dishId) {
    return !!(state.soldOut && state.soldOut[dishId]);
  }

  function toggleSoldOut(dishId, force) {
    if (!state.soldOut) state.soldOut = {};
    var next = force != null ? !!force : !state.soldOut[dishId];
    if (next) state.soldOut[dishId] = true;
    else delete state.soldOut[dishId];
    var d = findDish(dishId);
    var name = d ? d.name : dishId;
    pushOrderEvent(
      state.ticket && state.ticket.tableId ? Number(state.ticket.tableId) : null,
      "",
      "86",
      (next ? "86／售完：" : "恢復供應：") + name,
      { source: "pos" }
    );
    saveOrgState();
    toast(next ? ("已標售完：" + name + "（桌邊同步）") : ("已恢復：" + name));
    render();
  }

  function openOrderLinesHtml(order, editableDraft) {
    if (!order || !(order.lines || []).length) {
      return editableDraft || '<p class="help">尚無本桌開單。櫃台加點送廚或客人桌邊 QR 送廚後，會併入同一 order id。</p>';
    }
    var committed = order.lines.map(function (l) {
      enrichLine(l);
      return (
        '<div class="line is-committed">' +
          "<div>" + esc(l.name) + " " + lineSourceChip(l.source || order.actor) +
            '<div class="party-meta">NT$ ' + l.price + " · 已送廚</div>" +
            lineEtaHtml(l) +
          "</div>" +
          '<div class="qty"><span>' + l.qty + "</span></div>" +
          '<div class="line-amt">NT$ ' + (l.price * l.qty) + "</div>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="spine-order-meta">單號 <strong>#' + esc(String(order.id).slice(-8)) +
        "</strong>　" + sourceChipsHtml(order.sources) +
        '　<span class="help">同桌開單禁止雙開</span></div>' +
      committed + (editableDraft || "")
    );
  }

  function syncParentFromParts(t) {
    if (!t || !t.split || !t.parts || !t.parts.length) return t;
    var dining = 0, dirty = 0, empty = 0, invited = 0, guests = 0;
    var names = [];
    t.parts.forEach(function (p) {
      if (p.status === "dining") { dining += 1; guests += p.guests || 0; if (p.party) names.push(p.party); }
      else if (p.status === "dirty") dirty += 1;
      else if (p.status === "invited") { invited += 1; if (p.party) names.push(p.party); }
      else empty += 1;
    });
    if (dining) t.status = "dining";
    else if (invited) t.status = "invited";
    else if (dirty && !empty) t.status = "dirty";
    else if (dirty) t.status = "dirty";
    else t.status = "empty";
    t.guests = guests;
    t.party = names.join("／");
    t.seats = tableCapacity(t);
    return t;
  }

  function partById(t, partId) {
    if (!t || !t.parts) return null;
    return t.parts.find(function (p) { return p.id === partId; }) || null;
  }

  function tableDisplayName(t, partId) {
    if (!t) return "—";
    if (partId) {
      var p = partById(t, partId);
      return t.name + "-" + String(partId).toUpperCase() + (p ? "（" + p.seats + "）" : "");
    }
    if (t.split && t.splitParts) return t.name + " · " + splitLabel(t.splitParts);
    if (t.mergedWith) {
      var other = state.tables.find(function (x) { return x.id === t.mergedWith; });
      return t.name + "＋" + (other ? other.name : "?");
    }
    return t.name;
  }

  function canSplitTable(t) {
    if (!t || t.split || t.mergedWith || t.mergedInto) return false;
    if (t.status === "dining") return false;
    return !!(t.splitParts && t.splitParts.length >= 2);
  }

  function canUnsplitTable(t) {
    if (!t || !t.split || !t.parts || !t.parts.length) return false;
    return t.parts.every(function (p) { return p.status !== "dining"; });
  }

  function neighborEmpty(t) {
    if (!t || t.split || t.mergedWith || t.mergedInto || t.status !== "empty") return null;
    var idx = state.tables.indexOf(t);
    var cands = [];
    if (idx > 0) cands.push(state.tables[idx - 1]);
    if (idx < state.tables.length - 1) cands.push(state.tables[idx + 1]);
    return cands.find(function (x) {
      return x && !x.split && !x.mergedWith && !x.mergedInto && x.status === "empty";
    }) || null;
  }

  function splitTable(id) {
    var t = state.tables.find(function (x) { return x.id === id; });
    if (!t || !canSplitTable(t)) {
      toast("此桌目前不能拆（用餐中或無可拆桌型）");
      return;
    }
    var snap = snapshotTables();
    t.split = true;
    t.parts = makeParts(t.splitParts);
    if (t.status === "dirty") {
      t.parts.forEach(function (p) { p.status = "dirty"; p.statusSince = t.statusSince; });
    }
    syncParentFromParts(t);
    selectedPartId = t.parts[0] ? t.parts[0].id : null;
    saveOrgState();
    render();
    pushUndo("已拆 " + t.name + " 為 " + splitLabel(t.splitParts), snap);
  }

  function unsplitTable(id) {
    var t = state.tables.find(function (x) { return x.id === id; });
    if (!t || !canUnsplitTable(t)) {
      toast("半桌仍有客人，不能併回整桌");
      return;
    }
    var snap = snapshotTables();
    var anyDirty = t.parts.some(function (p) { return p.status === "dirty"; });
    t.split = false;
    t.parts = [];
    t.party = "";
    t.guests = 0;
    t.status = anyDirty ? "dirty" : "empty";
    t.statusSince = Date.now();
    selectedPartId = null;
    saveOrgState();
    render();
    pushUndo("已併回 " + t.name + "（" + tableCapacity(t) + " 人桌）", snap);
  }

  function joinNeighborTables(id) {
    var t = state.tables.find(function (x) { return x.id === id; });
    var n = neighborEmpty(t);
    if (!t || !n) {
      toast("沒有可併的鄰桌（需兩張空桌）");
      return;
    }
    var snap = snapshotTables();
    t.mergedWith = n.id;
    n.mergedInto = t.id;
    n.party = "併入 " + t.name;
    saveOrgState();
    render();
    pushUndo("已示意併桌 " + t.name + "＋" + n.name + "（未入座）", snap);
  }

  function unjoinTable(id) {
    var t = state.tables.find(function (x) { return x.id === id; });
    if (!t || !t.mergedWith) return;
    var n = state.tables.find(function (x) { return x.id === t.mergedWith; });
    var snap = snapshotTables();
    t.mergedWith = null;
    if (n) {
      n.mergedInto = null;
      if (n.party && n.party.indexOf("併入") === 0) n.party = "";
      if (n.status === "dining" && !n.guests) {
        n.status = "empty";
        n.party = "";
      }
    }
    saveOrgState();
    render();
    pushUndo("已取消併桌 " + t.name, snap);
  }

  function findEmptyTable(size) {
    size = Number(size) || 0;
    var best = null;
    var bestPart = null;
    state.tables.forEach(function (t) {
      if (t.mergedInto) return;
      if (t.holdId || t.status === "invited" || t.status === "reserved") return; /* N1/N5：軟鎖不可再佔 */
      if (t.split && t.parts) {
        t.parts.forEach(function (p) {
          if (p.status !== "empty" || p.seats < size) return;
          if (!bestPart || p.seats < bestPart.seats) {
            best = t;
            bestPart = p;
          }
        });
        return;
      }
      if (t.status !== "empty") return;
      var cap = tableCapacity(t);
      if (t.mergedWith) {
        var other = state.tables.find(function (x) { return x.id === t.mergedWith; });
        cap += tableCapacity(other);
      }
      if (cap < size) return;
      if (!best || cap < tableCapacity(best)) {
        best = t;
        bestPart = null;
      }
    });
    if (best && bestPart) best._assignPartId = bestPart.id;
    else if (best) best._assignPartId = null;
    return best;
  }

  function assignableParties() {
    return state.waitlist.filter(function (p) {
      return p.status === "waiting" || p.status === "invited" || p.status === "held";
    });
  }

  function mockSeatAssign() {
    var parties = assignableParties().slice();
    parties.sort(function (a, b) {
      function rank(p) {
        var r = 0;
        if (p.kind === "reservation") r += 80;
        if (p.status === "invited") r += 40;
        if (p.member) r += 16;
        r += Math.min(24, Number(p.waited) || 0);
        return r;
      }
      return rank(b) - rank(a);
    });
    var used = {};
    function mark(tableId, partId) {
      used[tableId + ":" + (partId || "*")] = true;
      if (!partId) used[tableId + ":*"] = true;
    }
    function taken(tableId, partId) {
      if (used[tableId + ":*"]) return true;
      if (partId && used[tableId + ":" + partId]) return true;
      return false;
    }
    var items = [];
    parties.forEach(function (p) {
      var size = partySizeOf(p);
      var pick = null;
      var action = "seat";
      var reason = "";
      var label = "—";
      var seats = 0;
      var partId = null;
      var mergeId = null;

      /* 1) empty split part that fits */
      state.tables.forEach(function (t) {
        if (pick || !t.split || taken(t.id)) return;
        (t.parts || []).forEach(function (part) {
          if (pick || part.status !== "empty" || taken(t.id, part.id)) return;
          if (part.seats < size) return;
          if (!pick || part.seats < pick.seats) {
            pick = { t: t, part: part, seats: part.seats };
          }
        });
      });
      if (pick) {
        action = "seat";
        partId = pick.part.id;
        seats = pick.seats;
        label = pick.t.name + "-" + partId.toUpperCase();
        reason = "拆桌 " + label + "（" + seats + " 人）接待 " + size + " 位";
      }

      /* 2) empty whole table, smallest fit */
      if (!pick) {
        state.tables.forEach(function (t) {
          if (t.split || t.mergedInto || t.status !== "empty" || taken(t.id)) return;
          var cap = tableCapacity(t);
          if (t.mergedWith) {
            var o = state.tables.find(function (x) { return x.id === t.mergedWith; });
            cap += tableCapacity(o);
          }
          if (cap < size) return;
          if (!pick || cap < pick.seats) pick = { t: t, part: null, seats: cap };
        });
        if (pick) {
          action = "seat";
          seats = pick.seats;
          label = pick.t.mergedWith
            ? pick.t.name + "＋併桌"
            : pick.t.name;
          if (pick.seats === size) reason = "人數剛好 " + seats + " 人桌";
          else if (pick.seats - size <= 1) reason = "接近桌型（" + seats + " 人桌坐 " + size + " 位）";
          else reason = "最小足夠空桌（" + seats + " 人）";
          if (pick.t.prefZone && p.pref && pick.t.prefZone === p.pref) {
            reason += "；符合「" + p.pref + "」";
          }
        }
      }

      /* 3) empty table that can split to fit */
      if (!pick) {
        state.tables.forEach(function (t) {
          if (pick || t.split || t.mergedInto || t.status !== "empty" || taken(t.id)) return;
          var parts = t.splitParts || defaultSplitParts(tableCapacity(t));
          if (!parts) return;
          var fit = parts.find(function (n) { return n >= size; });
          if (fit == null) return;
          pick = { t: t, part: null, seats: fit, splitSizes: parts, fit: fit };
        });
        if (pick) {
          action = "split-then-seat";
          var idx = pick.splitSizes.indexOf(pick.fit);
          partId = String.fromCharCode(97 + Math.max(0, idx));
          seats = pick.fit;
          label = pick.t.name + "-" + partId.toUpperCase() + "（先拆 " + splitLabel(pick.splitSizes) + "）";
          reason = "先拆 " + pick.t.name + " 為 " + splitLabel(pick.splitSizes) + "，以 " + seats + " 人半桌接待 " + size + " 位";
        }
      }

      /* 4) join two empty tables */
      if (!pick) {
        var empties = state.tables.filter(function (t) {
          return !t.split && !t.mergedInto && !t.mergedWith && t.status === "empty" && !taken(t.id);
        });
        var pair = null;
        for (var i = 0; i < empties.length && !pair; i++) {
          for (var j = i + 1; j < empties.length; j++) {
            if (tableCapacity(empties[i]) + tableCapacity(empties[j]) >= size) {
              pair = [empties[i], empties[j]];
              break;
            }
          }
        }
        if (pair) {
          pick = { t: pair[0], other: pair[1], seats: tableCapacity(pair[0]) + tableCapacity(pair[1]) };
          action = "merge-then-seat";
          mergeId = pair[1].id;
          seats = pick.seats;
          label = pair[0].name + "＋" + pair[1].name;
          reason = "併 " + label + " 接待 " + size + " 位（示意大桌）";
        }
      }

      if (p.kind === "reservation") reason = (reason ? reason + "；" : "") + "已訂 " + (p.slot || "") + " 優先";
        if (p.status === "held") reason = (reason ? reason + "；" : "") + "訂位保留中（N5 寬限）";
      else if (p.status === "invited") reason = (reason ? reason + "；" : "") + "已邀請";
      else if (p.member) reason = (reason ? reason + "；" : "") + "會員優先";
      else if ((p.waited || 0) >= 15) reason = (reason ? reason + "；" : "") + "候位較久";
      if (p.pref && reason.indexOf(p.pref) === -1) reason += "；偏好「" + p.pref + "」示意";
      if (!pick) {
        action = "none";
        reason = "目前沒有夠座的空桌／拆桌；請先清桌或拆併";
      } else {
        mark(pick.t.id, partId);
        if (mergeId) mark(mergeId, null);
      }

      items.push({
        id: "asg-" + p.id,
        partyId: p.id,
        tableId: pick ? pick.t.id : null,
        partId: partId,
        mergeTableId: mergeId,
        partyName: p.name,
        partySize: size,
        tableLabel: label,
        seats: seats,
        action: action,
        reason: reason || "模擬建議",
        kind: p.kind || "waitlist"
      });
    });
    return items;
  }

  function runAiSeatAssign() {
    pendingAssign = mockSeatAssign();
    render();
    toast("已產出模擬分配（非正式 AI）· 請店員確認後才入座，不會自動改承諾");
  }

  function dismissSeatSuggestion(sid) {
    if (!pendingAssign) return;
    var item = pendingAssign.find(function (x) { return x.id === sid; });
    pendingAssign = pendingAssign.filter(function (x) { return x.id !== sid; });
    if (!pendingAssign.length) pendingAssign = null;
    recordSuggestionDecision({
      suggestionId: sid,
      kind: "seat",
      target: item ? ((item.partyName || "") + "→" + (item.tableLabel || "—")) : sid,
      decision: "skip",
      reason: item ? ("略過分配 · " + (item.reason || item.partyName || "")) : "略過分配建議"
    });
    if (item && item.partyId) {
      var etaSkip = seatEtaByPartyId(item.partyId);
      if (etaSkip && etaSkip.band === "ready") {
        recordSuggestionDecision({
          suggestionId: sid + "-eta",
          kind: "wait_eta",
          target: (item.partyName || "") + "·第" + etaSkip.queuePos + "組",
          decision: "skip",
          reason: "略過可叫號座位建議 · 示意·非保證"
        });
      }
    }
    saveOrgState();
    render();
    toast("已略過此建議（未改桌況）· 已寫建議紀錄");
  }

  function applySeatSuggestion(sid) {
    if (!pendingAssign) return;
    var item = pendingAssign.find(function (x) { return x.id === sid; });
    if (!item) return;
    if (item.action === "none" || !item.tableId) {
      toast("此組尚無可用桌，無法確認");
      return;
    }
    var party = state.waitlist.find(function (p) { return p.id === item.partyId; });
    var table = state.tables.find(function (t) { return t.id === item.tableId; });
    if (!party || !table) {
      toast("建議已過期，請再按「AI 模擬分配」");
      return;
    }
    var snap = snapshotTables();
    if (item.action === "split-then-seat") {
      if (!table.split) {
        table.split = true;
        table.parts = makeParts(table.splitParts || defaultSplitParts(tableCapacity(table)));
      }
    }
    if (item.action === "merge-then-seat" && item.mergeTableId) {
      var other = state.tables.find(function (t) { return t.id === item.mergeTableId; });
      if (other) {
        table.mergedWith = other.id;
        other.mergedInto = table.id;
        other.status = "dining";
        other.party = party.name + "（併）";
        other.guests = 0;
        other.statusSince = Date.now();
      }
    }
    pendingAssign = pendingAssign.filter(function (x) { return x.id !== sid; });
    if (!pendingAssign.length) pendingAssign = null;
    var etaSnap = party.status === "waiting" ? seatEtaByPartyId(party.id) : null;
    recordSuggestionDecision({
      suggestionId: sid,
      kind: "seat",
      target: (party.name || "") + "→" + (item.tableLabel || table.name),
      decision: "accept",
      reason: "確認入座 · " + (item.reason || party.name)
    });
    if (etaSnap && (etaSnap.band === "ready" || etaSnap.band === "clear")) {
      recordSuggestionDecision({
        suggestionId: sid + "-eta",
        kind: "wait_eta",
        target: (party.name || "") + "·第" + etaSnap.queuePos + "組",
        decision: "accept",
        reason: "依座位 ETA（" + etaSnap.reasonChip + "）確認入座 · 示意·非保證"
      });
    }
    seatParty(party, table, item.partId, { silent: true });
    pushUndo("已確認入座 " + party.name + " → " + (item.tableLabel || table.name), snap);
  }

  function seatAssignStripHtml() {
    var cards = "";
    if (pendingAssign && pendingAssign.length) {
      cards = pendingAssign.map(function (s) {
        var kindLab = s.kind === "reservation" ? "訂位" : "候位";
        var can = s.action !== "none" && s.tableId;
        var etaS = s.partyId ? seatEtaByPartyId(s.partyId) : null;
        return (
          '<div class="seat-assign-card" data-seat-id="' + esc(s.id) + '">' +
            '<div class="seat-assign-top">' +
              '<span class="seat-assign-badge">模擬 AI · ' + kindLab + "</span>" +
              '<strong>' + esc(s.partyName) + "（" + s.partySize + " 位）</strong>" +
            "</div>" +
            '<div class="seat-assign-to">建議桌組　' + esc(s.tableLabel) + "</div>" +
            (etaS ? '<div class="seat-eta-inline">' + seatEtaChipHtml(etaS) + "</div>" : "") +
            '<p class="seat-assign-reason">' + esc(s.reason) + "</p>" +
            '<div class="seat-assign-actions">' +
              (can
                ? '<button type="button" class="btn ok" data-seat-confirm="' + esc(s.id) + '">確認入座</button>'
                : '<button type="button" class="btn" disabled>無法入座</button>') +
              '<button type="button" class="btn" data-seat-dismiss="' + esc(s.id) + '">略過</button>' +
            "</div>" +
          "</div>"
        );
      }).join("");
    }
    return (
      '<div class="seat-assign-strip" role="region" aria-label="AI 模擬分配">' +
        '<div class="seat-assign-h">' +
          "<strong>AI 模擬分配</strong>" +
          '<span class="sim-ai-chip">模擬 AI · 非正式</span>' +
        "</div>" +
        '<p class="help">依空桌、拆桌、已訂、候位優先級建議桌組。須店員確認才入座，不自動改承諾。</p>' +
        '<div class="seat-assign-toolbar">' +
          '<button type="button" class="btn primary" id="btn-ai-seat-assign">AI 模擬分配</button>' +
          (pendingAssign
            ? '<button type="button" class="btn" id="btn-ai-seat-clear">清除建議</button>'
            : "") +
        "</div>" +
        cards +
      "</div>"
    );
  }

  function countsNow() {
    return counts();
  }


  function switchOrg(orgId) {
    if (!findOrg(orgId)) return;
    saveOrgState();
    meta.currentOrgId = orgId;
    saveMeta();
    state = loadOrgState(orgId);
    render();
    toast("已切換至" + state.shop + "（各店資料分開）");
  }

  function elapsedMin(t) {
    if (!t || !t.statusSince) return 0;
    return Math.max(0, Math.floor((Date.now() - t.statusSince) / 60000));
  }

  function formatElapsed(t) {
    var ms = Math.max(0, Date.now() - (t.statusSince || Date.now()));
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return pad2(m) + ":" + pad2(s);
  }

  function overdueClass(t) {
    if (t.status !== "dining" && t.status !== "dirty") return "";
    var m = elapsedMin(t);
    if (m >= OVERDUE_CRIT_MIN) return " is-crit";
    if (m >= OVERDUE_WARN_MIN) return " is-warn";
    return "";
  }

  /* ——— POS AI＋事件時間軸（mock；無真 ML）——— */
  function dishTiming(id) {
    var d = findDish(id);
    return {
      prepMinutes: d && d.prepMinutes != null ? d.prepMinutes : 8,
      serveMinutes: d && d.serveMinutes != null ? d.serveMinutes : 3
    };
  }

  function enrichLine(line) {
    var t = dishTiming(line.id);
    if (line.prepMinutes == null) line.prepMinutes = t.prepMinutes;
    if (line.serveMinutes == null) line.serveMinutes = t.serveMinutes;
    return line;
  }

  function orderPrepMinutes(o) {
    var lines = (o && o.lines) || [];
    if (!lines.length) return o && o.prepMinutes != null ? o.prepMinutes : 8;
    var max = 0;
    lines.forEach(function (l) {
      enrichLine(l);
      if (l.prepMinutes > max) max = l.prepMinutes;
    });
    return o.prepMinutes != null ? o.prepMinutes : max;
  }

  function orderServeMinutes(o) {
    var lines = (o && o.lines) || [];
    if (!lines.length) return o && o.serveMinutes != null ? o.serveMinutes : 3;
    var max = 0;
    lines.forEach(function (l) {
      enrichLine(l);
      if (l.serveMinutes > max) max = l.serveMinutes;
    });
    return o.serveMinutes != null ? o.serveMinutes : max;
  }

  function waitMsFrom(at) {
    if (!at) return 0;
    return Math.max(0, Date.now() - Number(at));
  }

  function formatWaitMmSs(at) {
    var totalSec = Math.floor(waitMsFrom(at) / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return pad2(m) + ":" + pad2(s);
  }

  function ticketAgeMinutes(o) {
    if (!o) return 0;
    var at = o.sent_at || o.at;
    if (!at) return 0;
    return waitMsFrom(at) / 60000;
  }

  /** N3：綠 ok／黃 warn／紅 crit（分鐘 since fire） */
  function ticketAgeLevel(o) {
    if (!o || o.status === "done" || o.checkClosed) return "";
    var age = ticketAgeMinutes(o);
    if (age >= TICKET_AGE_CRIT_MIN) return "crit";
    if (age >= TICKET_AGE_WARN_MIN) return "warn";
    return "ok";
  }

  /** 僅超時（warn／crit）— 相容舊呼叫 */
  function kitchenOverdueLevel(o) {
    var lv = ticketAgeLevel(o);
    if (lv === "warn" || lv === "crit") return lv;
    return "";
  }

  function kitchenAgeClass(o) {
    var lv = ticketAgeLevel(o);
    if (lv === "crit") return " is-crit";
    if (lv === "warn") return " is-warn";
    if (lv === "ok") return " is-ok";
    return "";
  }

  function kitchenOverdueClass(o) {
    return kitchenAgeClass(o);
  }

  function openKitchenSorted() {
    return (state.kitchenQueue || []).filter(function (o) {
      return o && o.status !== "done" && !o.checkClosed;
    }).slice().sort(function (a, b) {
      return (Number(a.sent_at || a.at || 0) - Number(b.sent_at || b.at || 0));
    });
  }

  function queueDepthAhead(order) {
    if (!order) return 0;
    var open = openKitchenSorted();
    var depth = 0;
    for (var i = 0; i < open.length; i++) {
      if (open[i].id === order.id) break;
      depth += 1;
    }
    return depth;
  }

  /** 同源 ETA：票齡＋佇列深度；非靜態行銷分鐘 */
  function liveEtaForOrder(order) {
    var prep = orderPrepMinutes(order);
    var serve = orderServeMinutes(order);
    var age = ticketAgeMinutes(order);
    var depth = queueDepthAhead(order);
    var remPrep = Math.max(0, Math.ceil(prep - age)) + depth * QUEUE_DEPTH_PENALTY_MIN;
    return {
      ageMin: age,
      ageLevel: ticketAgeLevel(order),
      queueDepth: depth,
      prepBase: prep,
      serveBase: serve,
      remainingPrep: remPrep,
      remainingServe: serve,
      remainingTotal: remPrep + serve
    };
  }

  function agePillLabel(lv) {
    if (lv === "crit") return "紅·嚴重";
    if (lv === "warn") return "黃·偏久";
    if (lv === "ok") return "綠·正常";
    return "—";
  }

  function fohLiveEtaHtml(order) {
    if (!order || order.status === "done") return "";
    var eta = liveEtaForOrder(order);
    var lv = eta.ageLevel || "ok";
    return (
      '<div class="foh-live-eta is-' + lv + '" data-foh-eta-order="' + esc(order.id) + '"' +
        ' title="同源票齡＋佇列深度 · mock · 非保證分鐘">' +
        '<div class="foh-live-eta-h">FOH／客人 ETA（同源票齡）</div>' +
        '<div class="foh-live-eta-row">' +
          '<span>票齡 <strong data-foh-age>' + Math.floor(eta.ageMin) + "</strong> 分" +
            ' <span class="age-pill age-' + lv + '">' + agePillLabel(lv) + "</span></span>" +
          '<span>佇列前 <strong data-foh-depth>' + eta.queueDepth + "</strong> 單</span>" +
          '<span>剩餘製作約 <strong data-foh-rem-prep>' + eta.remainingPrep + "</strong> 分</span>" +
          '<span>送餐約 <strong data-foh-rem-serve>' + eta.remainingServe + "</strong> 分</span>" +
        "</div>" +
        '<p class="help">隨票齡／佇列更新 · 催菜確認不改承諾 · 非保證分鐘</p>' +
      "</div>"
    );
  }

  function confirmRush(orderId) {
    var o = (state.kitchenQueue || []).find(function (x) { return x.id === orderId; });
    if (!o) {
      toast("找不到廚票");
      return;
    }
    o.rushConfirmed = true;
    o.rushConfirmedAt = Date.now();
    /* 硬線：不靜默改 prep／serve／承諾 */
    pushOrderEvent(
      o.tableId,
      o.table,
      "rush_confirm",
      "確認催菜 · " + o.table + " · #" + String(o.id).slice(-8) + "（未改承諾時間）",
      { orderId: o.id, source: "pos" }
    );
    recordSuggestionDecision({
      suggestionId: "rush-" + o.id,
      kind: _trailSurface === "nowdo" ? "nowdo" : "rush",
      target: o.table + " · #" + String(o.id).slice(-8),
      decision: "accept",
      reason: _trailSurface === "nowdo"
        ? "現在該做 · 確認催菜（未改承諾）"
        : "確認催菜（未改承諾）· 票齡門檻"
    });
    aiDismissed["nudge-late"] = true;
    aiDismissed["rush-" + o.id] = true;
    aiDismissed["nowdo-rush"] = true;
    saveOrgState();
    render();
    toast("已確認催菜（事件＋建議紀錄）· 未自動改承諾／ETA 基線");
  }

  function skipRush(orderId) {
    var o = (state.kitchenQueue || []).find(function (x) { return x.id === orderId; });
    if (!o) {
      toast("找不到廚票");
      return;
    }
    o.rushSkipped = true;
    o.rushSkippedAt = Date.now();
    pushOrderEvent(
      o.tableId,
      o.table,
      "rush_skip",
      "略過催菜 · " + o.table + " · #" + String(o.id).slice(-8),
      { orderId: o.id, source: "pos" }
    );
    recordSuggestionDecision({
      suggestionId: "rush-" + o.id,
      kind: _trailSurface === "nowdo" ? "nowdo" : "rush",
      target: o.table + " · #" + String(o.id).slice(-8),
      decision: "skip",
      reason: _trailSurface === "nowdo"
        ? "現在該做 · 略過催菜"
        : "略過催菜 · 未改單"
    });
    aiDismissed["nudge-late"] = true;
    aiDismissed["rush-" + o.id] = true;
    aiDismissed["nowdo-rush"] = true;
    saveOrgState();
    render();
    toast("已略過催菜（事件＋建議紀錄）· 未改單");
  }

  function kitchenEventsHtml() {
    var evs = (state.orderEvents || []).filter(function (ev) {
      return ev.kind === "rush_confirm" || ev.kind === "rush_skip" ||
        ev.kind === "open" || ev.kind === "append";
    }).slice(0, 10);
    if (!evs.length) {
      return (
        '<div class="kitchen-events">' +
          '<div class="kitchen-events-h">廚房／催菜事件</div>' +
          '<p class="help">催菜確認／略過後寫入此處（與桌況時間軸同源）</p>' +
        "</div>"
      );
    }
    var lis = evs.map(function (ev) {
      var t = new Date(ev.at);
      var tag = ev.kind === "rush_confirm" ? "催菜確認" :
        ev.kind === "rush_skip" ? "催菜略過" :
        ev.kind === "open" ? "開單" : "併單";
      return (
        "<li><strong>" + hm(t) + "</strong>　" +
        '<span class="src-chip tiny">' + tag + "</span>　" +
        esc(ev.text) + "</li>"
      );
    }).join("");
    return (
      '<div class="kitchen-events" aria-label="廚房事件列表">' +
        '<div class="kitchen-events-h">廚房／催菜事件</div>' +
        "<ol>" + lis + "</ol>" +
      "</div>"
    );
  }

  function lineEtaHtml(line) {
    enrichLine(line);
    return (
      '<div class="line-eta" title="mock 預估 · 非保證分鐘">' +
        "預估製作 " + line.prepMinutes + " 分　·　預估送餐 " + line.serveMinutes + " 分" +
      "</div>"
    );
  }

  function mockKitchenSeed(orgId) {
    /* demo overdue／正常單，事件時間戳齊 */
    var now = Date.now();
    function ago(min) { return now - min * 60000; }
    var lateTable = orgId === "org-demo-b" ? "B4" : "T3";
    var okTable = orgId === "org-demo-b" ? "B1" : "T2";
    var lateId = orgId === "org-demo-b" ? 4 : 3;
    var okId = orgId === "org-demo-b" ? 1 : 2;
    return [
      {
        id: "seed-late-" + (orgId || "a"),
        actor: "pos",
        tableId: lateId,
        table: lateTable,
        time: "16:52",
        at: ago(22),
        sent_at: ago(22),
        prep_started_at: null,
        ready_at: null,
        served_at: null,
        status: "sent",
        prepMinutes: 12,
        serveMinutes: 4,
        sources: ["pos"],
        checkClosed: false,
        lines: [
          { id: "m4", name: "紅燒牛肉麵", price: 240, qty: 2, prepMinutes: 12, serveMinutes: 4, source: "pos" },
          { id: "m8", name: "宮保雞丁", price: 280, qty: 1, prepMinutes: 14, serveMinutes: 5, source: "pos" }
        ],
        amount: 760,
        note: "seed·超時示意"
      },
      {
        id: "seed-ok-" + (orgId || "a"),
        actor: "guest_device",
        tableId: okId,
        table: okTable,
        time: "17:05",
        at: ago(4),
        sent_at: ago(4),
        prep_started_at: ago(3),
        ready_at: null,
        served_at: null,
        status: "ack",
        prepMinutes: 8,
        serveMinutes: 3,
        sources: ["guest_device"],
        checkClosed: false,
        lines: [
          { id: "m2", name: "蒜泥白肉", price: 160, qty: 1, prepMinutes: 8, serveMinutes: 3, source: "guest_device" },
          { id: "m11", name: "古早味紅茶", price: 40, qty: 2, prepMinutes: 2, serveMinutes: 1, source: "guest_device" }
        ],
        amount: 240,
        note: "seed·桌邊"
      }
    ];
  }

  function mockAiSuggestions() {
    var q = (state.kitchenQueue || []).filter(function (o) {
      return o.status !== "done" && !o.checkClosed;
    });
    var late = q.filter(function (o) {
      return kitchenOverdueLevel(o) && !o.rushConfirmed && !o.rushSkipped;
    });
    var sug = [];
    lateSuggestTargets().forEach(function (p) {
      var tlab = "";
      var tb = state.tables.find(function (x) { return x.id === p.reserveTableId; });
      if (tb) tlab = tb.name;
      var past = isReservationPastGrace(p);
      sug.push({
        id: "late-" + p.id,
        kind: "late",
        text: (past ? "遲到釋放：" : "即將逾時：") + p.name +
          (tlab ? " · 留桌 " + tlab : "") +
          "（寬限 " + getPolicy().reservationGraceMin +
          " 分）。確認釋放桌位可回填候位——非 AI 消滅 no-show；尖峰訂金仍是硬控。",
        target: String(p.id)
      });
    });
    late.forEach(function (o) {
      var age = Math.floor(ticketAgeMinutes(o));
      sug.push({
        id: "rush-" + o.id,
        kind: "nudge",
        text: "催菜：" + o.table + " 票齡 " + age + " 分已過門檻（≥" +
          TICKET_AGE_WARN_MIN + " 分）。請確認催菜或略過——不自動改承諾。",
        target: o.id
      });
    });
    if (q.length >= 2) {
      sug.push({
        id: "mix-batch",
        kind: "mix",
        text: "混單：熱炒可併炒一次；飲品先出可降等待感（mock 建議，需確認）",
        target: null
      });
    } else if (state.ticket && state.ticket.lines && state.ticket.lines.length >= 2) {
      sug.push({
        id: "mix-ticket",
        kind: "mix",
        text: "混單：此單可先出飲品／小食，主菜稍後送達（mock）",
        target: null
      });
    } else if (!late.length) {
      sug.push({
        id: "nudge-idle",
        kind: "nudge",
        text: "節奏：尖峰可先清待清桌再接大桌；廚房負載示意正常（mock）",
        target: null
      });
    }
    return sug.filter(function (s) { return !aiDismissed[s.id]; });
  }

  function aiSuggestStripHtml() {
    var list = mockAiSuggestions();
    if (!list.length) return "";
    var cards = list.slice(0, 3).map(function (s) {
      var isRush = s.kind === "nudge" && s.target;
      var isLate = s.kind === "late";
      var kindLab = s.kind === "mix" ? "混單" : (isRush ? "催菜" : (isLate ? "遲到釋放" : "節奏"));
      var confLab = isRush ? "確認催菜" : (isLate ? "確認釋放" : "確認採納");
      var confAttr = isRush
        ? (' data-rush-confirm="' + esc(s.target) + '" data-ai-confirm="' + esc(s.id) + '"')
        : isLate
          ? (' data-late-confirm="' + esc(s.target) + '" data-ai-confirm="' + esc(s.id) + '"')
          : (' data-ai-confirm="' + esc(s.id) + '"');
      var skipAttr = isRush
        ? (' data-rush-skip="' + esc(s.target) + '" data-ai-dismiss="' + esc(s.id) + '"')
        : isLate
          ? (' data-late-skip="' + esc(s.target) + '" data-ai-dismiss="' + esc(s.id) + '"')
          : (' data-ai-dismiss="' + esc(s.id) + '"');
      return (
        '<div class="ai-suggest-card" data-ai-id="' + esc(s.id) + '"' +
          (s.target ? ' data-ai-target="' + esc(s.target) + '"' : "") + ">" +
          '<div class="ai-suggest-top">' +
            '<span class="ai-suggest-badge">AI · ' + kindLab + "</span>" +
            '<span class="help">建議＋確認 · 不自動改單／不改承諾</span>' +
          "</div>" +
          '<p class="ai-suggest-text">' + esc(s.text) + "</p>" +
          '<div class="ai-suggest-actions">' +
            '<button type="button" class="btn primary"' + confAttr + ">" + confLab + "</button>" +
            '<button type="button" class="btn"' + skipAttr + ">略過</button>" +
          "</div>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="ai-suggest-strip" role="region" aria-label="AI 建議（mock）">' +
        '<div class="ai-suggest-h"><strong>AI 建議</strong>' +
          '<span class="line-fake-badge">mock · 無真 ML · N4 採納軌跡</span></div>' +
        cards +
      "</div>"
    );
  }

  function clearUndo() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    undoPayload = null;
  }

  function snapshotWaitlist() {
    return state.waitlist.map(function (p) { return Object.assign({}, p); });
  }

  function pushUndo(label, snapshotTables) {
    clearUndo();
    undoPayload = { tables: snapshotTables, waitlist: snapshotWaitlist(), covers: state.covers, label: label };
    undoTimer = setTimeout(function () {
      undoPayload = null;
      undoTimer = null;
    }, 30000);
    toast(label, { undo: true });
  }

  function applyUndo() {
    if (!undoPayload) return;
    state.tables = undoPayload.tables;
    if (undoPayload.waitlist) state.waitlist = undoPayload.waitlist;
    if (undoPayload.covers != null) state.covers = undoPayload.covers;
    pendingAssign = null;
    clearUndo();
    saveOrgState();
    render();
    toast("已復原桌況");
  }

  function snapshotTables() {
    return state.tables.map(function (t) {
      var copy = Object.assign({}, t);
      if (t.parts) copy.parts = t.parts.map(function (p) { return Object.assign({}, p); });
      if (t.splitParts) copy.splitParts = t.splitParts.slice();
      return copy;
    });
  }

  function applyStatusFields(target, prev, next, seatsFallback) {
    if ((prev === "empty" || prev === "dirty") && next === "dining") {
      target.guests = target.guests || Math.min(seatsFallback, 2);
      target.party = target.party || "現場客";
      state.covers += target.guests;
    }
    if (prev === "dining" && next === "dirty") {
      target.party = "";
    }
    if (prev === "dirty" && next === "empty") {
      state.turns += 1;
      target.guests = 0;
      target.party = "";
    }
    if (prev === "dining" && next === "empty") {
      target.guests = 0;
      target.party = "";
    }
    target.status = next;
    target.statusSince = Date.now();
  }

  function setTableStatus(id, next, opts) {
    opts = opts || {};
    var t = state.tables.find(function (x) { return x.id === id; });
    if (!t) return;
    if (t.status === "invited" && next !== "invited") {
      var hid = t.holdId;
      t.holdId = null;
      t.holdUntil = null;
      if (hid) {
        var hol = holdById(hid);
        if (hol && hol.status === "open" && next === "dining") {
          /* 現場強行入座：關閉回合，邀請組標過期／不自動 lost */
        } else if (hol && hol.status === "open") {
          hol.status = "expired";
          appendHoldEvent(hol, "expire", null, "店員改桌態，釋放補位");
          (hol.partyIds || []).forEach(function (pid) {
            var pp = state.waitlist.find(function (x) { return x.id === pid; });
            if (pp && pp.status === "invited") {
              pp.status = "expired";
              pp.inviteUntil = null;
            }
          });
        }
      }
    }
    if (t.status === "reserved" && next !== "reserved") {
      var rp = (state.waitlist || []).find(function (x) { return x.id === t.reservePartyId; });
      t.reservePartyId = null;
      t.holdKind = null;
      t.holdUntil = null;
      if (rp && rp.status === "held" && next !== "dining") {
        rp.status = "waiting";
        rp.reserveTableId = null;
        rp.reserveUntil = null;
        pushLateEvent({
          type: "manual_unhold",
          partyId: rp.id,
          partyName: rp.name,
          tableId: t.id,
          tableLabel: t.name,
          note: "店員改桌態 · 取消訂位保留"
        });
      }
    }
    var partId = opts.partId != null ? opts.partId : selectedPartId;
    var part = t.split && partId ? partById(t, partId) : null;
    if (part) {
      if (part.status === next) return;
      var snapP = snapshotTables();
      applyStatusFields(part, part.status, next, part.seats);
      syncParentFromParts(t);
      selectedTableId = id;
      selectedPartId = part.id;
      saveOrgState();
      render();
      if (opts.silent) return;
      pushUndo("已標「" + (LABEL[next] || next) + "」· " + t.name + "-" + part.id.toUpperCase(), snapP);
      return;
    }
    if (t.status === next && !t.split) return;
    var snap = snapshotTables();
    if (t.split && t.parts && t.parts.length) {
      t.parts.forEach(function (p) {
        if (p.status !== next) applyStatusFields(p, p.status, next, p.seats);
      });
      syncParentFromParts(t);
    } else {
      applyStatusFields(t, t.status, next, tableCapacity(t));
    }
    selectedTableId = id;
    saveOrgState();
    render();
    if (opts.silent) return;
    var lab = LABEL[next] || next;
    pushUndo("已標「" + lab + "」· " + t.name, snap);
  }

  function cycleTable(id) {
    var t = state.tables.find(function (x) { return x.id === id; });
    if (!t) return;
    var i = CYCLE.indexOf(t.status);
    var next = CYCLE[(i + 1) % CYCLE.length];
    setTableStatus(id, next);
  }

  function selectTable(id) {
    selectedTableId = id;
    selectedPartId = null;
    render();
  }

  function seatParty(party, table, partId, opts) {
    opts = opts || {};
    var size = partySizeOf(party);
    var label = table.name;
    if (partId && table.split) {
      var part = partById(table, partId);
      if (!part) part = (table.parts || []).find(function (p) { return p.status === "empty" && p.seats >= size; });
      if (part) {
        part.status = "dining";
        part.party = party.name;
        part.guests = size;
        part.statusSince = Date.now();
        label = table.name + "-" + part.id.toUpperCase();
        syncParentFromParts(table);
      } else {
        table.status = "dining";
        table.party = party.name;
        table.guests = size;
        table.statusSince = Date.now();
      }
    } else {
      table.status = "dining";
      table.party = party.name;
      table.guests = size;
      table.statusSince = Date.now();
      if (table.mergedWith) {
        var other = state.tables.find(function (x) { return x.id === table.mergedWith; });
        if (other) {
          other.status = "dining";
          other.party = party.name + "（併）";
          other.guests = 0;
          other.statusSince = Date.now();
          label = table.name + "＋" + other.name;
        }
      }
    }
    party.status = "seated";
    party.tableName = label;
    party.size = size;
    party.partySize = size;
    party.inviteUntil = null;
    /* 保留 backfillId 供時間軸稽核；不再佔桌 */
    state.covers += size;
    selectedTableId = table.id;
    if (partId) selectedPartId = partId;
    saveOrgState();
    render();
    if (!opts.silent) toast(party.name + " 已入座 " + label + "（" + size + " 位）");
  }

  /* ——— N1 原子補位閉環（真規則 · Preview mock）——— */
  function ensureBackfillRounds() {
    if (!state.backfillRounds) state.backfillRounds = [];
  }

  function partyStatusLabel(st) {
    var map = {
      waiting: "候位中",
      invited: "已邀請",
      held: "訂位保留",
      seated: "已入座",
      cancelled: "已取消",
      lost: "已被訂走",
      expired: "已過期",
      noshow: "遲到／未到"
    };
    return map[st] || st || "—";
  }

  function holdById(id) {
    ensureBackfillRounds();
    if (!id) return null;
    return state.backfillRounds.find(function (r) { return r.id === id; }) || null;
  }

  function openHoldForTable(tableId) {
    ensureBackfillRounds();
    return state.backfillRounds.find(function (r) {
      return r.status === "open" && r.tableId === tableId;
    }) || null;
  }

  function holdForParty(p) {
    return p && p.backfillId ? holdById(p.backfillId) : null;
  }

  function appendHoldEvent(hold, type, partyId, note) {
    if (!hold) return;
    if (!hold.events) hold.events = [];
    hold.events.push({
      at: Date.now(),
      type: type,
      partyId: partyId || null,
      note: note || ""
    });
  }

  function backfillEventLabel(ev) {
    var map = {
      invite: "邀請",
      resend: "重送／刷新",
      confirm: "確認入座",
      lost: "搶輸",
      expire: "過期",
      release: "釋放桌位"
    };
    var base = map[ev.type] || ev.type;
    var who = "";
    if (ev.partyId) {
      var p = state.waitlist.find(function (x) { return x.id === ev.partyId; });
      if (p) who = " · " + p.name;
    }
    return base + who + (ev.note ? " — " + ev.note : "");
  }

  function formatCountdown(until) {
    var ms = Math.max(0, (until || 0) - Date.now());
    var sec = Math.ceil(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + pad2(s);
  }

  function candidateBackfillSeats(minCap) {
    minCap = Number(minCap) || 1;
    var out = [];
    state.tables.forEach(function (t) {
      if (t.mergedInto) return;
      if (t.holdId && openHoldForTable(t.id)) {
        /* 已有進行中回合：仍列為目前目標，不可另開 */
        out.push({
          tableId: t.id,
          partId: null,
          label: t.name + "（補位中）",
          seats: tableCapacity(t),
          held: true
        });
        return;
      }
      if (t.split && t.parts && t.parts.length) {
        t.parts.forEach(function (p) {
          if (p.status !== "empty" || p.seats < minCap) return;
          out.push({
            tableId: t.id,
            partId: p.id,
            label: t.name + "-" + String(p.id).toUpperCase() + "（" + p.seats + "）",
            seats: p.seats,
            held: false
          });
        });
        return;
      }
      if (t.status === "empty" || t.status === "dirty") {
        var cap = tableCapacity(t);
        if (cap < minCap) return;
        out.push({
          tableId: t.id,
          partId: null,
          label: t.name + "（" + cap + "人" + (t.status === "dirty" ? "·待清可清後坐" : "") + "）",
          seats: cap,
          held: false,
          needsClear: t.status === "dirty"
        });
      }
    });
    out.sort(function (a, b) { return a.seats - b.seats; });
    return out;
  }

  function softHoldTable(hold) {
    var t = state.tables.find(function (x) { return x.id === hold.tableId; });
    if (!t) return;
    if (hold.partId && t.split) {
      var part = partById(t, hold.partId);
      if (part) {
        part.status = "invited";
        part.party = "補位邀請中";
        part.guests = 0;
        part.statusSince = Date.now();
        syncParentFromParts(t);
        /* 半桌補位：父桌態由 sync 決定（另一半用餐中勿蓋成 invited） */
      }
    } else {
      if (t.status === "dirty") t.status = "empty";
      t.status = "invited";
      t.party = "補位邀請中";
      t.guests = 0;
      t.statusSince = Date.now();
    }
    t.holdId = hold.id;
    t.holdUntil = hold.until;
  }

  function releaseTableHold(hold) {
    var t = state.tables.find(function (x) { return x.id === hold.tableId; });
    if (!t) return;
    if (t.holdId && t.holdId !== hold.id) return;
    t.holdId = null;
    t.holdUntil = null;
    if (hold.partId && t.split) {
      var part = partById(t, hold.partId);
      if (part && (part.status === "invited" || part.party === "補位邀請中")) {
        part.status = "empty";
        part.party = "";
        part.guests = 0;
        part.statusSince = Date.now();
        syncParentFromParts(t);
      }
    } else if (t.status === "invited") {
      t.status = "empty";
      t.party = "";
      t.guests = 0;
      t.statusSince = Date.now();
    }
  }

  function expireOpenBackfills() {
    ensureBackfillRounds();
    var now = Date.now();
    var changed = false;
    state.backfillRounds.forEach(function (hold) {
      if (hold.status !== "open") return;
      if (hold.until > now) return;
      hold.status = "expired";
      appendHoldEvent(hold, "expire", null, "倒數結束，桌位釋放");
      (hold.partyIds || []).forEach(function (pid) {
        var p = state.waitlist.find(function (x) { return x.id === pid; });
        if (p && p.status === "invited" && p.backfillId === hold.id) {
          p.status = "expired";
          p.inviteUntil = null;
        }
      });
      releaseTableHold(hold);
      appendHoldEvent(hold, "release", null, "桌位已空出");
      changed = true;
    });
    return changed;
  }

  function accelerateBackfillExpire(holdId) {
    var hold = holdById(holdId);
    if (!hold || hold.status !== "open") {
      toast("沒有可加速過期的補位回合");
      return;
    }
    hold.until = Date.now() - 1;
    expireOpenBackfills();
    saveOrgState();
    render();
    toast("已示意過期 · 桌位釋放 · 相關組別「已過期」");
  }


  /* ——— N5 遲到／No-show 釋放規則（真規則 · Preview mock）——— */
  function pushLateEvent(ev) {
    if (!Array.isArray(state.lateEvents)) state.lateEvents = [];
    var rec = {
      id: "late" + Date.now().toString(36) + Math.floor(Math.random() * 100).toString(36),
      at: Date.now(),
      type: ev.type || "release",
      partyId: ev.partyId || null,
      partyName: ev.partyName || "",
      tableId: ev.tableId == null ? null : Number(ev.tableId),
      tableLabel: ev.tableLabel || "",
      note: ev.note || ""
    };
    state.lateEvents.unshift(rec);
    if (state.lateEvents.length > 40) state.lateEvents.length = 40;
    pushOrderEvent(
      rec.tableId,
      rec.tableLabel,
      "late_release",
      (rec.partyName ? rec.partyName + " · " : "") + (rec.note || "遲到／未到釋放"),
      { source: "pos" }
    );
    return rec;
  }

  function slotToTodayMs(slot) {
    if (!slot || typeof slot !== "string") return null;
    var m = slot.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d.getTime();
  }

  function reservationDeadlineMs(p) {
    if (!p) return null;
    if (p.reserveUntil) return Number(p.reserveUntil);
    var grace = getPolicy().reservationGraceMin;
    if (p.heldAt) return Number(p.heldAt) + grace * 60000;
    var slotMs = slotToTodayMs(p.slot);
    if (slotMs != null) return slotMs + grace * 60000;
    return null;
  }

  function isReservationPastGrace(p) {
    var dl = reservationDeadlineMs(p);
    return dl != null && Date.now() >= dl;
  }

  function isReservationApproachingLate(p) {
    if (!p || (p.status !== "held" && !(p.kind === "reservation" && p.status === "waiting"))) return false;
    var dl = reservationDeadlineMs(p);
    if (dl == null) return false;
    var left = dl - Date.now();
    return left > 0 && left <= LATE_APPROACH_MIN * 60000;
  }

  function releaseReservationTable(table, toStatus) {
    if (!table) return;
    toStatus = toStatus || "empty";
    table.status = toStatus;
    table.party = "";
    table.guests = 0;
    table.statusSince = Date.now();
    table.holdUntil = null;
    table.holdKind = null;
    table.reservePartyId = null;
    if (table.holdId && !openHoldForTable(table.id)) {
      /* 訂位保留不共用 backfill holdId；清掉誤植 */
      table.holdId = null;
    }
  }

  /**
   * 標遲到／未到並釋放訂位保留桌（若有）。toStatus: empty|dirty
   * @returns {{released:boolean, tableId:number|null, tableLabel:string}}
   */
  function markPartyNoshow(party, opts) {
    opts = opts || {};
    if (!party) return { released: false, tableId: null, tableLabel: "" };
    if (party.status === "noshow" || party.status === "seated" || party.status === "cancelled") {
      return { released: false, tableId: null, tableLabel: "" };
    }
    var tableId = party.reserveTableId;
    var table = null;
    if (tableId != null) {
      table = state.tables.find(function (x) { return x.id === tableId; });
    }
    if (!table && party.name) {
      table = state.tables.find(function (x) {
        return x.status === "reserved" && x.reservePartyId === party.id;
      });
    }
    var tableLabel = "";
    var released = false;
    var toStatus = opts.toStatus || "empty";
    if (table && (table.status === "reserved" || table.reservePartyId === party.id)) {
      tableLabel = table.name;
      releaseReservationTable(table, toStatus);
      released = true;
    }
    party.status = "noshow";
    party.lateReleasedAt = Date.now();
    party.reserveUntil = null;
    party.inviteUntil = null;
    /* 保留 reserveTableId 供稽核 */
    var note = opts.note || (
      released
        ? ("遲到／未到 · 釋放 " + tableLabel + "（寬限 " + getPolicy().reservationGraceMin + " 分）")
        : ("遲到／未到 · 時段 " + (party.slot || "—") + "＋寬限未報到")
    );
    pushLateEvent({
      type: "noshow_release",
      partyId: party.id,
      partyName: party.name,
      tableId: table ? table.id : null,
      tableLabel: tableLabel,
      note: note
    });
    return { released: released, tableId: table ? table.id : null, tableLabel: tableLabel };
  }

  function expireLateReservations(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var changed = false;
    var lastRelease = null;
    (state.waitlist || []).forEach(function (p) {
      if (p.status === "held") {
        if (!isReservationPastGrace(p)) return;
        lastRelease = markPartyNoshow(p, { note: null });
        changed = true;
        return;
      }
      /* 訂位未留桌：時段＋寬限仍未報到 → 標遲到／未到（不釋桌） */
      if (p.kind === "reservation" && p.status === "waiting" && !p.reserveTableId) {
        var dl0 = reservationDeadlineMs(p);
        if (dl0 == null || Date.now() < dl0) return;
        /* 避免隔夜種子誤殺：僅逾時 4 小時內 */
        if (Date.now() - dl0 > 4 * 3600000) return;
        markPartyNoshow(p, {
          note: "遲到／未到 · 訂位 " + (p.slot || "") + "＋寬限未報到（無留桌）"
        });
        changed = true;
      }
    });
    /* 桌況殘留 reserved 但組別已不在 held */
    (state.tables || []).forEach(function (t) {
      if (t.status !== "reserved") return;
      var p = (state.waitlist || []).find(function (x) { return x.id === t.reservePartyId; });
      if (p && p.status === "held" && !isReservationPastGrace(p)) return;
      if (p && p.status === "held" && isReservationPastGrace(p)) {
        lastRelease = markPartyNoshow(p);
        changed = true;
        return;
      }
      if (!p || p.status !== "held") {
        var lab = t.name;
        releaseReservationTable(t, "empty");
        pushLateEvent({
          type: "orphan_release",
          partyId: p ? p.id : null,
          partyName: p ? p.name : "",
          tableId: t.id,
          tableLabel: lab,
          note: "訂位保留殘留釋放 · " + lab
        });
        lastRelease = { released: true, tableId: t.id, tableLabel: lab };
        changed = true;
      }
    });
    if (changed && !silent && lastRelease && lastRelease.released) {
      toast(
        "遲到／未到 · " + (lastRelease.tableLabel || "桌位") + " 已釋放（規則·非 AI 消滅 no-show）",
        {
          action: "對空桌發起補位",
          screen: "wait",
          backfillTableId: lastRelease.tableId
        }
      );
    } else if (changed && !silent) {
      toast("已標「遲到／未到」（寬限規則）· 尖峰訂金仍是硬控（文案示意）");
    }
    return changed;
  }

  function holdReservationOnTable(partyId, tableId, opts) {
    opts = opts || {};
    var p = state.waitlist.find(function (x) { return x.id === Number(partyId); });
    var t = state.tables.find(function (x) { return x.id === Number(tableId); });
    if (!p || !t) {
      toast("找不到訂位組或桌");
      return false;
    }
    if (p.kind !== "reservation") {
      toast("僅訂位組可「留桌」；候位請走補位");
      return false;
    }
    if (t.status === "dining" || t.status === "invited" || t.status === "reserved") {
      toast("此桌不可留（用餐中／補位中／已保留）");
      return false;
    }
    if (t.mergedInto) {
      toast("併入桌不可單獨留");
      return false;
    }
    var grace = getPolicy().reservationGraceMin;
    var heldAt = Date.now();
    var slotMs = slotToTodayMs(p.slot);
    var until = opts.until != null
      ? Number(opts.until)
      : (slotMs != null ? slotMs + grace * 60000 : heldAt + grace * 60000);
    if (t.status === "dirty") {
      /* 待清可標保留，釋放時回到 empty（示意已清）或保持 dirty — 採 empty */
    }
    t.status = "reserved";
    t.party = p.name + "（訂位）";
    t.guests = partySizeOf(p);
    t.statusSince = heldAt;
    t.holdKind = "reservation";
    t.reservePartyId = p.id;
    t.holdUntil = until;
    t.holdId = null;
    p.status = "held";
    p.reserveTableId = t.id;
    p.heldAt = heldAt;
    p.reserveUntil = until;
    pushLateEvent({
      type: "hold",
      partyId: p.id,
      partyName: p.name,
      tableId: t.id,
      tableLabel: t.name,
      note: "訂位留桌 · 寬限至 " + hm(new Date(until)) + "（" + grace + " 分）"
    });
    saveOrgState();
    render();
    if (!opts.silent) {
      toast(p.name + " 已留 " + t.name + " · 寬限 " + grace + " 分（逾時釋放）");
    }
    return true;
  }

  function accelerateLate(partyId) {
    var p = state.waitlist.find(function (x) { return x.id === Number(partyId); });
    if (!p) {
      /* 找任一 held */
      p = state.waitlist.find(function (x) { return x.status === "held"; });
    }
    if (!p || p.status !== "held") {
      toast("沒有可加速的訂位保留（可先「示範遲到留桌」）");
      return;
    }
    p.reserveUntil = Date.now() - 1;
    var t = state.tables.find(function (x) { return x.id === p.reserveTableId; });
    if (t) t.holdUntil = p.reserveUntil;
    expireLateReservations();
    saveOrgState();
    render();
  }

  /** 一鍵示範：把一組訂位放到空桌並設為已逾寬限（或加速） */
  function demoSeedLateHold() {
    var p = state.waitlist.find(function (x) {
      return x.kind === "reservation" && (x.status === "waiting" || x.status === "noshow" || x.status === "held");
    });
    if (!p) {
      toast("沒有訂位組可示範");
      return;
    }
    if (p.status === "held") {
      accelerateLate(p.id);
      return;
    }
    /* 恢復為可留桌 */
    if (p.status === "noshow") {
      p.status = "waiting";
      p.lateReleasedAt = null;
    }
    var t = state.tables.find(function (x) {
      return !x.mergedInto && (x.status === "empty" || x.status === "dirty") &&
        tableCapacity(x) >= partySizeOf(p) && !x.split;
    });
    if (!t) {
      toast("沒有足夠空桌可示範留桌");
      return;
    }
    holdReservationOnTable(p.id, t.id, {
      until: Date.now() + getPolicy().reservationGraceMin * 60000,
      silent: true
    });
    toast("已示範留桌 " + t.name + " · 可按「加速遲到」看釋放＋補位 CTA");
  }

  function lateEventsHtml(opts) {
    opts = opts || {};
    var limit = opts.limit || 6;
    var evs = (state.lateEvents || []).slice(0, limit);
    var pol = getPolicy();
    var head =
      '<div class="bf-timeline late-tl" aria-label="遲到／未到時間軸">' +
        '<div class="bf-timeline-h">遲到／No-show · 釋放規則' +
          '<span class="line-fake-badge">N5 · 寬限 ' + pol.reservationGraceMin + " 分</span></div>" +
        '<div class="bf-timeline-sub">規則釋放＋可補位回填 · 非「AI 消滅 no-show」· 尖峰訂金仍是硬控（文案）</div>';
    if (!evs.length) {
      return head + '<p class="help">尚無遲到釋放事件。種子含已逾寬限訂位留桌；或按「加速遲到」。</p></div>';
    }
    var lis = evs.map(function (ev) {
      var t = new Date(ev.at);
      return (
        "<li><strong>" + hm(t) + "</strong>　" + esc(ev.note || ev.type) +
        (ev.tableLabel ? "　·　" + esc(ev.tableLabel) : "") +
        "</li>"
      );
    }).join("");
    return head + "<ol>" + lis + "</ol></div>";
  }

  function lateSuggestTargets() {
    return (state.waitlist || []).filter(function (p) {
      if (p.status === "held" && (isReservationPastGrace(p) || isReservationApproachingLate(p))) return true;
      return false;
    });
  }

  /**
   * 同時邀請多組搶同一桌。冪等：同桌已有 open hold → 不新建第二佔位。
   */
  function startAtomicBackfill(tableId, partyIds, opts) {
    opts = opts || {};
    ensureBackfillRounds();
    expireOpenBackfills();
    var t = state.tables.find(function (x) { return x.id === tableId; });
    if (!t) {
      toast("找不到目標桌");
      return null;
    }
    var ids = [];
    (partyIds || []).forEach(function (id) {
      id = Number(id);
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    ids = ids.filter(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      return p && (p.status === "waiting" || p.status === "invited" || p.status === "expired" || p.status === "lost");
    });

    var existing = openHoldForTable(tableId);
    if (existing) {
      appendHoldEvent(existing, "resend", null, "重送／刷新（冪等·未新建第二佔位）");
      /* 重送不延長、不重開承諾窗，避免雙佔 */
      (existing.partyIds || []).forEach(function (pid) {
        var p = state.waitlist.find(function (x) { return x.id === pid; });
        if (p && p.status === "invited") {
          p.inviteUntil = existing.until;
          p.backfillId = existing.id;
        }
      });
      saveOrgState();
      render();
      toast("此桌補位已在進行（冪等）· 回合 " + existing.id + " · 先確認者得桌");
      return existing;
    }

    if (!ids.length) {
      toast("請先選取要補位的組別");
      return null;
    }

    var maxNeed = 0;
    ids.forEach(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      var sz = partySizeOf(p);
      if (sz > maxNeed) maxNeed = sz;
    });
    var partId = opts.partId || null;
    var cap = tableCapacity(t);
    if (partId && t.split) {
      var part = partById(t, partId);
      if (!part || (part.status !== "empty" && part.status !== "dirty")) {
        toast("目標半桌不可用");
        return null;
      }
      cap = part.seats;
    } else if (t.status !== "empty" && t.status !== "dirty") {
      toast("目標桌需為空桌或待清");
      return null;
    }
    if (maxNeed > cap) {
      toast("桌位容量不足（需 " + maxNeed + "／桌 " + cap + "）");
      return null;
    }

    var until = Date.now() + INVITE_HOLD_MIN * 60000;
    var label = tableDisplayName(t, partId);
    var hold = {
      id: "bf-" + nextId(),
      tableId: t.id,
      partId: partId,
      tableLabel: label,
      partyIds: ids.slice(),
      until: until,
      status: "open",
      winnerPartyId: null,
      createdAt: Date.now(),
      events: []
    };
    softHoldTable(hold);
    ids.forEach(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      if (!p) return;
      p.status = "invited";
      p.inviteUntil = until;
      p.backfillId = hold.id;
      p.inviteTableLabel = label;
    });
    appendHoldEvent(
      hold,
      "invite",
      null,
      "同時通知 " + ids.length + " 組 → " + label + "；先確認者留桌"
    );
    state.backfillRounds.unshift(hold);
    if (state.backfillRounds.length > 24) state.backfillRounds.length = 24;
    backfillTargetTableId = t.id;
    saveOrgState();
    render();
    toast(
      "已向 " + ids.length + " 組同時發送補位（" + label + "｜" + INVITE_HOLD_MIN +
        " 分內｜示意非真簡訊）"
    );
    return hold;
  }

  function confirmBackfillParty(partyId) {
    expireOpenBackfills();
    var p = state.waitlist.find(function (x) { return x.id === partyId; });
    if (!p) return { ok: false };

    if (p.status === "lost") {
      toast(p.name + " 已被訂走（此波未搶到）");
      render();
      return { ok: false, reason: "lost" };
    }
    if (p.status === "expired") {
      toast(p.name + " 邀請已過期，桌位已釋放");
      return { ok: false, reason: "expired" };
    }
    if (p.status === "seated") {
      toast(p.name + " 已入座（冪等·不重複佔桌）");
      return { ok: true, idempotent: true };
    }
    if (p.status === "cancelled") {
      toast("此組已取消");
      return { ok: false };
    }

    var hold = holdForParty(p);
    if (!hold) {
      /* 無原子回合：單組舊路徑 */
      var table = findEmptyTable(partySizeOf(p));
      if (!table) {
        toast("目前沒有夠座的空桌。請先清桌、拆桌或調整桌況。", {
          action: "去桌況清桌",
          screen: "tables"
        });
        return { ok: false };
      }
      seatParty(p, table, table._assignPartId || null);
      return { ok: true, legacy: true };
    }

    if (hold.status === "won") {
      if (hold.winnerPartyId === p.id) {
        toast(p.name + " 已入座（冪等）");
        return { ok: true, idempotent: true };
      }
      if (p.status === "invited") {
        p.status = "lost";
        p.inviteUntil = null;
        appendHoldEvent(hold, "lost", p.id, "已被訂走");
        saveOrgState();
        render();
      }
      toast(p.name + " 已被訂走");
      return { ok: false, reason: "lost" };
    }
    if (hold.status === "expired") {
      if (p.status === "invited") p.status = "expired";
      saveOrgState();
      render();
      toast("此波補位已過期");
      return { ok: false, reason: "expired" };
    }

    /* —— 原子得桌：先關回合再入座，失敗者立即 lost —— */
    var table = state.tables.find(function (x) { return x.id === hold.tableId; });
    if (!table) {
      toast("目標桌不存在");
      return { ok: false };
    }

    hold.status = "won";
    hold.winnerPartyId = p.id;
    appendHoldEvent(hold, "confirm", p.id, "確認入座／接受補位");

    (hold.partyIds || []).forEach(function (pid) {
      if (pid === p.id) return;
      var other = state.waitlist.find(function (x) { return x.id === pid; });
      if (!other) return;
      if (other.status === "invited" || other.status === "waiting") {
        other.status = "lost";
        other.inviteUntil = null;
        appendHoldEvent(hold, "lost", pid, "已被訂走");
      }
    });

    /* 解除軟鎖後入座（同一同步流程，無第二窗） */
    table.holdId = null;
    table.holdUntil = null;
    if (hold.partId && table.split) {
      var part = partById(table, hold.partId);
      if (part && part.status === "invited") {
        part.status = "empty";
        part.party = "";
      }
    } else if (table.status === "invited") {
      table.status = "empty";
      table.party = "";
    }

    seatParty(p, table, hold.partId || null, { silent: true });
    toast(
      p.name + " 已入座 " + (hold.tableLabel || table.name) +
        " · 其餘同波組別立即「已被訂走」"
    );
    return { ok: true, won: true };
  }

  function selectedBackfillPartyIds() {
    var ids = [];
    Object.keys(backfillPickIds).forEach(function (k) {
      if (backfillPickIds[k]) ids.push(Number(k));
    });
    document.querySelectorAll(".wait-check:checked").forEach(function (b) {
      var id = Number(b.value);
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    return ids.filter(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      return p && p.status === "waiting";
    });
  }

  function resolveBackfillTarget(partyIds) {
    var maxNeed = 1;
    (partyIds || []).forEach(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      var sz = partySizeOf(p);
      if (sz > maxNeed) maxNeed = sz;
    });
    var cands = candidateBackfillSeats(maxNeed);
    var free = cands.filter(function (c) { return !c.held; });
    if (backfillTargetTableId) {
      var hit = free.find(function (c) { return c.tableId === backfillTargetTableId; }) ||
        cands.find(function (c) { return c.tableId === backfillTargetTableId; });
      if (hit) return hit;
    }
    return free[0] || null;
  }

  function inviteSelected() {
    if (!hasFeature("restaurant.waitlist.multi_invite")) {
      toast("目前方案不含多組補位。升級「小店」後可一次邀請多組。", isManager()
        ? { action: "看升級示意", screen: "settings" }
        : null);
      return;
    }
    var sel = document.getElementById("bf-target-table");
    if (sel) backfillTargetTableId = Number(sel.value) || backfillTargetTableId;
    var ids = selectedBackfillPartyIds();
    if (ids.length < 2) {
      toast("原子補位請勾選至少 2 組，對同一空桌同時邀請。");
      return;
    }
    var target = resolveBackfillTarget(ids);
    if (!target) {
      toast("沒有容量足夠的空桌／待清桌。請先清桌或換目標桌。", {
        action: "去桌況",
        screen: "tables"
      });
      return;
    }
    startAtomicBackfill(target.tableId, ids, { partId: target.partId });
    backfillPickIds = {};
  }

  function inviteOne(id) {
    var p = state.waitlist.find(function (x) { return x.id === id; });
    if (!p || (p.status !== "waiting" && p.status !== "expired" && p.status !== "lost")) return;
    if (p.status === "expired" || p.status === "lost") {
      p.status = "waiting";
      p.backfillId = null;
    }
    var target = resolveBackfillTarget([id]);
    if (!target) {
      p.status = "invited";
      p.inviteUntil = Date.now() + INVITE_HOLD_MIN * 60000;
      p.backfillId = null;
      saveOrgState();
      render();
      toast("已邀請 " + p.name + "（尚無綁定空桌；確認時再找桌）");
      return;
    }
    startAtomicBackfill(target.tableId, [id], { partId: target.partId });
    if (!hasFeature("restaurant.waitlist.multi_invite")) {
      /* startAtomicBackfill 已 toast；補一句閘控說明 */
      setTimeout(function () {
        toast("單組可用。一次邀請多組需升級「小店」。");
      }, 600);
    }
  }

  function confirmHeldReservation(id) {
    var p = state.waitlist.find(function (x) { return x.id === Number(id); });
    if (!p || p.status !== "held") {
      toast("此組不是訂位保留中");
      return;
    }
    var t = state.tables.find(function (x) { return x.id === p.reserveTableId; });
    if (!t || t.status !== "reserved") {
      toast("找不到保留桌，請改選空桌入座");
      return;
    }
    t.status = "empty";
    t.holdKind = null;
    t.reservePartyId = null;
    t.holdUntil = null;
    p.reserveUntil = null;
    seatParty(p, t, null);
    pushLateEvent({
      type: "checkin",
      partyId: p.id,
      partyName: p.name,
      tableId: t.id,
      tableLabel: t.name,
      note: "訂位到店入座 · 取消保留倒數"
    });
    saveOrgState();
    render();
  }

  function confirmParty(id) {
    var p = state.waitlist.find(function (x) { return x.id === Number(id); });
    if (p && p.status === "held") {
      confirmHeldReservation(id);
      return;
    }
    confirmBackfillParty(id);
  }

  function cancelParty(id) {
    var p = state.waitlist.find(function (x) { return x.id === id; });
    if (!p) return;
    if (p.status === "held") {
      var tb = state.tables.find(function (x) { return x.id === p.reserveTableId; });
      if (tb && tb.status === "reserved") releaseReservationTable(tb, "empty");
      p.status = "cancelled";
      p.reserveUntil = null;
      pushLateEvent({
        type: "cancel_hold",
        partyId: p.id,
        partyName: p.name,
        tableId: tb ? tb.id : null,
        tableLabel: tb ? tb.name : "",
        note: "取消訂位保留"
      });
      saveOrgState();
      render();
      toast(p.name + " 已取消訂位保留");
      return;
    }
    var hold = holdForParty(p);
    p.status = "cancelled";
    p.inviteUntil = null;
    if (hold && hold.status === "open") {
      appendHoldEvent(hold, "lost", p.id, "客人取消");
      hold.partyIds = (hold.partyIds || []).filter(function (x) { return x !== p.id; });
      var still = (hold.partyIds || []).some(function (pid) {
        var o = state.waitlist.find(function (x) { return x.id === pid; });
        return o && o.status === "invited";
      });
      if (!still) {
        hold.status = "expired";
        appendHoldEvent(hold, "expire", null, "無剩餘邀請，釋放");
        releaseTableHold(hold);
      }
    }
    saveOrgState();
    render();
    toast(p.name + " 已取消，桌位不佔用");
  }

  function addWaiter() {
    var nameEl = document.getElementById("new-name");
    var sizeEl = document.getElementById("new-size");
    var name = (nameEl && nameEl.value || "").trim();
    var size = Number(sizeEl && sizeEl.value || 2);
    if (!name) { toast("請填入稱呼"); return; }
    if (!(size >= 1 && size <= 12)) { toast("人數請填 1–12"); return; }
    state.waitlist.push({
      id: nextId(),
      name: name,
      size: size,
      partySize: size,
      waited: 0,
      member: false,
      status: "waiting",
      guestType: "guest",
      channel: "現場",
      kind: "waitlist",
      pref: "",
      slot: ""
    });
    saveOrgState();
    render();
    toast(name + " 已加入候位");
  }

  function findDish(id) {
    var found = null;
    MENU.forEach(function (c) {
      c.items.forEach(function (it) { if (it.id === id) found = it; });
    });
    return found;
  }

  function addDish(id) {
    var d = findDish(id);
    if (!d) return;
    if (isSoldOut(id)) {
      toast(d.name + " 已售完（86）");
      return;
    }
    var line = state.ticket.lines.find(function (l) { return l.id === id; });
    if (line) line.qty += 1;
    else state.ticket.lines.push({
      id: d.id, name: d.name, price: d.price, qty: 1,
      prepMinutes: d.prepMinutes != null ? d.prepMinutes : 8,
      serveMinutes: d.serveMinutes != null ? d.serveMinutes : 3
    });
    saveOrgState();
    render();
  }

  function changeQty(id, delta) {
    var line = state.ticket.lines.find(function (l) { return l.id === id; });
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) {
      state.ticket.lines = state.ticket.lines.filter(function (l) { return l.id !== id; });
    }
    saveOrgState();
    render();
  }

  function ticketTotal() {
    return state.ticket.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  }

  function sendTicketToKitchen() {
    if (!state.ticket.lines.length) {
      toast("請先加入品項再送廚");
      return;
    }
    var blocked = state.ticket.lines.filter(function (l) { return isSoldOut(l.id); });
    if (blocked.length) {
      toast("含售完品項：" + blocked.map(function (l) { return l.name; }).join("、"));
      return;
    }
    var table = state.tables.find(function (t) { return t.id === Number(state.ticket.tableId); });
    var tableLabel = table ? table.name : "外帶";
    var tableId = table ? table.id : 0;
    var existed = tableId ? findOpenOrderForTable(tableId) : null;
    var order = appendLinesToOpenOrder({
      actor: "pos",
      tableId: tableId,
      tableLabel: tableLabel,
      lines: state.ticket.lines.slice(),
      note: "櫃台 POS 送廚"
    });
    state.ticket.lines = [];
    saveOrgState();
    render();
    var prep = order ? order.prepMinutes : 8;
    var serve = order ? order.serveMinutes : 3;
    toast(
      (existed ? "已併入同桌訂單 #" : "已開單送廚 #") +
      String(order.id).slice(-8) + " · " + tableLabel +
      " · 預估製作 " + prep + " 分／送餐 " + serve + " 分（mock）"
    );
  }

  function checkout() {
    var table = state.tables.find(function (t) { return t.id === Number(state.ticket.tableId); });
    var tableLabel = table ? table.name : "外帶";
    var tableId = table ? table.id : 0;
    var open = tableId ? findOpenOrderForTable(tableId) : null;
    var draftQty = state.ticket.lines.reduce(function (n, l) { return n + l.qty; }, 0);
    var openAmt = open ? (open.amount || 0) : 0;
    var draftAmt = ticketTotal();
    if (!open && !state.ticket.lines.length) {
      toast("請先加入品項或送廚後再結帳");
      return;
    }
    /* 有開單時：先送完草稿再結，避免漏送廚；純草稿（未送廚）仍可示意結帳 */
    if (open && state.ticket.lines.length) {
      toast("尚有未送廚草稿；請先送廚或清空後再結帳");
      return;
    }
    var total = open ? openAmt : draftAmt;
    var items = open
      ? (open.lines || []).reduce(function (n, l) { return n + l.qty; }, 0)
      : draftQty;
    var pay = state.ticket.pay || "現金";
    var now = new Date();
    var wasDining = !!(table && table.status === "dining");
    state.receipts.unshift({
      id: nextId(),
      time: hm(now),
      table: tableLabel,
      pay: pay,
      amount: total,
      items: items,
      orderId: open ? open.id : null
    });
    if (tableId) closeOpenCheckForTable(tableId);
    if (wasDining) {
      table.status = "dirty";
      table.party = "";
      table.guests = 0;
      table.statusSince = Date.now();
      if (table.split && table.parts) {
        table.parts.forEach(function (p) {
          p.status = "dirty";
          p.party = "";
          p.guests = 0;
          p.statusSince = Date.now();
        });
        syncParentFromParts(table);
      }
      if (table.mergedWith) {
        var annex = state.tables.find(function (x) { return x.id === table.mergedWith; });
        if (annex) {
          annex.status = "dirty";
          annex.party = "";
          annex.mergedInto = null;
        }
        table.mergedWith = null;
      }
    }
    state.ticket.lines = [];
    saveOrgState();
    render();
    toast(
      "已結帳（示意）· " + tableLabel + " · " + pay + " · NT$ " + total + " · 無真實金流" +
        (wasDining ? " · 桌轉待清" : "") + (open ? " · 關單 #" + String(open.id).slice(-8) : ""),
      wasDining ? { action: "去桌況", screen: "tables" } : null
    );
  }

  function changePlan(slug) {
    if (!isManager()) {
      toast("店員無法變更方案。請店長在設定操作（示意守門）。");
      return false;
    }
    if (!PLAN_DEFS[slug]) return false;
    if (state.plan === slug) return false;
    if (!window.confirm("僅 mock、非正式授權。切到「" + PLAN_DEFS[slug].name + "」？")) {
      return false;
    }
    state.plan = slug;
    saveOrgState();
    render();
    toast("已切換方案為「" + PLAN_DEFS[slug].name + "」（僅 mock，非正式授權）");
    return true;
  }

  function setRole(role) {
    meta.role = role === "staff" ? "staff" : "manager";
    saveMeta();
    render();
    toast("身分切換為「" + (meta.role === "manager" ? "店長" : "店員") + "」（示意）");
  }

  function setConsent(on) {
    if (!isManager()) {
      toast("店員無法變更跨店資料授權。請店長在設定操作（示意守門）。");
      return;
    }
    meta.consentCrossStore = !!on;
    saveMeta();
    render();
    toast(meta.consentCrossStore ? "跨店資料授權已開啟（示意）" : "跨店資料授權已關閉");
  }

  function setOffline(on) {
    simOffline = !!on;
    render();
    if (simOffline) {
      toast("連線中斷。畫面資料可能不是最新；已輸入內容先留在本機。");
    } else {
      toast("已恢復連線（示意）");
    }
  }

  function hintText() {
    var dirty = state.tables.filter(function (t) { return t.status === "dirty"; });
    var empty2 = state.tables.filter(function (t) { return t.status === "empty" && t.seats <= 2; });
    var wait2 = state.waitlist.filter(function (p) { return p.status === "waiting" && p.size <= 2; });
    if (state.screen === "tables" && dirty.length) {
      return "建議：優先清 " + dirty.map(function (t) { return t.name; }).join("、") + "，騰出後可補位候位組。點桌循環：空桌 → 用餐中 → 待清。";
    }
    if (state.screen === "wait" && empty2.length && wait2.length) {
      if (hasFeature("restaurant.waitlist.multi_invite")) {
        return "建議：可同時邀請 " + wait2.map(function (p) { return p.name; }).join("、") + "（皆 2 人桌型），對 " + empty2.map(function (t) { return t.name; }).join("／") + " 做多組補位。先確認者不佔未確認桌。";
      }
      return "目前方案不含多組補位。升級「小店」後可一次邀請多組。可先用單組「邀請」。";
    }
    if (state.screen === "pos") {
      return "POS-1 示意：點品項加單、調數量、選桌號與支付方式。支付為店員回報（現金／刷卡／LINE Pay），不串金流。結帳後用餐中桌會轉待清。";
    }
    if (state.screen === "hq") {
      return "總部報告：多店來客／營收／翻桌／候位轉換／平均製作與送餐（mock）。日／週假資料。跨店對標需 Consent。示意·非正式／待 Owner。";
    }
    if (state.screen === "finance") {
      return "財務為示意·非金流。方案狀態與今日銷售來自本店 POS 示意單據，非正式帳單。";
    }
    if (state.screen === "guest") {
      return "客人視角：LINE 示意卡（非正式官方帳號、不會真的發送）。與店員帳號分開。";
    }
    if (state.screen === "compete") {
      return "競品一屏摘要，非正式行銷定稿。來源見盤點檔路徑。";
    }
    if (state.screen === "settings") {
      return "設定為 Demo 示意：方案功能、身分守門、跨店資料授權。非正式授權。";
    }
    return "";
  }


  function getTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      return t === "steel" ? "steel" : "paper";
    } catch (e) {
      return "paper";
    }
  }

  function setTheme(theme) {
    var t = theme === "steel" ? "steel" : "paper";
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    document.documentElement.setAttribute("data-hym-theme", t);
    document.body.setAttribute("data-hym-theme", t);
    syncThemeChromeUi();
  }

  function getChromeOn() {
    try {
      return localStorage.getItem(CHROME_KEY) === "on";
    } catch (e) {
      return false;
    }
  }

  function setChromeOn(on) {
    try { localStorage.setItem(CHROME_KEY, on ? "on" : "off"); } catch (e) {}
    document.body.classList.toggle("chrome-off", !on);
    document.documentElement.classList.remove("chrome-off-boot");
    if (typeof window.fitDeskStage === "function") window.fitDeskStage();
    syncThemeChromeUi();
  }

  function syncThemeChromeUi() {
    var theme = getTheme();
    document.querySelectorAll("[data-theme]").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-theme") === theme);
    });
    var chromeOn = getChromeOn();
    document.querySelectorAll("[data-chrome]").forEach(function (btn) {
      var want = btn.getAttribute("data-chrome") === "on";
      btn.classList.toggle("is-on", want === chromeOn);
    });
  }

  function renderHeaderChrome() {
    var org = findOrg(state.orgId);
    var sel = document.getElementById("org-select");
    if (sel && sel.options.length !== ORG_CATALOG.length) {
      sel.innerHTML = ORG_CATALOG.map(function (o) {
        return '<option value="' + esc(o.orgId) + '">' + esc(o.name) + "</option>";
      }).join("");
    }
    if (sel) sel.value = state.orgId;
    document.getElementById("shop-name").textContent = state.shop;
    document.getElementById("header-sub").textContent = "櫃台腦";
    var badge = document.getElementById("role-badge");
    badge.textContent = meta.role === "manager" ? "店長" : "店員";
    badge.className = "role-badge " + (meta.role === "manager" ? "is-manager" : "is-staff");
    var chip = document.getElementById("org-id-chip");
    if (chip) {
      chip.textContent = org.shortCode;
      chip.title = "店家短碼（除錯）";
    }
    var offBtn = document.getElementById("btn-offline");
    if (offBtn) offBtn.textContent = simOffline ? "恢復連線" : "模擬離線";
    var offBar = document.getElementById("offline-banner");
    if (offBar) offBar.hidden = !simOffline;
    syncThemeChromeUi();
    var ov = document.getElementById("overflow-menu");
    var ovBtn = document.getElementById("btn-overflow");
    if (ov) ov.hidden = !overflowOpen;
    if (ovBtn) ovBtn.setAttribute("aria-expanded", overflowOpen ? "true" : "false");
  }

  function renderAnalytics() {
    var c = counts();
    var compact = document.getElementById("stats-compact-text");
    if (compact) {
      compact.textContent =
        "用餐 " + c.dining + " · 待清 " + c.dirty + " · 空 " + c.empty + " · 候位 " + c.waiting;
    }
    var expand = document.getElementById("analytics-expand");
    var toggle = document.getElementById("btn-stats-toggle");
    var showExpand = statsExpanded;
    // OV-P1-01: auto-collapse on insight screens
    if (INSIGHT_SCREENS.indexOf(state.screen) !== -1) showExpand = false;
    if (expand) expand.hidden = !showExpand;
    if (toggle) toggle.setAttribute("aria-expanded", showExpand ? "true" : "false");
    document.getElementById("stat-covers").textContent = String(state.covers);
    document.getElementById("stat-covers-sub").textContent = "在席約 " + c.seated + " 人　·　含已離席累計";
    document.getElementById("stat-turns").textContent = c.rate;
    document.getElementById("stat-turns-sub").textContent = "已翻 " + state.turns + " 桌　·　" + c.rate + " 次／桌（示意）";
    document.getElementById("stat-floor").textContent = c.dining + " 用餐　／　" + c.dirty + " 待清　／　" + c.empty + " 空";
    document.getElementById("stat-floor-sub").textContent = "共 " + state.tables.length + " 桌　·　本店";
    document.getElementById("stat-wait").textContent = String(c.waiting);
    var longW = longestWaitEta();
    document.getElementById("stat-wait-sub").textContent = longW
      ? ("候位＋邀請 · 最久第 " + longW.queuePos + " 組·" + longW.reasonChip)
      : "候位＋邀請中";
  }

  function renderCrossStore() {
    var panel = document.getElementById("cross-store-panel");
    var body = document.getElementById("cross-store-body");
    var note = document.getElementById("cross-store-plan-note");
    if (!panel) return;
    // Only show on settings / finance insight when relevant — keep on all for feature parity but hide on tip peak unless entitled+consent
    var entitled = hasFeature("restaurant.analytics.cross_store");
    var peak = PEAK_SCREENS.indexOf(state.screen) !== -1;
    if (peak || state.screen === "hq") {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (!entitled) {
      note.textContent = "需高端方案才有跨店分析";
      body.innerHTML = '<p class="cross-denied">目前方案無跨店分析。切到「高端」後可演示授權開關。</p>';
      return;
    }
    note.textContent = "高端方案 · 跨店資料授權";
    if (!meta.consentCrossStore) {
      body.innerHTML =
        '<p class="cross-denied">' +
        "<strong>未授權／樣本不足</strong> — 跨店對比數字不顯示。請於設定開啟跨店資料授權（僅店長）。" +
        "</p>";
      return;
    }
    var other = ORG_CATALOG.find(function (o) { return o.orgId !== state.orgId; });
    var otherState = loadOrgState(other.orgId);
    body.innerHTML =
      '<div class="cross-grid">' +
        '<div class="cross-card"><div class="stat-k">' + esc(state.shop) + '</div>' +
          '<div class="stat-v sm">' + state.covers + '</div><div class="stat-s">今日來客（本店）</div></div>' +
        '<div class="cross-card"><div class="stat-k">' + esc(other.name) + '</div>' +
          '<div class="stat-v sm">' + otherState.covers + '</div><div class="stat-s">今日來客（對照）</div></div>' +
        '<div class="cross-card"><div class="stat-k">翻桌對照</div>' +
          '<div class="stat-v sm">' + state.turns + " / " + otherState.turns + '</div>' +
          '<div class="stat-s">本店／對照（示意）</div></div>' +
      "</div>" +
      '<p class="help" style="margin-top:8px">跨店資料授權開啟後才顯示。數字為各店分開後的示意彙總，非正式授權。</p>';
  }

  function renderTabs() {
    document.querySelectorAll(".tab[data-screen]").forEach(function (btn) {
      var on = btn.getAttribute("data-screen") === state.screen;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".insight-link").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-screen") === state.screen);
    });
    var moreBtn = document.getElementById("btn-more");
    if (moreBtn) {
      moreBtn.classList.toggle("is-open", moreOpen || INSIGHT_SCREENS.indexOf(state.screen) !== -1);
      moreBtn.setAttribute("aria-expanded", moreOpen ? "true" : "false");
    }
    document.body.classList.toggle("insight-active", INSIGHT_SCREENS.indexOf(state.screen) !== -1);
    var drawer = document.getElementById("insight-drawer");
    var backdrop = document.getElementById("insight-backdrop");
    if (drawer) drawer.hidden = !moreOpen;
    if (backdrop) backdrop.hidden = !moreOpen;
  }

  function nowDoText() {
    var dirty = state.tables.filter(function (t) { return t.status === "dirty"; });
    var waiting = state.waitlist.filter(function (p) { return p.status === "waiting"; });
    var invited = state.waitlist.filter(function (p) { return p.status === "invited"; });
    var lateHolds = lateSuggestTargets();
    var lateKq = (state.kitchenQueue || []).filter(function (o) {
      return o.status !== "done" && kitchenOverdueLevel(o);
    });
    if (lateHolds.length && PEAK_SCREENS.indexOf(state.screen) !== -1) {
      var lp = lateHolds[0];
      var tl = "";
      var tb = state.tables.find(function (x) { return x.id === lp.reserveTableId; });
      if (tb) tl = tb.name;
      return "訂位 " + lp.name + (tl ? " · " + tl : "") +
        " 逾時／將逾寬限 — 現在該做：確認釋放桌位後可補位（非 AI 消滅 no-show）";
    }
    /* 超時廚房單 → lemon「現在該做」（尖峰任一頁） */
    if (lateKq.length && PEAK_SCREENS.indexOf(state.screen) !== -1) {
      var first = lateKq[0];
      var lv = kitchenOverdueLevel(first) === "crit" ? "嚴重超時" : "偏久";
      return "廚房 " + first.table + " " + lv + "（票齡 " + formatWaitMmSs(first.sent_at || first.at) +
        "）— 現在該做：確認催菜或告知客人（不改承諾）";
    }
    if (state.screen === "tables" && dirty.length) {
      var longT = longestWaitEta();
      return "優先清 " + dirty.map(function (t) { return t.name; }).join("、") +
        "，騰出後可補位" +
        (longT ? "（候位最久：" + longT.name + "·" + longT.reasonChip + "）" : "");
    }
    if (state.screen === "wait") {
      var openBf = (state.backfillRounds || []).find(function (r) { return r.status === "open"; });
      if (openBf) {
        return "原子補位進行中 → " + (openBf.tableLabel || "") +
          " · 倒數 " + formatCountdown(openBf.until) + " · 先確認者得桌";
      }
      if (invited.length) return "有 " + invited.length + " 組邀請中，請確認入座／接受補位";
      if (waiting.length) {
        var longE = longestWaitEta();
        var etaHint = longE
          ? " · 最久 " + longE.name + "（第 " + longE.queuePos + " 組）" + longE.reasonChip
          : "";
        return waiting.length + " 組可補位（勾選≥2組後同時邀）" + etaHint + " · 座位 ETA 與桌況同源";
      }
      return "目前無候位 — 可加入現場組別";
    }
    if (state.screen === "pos") {
      if (state.ticket.lines.length) return "可「送廚」寫入事件流，或確認支付後結帳（示意·非金流）";
      return "點左側菜單加入此單；送廚後見預估與等待";
    }
    return "";
  }

  function nowDoRushTarget() {
    if (PEAK_SCREENS.indexOf(state.screen) === -1) return null;
    if (aiDismissed["nowdo-rush"]) return null;
    var lateKq = (state.kitchenQueue || []).filter(function (o) {
      return o.status !== "done" && kitchenOverdueLevel(o) && !o.rushConfirmed && !o.rushSkipped;
    });
    return lateKq.length ? lateKq[0] : null;
  }

  function renderNowDo() {
    var el = document.getElementById("now-do");
    var text = document.getElementById("now-do-text");
    var actions = document.getElementById("now-do-actions");
    var t = nowDoText();
    if (!el || !text) return;
    if (!t || INSIGHT_SCREENS.indexOf(state.screen) !== -1) {
      el.hidden = true;
      text.textContent = "";
      if (actions) actions.innerHTML = "";
      return;
    }
    el.hidden = false;
    text.textContent = t;
    if (actions) {
      var lateT = lateSuggestTargets()[0];
      var rush = nowDoRushTarget();
      if (lateT) {
        actions.innerHTML =
          '<button type="button" class="btn primary now-do-btn" data-late-confirm="' +
            esc(String(lateT.id)) + '" data-nowdo-trail="1">確認釋放</button>' +
          '<button type="button" class="btn now-do-btn" data-late-skip="' +
            esc(String(lateT.id)) + '" data-nowdo-trail="1">略過</button>';
      } else if (rush) {
        actions.innerHTML =
          '<button type="button" class="btn primary now-do-btn" data-rush-confirm="' +
            esc(rush.id) + '" data-nowdo-trail="1">確認催菜</button>' +
          '<button type="button" class="btn now-do-btn" data-rush-skip="' +
            esc(rush.id) + '" data-nowdo-trail="1">略過</button>';
      } else {
        actions.innerHTML = "";
      }
    }
  }

  function renderHint() {
    /* v2: peak guidance moved to now-do strip; hide legacy ai-hint if present */
    var el = document.getElementById("ai-hint");
    if (el) { el.hidden = true; el.textContent = ""; }
  }


  function tablesideUrl(tableName) {
    try {
      var u = new URL("tableside.html", window.location.href);
      u.searchParams.set("table", tableName);
      return u.pathname + u.search;
    } catch (e) {
      return "tableside.html?table=" + encodeURIComponent(tableName);
    }
  }

  function tablesideAbsUrl(tableName) {
    try {
      var u = new URL("tableside.html", window.location.href);
      u.searchParams.set("table", tableName);
      return u.href;
    } catch (e) {
      return "tableside.html?table=" + encodeURIComponent(tableName);
    }
  }

  /** Simple mock QR SVG (not a real encoder — Preview visual only) */
  function mockQrSvg(label) {
    var bits = [];
    var seed = 0;
    for (var i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) >>> 0;
    function bit(x, y) {
      var n = (seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0;
      return (n % 5) !== 0;
    }
    var size = 21;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var finder =
          (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
        var on = finder
          ? (x === 0 || y === 0 || x === 6 || y === 6 || x === size - 1 || y === size - 1 ||
             x === size - 7 || y === size - 7 ||
             (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
             (x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4) ||
             (x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3))
          : bit(x, y);
        if (on) {
          bits.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#0A0A0A"/>');
        }
      }
    }
    return (
      '<svg class="qr-mock" viewBox="0 0 ' + size + ' ' + size +
      '" width="120" height="120" role="img" aria-label="桌上 QR 示意 ' + esc(label) + '">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' + bits.join("") + "</svg>"
    );
  }

  function renderTableQr(t) {
    if (!t) return "";
    var href = tablesideUrl(t.name);
    return (
      '<div class="table-qr" data-table-qr="' + t.id + '">' +
        '<div class="table-qr-h">桌上 QR（掃碼點餐）</div>' +
        '<div class="table-qr-body">' +
          mockQrSvg(t.name) +
          '<div class="table-qr-meta">' +
            '<div class="ts-table-code">' + esc(t.name) + "</div>" +
            '<a class="btn primary table-qr-open" href="' + esc(href) +
              '" target="_blank" rel="noopener">模擬掃碼開啟</a>' +
            '<p class="help">連結：' + esc(href) + "</p>" +
            '<p class="help">Preview 視覺碼 · 非正式編碼器</p>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function kitchenQueueHtml() {
    var q = state.kitchenQueue || [];
    if (!q.length) {
      return (
        '<div class="kitchen-queue">' +
          '<div class="kitchen-queue-h"><h3>廚房／桌邊佇列</h3>' +
          '<span class="help">送廚後出現 · 票齡色帶</span></div>' +
          '<p class="help">尚無廚房單。POS「送廚」或客人 tableside.html?table=T3。</p>' +
          kitchenEventsHtml() +
          suggestionTrailHtml({ limit: 6, compact: true }) +
        "</div>"
      );
    }
    var cards = q.slice(0, 12).map(function (o) {
      var st = o.status || "sent";
      var prep = orderPrepMinutes(o);
      var serve = orderServeMinutes(o);
      var sentAt = o.sent_at || o.at;
      var ageLv = ticketAgeLevel(o);
      var over = kitchenAgeClass(o);
      var eta = st === "done" ? null : liveEtaForOrder(o);
      var lines = (o.lines || []).map(function (l) {
        enrichLine(l);
        var so = isSoldOut(l.id);
        return (
          "<li>" + esc(l.name) + " × " + l.qty + " " +
            lineSourceChip(l.source || o.actor) +
            (so ? ' <span class="src-chip src-86">售完</span>' : "") +
            '<span class="kq-line-eta">預估製作 ' + l.prepMinutes +
            " 分 · 預估送餐 " + l.serveMinutes + " 分</span>" +
            ' <button type="button" class="btn kq-86" data-86="' + esc(l.id) + '">86／售完</button>' +
            "</li>"
        );
      }).join("");
      var actions = "";
      if (st === "sent") {
        actions =
          '<button type="button" class="btn" data-kq-ack="' + esc(o.id) + '">廚房已收</button>' +
          '<button type="button" class="btn" data-kq-done="' + esc(o.id) + '">完成</button>';
      } else if (st === "ack") {
        actions = '<button type="button" class="btn" data-kq-done="' + esc(o.id) + '">完成</button>';
      } else {
        actions = '<span class="help">已完成</span>';
      }
      if (st !== "done" && (ageLv === "warn" || ageLv === "crit")) {
        if (o.rushConfirmed) {
          actions += ' <span class="help rush-done">已確認催菜（未改承諾）</span>';
        } else if (o.rushSkipped) {
          actions += ' <span class="help rush-done">已略過催菜</span>';
        } else {
          actions +=
            ' <button type="button" class="btn primary" data-rush-confirm="' + esc(o.id) +
            '">確認催菜</button>' +
            ' <button type="button" class="btn" data-rush-skip="' + esc(o.id) + '">略過</button>';
        }
      }
      var srcHtml = sourceChipsHtml(o.sources || [o.actor]);
      var ageHtml = (st === "done" || !ageLv)
        ? ""
        : ('<span class="age-pill age-' + ageLv + '" data-kq-age-pill="' + esc(o.id) + '">' +
           "票齡 " + Math.floor(eta.ageMin) + " 分 · " + agePillLabel(ageLv) + "</span>");
      var waitHtml = st === "done"
        ? '<span class="kq-wait">已完成</span>'
        : ('<span class="kq-wait" data-kq-wait="' + esc(String(sentAt || "")) + '">已等待 ' +
           formatWaitMmSs(sentAt) + "</span>");
      var liveHtml = (st === "done" || !eta)
        ? ""
        : ('<span class="kq-live-rem">剩餘製作約 <strong data-kq-rem-prep="' + esc(o.id) + '">' +
           eta.remainingPrep + "</strong> 分" +
           '　·　佇列前 <strong data-kq-depth="' + esc(o.id) + '">' + eta.queueDepth +
           "</strong> 單</span>");
      var closedTag = o.checkClosed ? "　·　已關單" : "";
      return (
        '<div class="kq-card is-' + st + over + '" data-kq-id="' + esc(o.id) + '"' +
          (ageLv ? ' data-kq-age="' + ageLv + '"' : "") + ">" +
          '<div class="kq-top">' +
            '<span class="kq-table">' + esc(o.table) + "</span>" +
            '<span class="kq-sources">' + srcHtml + "</span>" +
            ageHtml +
            '<span class="kq-meta">' + esc(o.time || "") +
              "　·　#" + esc(String(o.id).slice(-8)) +
              "　·　NT$ " + (o.amount || 0) +
              "　·　" + (st === "sent" ? "待廚" : st === "ack" ? "製作中" : "完成") +
              closedTag +
            "</span>" +
          "</div>" +
          '<div class="kq-eta">' +
            "<span>基線製作 " + prep + " 分</span>" +
            "<span>基線送餐 " + serve + " 分</span>" +
            waitHtml +
            liveHtml +
          "</div>" +
          '<ul class="kq-lines">' + lines + "</ul>" +
          '<div class="kq-actions">' + actions + "</div>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="kitchen-queue">' +
        '<div class="kitchen-queue-h"><h3>廚房／桌邊佇列</h3>' +
        '<span class="line-fake-badge">N3 票齡色 · 綠／黃／紅</span></div>' +
        '<p class="help kq-age-legend">票齡門檻：&lt;' + TICKET_AGE_WARN_MIN +
          " 分綠　·　≥" + TICKET_AGE_WARN_MIN + " 分黃　·　≥" + TICKET_AGE_CRIT_MIN +
          " 分紅　·　ETA＝剩餘製作＋佇列深度×" + QUEUE_DEPTH_PENALTY_MIN + " 分</p>" +
        cards +
        kitchenEventsHtml() +
        suggestionTrailHtml({ limit: 8, compact: true }) +
      "</div>"
    );
  }

  function ensureTableFocus() {
    if (selectedTableId && state.tables.some(function (t) { return t.id === selectedTableId; })) {
      return state.tables.find(function (t) { return t.id === selectedTableId; });
    }
    var overdue = state.tables.find(function (t) {
      return t.status === "dining" && elapsedMin(t) >= OVERDUE_WARN_MIN;
    });
    var dining = state.tables.find(function (t) { return t.status === "dining"; });
    var dirty = state.tables.find(function (t) { return t.status === "dirty"; });
    var pick = overdue || dining || dirty || state.tables[0];
    selectedTableId = pick ? pick.id : null;
    return pick || null;
  }

  function ensureWaitFocus() {
    if (waitFocusId && state.waitlist.some(function (p) { return p.id === waitFocusId; })) {
      return state.waitlist.find(function (p) { return p.id === waitFocusId; });
    }
    var held = state.waitlist.find(function (p) { return p.status === "held"; });
    var invited = state.waitlist.find(function (p) { return p.status === "invited"; });
    var waiting = state.waitlist.find(function (p) { return p.status === "waiting"; });
    var lost = state.waitlist.find(function (p) {
      return p.status === "lost" || p.status === "expired" || p.status === "noshow";
    });
    var pick = held || invited || waiting || lost || state.waitlist[0] || null;
    waitFocusId = pick ? pick.id : null;
    return pick;
  }

  function openInfoDrawer() {
    infoDrawerOpen = true;
    var d = document.getElementById("lc-drawer");
    var b = document.getElementById("lc-backdrop");
    var btn = document.getElementById("btn-lc-drawer");
    if (d) d.classList.add("open");
    if (b) { b.hidden = false; b.classList.add("open"); }
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function closeInfoDrawer() {
    infoDrawerOpen = false;
    posMenuOpen = false;
    var d = document.getElementById("lc-drawer");
    var b = document.getElementById("lc-backdrop");
    var btn = document.getElementById("btn-lc-drawer");
    if (d) d.classList.remove("open");
    if (b) { b.classList.remove("open"); b.hidden = true; }
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function lcDrawerShell(inner, opts) {
    opts = opts || {};
    var open = infoDrawerOpen || posMenuOpen;
    var wide = opts.wide ? " wide" : "";
    var label = opts.label || "情報";
    return (
      '<button type="button" class="drawer-btn" id="btn-lc-drawer" aria-expanded="' +
        (open ? "true" : "false") + '" aria-controls="lc-drawer">' + esc(label) + "</button>" +
      '<div class="lc-backdrop' + (open ? " open" : "") + '" id="lc-backdrop"' +
        (open ? "" : " hidden") + "></div>" +
      '<aside class="lc-drawer' + wide + (open ? " open" : "") +
        '" id="lc-drawer" aria-label="' + esc(label) + '">' +
        '<button type="button" class="drawer-close" id="btn-lc-drawer-close">關閉</button>' +
        inner +
      "</aside>"
    );
  }

  function renderTableDetail(t) {
    /* Legacy helper kept for callers; Layout C uses focus panel instead. */
    if (!t) {
      return (
        '<section class="panel table-detail">' +
          '<div class="detail-title">選一桌</div>' +
          '<p class="help">點邊緣 chip 選中桌位。</p>' +
        "</section>"
      );
    }
    return '<section class="panel table-detail"><div class="detail-title">' + esc(t.name) + "</div></section>";
  }

  function renderTables() {
    var t = ensureTableFocus();
    var counts = countsNow();
    var chips = state.tables.map(function (tb) {
      var over = overdueClass(tb);
      var st = LABEL[tb.status] || tb.status;
      if (tb.status === "dining") st = formatElapsed(tb);
      if (tb.split && tb.splitParts) st = splitLabel(tb.splitParts) + " · " + st;
      else if (tb.mergedInto) st = "併入";
      else if (tb.mergedWith) st = "併桌 · " + st;
      else st = tableCapacity(tb) + "人 · " + st;
      return (
        '<button type="button" class="edge-chip ' + tb.status + over +
          (tb.split ? " is-split" : "") +
          (tb.mergedInto ? " is-merged" : "") +
          (selectedTableId === tb.id ? " is-on" : "") +
          '" data-select-table="' + tb.id + '" role="tab" aria-selected="' +
          (selectedTableId === tb.id ? "true" : "false") + '">' +
          '<span class="id">' + esc(tb.name) + "</span>" +
          '<span class="st">' + esc(st) +
            (over.indexOf("is-crit") !== -1 || over.indexOf("is-warn") !== -1 ? "!" : "") +
          "</span>" +
        "</button>"
      );
    }).join("");
    chips +=
      '<button type="button" class="edge-chip util" data-go-wait="1" title="候位">' +
        "候位 · " + counts.waiting + "</button>";

    var focusInner;
    if (!t) {
      focusInner =
        '<div class="focus-empty"><div class="focus-id">—</div><p>尚無桌位資料</p></div>';
    } else {
      var cap = tableCapacity(t);
      var shape = t.splitParts && t.splitParts.length ? splitLabel(t.splitParts) : "";
      var guests =
        t.status === "empty" || t.status === "dirty"
          ? "— / " + cap
          : (t.guests || 0) + " / " + cap;
      /* reserved 亦顯示保留人數 */
      var mins =
        t.status === "dining" || t.status === "dirty"
          ? formatElapsed(t)
          : "—";
      var late =
        t.status === "dining" && elapsedMin(t) >= OVERDUE_WARN_MIN;
      var statusText = LABEL[t.status] + (late ? " · 過久" : "");
      if (t.split) statusText += " · 已拆 " + shape;
      if (t.mergedWith) statusText += " · 併桌";
      var activeStatus = t.status;
      if (t.split && selectedPartId) {
        var ap = partById(t, selectedPartId);
        if (ap) activeStatus = ap.status;
      }
      var keys = CYCLE.map(function (st) {
        return (
          '<button type="button" class="btn' + (activeStatus === st ? " is-current" : "") +
            '" data-set-status="' + st + '" data-table="' + t.id + '">' + LABEL[st] + "</button>"
        );
      }).join("");
      var partyLine =
        t.status === "dining"
          ? (esc(t.party || "現場客") + " · " + (t.guests || 0) + " 位")
          : t.status === "dirty"
            ? "需清桌後才能再坐"
            : t.status === "invited"
              ? ("補位邀請中" + (t.holdUntil ? " · 倒數 " + formatCountdown(t.holdUntil) : ""))
              : t.status === "reserved"
                ? ("訂位保留 · " + esc(t.party || "") +
                  (t.holdUntil
                    ? (' · 寬限倒數 <span data-countdown-until="' + t.holdUntil + '">' +
                      formatCountdown(t.holdUntil) + "</span>")
                    : ""))
                : "可帶位／確認入座";
      var partsHtml = "";
      if (t.split && t.parts && t.parts.length) {
        partsHtml =
          '<div class="part-list" aria-label="拆桌半桌">' +
          t.parts.map(function (p) {
            var on = selectedPartId === p.id;
            return (
              '<button type="button" class="part-chip ' + p.status + (on ? " is-on" : "") +
                '" data-select-part="' + p.id + '" data-table="' + t.id + '">' +
                "<strong>" + esc(t.name + "-" + p.id.toUpperCase()) + "</strong>" +
                "<span>" + p.seats + " 人 · " + (LABEL[p.status] || p.status) +
                (p.party ? " · " + esc(p.party) : "") + "</span>" +
              "</button>"
            );
          }).join("") +
          "</div>";
      }
      var splitBtns = "";
      if (canSplitTable(t)) {
        splitBtns +=
          '<button type="button" class="btn" data-split-table="' + t.id +
          '">拆成 ' + esc(shape || splitLabel(defaultSplitParts(cap))) + "</button>";
      }
      if (canUnsplitTable(t)) {
        splitBtns +=
          '<button type="button" class="btn" data-merge-table="' + t.id +
          '">併回 ' + cap + " 人桌</button>";
      }
      var nb = neighborEmpty(t);
      if (nb && !t.mergedWith) {
        splitBtns +=
          '<button type="button" class="btn" data-join-table="' + t.id +
          '">與 ' + esc(nb.name) + " 併桌</button>";
      }
      if (t.mergedWith) {
        splitBtns +=
          '<button type="button" class="btn" data-unjoin-table="' + t.id +
          '">取消併桌</button>';
      }
      var typeLab = cap + " 人桌" + (shape ? " · 可拆 " + shape : "");
      focusInner =
        '<div class="focus-panel" id="focus-panel">' +
          "<div>" +
            '<div class="focus-id">' + esc(t.name) + "</div>" +
            '<div class="focus-status ' + t.status + '">' +
              '<span class="dot" aria-hidden="true"></span>' +
              "<span>" + esc(statusText) + "</span>" +
            "</div>" +
            '<div class="focus-meta">' +
              '<div class="cell"><div class="k">人數</div><div class="v">' + guests + "</div></div>" +
              '<div class="cell"><div class="k">用餐／狀態時間</div><div class="v" id="focus-elapsed">' + mins + "</div></div>" +
              '<div class="cell"><div class="k">桌型／容量</div><div class="v" style="font-size:22px">' + esc(typeLab) + "</div></div>" +
              '<div class="cell"><div class="k">現場</div><div class="v" style="font-size:18px">' + partyLine + "</div></div>" +
            "</div>" +
            partsHtml +
            (splitBtns ? '<div class="split-actions">' + splitBtns + "</div>" : "") +
            '<div class="status-pills" aria-label="改狀態">' + keys + "</div>" +
            '<button type="button" class="btn" style="margin-top:10px" data-cycle="' + t.id + '">循環下一態</button>' +
          "</div>" +
          '<div class="focus-side">' +
            seatAssignStripHtml() +
            suggestionTrailHtml({ limit: 5, compact: true }) +
            lateEventsHtml({ limit: 5 }) +
            orderTimelineHtml(t.id) +
            "<h3>桌上 QR · 掃碼點餐</h3>" +
            renderTableQr(t) +
          "</div>" +
        "</div>";
    }

    var seatOff = !t || !(t.status === "empty" || t.status === "dirty" ||
      t.status === "invited" || t.status === "reserved");
    var pageOff = !t || !(t.status === "empty" || t.status === "dirty");
    var payOff = !t || t.status !== "dining";
    var seatCtaLab = t && t.status === "invited"
      ? "確認入座／接受補位"
      : (t && t.status === "reserved" ? "確認入座（訂位到店）" : "確認入座");
    var lateBtns = "";
    if (t && t.status === "reserved" && t.reservePartyId) {
      lateBtns =
        '<button type="button" class="btn xl secondary" data-late-accelerate="' +
          t.reservePartyId + '">加速遲到</button>' +
        '<button type="button" class="btn xl brass" data-late-confirm="' +
          t.reservePartyId + '">確認釋放</button>';
    } else if (t && (t.status === "empty" || t.status === "dirty")) {
      lateBtns =
        '<button type="button" class="btn xl secondary" data-start-backfill="' +
          t.id + '">對空桌發起補位</button>';
    }
    var cta =
      '<div class="cta-row" role="toolbar" aria-label="焦點動作">' +
        '<button type="button" class="btn xl primary' + (seatOff ? " is-off" : "") +
          '" id="btn-focus-seat"' + (seatOff ? " disabled" : "") + ">" + seatCtaLab + "</button>" +
        '<button type="button" class="btn xl secondary' + (pageOff ? " is-off" : "") +
          '" id="btn-focus-page"' + (pageOff ? " disabled" : "") + ">發送補位</button>" +
        '<button type="button" class="btn xl brass' + (payOff ? " is-off" : "") +
          '" id="btn-focus-pay"' + (payOff ? " disabled" : "") + ">結帳</button>" +
        lateBtns +
      "</div>";

    var drawer =
      "<h3>現場情報</h3>" +
      '<div class="mini-stat"><span>用餐</span><strong>' + counts.dining + "</strong></div>" +
      '<div class="mini-stat"><span>待清</span><strong>' + counts.dirty + "</strong></div>" +
      '<div class="mini-stat"><span>空桌</span><strong>' + counts.empty + "</strong></div>" +
      '<div class="mini-stat"><span>候位組數</span><strong>' + counts.waiting + "</strong></div>" +
      '<div class="mini-stat"><span>今日來客</span><strong>' + state.covers + "</strong></div>" +
      '<div class="mini-stat"><span>翻桌示意</span><strong>' + state.turns + "</strong></div>" +
      '<div class="legend" style="margin-top:14px">' +
        '<span><i class="l-empty"></i>空桌</span>' +
        '<span><i class="l-dining"></i>用餐中</span>' +
        '<span><i class="l-dirty"></i>待清</span>' +
        '<span><i class="l-reserved"></i>訂位保留</span>' +
      "</div>" +
      '<p class="help" style="margin-top:14px;line-height:1.5">' +
        "佈局 C｜單焦點舞台。N5：訂位寬限逾時釋放＋可補位。AI 不宣稱消滅 no-show；尖峰訂金仍是硬控（文案）。" +
      "</p>" +
      '<button type="button" class="btn" style="margin-top:8px" id="btn-demo-late">示範遲到留桌</button>' +
      '<button type="button" class="btn" style="margin-top:8px" id="btn-demo-clear-eta">示範：清一桌看 ETA 變</button>' +
      '<button type="button" class="btn" style="margin-top:12px" data-go-wait="1">開啟候位</button>';

    document.getElementById("view").innerHTML =
      '<div class="layout-c" data-layout="C">' +
        '<div class="edge-chips" role="tablist" aria-label="桌位邊緣 chip">' + chips + "</div>" +
        '<div class="focus">' + focusInner + cta + "</div>" +
        lcDrawerShell(drawer, { label: "情報" }) +
      "</div>";
  }

  function partyRow(p, interactive) {
    var member = p.member
      ? '<span class="badge">會員</span>'
      : '<span class="badge plain">客人</span>';
    var ch = p.channel === "線上"
      ? '<span class="badge online">線上</span>'
      : '<span class="badge plain">現場</span>';
    var kindB = p.kind === "reservation"
      ? '<span class="badge reserve">訂位' + (p.slot ? " " + esc(p.slot) : "") + "</span>"
      : "";
    var multiOk = hasFeature("restaurant.waitlist.multi_invite");
    var check = interactive
      ? '<input type="checkbox" class="wait-check" value="' + p.id + '"' +
        (p.status !== "waiting" || !multiOk ? " disabled" : "") +
        (backfillPickIds[p.id] ? " checked" : "") + ">"
      : "<span></span>";
    var focus = waitFocusId === p.id ? " is-selected" : "";
    var psz = partySizeOf(p);
    var eta = p.status === "waiting" ? seatEtaByPartyId(p.id) : null;
    return (
      '<div class="row' + focus + '" data-wait-focus="' + p.id + '">' +
        check +
        '<div><div class="party-name">' + esc(p.name) + member + ch + kindB + '</div>' +
        '<div class="party-meta">' +
          (p.kind === "reservation" ? "訂位 " + esc(p.slot || "") : "已候 " + p.waited + " 分") +
          (p.pref ? " · " + esc(p.pref) : "") +
          (eta ? '<div class="seat-eta-inline">' + seatEtaChipHtml(eta) + "</div>" : "") +
        "</div></div>" +
        '<div>' + psz + " 位</div>" +
        '<div class="hide-sm">' + partyStatusLabel(p.status) +
          (eta ? '<div class="help">' + esc(eta.reasonChip) + "</div>" : "") +
        "</div>" +
        '<div class="actions">' +
          (p.status === "waiting" ? '<button type="button" class="btn" data-invite-one="' + p.id + '">邀請</button>' : "") +
        "</div>" +
      "</div>"
    );
  }

  function lineCopy() {
    var shop = state.shop;
    var now = new Date();
    var reserveAt = new Date(now.getTime() + 35 * 60000);
    var deadline = new Date(now.getTime() + 8 * 60000);
    var waiting = state.waitlist.filter(function (p) { return p.status === "waiting"; });
    var invited = state.waitlist.filter(function (p) { return p.status === "invited"; });
    var seated = state.waitlist.filter(function (p) { return p.status === "seated"; });
    var g1 = waiting[0] || { name: "張小姐", size: 2 };
    var g2 = invited[0] || waiting[0] || { name: "黃先生", size: 4 };
    var g4 = seated[0] || {
      name: "客人",
      size: 2,
      tableName: (state.tables[1] && state.tables[1].name) || "T2"
    };
    var qPos = Math.max(1, waiting.length);
    var waitCount = waiting.length + invited.length;
    return [
      {
        title: "訂位確認",
        body: "【" + shop + "】已為您保留 " + mdhm(reserveAt) + " · " + g1.size + "位。到店報「" + g1.name + "」即可。若要改期請回「改」或來電。"
      },
      {
        title: "補位邀請",
        body: "【" + shop + "】有桌了！請於 " + hm(deadline) + " 前回「來」確認；逾時將開放給下一位。現場候位組數示意：" + waitCount + "。"
      },
      {
        title: "已被訂走",
        body: "抱歉，剛剛那組桌位已被下一位確認。您仍在候位第 " + qPos + " 位；有桌會再通知，或回「改」另約時段。"
      },
      {
        title: "入座",
        body: "已為您安排 " + (g4.tableName || "T2") + " 桌（" + g4.size + "位）。請直接入座，店員會協助。用餐愉快！"
      }
    ];
  }

  function lineCardsHtml() {
    return lineCopy().map(function (c) {
      return (
        '<article class="line-card">' +
          '<div class="line-card-k">' + esc(c.title) + "　·　示意</div>" +
          '<div class="line-card-from">' + esc(state.shop) + "　官方帳號（示意）</div>" +
          '<p class="line-bubble">' + esc(c.body) + "</p>" +
        "</article>"
      );
    }).join("");
  }

  function lineCardsForParty(p) {
    if (!p) return lineCardsHtml();
    var shop = state.shop;
    var hold = holdForParty(p);
    var n = hold && hold.partyIds ? hold.partyIds.length : 1;
    var tableLab = (hold && hold.tableLabel) || p.inviteTableLabel || "空桌";
    var until = p.inviteUntil ? new Date(p.inviteUntil) : new Date(Date.now() + INVITE_HOLD_MIN * 60000);
    var cards = [];
    if (p.status === "invited") {
      cards.push({
        title: "補位邀請",
        body: "【" + shop + "】有桌了（" + tableLab + "）！此波同時通知 " + n +
          " 組，先確認者留桌。請於 " + hm(until) + " 前確認入座／接受補位；逾時開放。示意非真 LINE。"
      });
    } else if (p.status === "lost") {
      cards.push({
        title: "已被訂走",
        body: "抱歉，" + tableLab + " 已被其他組確認入座。您這一波未搶到；有桌會再通知，或回「改」另約。示意非真 LINE。"
      });
    } else if (p.status === "expired") {
      cards.push({
        title: "已過期",
        body: "【" + shop + "】補位時限已過，" + tableLab + " 已釋放。您可繼續候位，有桌再邀。示意非真 LINE。"
      });
    } else if (p.status === "seated") {
      cards.push({
        title: "入座",
        body: "已為您安排 " + (p.tableName || tableLab) + "（" + partySizeOf(p) + "位）。請直接入座。用餐愉快！"
      });
    } else {
      return lineCardsHtml();
    }
    return cards.map(function (c) {
      return (
        '<article class="line-card">' +
          '<div class="line-card-k">' + esc(c.title) + "　·　示意</div>" +
          '<div class="line-card-from">' + esc(shop) + "　官方帳號（示意）</div>" +
          '<p class="line-bubble">' + esc(c.body) + "</p>" +
        "</article>"
      );
    }).join("");
  }

  function deadlineHtml(p) {
    if (p.status === "held") {
      var untilH = p.reserveUntil || reservationDeadlineMs(p) ||
        (Date.now() + getPolicy().reservationGraceMin * 60000);
      var dH = new Date(untilH);
      var past = Date.now() >= untilH;
      return (
        '<div class="deadline-chip late-chip' + (past ? " is-past" : "") +
          '" data-countdown-until="' + untilH + '">' +
          (past ? "已逾寬限 · " : ("寬限倒數 " + formatCountdown(untilH) + " · ")) +
          "留桌至 " + hm(dH) +
          "（訂位寬限 " + getPolicy().reservationGraceMin + " 分）</div>"
      );
    }
    if (p.status !== "invited") return "";
    var until = p.inviteUntil || (Date.now() + INVITE_HOLD_MIN * 60000);
    var d = new Date(until);
    return (
      '<div class="deadline-chip" data-countdown-until="' + until + '">' +
        "倒數 " + formatCountdown(until) + " · 留桌至 " + hm(d) +
        "（" + INVITE_HOLD_MIN + " 分 mock）</div>"
    );
  }

  function backfillTimelineHtml(hold) {
    if (!hold) return "";
    var steps = (hold.events || []).slice().reverse().slice(0, 8);
    if (!steps.length) return "";
    var lis = steps.map(function (ev) {
      var cls = "tl-" + ev.type;
      return (
        '<li class="bf-tl-item ' + cls + '">' +
          '<span class="bf-tl-t">' + hm(new Date(ev.at)) + "</span>" +
          '<span class="bf-tl-l">' + esc(backfillEventLabel(ev)) + "</span>" +
        "</li>"
      );
    }).join("");
    var head =
      hold.status === "open"
        ? "進行中 · " + esc(hold.tableLabel || "") + " · 倒數 " + formatCountdown(hold.until)
        : hold.status === "won"
          ? "已結束 · 確認入座 · " + esc(hold.tableLabel || "")
          : "已結束 · 已過期 · 桌位已釋放";
    return (
      '<div class="bf-timeline" aria-label="補位時間軸">' +
        '<div class="bf-timeline-h">補位時間軸 · 邀請→確認／搶輸／過期</div>' +
        '<div class="bf-timeline-sub">' + head + "</div>" +
        "<ol>" + lis + "</ol>" +
      "</div>"
    );
  }

  function backfillTargetPickerHtml(partyIds) {
    var maxNeed = 1;
    (partyIds || []).forEach(function (id) {
      var p = state.waitlist.find(function (x) { return x.id === id; });
      var sz = partySizeOf(p);
      if (sz > maxNeed) maxNeed = sz;
    });
    if (!partyIds || !partyIds.length) {
      var waiting = state.waitlist.filter(function (p) { return p.status === "waiting"; });
      waiting.forEach(function (p) {
        var sz = partySizeOf(p);
        if (sz > maxNeed) maxNeed = sz;
      });
    }
    var cands = candidateBackfillSeats(Math.max(1, maxNeed));
    if (!cands.length) {
      return '<p class="help">目前無容量足夠的空桌／待清桌可綁定補位。</p>';
    }
    var opts = cands.map(function (c) {
      var sel = backfillTargetTableId === c.tableId ? " selected" : "";
      return (
        '<option value="' + c.tableId + '"' +
          (c.partId ? ' data-part="' + c.partId + '"' : "") +
          sel + ">" + esc(c.label) + (c.held ? "" : "") + "</option>"
      );
    }).join("");
    return (
      '<label class="bf-target">' +
        "<span>目標桌（同一桌同時邀）</span>" +
        '<select id="bf-target-table">' + opts + "</select>" +
      "</label>"
    );
  }


  function renderWait() {
    expireOpenBackfills();
    var waiting = state.waitlist.filter(function (p) { return p.status === "waiting"; });
    var invited = state.waitlist.filter(function (p) { return p.status === "invited"; });
    var held = state.waitlist.filter(function (p) { return p.status === "held"; });
    var done = state.waitlist.filter(function (p) {
      return p.status === "seated" || p.status === "cancelled" ||
        p.status === "lost" || p.status === "expired" || p.status === "noshow";
    });
    var multiOk = hasFeature("restaurant.waitlist.multi_invite");
    var focus = ensureWaitFocus();
    if (focus && (focus.status === "seated" || focus.status === "cancelled")) {
      focus = held[0] || invited[0] || waiting[0] || null;
      waitFocusId = focus ? focus.id : null;
    }

    var active = held.concat(waiting).concat(invited);
    /* 搶輸／過期／遲到亦顯示於邊緣，方便點進看時間軸 */
    var edgeExtra = state.waitlist.filter(function (p) {
      return p.status === "lost" || p.status === "expired" || p.status === "noshow";
    });
    var chips = active.concat(edgeExtra).map(function (p) {
      var lab =
        p.status === "held" ? "訂位保留" :
        p.status === "noshow" ? "遲到／未到" :
        p.kind === "reservation" ? "訂位" :
        p.status === "invited" ? "已邀請" :
        p.status === "lost" ? "已被訂走" :
        p.status === "expired" ? "已過期" : "候位";
      var extra = p.kind === "reservation" ? (p.slot || "") : (p.waited + "′");
      var etaChip = p.status === "waiting" ? seatEtaByPartyId(p.id) : null;
      if (etaChip) {
        extra = "第" + etaChip.queuePos + "·" + etaChip.reasonChip;
      }
      return (
        '<button type="button" class="edge-chip ' + p.status +
          (p.kind === "reservation" ? " is-reserve" : "") +
          (p.status === "noshow" ? " is-noshow" : "") +
          (etaChip ? " has-seat-eta band-" + etaChip.band : "") +
          (waitFocusId === p.id ? " is-on" : "") +
          '" data-wait-focus="' + p.id + '" role="tab">' +
          '<span class="id">' + esc(p.name) + "</span>" +
          '<span class="st">' + lab + " · " + partySizeOf(p) + "位 · " + extra + "</span>" +
        "</button>"
      );
    }).join("");
    chips +=
      '<button type="button" class="edge-chip add" id="btn-chip-add-wait">＋ 加入候位</button>';

    var pickIds = selectedBackfillPartyIds();
    if (!pickIds.length && focus && focus.status === "waiting" && backfillPickIds[focus.id]) {
      pickIds = [focus.id];
    }
    var focusHold = focus ? holdForParty(focus) : null;
    if (!focusHold && backfillTargetTableId) {
      focusHold = openHoldForTable(backfillTargetTableId);
    }
    ensureBackfillRounds();
    if (!focusHold && state.backfillRounds[0] && state.backfillRounds[0].status === "open") {
      focusHold = state.backfillRounds[0];
    }

    var focusInner;
    if (!focus) {
      focusInner =
        '<div class="focus-panel" id="focus-panel">' +
          '<div class="focus-empty">' +
            '<div class="focus-id">候位</div>' +
            "<p>目前沒有候位中的組別。</p>" +
            '<button type="button" class="btn primary" id="btn-focus-add">加入候位</button>' +
          "</div>" +
          '<div class="focus-side">' +
            seatAssignStripHtml() +
            suggestionTrailHtml({ limit: 5, compact: true }) +
            backfillTimelineHtml(focusHold) +
          "</div>" +
        "</div>";
    } else {
      var stLab = partyStatusLabel(focus.status);
      if (focus.status === "invited") stLab = "已邀請／補位中";
      if (focus.status === "held") stLab = "訂位保留中";
      if (focus.status === "noshow") stLab = "遲到／未到";
      var focusEta = focus.status === "waiting" ? seatEtaByPartyId(focus.id) : null;
      var fair =
        focusHold && focusHold.status === "open"
          ? '<p class="bf-fair">此波同時通知 <strong>' +
            (focusHold.partyIds || []).length +
            "</strong> 組搶 <strong>" +
            esc(focusHold.tableLabel || "") +
            "</strong>；先確認者留桌（原子）。</p>"
          : multiOk
            ? '<p class="bf-fair">多組補位：勾選 ≥2 組 → 選一空桌 → 同時邀請；僅首個「確認入座／接受補位」得桌。</p>'
            : '<p class="bf-fair help">多組原子補位需升級「小店」。單組邀請仍可用。</p>';

      var pickHint =
        multiOk && pickIds.length
          ? '<div class="bf-pick-hint">已勾選 ' + pickIds.length + " 組：" +
            pickIds.map(function (id) {
              var x = state.waitlist.find(function (p) { return p.id === id; });
              return x ? esc(x.name) : id;
            }).join("、") +
            "</div>"
          : "";

      focusInner =
        '<div class="focus-panel" id="focus-panel">' +
          "<div>" +
            '<div class="focus-id" style="font-size:clamp(36px,5.5vw,56px)">' + esc(focus.name) + "</div>" +
            '<div class="focus-status ' + focus.status + '">' +
              '<span class="dot" aria-hidden="true"></span>' +
              "<span>" + stLab + "</span>" +
            "</div>" +
            (focus.member ? '<span class="badge" style="margin-top:8px">會員優先</span>' : "") +
            (focus.kind === "reservation" ? '<span class="badge reserve" style="margin-top:8px">訂位</span>' : "") +
            (focus.status === "held" ? '<span class="badge reserve" style="margin-top:8px">訂位保留</span>' : "") +
            (focus.status === "noshow" ? '<span class="badge noshow" style="margin-top:8px">遲到／未到</span>' : "") +
            (focus.status === "lost" ? '<span class="badge lost" style="margin-top:8px">已被訂走</span>' : "") +
            (focus.status === "expired" ? '<span class="badge expired" style="margin-top:8px">已過期</span>' : "") +
            '<div class="focus-meta">' +
              '<div class="cell"><div class="k">人數</div><div class="v">' + partySizeOf(focus) + " 位</div></div>" +
              '<div class="cell"><div class="k">' +
                (focus.kind === "reservation" ? "時段" : "已候") +
              '</div><div class="v">' +
                (focus.kind === "reservation" ? esc(focus.slot || "—") : focus.waited + "′") +
              "</div></div>" +
              '<div class="cell"><div class="k">座位 ETA</div><div class="v" style="font-size:16px">' +
                (focusEta
                  ? ("第 " + focusEta.queuePos + " 組 · " + esc(focusEta.seatEtaLabel))
                  : (focus.status === "waiting" ? "—" : "非候位中")) +
              "</div></div>" +
              '<div class="cell"><div class="k">通路／偏好</div><div class="v" style="font-size:18px">' +
                esc(focus.channel || "現場") + (focus.pref ? " · " + esc(focus.pref) : "") +
                (focusEta ? '<div class="seat-eta-inline">' + seatEtaChipHtml(focusEta) + "</div>" : "") +
              "</div></div>" +
              '<div class="cell"><div class="k">目標桌</div><div class="v" style="font-size:18px">' +
                esc(
                  (focus.status === "held" && focus.reserveTableId
                    ? ((state.tables.find(function (t) { return t.id === focus.reserveTableId; }) || {}).name || "—")
                    : null) ||
                  (focusHold && focusHold.tableLabel) ||
                  focus.inviteTableLabel ||
                  (backfillTargetTableId
                    ? ((state.tables.find(function (t) { return t.id === backfillTargetTableId; }) || {}).name || "—")
                    : "未綁定")
                ) +
              "</div></div>" +
            "</div>" +
            deadlineHtml(focus) +
            (focus.status === "held" || focus.status === "noshow"
              ? '<p class="bf-fair help">N5 遲到規則：逾寬限自動標「遲到／未到」並釋放桌；可對空桌發起補位。非 AI 消滅 no-show；尖峰訂金仍是硬控（文案）。</p>'
              : fair) +
            pickHint +
            (multiOk && focus.status === "waiting"
              ? backfillTargetPickerHtml(pickIds.length ? pickIds : [focus.id])
              : "") +
            (focus.status === "waiting" && focus.kind === "reservation"
              ? '<div class="late-hold-actions">' +
                '<label class="help">訂位留桌（N5）</label>' +
                '<select id="reserve-hold-table">' +
                state.tables.filter(function (tb) {
                  return !tb.mergedInto && (tb.status === "empty" || tb.status === "dirty") && !tb.split;
                }).map(function (tb) {
                  return '<option value="' + tb.id + '">' + esc(tb.name) + "（" + tableCapacity(tb) + "）</option>";
                }).join("") +
                "</select>" +
                '<button type="button" class="btn" data-hold-reserve="' + focus.id + '">留桌</button>' +
                "</div>"
              : "") +
            (focusHold && focusHold.status === "open"
              ? '<button type="button" class="btn" id="btn-bf-accelerate" data-hold="' +
                esc(focusHold.id) + '">加速過期（示意）</button>'
              : "") +
            (focus.status === "held"
              ? '<button type="button" class="btn" data-late-accelerate="' + focus.id +
                '">加速遲到（示意）</button>' +
                '<button type="button" class="btn primary" data-late-confirm="' + focus.id +
                '">確認釋放</button>'
              : "") +
            (focus.status === "noshow" && focus.reserveTableId
              ? '<button type="button" class="btn primary" data-start-backfill="' +
                focus.reserveTableId + '">對空桌發起補位</button>'
              : "") +
            backfillTimelineHtml(focusHold) +
          "</div>" +
          '<div class="focus-side">' +
            seatAssignStripHtml() +
            suggestionTrailHtml({ limit: 5, compact: true }) +
            lateEventsHtml({ limit: 5 }) +
            '<div class="panel-h" style="margin:12px 0 0"><h3 style="margin:0">本組會收到</h3>' +
              '<span class="line-fake-badge">示意·非真 LINE</span></div>' +
            '<div class="line-cards compact-rail">' + lineCardsForParty(focus) + "</div>" +
          "</div>" +
        "</div>";
    }

    var canInvite = focus && focus.status === "waiting";
    var canConfirm = focus && (focus.status === "invited" || focus.status === "held");
    var canCancel = focus && (focus.status === "waiting" || focus.status === "invited" || focus.status === "held");
    var inviteLabel =
      multiOk && pickIds.length >= 2 ? "同時補位 " + pickIds.length + " 組" :
      multiOk ? "發送補位" : "邀請此組";
    var confirmLabel = focus && focus.status === "held" ? "確認入座（訂位到店）" : "確認入座／接受補位";
    var cta =
      '<div class="cta-row" role="toolbar" aria-label="候位主操作">' +
        '<button type="button" class="btn xl primary' + (!canInvite ? " is-off" : "") +
          '" id="btn-focus-invite"' + (!canInvite ? " disabled" : "") + ">" + inviteLabel + "</button>" +
        '<button type="button" class="btn xl brass' + (!canConfirm ? " is-off" : "") +
          '" id="btn-focus-confirm"' + (!canConfirm ? " disabled" : "") + ">" + confirmLabel + "</button>" +
        '<button type="button" class="btn xl secondary' + (!canCancel ? " is-off" : "") +
          '" id="btn-focus-cancel"' + (!canCancel ? " disabled" : "") + ">取消</button>" +
        (focus && focus.status === "held"
          ? '<button type="button" class="btn xl secondary" data-late-accelerate="' + focus.id +
            '">加速遲到</button>'
          : "") +
        (focus && focus.status === "noshow"
          ? '<button type="button" class="btn xl primary" data-start-backfill="' +
            (focus.reserveTableId || "") + '">對空桌發起補位</button>'
          : "") +
      "</div>";

    var multiBtn = multiOk
      ? '<button type="button" class="btn primary" id="btn-invite">勾選≥2組後原子補位</button>'
      : '<button type="button" class="btn primary is-locked" id="btn-invite" aria-disabled="true">多組補位 🔒</button>';
    var trayHelp = multiOk
      ? '<p class="help">原子規則：同桌同時邀 ≥2 組；僅首個確認得桌，其餘立即「已被訂走」。重送不新建第二佔位。過期釋放。</p>'
      : '<p class="help locked-note">多組補位需升級「小店」。焦點「邀請此組」仍可用。</p>';

    var drawer =
      "<h3>候位情報 · 原子補位</h3>" +
      trayHelp +
      '<p class="help">N6 座位 ETA 與桌況同源（空桌／待清／翻桌）；<strong>示意·非保證</strong>；≠ 廚房出餐等待。</p>' +
      '<div class="n6-demo-row">' +
        '<button type="button" class="btn primary" id="btn-demo-clear-eta">示範：清一桌看 ETA 變</button>' +
      "</div>" +
      '<div class="panel-h" style="margin-top:8px"><strong>候位列</strong><span class="help">可多選 · 含座位 ETA</span></div>' +
      '<div class="row head"><span></span><span>稱呼</span><span>人數</span><span class="hide-sm">狀態</span><span></span></div>' +
      waiting.map(function (p) { return partyRow(p, true); }).join("") +
      (waiting.length ? "" : '<p class="help">無候位中組別</p>') +
      '<div class="add-form" id="add-wait-form" style="margin-top:12px">' +
        '<input id="new-name" placeholder="新增稱呼，例如 吳小姐" maxlength="20">' +
        '<input id="new-size" type="number" min="1" max="12" value="2" title="人數">' +
        '<button type="button" class="btn primary" id="btn-add-wait">加入候位</button>' +
      "</div>" +
      multiBtn +
      (invited.length
        ? '<h3 style="margin-top:18px">邀請中</h3>' +
          invited.map(function (p) {
            return (
              '<div class="invite-card invited" data-wait-focus="' + p.id + '">' +
                esc(p.name) + " · " + partySizeOf(p) + " 位" +
                (p.inviteTableLabel ? " → " + esc(p.inviteTableLabel) : "") +
                deadlineHtml(p) +
                '<div class="actions" style="margin-top:8px">' +
                  '<button type="button" class="btn ok" data-confirm="' + p.id + '">確認入座／接受補位</button>' +
                "</div>" +
              "</div>"
            );
          }).join("")
        : "") +
      (done.length
        ? '<h3 style="margin-top:18px">已處理</h3>' +
          done.map(function (p) {
            var lab =
              p.status === "seated" ? "已入座 " + esc(p.tableName || "") :
              p.status === "lost" ? "已被訂走" :
              p.status === "noshow" ? "遲到／未到" :
              p.status === "expired" ? "已過期" : "已取消";
            return (
              '<div class="invite-card' +
                (p.status === "cancelled" || p.status === "expired" || p.status === "noshow" ? " cancelled" : "") +
                (p.status === "lost" ? " lost" : "") +
                (p.status === "noshow" ? " noshow" : "") +
                '" data-wait-focus="' + p.id + '">' +
                esc(p.name) + "　" + lab +
              "</div>"
            );
          }).join("")
        : "");

    document.getElementById("view").innerHTML =
      '<div class="layout-c" data-layout="C">' +
        '<div class="edge-chips" role="tablist" aria-label="候位邊緣 chip">' + chips + "</div>" +
        '<div class="focus">' + focusInner + cta + "</div>" +
        lcDrawerShell(drawer, { label: "名單", wide: true }) +
      "</div>";
  }

  function renderPos() {
    var tid = Number(state.ticket.tableId) || 0;
    var table = tid ? state.tables.find(function (x) { return x.id === tid; }) : null;
    var focusName = table ? table.name : "外帶";
    var focusStatus = table ? LABEL[table.status] : "外帶單";

    var chips =
      '<button type="button" class="edge-chip' + (!tid ? " is-on" : "") +
        '" data-ticket-table="0"><span class="id">外帶</span><span class="st">外帶單</span></button>' +
      state.tables.map(function (tb) {
        var on = tid === tb.id;
        return (
          '<button type="button" class="edge-chip ' + tb.status + (on ? " is-on" : "") +
            (tb.split ? " is-split" : "") +
            '" data-ticket-table="' + tb.id + '">' +
            '<span class="id">' + esc(tb.name) + "</span>" +
            '<span class="st">' + LABEL[tb.status] +
            (tb.split && tb.splitParts ? " · " + splitLabel(tb.splitParts) : " · " + tableCapacity(tb) + "人") +
            "</span>" +
          "</button>"
        );
      }).join("");
    var kqN = (state.kitchenQueue || []).filter(function (o) {
      return o.status === "sent" || o.status === "ack";
    }).length;
    chips +=
      '<button type="button" class="edge-chip util" id="btn-chip-kitchen">廚列 · ' + kqN + "</button>";

    var openOrd = tid ? findOpenOrderForTable(tid) : null;
    var draftHtml = state.ticket.lines.length
      ? ('<div class="spine-draft-h">待送廚草稿（櫃台）</div>' +
        state.ticket.lines.map(function (l) {
          enrichLine(l);
          var so = isSoldOut(l.id);
          return (
            '<div class="line' + (so ? " is-soldout" : "") + '">' +
              "<div>" + esc(l.name) + ' <span class="src-chip tiny src-pos">櫃台</span>' +
                (so ? ' <span class="src-chip src-86">售完</span>' : "") +
                '<div class="party-meta">NT$ ' + l.price + "</div>" +
                lineEtaHtml(l) +
              "</div>" +
              '<div class="qty">' +
                '<button type="button" data-qty="' + l.id + '" data-delta="-1">−</button>' +
                "<span>" + l.qty + "</span>" +
                '<button type="button" data-qty="' + l.id + '" data-delta="1">＋</button>' +
              "</div>" +
              '<div class="line-amt">NT$ ' + (l.price * l.qty) + "</div>" +
            "</div>"
          );
        }).join(""))
      : "";
    var lines = openOrderLinesHtml(
      openOrd,
      draftHtml || (!openOrd ? '<p class="help">按「菜單」加入品項；送廚後與桌邊 QR 併同一 order id。</p>' : "")
    );
    var spineTotal = (openOrd ? (openOrd.amount || 0) : 0) + ticketTotal();
    var spineQty = (openOrd ? (openOrd.lines || []).reduce(function (n, l) { return n + l.qty; }, 0) : 0) +
      state.ticket.lines.reduce(function (n, l) { return n + l.qty; }, 0);

    var pays = PAY.map(function (p) {
      return (
        '<label><input type="radio" name="pay" value="' + p + '"' +
          (state.ticket.pay === p ? " checked" : "") + "> " + p + "</label>"
      );
    }).join("");

    var cats = MENU.map(function (c) {
      var items = c.items.map(function (it) {
        var so = isSoldOut(it.id);
        return (
          '<div class="dish-wrap' + (so ? " is-soldout" : "") + '">' +
            '<button type="button" class="dish" data-dish="' + it.id + '"' +
              (so ? " disabled" : "") + ">" +
              '<div class="dish-n">' + esc(it.name) + (so ? " · 售完" : "") + "</div>" +
              '<div class="dish-p">NT$ ' + it.price + "</div>" +
            "</button>" +
            '<button type="button" class="btn dish-86" data-86="' + it.id + '" title="標記售完／恢復">' +
              (so ? "恢復" : "86／售完") +
            "</button>" +
          "</div>"
        );
      }).join("");
      return (
        "<div><p class=\"cat-name\">" + esc(c.cat) + "</p>" +
        '<div class="menu-grid">' + items + "</div></div>"
      );
    }).join("");

    var rec = state.receipts.slice(0, 6).map(function (r) {
      return "<li>" + r.time + "　" + esc(r.table) + "　" + r.pay + "　NT$ " + r.amount + "　" + r.items + " 項</li>";
    }).join("");

    var focusInner =
      '<div class="focus-panel" id="focus-panel">' +
        "<div>" +
          '<div class="focus-id">' + esc(focusName) + "</div>" +
          '<div class="focus-status ' + (table ? table.status : "empty") + '">' +
            '<span class="dot" aria-hidden="true"></span>' +
            "<span>" + esc(focusStatus) + " · 此單</span>" +
          "</div>" +
          '<div class="focus-meta">' +
            '<div class="cell"><div class="k">品項數</div><div class="v">' +
              spineQty +
            "</div></div>" +
            '<div class="cell"><div class="k">支付</div><div class="v" style="font-size:18px">' +
              esc(state.ticket.pay) + "</div></div>" +
            '<div class="cell"><div class="k">訂單</div><div class="v" style="font-size:16px">' +
              (openOrd ? ("#" + String(openOrd.id).slice(-8)) : "未開單") +
            "</div></div>" +
          "</div>" +
          '<div class="help" style="margin-top:10px">支付方式（店員回報，不串金流）· 同桌開單與桌邊 QR 共用 order id</div>' +
          '<div class="pay-row pay">' + pays + "</div>" +
          (openOrd ? ('<div class="spine-chips" style="margin-top:8px">' + sourceChipsHtml(openOrd.sources) + "</div>") : "") +
          (openOrd ? fohLiveEtaHtml(openOrd) : "") +
          '<span class="line-fake-badge" style="margin-top:10px">示意·非金流 · N2 脊柱 · N3 票齡 ETA</span>' +
        "</div>" +
        '<div class="focus-side">' +
          "<h3>本單明細（脊柱）</h3>" +
          '<div class="ticket-lines">' + lines + "</div>" +
          '<div class="order-total"><span>合計</span><span class="amt">NT$ ' + spineTotal + "</span></div>" +
        "</div>" +
      "</div>";

    var canPay = spineQty > 0;
    var canSend = state.ticket.lines.length > 0;
    var canCheckout = !!((openOrd && !state.ticket.lines.length) || (!openOrd && state.ticket.lines.length));
    var cta =
      '<div class="cta-row" role="toolbar" aria-label="POS 主操作" style="grid-template-columns:1fr 1fr 1.1fr 1.3fr">' +
        '<button type="button" class="btn xl secondary" id="btn-open-menu">菜單</button>' +
        '<button type="button" class="btn xl secondary" id="btn-clear-ticket"' +
          (state.ticket.lines.length ? "" : " disabled") + ">清空</button>" +
        '<button type="button" class="btn xl secondary' + (!canSend ? " is-off" : "") +
          '" id="btn-send-kitchen"' + (!canSend ? " disabled" : "") + ">送廚</button>" +
        '<button type="button" class="btn xl brass' + (!canCheckout ? " is-off" : "") +
          '" id="btn-checkout"' + (!canCheckout ? " disabled" : "") + ">結帳（示意）</button>" +
      "</div>";

    var drawer =
      (posMenuOpen
        ? "<h3>菜單 · " + esc(state.shop) + "</h3>" +
          '<div class="menu-drawer-grid cats">' + cats + "</div>"
        : "<h3>廚房／桌邊佇列</h3>") +
      (posMenuOpen ? '<hr style="border:none;border-top:1px solid var(--line);margin:16px 0">' : "") +
      (posMenuOpen ? "<h3>廚房／桌邊佇列</h3>" : "") +
      aiSuggestStripHtml() +
      kitchenQueueHtml() +
      (rec
        ? '<div class="receipts" style="margin-top:14px"><div>今日示意單據</div><ul>' + rec + "</ul></div>"
        : "") +
      '<p class="help" style="margin-top:12px">AI 建議需確認、不自動改單；採納／略過寫入建議紀錄。菜單／廚列在抽屜；舞台＝此單＋送廚／結帳。</p>';

    /* If opening menu, force drawer open */
    var prevMenu = posMenuOpen;
    if (prevMenu) infoDrawerOpen = true;

    document.getElementById("view").innerHTML =
      '<div class="layout-c" data-layout="C">' +
        '<div class="edge-chips" role="tablist" aria-label="POS 桌號 chip">' + chips + "</div>" +
        '<div class="focus">' + focusInner + cta + "</div>" +
        lcDrawerShell(drawer, { label: posMenuOpen ? "菜單" : "廚列", wide: true }) +
      "</div>";
  }


  function renderHqReport() {
    var period = hqPeriod === "week" ? "week" : "day";
    var pack = HQ_MOCK[period] || HQ_MOCK.day;
    var periodLabel = period === "week" ? "本週" : "今日";
    var canView = isManager();

    if (!canView) {
      document.getElementById("view").innerHTML =
        '<section class="panel hq-locked-full">' +
          '<div class="panel-h"><h2>總部報告</h2>' +
            '<span class="line-fake-badge">示意·非正式／待 Owner</span></div>' +
          '<p class="staff-readonly-bar">店員預設不可見完整總部報表。請切換身分為「店長」後查看（示意守門）。</p>' +
          '<p class="help">對齊 Intake：總部／店長可見；店員不可見完整報表。路徑 C 訂閱／entitlement 示意。</p>' +
        "</section>";
      return;
    }

    var storeCards = pack.stores.map(function (s) {
      return (
        '<article class="hq-store-card" data-hq-store="' + esc(s.id) + '">' +
          '<div class="hq-store-h">' +
            '<strong>' + esc(s.name) + "</strong>" +
            '<span class="hq-area">' + esc(s.area) + "</span>" +
          "</div>" +
          '<div class="hq-metrics">' +
            '<div class="hq-metric"><div class="stat-k">來客</div>' +
              '<div class="stat-v sm">' + s.covers + '</div>' +
              '<div class="stat-s">' + periodLabel + "（示意）</div></div>" +
            '<div class="hq-metric money"><div class="stat-k">營收示意</div>' +
              '<div class="stat-v sm money">' + moneyFmt(s.revenue) + '</div>' +
              '<div class="stat-s">非正式／非金流</div></div>' +
            '<div class="hq-metric"><div class="stat-k">翻桌</div>' +
              '<div class="stat-v sm">' + s.turns + '</div>' +
              '<div class="stat-s">次（示意）</div></div>' +
            '<div class="hq-metric"><div class="stat-k">候位轉換</div>' +
              '<div class="stat-v sm">' + s.waitConv + '%</div>' +
              '<div class="stat-s">邀請→入座</div></div>' +
            '<div class="hq-metric"><div class="stat-k">平均製作</div>' +
              '<div class="stat-v sm">' + (s.avgPrepMin != null ? s.avgPrepMin : "—") + '</div>' +
              '<div class="stat-s">分鐘（mock）</div></div>' +
            '<div class="hq-metric"><div class="stat-k">平均送餐</div>' +
              '<div class="stat-v sm">' + (s.avgServeMin != null ? s.avgServeMin : "—") + '</div>' +
              '<div class="stat-s">分鐘（mock）</div></div>' +
          "</div>" +
        "</article>"
      );
    }).join("");

    var totals = pack.stores.reduce(function (acc, s) {
      acc.covers += s.covers;
      acc.revenue += s.revenue;
      acc.turns += s.turns;
      acc.wait += s.waitConv;
      acc.prep += s.avgPrepMin || 0;
      acc.serve += s.avgServeMin || 0;
      return acc;
    }, { covers: 0, revenue: 0, turns: 0, wait: 0, prep: 0, serve: 0 });
    var avgWait = Math.round(totals.wait / pack.stores.length);
    var avgPrep = (totals.prep / pack.stores.length).toFixed(1);
    var avgServe = (totals.serve / pack.stores.length).toFixed(1);

    var entitled = hasFeature("restaurant.analytics.cross_store");
    var crossHtml;
    if (!entitled) {
      crossHtml =
        '<div class="hq-cross locked">' +
          '<div class="hq-cross-lock" aria-hidden="true">鎖</div>' +
          "<p><strong>跨店匿名對標未解鎖</strong> — 需高端方案（路徑 C entitlement）。切到「高端」後可演示 Consent。</p>" +
          '<p class="help">對齊 g0-06：僅 Consent ON＋樣本足夠才顯示匿名對標。</p>' +
        "</div>";
    } else if (!meta.consentCrossStore) {
      crossHtml =
        '<div class="hq-cross locked">' +
          '<div class="hq-cross-lock" aria-hidden="true">鎖</div>' +
          "<p><strong>跨店資料授權關閉（Consent OFF）</strong> — 匿名對標不顯示。請於「設定」開啟跨店資料授權（僅店長）。</p>" +
          '<p class="help">示意·非正式／待 Owner　·　無真實跨店個資</p>' +
          '<button type="button" class="btn" data-hq-goto="settings">前往設定</button>' +
        "</div>";
    } else {
      var anonRows = pack.anon.map(function (a) {
        return (
          "<tr>" +
            "<td>" + esc(a.label) + "</td>" +
            "<td>" + a.coversIdx + "</td>" +
            "<td>" + a.turnIdx + "</td>" +
            "<td>" + a.waitIdx + "</td>" +
          "</tr>"
        );
      }).join("");
      crossHtml =
        '<div class="hq-cross open">' +
          '<p class="help" style="margin-top:0">Consent ON · 匿名對標（店名脫敏）· 樣本足夠示意 · 非正式</p>' +
          '<div class="hq-anon-wrap"><table class="hq-anon-table">' +
            "<thead><tr><th>匿名店別</th><th>來客指數</th><th>翻桌指數</th><th>候位轉換指數</th></tr></thead>" +
            "<tbody>" + anonRows + "</tbody>" +
          "</table></div>" +
          '<p class="help">指數 0–100 為同業分位示意，非正式統計。來源對齊 G4／g0-06。</p>' +
        "</div>";
    }

    document.getElementById("view").innerHTML =
      '<div class="hq-report">' +
        '<header class="hq-toolbar panel">' +
          '<div class="hq-toolbar-main">' +
            "<div>" +
              '<div class="panel-h" style="margin:0;border:0;padding:0">' +
                "<h2>總部報告</h2>" +
                '<span class="line-fake-badge">示意·非正式／待 Owner</span>' +
              "</div>" +
              '<p class="help hq-sub">多店彙整 · 假資料含平均製作／送餐 · Intake HQ＋POS-AI-DATA-CORE</p>' +
            "</div>" +
            '<div class="hq-period" role="group" aria-label="期間">' +
              '<button type="button" class="hq-period-btn' + (period === "day" ? " is-on" : "") + '" data-hq-period="day">日</button>' +
              '<button type="button" class="hq-period-btn' + (period === "week" ? " is-on" : "") + '" data-hq-period="week">週</button>' +
            "</div>" +
          "</div>" +
          '<div class="hq-export">' +
            '<button type="button" class="btn" data-hq-export="csv">匯出 CSV（示意）</button>' +
            '<button type="button" class="btn" data-hq-export="pdf">匯出 PDF（示意）</button>' +
          "</div>" +
        "</header>" +

        '<section class="hq-summary">' +
          '<div class="cross-card"><div class="stat-k">連鎖來客</div>' +
            '<div class="stat-v sm">' + totals.covers + '</div>' +
            '<div class="stat-s">' + periodLabel + " · 3 店合計</div></div>" +
          '<div class="cross-card"><div class="stat-k">營收示意</div>' +
            '<div class="stat-v sm money">' + moneyFmt(totals.revenue) + '</div>' +
            '<div class="stat-s">brass · 非正式</div></div>' +
          '<div class="cross-card"><div class="stat-k">翻桌合計</div>' +
            '<div class="stat-v sm">' + totals.turns + '</div>' +
            '<div class="stat-s">' + periodLabel + "</div></div>" +
                    '<div class="cross-card"><div class="stat-k">候位轉換均</div>' +
            '<div class="stat-v sm">' + avgWait + '%</div>' +
            '<div class="stat-s">跨店平均</div></div>' +
          '<div class="cross-card"><div class="stat-k">平均製作</div>' +
            '<div class="stat-v sm">' + avgPrep + '</div>' +
            '<div class="stat-s">分鐘 · 跨店 mock</div></div>' +
          '<div class="cross-card"><div class="stat-k">平均送餐</div>' +
            '<div class="stat-v sm">' + avgServe + '</div>' +
            '<div class="stat-s">分鐘 · 跨店 mock</div></div>' +
        "</section>" +

        '<section class="panel">' +
          '<div class="panel-h"><h2>多店卡片</h2>' +
            '<span class="help">A／B／C · ' + periodLabel + " · 示意</span></div>" +
          '<div class="hq-store-grid">' + storeCards + "</div>" +
        "</section>" +

        '<section class="panel">' +
          '<div class="panel-h"><h2>跨店匿名對標</h2>' +
            '<span class="help">Consent · G4</span></div>' +
          crossHtml +
        "</section>" +

        '<p class="help hq-foot">路徑：更多 → 總部報告。Demo mock ≠ 正式授權／報稅／預測。規格：' +
          "<code>/workspace/state/specs/restaurant-ai/INT-RESTAURANT-HQ-ANALYTICS-20260913.md</code></p>" +
      "</div>";
  }

  function renderFinance() {
    var org = findOrg(state.orgId);
    var plan = PLAN_DEFS[state.plan] || PLAN_DEFS.trial;
    var recs = state.receipts || [];
    var sales = recs.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    var avg = recs.length ? Math.round(sales / recs.length) : 0;
    var c = counts();
    var split = {};
    recs.forEach(function (r) {
      split[r.pay] = (split[r.pay] || 0) + r.amount;
    });
    var splitHtml = PAY.map(function (p) {
      return "<li><span>" + p + "</span><span>NT$ " + (split[p] || 0) + "</span></li>";
    }).join("");
    var expiry = state.plan === "trial"
      ? ("試營運倒數約 " + (org.trialDaysLeft || 0) + " 天")
      : "下期續約日示意　·　非正式帳單";
    var recList = recs.length
      ? recs.slice(0, 8).map(function (r) {
          return "<li>" + r.time + "　" + esc(r.table) + "　" + r.pay + "　NT$ " + r.amount + "</li>";
        }).join("")
      : "<li>尚無示意單據。請到 POS-1 做一筆結帳。</li>";

    document.getElementById("view").innerHTML =
      '<div class="finance-grid">' +
        '<section class="panel plan-card">' +
          '<div class="panel-h"><h2>方案狀態</h2><span class="line-fake-badge">示意·非金流</span></div>' +
          '<div class="plan-current">' +
            '<div class="plan-name">' + esc(plan.name) +
              (plan.slug === "shop_high" ? '<span class="vip-chip" title="高端方案">VIP</span>' : "") +
            "</div>" +
            '<div class="plan-price">' + esc(plan.priceLabel) + "</div>" +
            '<div class="help">' + esc(expiry) + "　·　" + esc(plan.l0Hint) + "</div>" +
            '<p class="mock-warn">Demo mock ≠ 正式授權／非正式報價／無真實扣款</p>' +
          "</div>" +
          '<p class="help" style="margin-top:12px">變更方案請到「設定」（僅店長）。本頁只看狀態。</p>' +
        "</section>" +
        '<section class="panel">' +
          '<div class="panel-h"><h2>今日銷售</h2><span class="help">來自 POS 示意單據</span></div>' +
          '<div class="finance-sales">' +
            '<div class="cross-card"><div class="stat-k">營業額</div><div class="stat-v sm">NT$ ' + sales + '</div><div class="stat-s">示意·非金流</div></div>' +
            '<div class="cross-card"><div class="stat-k">單據</div><div class="stat-v sm">' + recs.length + '</div><div class="stat-s">本店隔離</div></div>' +
            '<div class="cross-card"><div class="stat-k">平均客單</div><div class="stat-v sm">NT$ ' + avg + '</div><div class="stat-s">單據平均</div></div>' +
          "</div>" +
          '<ul class="pay-split">' + splitHtml + "</ul>" +
          '<div class="receipts"><div>單據明細</div><ul>' + recList + "</ul></div>" +
        "</section>" +
        '<section class="panel" style="grid-column:1/-1">' +
          '<div class="panel-h"><h2>日結卡片</h2><span class="help">關帳前一眼　·　示意·非金流</span></div>' +
          '<div class="close-grid">' +
            '<div class="cross-card"><div class="stat-k">開帳</div><div class="stat-v sm">營業中</div><div class="stat-s">Preview 不打烊</div></div>' +
            '<div class="cross-card"><div class="stat-k">今日來客</div><div class="stat-v sm">' + state.covers + '</div><div class="stat-s">在席約 ' + c.seated + " 人</div></div>" +
            '<div class="cross-card"><div class="stat-k">翻桌</div><div class="stat-v sm">' + state.turns + '</div><div class="stat-s">' + c.rate + " 次／桌</div></div>" +
            '<div class="cross-card"><div class="stat-k">已結帳</div><div class="stat-v sm">NT$ ' + sales + '</div><div class="stat-s">' + recs.length + " 張單</div></div>" +
            '<div class="cross-card"><div class="stat-k">未結桌</div><div class="stat-v sm">' + c.dining + '</div><div class="stat-s">用餐中　·　待清 ' + c.dirty + "</div></div>" +
            '<div class="cross-card"><div class="stat-k">候位中</div><div class="stat-v sm">' + c.waiting + '</div><div class="stat-s">含邀請中</div></div>' +
          "</div>" +
        "</section>" +
      "</div>";
  }

  function renderGuest() {
    var firstWait = (state.waitlist || []).find(function (p) { return p.status === "waiting"; });
    var seatEta = firstWait ? seatEtaByPartyId(firstWait.id) : null;
    var seatLine = seatEta
      ? ('<div class="guest-seat-eta panel" style="margin:12px 12px 0;background:var(--bg2)">' +
          '<div class="panel-h"><h3 style="margin:0;font-size:15px">位子還要多久（候位）</h3>' +
          '<span class="line-fake-badge">示意·非保證 · ≠出餐</span></div>' +
          '<p style="margin:6px 0 0;font-size:14px">' +
            esc(firstWait.name) + " · 第 " + seatEta.queuePos + " 組 · " +
            esc(seatEta.guestLine) +
          "</p>" +
          '<p class="help" style="margin:6px 0 0">與櫃台桌況同源；不是廚房出餐「還要多久」。</p>' +
        "</div>")
      : "";
    document.getElementById("view").innerHTML =
      '<section class="guest-cx">' +
        '<div class="guest-phone" aria-label="客人 LINE 示意">' +
          '<div class="guest-phone-bar">客人視角　·　示意·非真 LINE</div>' +
          '<div class="panel" style="margin:0;background:var(--bg1)">' +
            '<div class="panel-h"><h2>您會收到的通知</h2><span class="line-fake-badge">示意·非真 LINE</span></div>' +
            '<p class="help" style="margin-top:-6px;margin-bottom:10px">這是客人手機示意，不是店員帳號。不會真的發到 LINE。</p>' +
            '<div class="line-cards">' + lineCardsHtml() + "</div>" +
            seatLine +
          "</div>" +
        "</div>" +
        '<p class="help guest-note">四段節奏：訂位確認 → 候補／補位 → 已被訂走 → 入座。文案對齊旅程稿。座位 ETA ≠ 出餐等待。</p>' +
      "</section>";
  }

  function renderCompete() {
    var rows = [
      ["多組同時補位＋先確認者得桌", "逐組候位／通知", "逐組候位／通知", "逐組候位／通知", "逐組／平台訂位", "非控位產品", "獨有候選 B"],
      ["AI 依本店時間軸建議接客／定價", "加購 AI／營收診斷", "未見店家 AI 行動", "消費者找店 AI", "未見店家 AI", "會員行銷自動化", "獨有候選 A"],
      ["訂位→桌→點餐→結帳同一時間軸", "POS 完整、訂位另冊", "POS＋訂位各完整", "訂候位為主", "平台訂位", "線上點／串 POS", "獨有候選 C（定位）"],
      ["POS-1 輕量、不做發票", "重 POS＋發票", "重 POS＋發票", "偏訂位／串 POS", "偏平台", "線上點／串接", "刻意差異（小店）"],
      ["匿名跨店對標（授權）", "同品牌連鎖報表", "同品牌多店", "同品牌 CRM", "公開不足", "同品牌分店比較", "G4 長期；Demo 僅開關"]
    ];
    var head = "<tr><th>我們強調</th><th>iCHEF</th><th>肚肚</th><th>inline</th><th>EZTABLE</th><th>Ocard</th><th>我們</th></tr>";
    var body = rows.map(function (r) {
      return "<tr>" + r.map(function (cell, i) {
        return "<td" + (i === 6 ? ' class="us"' : "") + ">" + esc(cell) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    document.getElementById("view").innerHTML =
      '<section class="panel">' +
        '<div class="panel-h"><h2>競品比較</h2><span class="help">一屏摘要　·　非正式行銷定稿</span></div>' +
        '<p class="help" style="margin-top:-4px;margin-bottom:12px">對手：iCHEF、肚肚、inline、EZTABLE、Ocard。細節見盤點檔。</p>' +
        '<div class="compete-wrap"><table class="compete-table">' + head + body + "</table></div>" +
        '<div class="panel-h" style="margin-top:18px"><h2>我們不同</h2><span class="help">三點皆可點開看來源</span></div>' +
        '<div class="unique-list">' +
          '<details class="unique-item" open><summary>獨有候選 A　·　AI 依本店時間軸建議接客／定價行動</summary>' +
            "<p>與 iCHEF 加購 AI、inline 消費者找店、Ocard 行銷自動化語意不同。建議哪個時段該開放、哪組該邀、哪道該調價，並銜接補位。</p>" +
            "<p>來源：<code>/workspace/state/projects/restaurant-ai-g0/g0-01-competitor-matrix.md</code>　§2 A</p></details>" +
          '<details class="unique-item"><summary>獨有候選 B　·　多組同時補位＋先確認者得桌</summary>' +
            "<p>取消／空桌釋出時可同時邀請多組，先確認者成立、其餘收「已被訂走」。公開未見對手以此原子語意產品化。</p>" +
            "<p>來源：<code>/workspace/state/projects/restaurant-ai-g0/G0-COMPETITOR-VISIBLE.md</code>　＋　矩陣 §2 B</p></details>" +
          '<details class="unique-item"><summary>獨有候選 C　·　訂位→桌→點餐→結帳同一時間軸（定位）</summary>' +
            "<p>對手 POS 或訂位各自完整；本產品為 AI／分析自建一體時間軸。非宣稱對手無 POS。</p>" +
            "<p>來源：<code>/workspace/state/projects/restaurant-ai-g0/g0-01-competitor-matrix.md</code>　§2 C</p></details>" +
        "</div>" +
      "</section>";
  }

  function chipClass(key) {
    if (hasFeature(key)) return "chip on";
    return "chip locked";
  }

  function chipIcon(key) {
    return hasFeature(key) ? "開" : "鎖";
  }

  function renderSettings() {
    var org = findOrg(state.orgId);
    var plan = PLAN_DEFS[state.plan] || PLAN_DEFS.trial;
    var canChange = isManager();

    var chips = FEATURE_DEFS.map(function (f) {
      var on = hasFeature(f.key);
      var why = on ? "已開（目前方案）" : lockedWhy(f.key);
      return (
        '<button type="button" class="' + chipClass(f.key) + '" data-feature="' + f.key + '" ' +
          (on ? "" : 'aria-disabled="true" ') +
          'title="' + esc(why) + '">' +
          '<span class="chip-ico">' + chipIcon(f.key) + "</span>" +
          '<span class="chip-lab">' + esc(f.label) + "</span>" +
          '<span class="chip-why">' + esc(on ? "綠＝已開" : "鎖＝方案不足，點鎖看如何開") + "</span>" +
        "</button>"
      );
    }).join("");

    var planBtns = Object.keys(PLAN_DEFS).map(function (slug) {
      var p = PLAN_DEFS[slug];
      var active = state.plan === slug;
      return (
        '<button type="button" class="plan-opt' + (active ? " is-active" : "") + '"' +
          ' data-plan="' + slug + '"' +
          (canChange ? "" : " disabled") + ">" +
          esc(p.name) +
          (slug === "shop_high" ? '<span class="vip-chip" title="高端方案">VIP</span>' : "") +
          '<span class="plan-opt-price">' + esc(p.priceLabel) + "</span>" +
        "</button>"
      );
    }).join("");

    var subNote = org.subOrgs && org.subOrgs.length
      ? org.subOrgs.map(function (s) { return esc(s.name); }).join("、")
      : "無分店（帳單主體仍為本店）";

    var staffRows = (state.staff || []).map(function (s) {
      return (
        '<div class="staff-row">' +
          "<strong>" + esc(s.name) + "</strong>" +
          '<span class="badge ' + (s.role === "manager" ? "" : "plain") + '">' +
            (s.role === "manager" ? "店長" : "店員") +
          "</span>" +
        "</div>"
      );
    }).join("");

    var expiry = state.plan === "trial"
      ? ("試營運倒數約 " + (org.trialDaysLeft || 0) + " 天（假資料）")
      : "訂閱示意：下期續約日 mock　·　非正式帳單";

    var consentHelp = hasFeature("restaurant.analytics.cross_store")
      ? (meta.consentCrossStore
          ? "跨店資料授權已開：上方跨店列與「總部報告」匿名對標可顯示。"
          : "跨店資料授權關閉：跨店列與總部報告匿名對標不顯示數字。")
      : "目前方案無跨店分析。切到「高端」後可演示授權開關（總部報告／G4）。";

    document.getElementById("view").innerHTML =
      '<div class="settings-grid">' +
        '<section class="panel">' +
          '<div class="panel-h"><h2>店家資訊</h2><span class="help">多店切換示意</span></div>' +
          '<dl class="kv">' +
            "<div><dt>名稱</dt><dd>" + esc(org.name) + "</dd></div>" +
            "<div><dt>店家編號</dt><dd><span title=\"" + esc(org.orgId) + "\">" + esc(org.shortCode) + "</span></dd></div>" +
            "<div><dt>業態</dt><dd>餐飲</dd></div>" +
            "<div><dt>分店</dt><dd>" + subNote + "</dd></div>" +
          "</dl>" +
          '<div class="panel-h" style="margin-top:16px"><h2>身分示意</h2></div>' +
          '<div class="role-toggle">' +
            '<button type="button" class="btn' + (meta.role === "manager" ? " primary" : "") + '" data-role="manager">店長</button>' +
            '<button type="button" class="btn' + (meta.role === "staff" ? " primary" : "") + '" data-role="staff">店員</button>' +
            '<span class="help">店員不可變更方案／跨店資料授權</span>' +
          "</div>" +
          '<div class="staff-list">' +
            '<div class="help" style="margin:10px 0 6px">員工帳號（與訂位「客人」分開）</div>' +
            staffRows +
          "</div>" +
        "</section>" +

        '<section class="panel plan-card">' +
          '<div class="panel-h"><h2>目前方案（示意）· 非正式報價</h2>' +
            '<span class="help">產品側方案＋功能</span></div>' +
          (canChange ? "" : '<p class="staff-readonly-bar">唯讀·請店長變更方案與跨店資料授權</p>') +
          '<div class="plan-current">' +
            '<div class="plan-name">' + esc(plan.name) +
              (plan.slug === "shop_high" ? '<span class="vip-chip" title="高端方案">VIP</span>' : "") +
            "</div>" +
            '<div class="plan-price">' + esc(plan.priceLabel) + "</div>" +
            '<div class="help">' + esc(plan.l0Hint) + "　·　" + esc(expiry) + "</div>" +
            '<p class="mock-warn">Demo mock ≠ 正式授權／非正式報價</p>' +
          "</div>" +
          '<div class="panel-h" style="margin-top:14px"><h2>變更方案（mock）</h2>' +
            (canChange ? '<span class="help">店長可切</span>' : '<span class="help locked-note">店員唯讀</span>') +
          "</div>" +
          '<div class="plan-opts">' + planBtns + "</div>" +
          '<div class="panel-h" style="margin-top:16px"><h2>方案功能</h2>' +
            '<span class="help">綠＝已開／鎖＝方案不足，點鎖看如何開</span></div>' +
          '<div class="chips">' + chips + "</div>" +
          '<div class="panel-h" style="margin-top:16px"><h2>跨店資料授權</h2>' +
            '<span class="help">僅高端有意義（Consent）</span></div>' +
          '<label class="consent-row">' +
            '<input type="checkbox" id="consent-cross"' +
              (meta.consentCrossStore ? " checked" : "") +
              (canChange && hasFeature("restaurant.analytics.cross_store") ? "" : " disabled") + ">" +
            "<span>允許跨店匿名對比（示意）</span>" +
          "</label>" +
          '<p class="help">' + esc(consentHelp) + "</p>" +
        "</section>" +

        '<section class="panel late-policy-panel">' +
          '<div class="panel-h"><h2>遲到／No-show 寬限（N5）</h2>' +
            '<span class="line-fake-badge">mock · localStorage</span></div>' +
          '<p class="help">訂位留桌逾寬限 → 自動標「遲到／未到」並釋放桌，可對空桌發起補位（接 N1）。' +
            '<strong>不</strong>宣稱 AI 消滅 no-show；尖峰訂金仍是硬控（文案示意，本 mock 不強制訂金）。</p>' +
          '<div class="late-policy-fields">' +
            '<label>訂位寬限（分）' +
              '<input type="number" id="policy-grace-min" min="1" max="120" value="' +
              getPolicy().reservationGraceMin + '"' + (canChange ? "" : " disabled") + ">" +
            "</label>" +
            '<label>未到釋放（分·示意）' +
              '<input type="number" id="policy-noshow-min" min="1" max="120" value="' +
              getPolicy().noShowMin + '"' + (canChange ? "" : " disabled") + ">" +
            "</label>" +
            '<button type="button" class="btn primary" id="btn-save-late-policy"' +
              (canChange ? "" : " disabled") + ">儲存寬限</button>" +
          "</div>" +
          '<p class="help">補位邀請倒數仍為 N1 的 ' + INVITE_HOLD_MIN + " 分（分開設定）。目前寬限 " +
            getPolicy().reservationGraceMin + " 分已寫入本店 localStorage。</p>" +
          '<div class="late-policy-demo">' +
            '<button type="button" class="btn" id="btn-demo-late">示範遲到留桌</button>' +
            '<button type="button" class="btn" data-late-accelerate="">加速遲到</button>' +
          "</div>" +
          lateEventsHtml({ limit: 8 }) +
        "</section>" +

        '<section class="panel late-policy-panel n6-policy-panel">' +
          '<div class="panel-h"><h2>候位座位 ETA（N6）</h2>' +
            '<span class="line-fake-badge">與桌況同源 · 示意·非保證</span></div>' +
          '<p class="help">依空桌／待清／翻桌推算候位「位子還要多久」。≠ 廚房出餐 ETA。' +
            '改桌況後下一幀更新，無獨立假 timer。</p>' +
          '<div class="late-policy-fields">' +
            '<label>待清示意（分）' +
              '<input type="number" id="policy-clear-min" min="1" max="60" value="' +
              getPolicy().clearMin + '"' + (canChange ? "" : " disabled") + ">" +
            "</label>" +
            '<label>翻桌示意（分）' +
              '<input type="number" id="policy-turn-min" min="5" max="180" value="' +
              getPolicy().avgTurnMin + '"' + (canChange ? "" : " disabled") + ">" +
            "</label>" +
            '<button type="button" class="btn primary" id="btn-save-n6-policy"' +
              (canChange ? "" : " disabled") + ">儲存 ETA 參數</button>" +
          "</div>" +
          '<div class="late-policy-demo">' +
            '<button type="button" class="btn" id="btn-demo-clear-eta">示範：清一桌看 ETA 變</button>' +
          "</div>" +
        "</section>" +
      "</div>";
  }


  function seatWalkInOnFocus() {
    var t = state.tables.find(function (x) { return x.id === selectedTableId; });
    if (!t) return;
    var part = t.split && selectedPartId ? partById(t, selectedPartId) : null;
    var cap = part ? part.seats : tableCapacity(t);
    if (part && part.status === "dining") { toast("此半桌已有客人"); return; }
    if (!part && t.status === "dining") { toast("此桌已有客人"); return; }
    /* N5 訂位保留：到店確認入座 */
    if (t.status === "reserved" && t.reservePartyId) {
      confirmHeldReservation(t.reservePartyId);
      return;
    }
    /* 補位軟鎖桌：走原子確認（先確認者得） */
    if (t.holdId || t.status === "invited") {
      var hold = openHoldForTable(t.id) || holdById(t.holdId);
      var winner = null;
      if (hold) {
        winner = state.waitlist.find(function (p) {
          return p.status === "invited" && p.backfillId === hold.id && partySizeOf(p) <= cap;
        });
      }
      if (winner) {
        confirmBackfillParty(winner.id);
        return;
      }
    }
    var party = state.waitlist.find(function (p) {
      return (p.status === "invited" || p.status === "waiting") && partySizeOf(p) <= cap;
    });
    if (party) {
      if (party.backfillId) {
        confirmBackfillParty(party.id);
        return;
      }
      if (t.status === "dirty" && !t.split) t.status = "empty";
      if (part && part.status === "dirty") part.status = "empty";
      if (t.status === "invited") { t.status = "empty"; t.holdId = null; }
      seatParty(party, t, part ? part.id : null);
      return;
    }
    setTableStatus(t.id, "dining", { partId: part ? part.id : null });
  }

  function render() {
    if (SCREENS.indexOf(state.screen) === -1) {
      state.screen = "tables";
    }
    if (state) {
      var _bfExp = expireOpenBackfills();
      var _lateExp = expireLateReservations({ silent: true });
      if (_bfExp || _lateExp) saveOrgState();
    }
    renderHeaderChrome();
    renderAnalytics();
    renderCrossStore();
    renderTabs();
    renderNowDo();
    renderInsightTrail();
    renderHint();
    if (state.screen === "tables") renderTables();
    else if (state.screen === "wait") renderWait();
    else if (state.screen === "pos") renderPos();
    else if (state.screen === "hq") renderHqReport();
    else if (state.screen === "finance") renderFinance();
    else if (state.screen === "guest") renderGuest();
    else if (state.screen === "compete") renderCompete();
    else renderSettings();
    /* Layout C peak: full-height stage */
    var peak = PEAK_SCREENS.indexOf(state.screen) !== -1;
    var vs = document.querySelector(".view-scroll");
    var vw = document.getElementById("view");
    if (vs) vs.classList.toggle("layout-c-active", peak);
    if (vw) vw.classList.toggle("layout-c-active", peak);
  }

  function tickClock() {
    var now = new Date();
    var el = document.getElementById("clock");
    if (!el) return;
    el.textContent =
      now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) +
      "　" + pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function closeMenus() {
    overflowOpen = false;
    moreOpen = false;
  }

  function goScreen(screen) {
    if (SCREENS.indexOf(screen) === -1) return;
    state.screen = screen;
    moreOpen = false;
    overflowOpen = false;
    infoDrawerOpen = false;
    posMenuOpen = false;
    if (INSIGHT_SCREENS.indexOf(screen) !== -1) statsExpanded = false;
    saveOrgState();
    render();
  }

  document.addEventListener("click", function (e) {
    var toastUndo = e.target.closest("#toast-undo");
    if (toastUndo) { applyUndo(); return; }
    var toastGo = e.target.closest("#toast-go");
    if (toastGo) {
      var bfTid = toastGo.getAttribute("data-backfill-table");
      if (bfTid != null && bfTid !== "") {
        backfillTargetTableId = Number(bfTid);
        state.screen = "wait";
      }
      goScreen(toastGo.getAttribute("data-go-screen") || "wait");
      return;
    }

    /* overflow / more toggles */
    if (e.target.closest("#btn-overflow")) {
      overflowOpen = !overflowOpen;
      moreOpen = false;
      renderHeaderChrome();
      return;
    }
    if (e.target.closest("#btn-more")) {
      moreOpen = !moreOpen;
      overflowOpen = false;
      renderTabs();
      return;
    }
    if (e.target.closest("#btn-more-close") || e.target.id === "insight-backdrop") {
      moreOpen = false;
      renderTabs();
      return;
    }
    if (overflowOpen && !e.target.closest(".more-wrap")) {
      overflowOpen = false;
      renderHeaderChrome();
    }

    var insight = e.target.closest(".insight-link");
    if (insight) {
      goScreen(insight.getAttribute("data-screen"));
      return;
    }

    var tab = e.target.closest(".tab[data-screen]");
    if (tab) {
      goScreen(tab.getAttribute("data-screen"));
      return;
    }

    if (e.target.id === "btn-stats-toggle" || e.target.closest("#btn-stats-toggle")) {
      statsExpanded = !statsExpanded;
      renderAnalytics();
      return;
    }

    if (e.target.id === "btn-lc-drawer" || e.target.closest("#btn-lc-drawer")) {
      if (infoDrawerOpen || posMenuOpen) closeInfoDrawer();
      else openInfoDrawer();
      return;
    }
    if (e.target.id === "btn-lc-drawer-close" || e.target.closest("#lc-backdrop")) {
      closeInfoDrawer();
      return;
    }
    if (e.target.id === "btn-open-menu") {
      posMenuOpen = true;
      infoDrawerOpen = true;
      render();
      return;
    }
    if (e.target.id === "btn-chip-kitchen") {
      posMenuOpen = false;
      infoDrawerOpen = true;
      render();
      return;
    }
    if (e.target.id === "btn-clear-ticket") {
      state.ticket.lines = [];
      saveOrgState();
      render();
      toast("已清空此單");
      return;
    }
    if (e.target.id === "btn-focus-seat") {
      seatWalkInOnFocus();
      return;
    }
    if (e.target.id === "btn-focus-page") {
      var pt = state.tables.find(function (x) { return x.id === selectedTableId; });
      if (!pt || (pt.status !== "empty" && pt.status !== "dirty")) return;
      backfillTargetTableId = pt.id;
      infoDrawerOpen = true;
      goScreen("wait");
      toast("已指定 " + pt.name + " 為補位目標 · 勾選≥2組後發送（原子）");
      return;
    }
    if (e.target.id === "btn-focus-pay") {
      var py = state.tables.find(function (x) { return x.id === selectedTableId; });
      if (!py || py.status !== "dining") return;
      state.ticket.tableId = py.id;
      saveOrgState();
      goScreen("pos");
      toast(py.name + " → POS 結帳");
      return;
    }
    if (e.target.closest("[data-go-wait]")) {
      goScreen("wait");
      return;
    }
    if (e.target.id === "btn-focus-invite") {
      if (!waitFocusId) return;
      var sel = document.getElementById("bf-target-table");
      if (sel) backfillTargetTableId = Number(sel.value) || backfillTargetTableId;
      var picks = selectedBackfillPartyIds();
      if (hasFeature("restaurant.waitlist.multi_invite") && picks.length >= 2) {
        inviteSelected();
        return;
      }
      if (!backfillPickIds[waitFocusId] && picks.indexOf(waitFocusId) === -1) {
        backfillPickIds[waitFocusId] = true;
      }
      inviteOne(waitFocusId);
      return;
    }
    if (e.target.id === "btn-focus-confirm") {
      if (!waitFocusId) return;
      confirmParty(waitFocusId);
      return;
    }
    if (e.target.id === "btn-focus-cancel") {
      if (!waitFocusId) return;
      cancelParty(waitFocusId);
      return;
    }
    if (e.target.id === "btn-chip-add-wait") {
      infoDrawerOpen = true;
      render();
      setTimeout(function () {
        var el = document.getElementById("new-name");
        if (el) el.focus();
      }, 50);
      return;
    }


    if (e.target.id === "btn-reset") {
      if (!window.confirm("將還原「目前店家」示範資料，另一間店不受影響。確定重設？")) return;
      var keepScreen = state.screen;
      state = seedForOrg(meta.currentOrgId);
      state.screen = keepScreen;
      selectedTableId = null;
      selectedPartId = null;
      pendingAssign = null;
      waitFocusId = null;
      backfillTargetTableId = null;
      backfillPickIds = {};
      aiDismissed = {};
      infoDrawerOpen = false;
      posMenuOpen = false;
      saveOrgState();
      closeMenus();
      render();
      toast("已還原「" + state.shop + "」種子資料");
      return;
    }

    var themeBtn = e.target.closest("[data-theme]");
    if (themeBtn) {
      setTheme(themeBtn.getAttribute("data-theme"));
      return;
    }
    var chromeBtn = e.target.closest("[data-chrome]");
    if (chromeBtn) {
      setChromeOn(chromeBtn.getAttribute("data-chrome") === "on");
      return;
    }
    if (e.target.id === "btn-offline") {
      setOffline(!simOffline);
      return;
    }
    if (e.target.id === "btn-retry-online") {
      setOffline(false);
      return;
    }

    var selTable = e.target.closest("[data-select-table]");
    if (selTable) {
      var tid = Number(selTable.getAttribute("data-select-table"));
      if (selectedTableId === tid) {
        /* second click within detail uses status keys; here re-select only */
      }
      selectTable(tid);
      return;
    }
    var setSt = e.target.closest("[data-set-status]");
    if (setSt) {
      setTableStatus(Number(setSt.getAttribute("data-table")), setSt.getAttribute("data-set-status"));
      return;
    }
    var cycle = e.target.closest("[data-cycle]");
    if (cycle) { cycleTable(Number(cycle.getAttribute("data-cycle"))); return; }

    var waitFocus = e.target.closest("[data-wait-focus]");
    if (waitFocus && !e.target.closest("input") && !e.target.closest("[data-invite-one]") &&
        !e.target.closest("[data-confirm]") && !e.target.closest("[data-cancel]")) {
      /* edge-chip buttons + list rows */
      if (e.target.closest("button.btn") && !waitFocus.classList.contains("edge-chip") &&
          !waitFocus.classList.contains("invite-card") && waitFocus.tagName !== "BUTTON") {
        /* ignore nested action buttons inside row */
      } else {
        waitFocusId = Number(waitFocus.getAttribute("data-wait-focus"));
        render();
        return;
      }
    }

    if (e.target.id === "btn-invite" || e.target.closest("#btn-invite")) {
      var selInv = document.getElementById("bf-target-table");
      if (selInv) backfillTargetTableId = Number(selInv.value) || backfillTargetTableId;
      inviteSelected();
      return;
    }
    if (e.target.id === "btn-bf-accelerate") {
      accelerateBackfillExpire(e.target.getAttribute("data-hold"));
      return;
    }
    if (e.target.id === "bf-target-table" || (e.target.closest && e.target.closest("#bf-target-table"))) {
      return; /* change 事件另處理 */
    }
    var one = e.target.closest("[data-invite-one]");
    if (one) {
      inviteOne(Number(one.getAttribute("data-invite-one")));
      return;
    }
    var conf = e.target.closest("[data-confirm]");
    if (conf) { confirmParty(Number(conf.getAttribute("data-confirm"))); return; }
    var can = e.target.closest("[data-cancel]");
    if (can) { cancelParty(Number(can.getAttribute("data-cancel"))); return; }
    if (e.target.id === "btn-add-wait" || e.target.id === "btn-focus-add") {
      if (e.target.id === "btn-focus-add") {
        var form = document.getElementById("add-wait-form");
        var nameEl = document.getElementById("new-name");
        if (form) form.classList.add("is-empty-focus");
        if (nameEl) nameEl.focus();
        return;
      }
      addWaiter();
      return;
    }
    var soldBtn = e.target.closest("[data-86]");
    if (soldBtn) {
      toggleSoldOut(soldBtn.getAttribute("data-86"));
      return;
    }
    var dish = e.target.closest("[data-dish]");
    if (dish) { addDish(dish.getAttribute("data-dish")); return; }
    var qty = e.target.closest("[data-qty]");
    if (qty) { changeQty(qty.getAttribute("data-qty"), Number(qty.getAttribute("data-delta"))); return; }
    /* Layout C drawers / focus CTAs */
    if (e.target.id === "btn-lc-drawer" || e.target.closest("#btn-lc-drawer")) {
      if (infoDrawerOpen || posMenuOpen) closeInfoDrawer();
      else openInfoDrawer();
      return;
    }
    if (e.target.id === "btn-lc-drawer-close" || e.target.id === "lc-backdrop") {
      closeInfoDrawer();
      render();
      return;
    }
    if (e.target.id === "btn-open-menu") {
      posMenuOpen = true;
      infoDrawerOpen = true;
      render();
      return;
    }
    var selPart = e.target.closest("[data-select-part]");
    if (selPart) {
      selectedTableId = Number(selPart.getAttribute("data-table"));
      selectedPartId = selPart.getAttribute("data-select-part");
      render();
      return;
    }
    var splitBtn = e.target.closest("[data-split-table]");
    if (splitBtn) { splitTable(Number(splitBtn.getAttribute("data-split-table"))); return; }
    var mergeBtn = e.target.closest("[data-merge-table]");
    if (mergeBtn) { unsplitTable(Number(mergeBtn.getAttribute("data-merge-table"))); return; }
    var joinBtn = e.target.closest("[data-join-table]");
    if (joinBtn) { joinNeighborTables(Number(joinBtn.getAttribute("data-join-table"))); return; }
    var unjoinBtn = e.target.closest("[data-unjoin-table]");
    if (unjoinBtn) { unjoinTable(Number(unjoinBtn.getAttribute("data-unjoin-table"))); return; }
    if (e.target.id === "btn-ai-seat-assign") { runAiSeatAssign(); return; }
    if (e.target.id === "btn-ai-seat-clear") { pendingAssign = null; render(); toast("已清除模擬建議（未改桌況）"); return; }
    var seatOk = e.target.closest("[data-seat-confirm]");
    if (seatOk) { applySeatSuggestion(seatOk.getAttribute("data-seat-confirm")); return; }
    var seatNo = e.target.closest("[data-seat-dismiss]");
    if (seatNo) { dismissSeatSuggestion(seatNo.getAttribute("data-seat-dismiss")); return; }

    if (e.target.id === "btn-send-kitchen") { sendTicketToKitchen(); return; }
    if (e.target.id === "btn-checkout") { checkout(); return; }

    var rushConf = e.target.closest("[data-rush-confirm]");
    if (rushConf) {
      _trailSurface = rushConf.hasAttribute("data-nowdo-trail") ? "nowdo" : null;
      confirmRush(rushConf.getAttribute("data-rush-confirm"));
      _trailSurface = null;
      return;
    }
    var rushSkip = e.target.closest("[data-rush-skip]");
    if (rushSkip) {
      _trailSurface = rushSkip.hasAttribute("data-nowdo-trail") ? "nowdo" : null;
      skipRush(rushSkip.getAttribute("data-rush-skip"));
      _trailSurface = null;
      return;
    }

    var lateConf = e.target.closest("[data-late-confirm]");
    if (lateConf) {
      var latePid = Number(lateConf.getAttribute("data-late-confirm"));
      var lateSugId = lateConf.getAttribute("data-ai-confirm") || ("late-" + latePid);
      var fromNowDo = lateConf.hasAttribute("data-nowdo-trail");
      var pLate = state.waitlist.find(function (x) { return x.id === latePid; });
      recordSuggestionDecision({
        suggestionId: lateSugId,
        kind: fromNowDo ? "nowdo" : "late",
        target: pLate ? (pLate.name + (pLate.reserveTableId ? ("@" + pLate.reserveTableId) : "")) : String(latePid),
        decision: "accept",
        reason: "確認釋放遲到／未到訂位（寫軌跡後執行規則釋放）"
      });
      aiDismissed[lateSugId] = true;
      if (pLate && pLate.status === "held") {
        pLate.reserveUntil = Date.now() - 1;
        var tL = state.tables.find(function (x) { return x.id === pLate.reserveTableId; });
        if (tL) tL.holdUntil = pLate.reserveUntil;
      }
      expireLateReservations();
      saveOrgState();
      render();
      return;
    }
    var lateSkip = e.target.closest("[data-late-skip]");
    if (lateSkip) {
      var skipPid = Number(lateSkip.getAttribute("data-late-skip"));
      var skipSug = lateSkip.getAttribute("data-ai-dismiss") || ("late-" + skipPid);
      var fromNowDoS = lateSkip.hasAttribute("data-nowdo-trail");
      var pSkip = state.waitlist.find(function (x) { return x.id === skipPid; });
      recordSuggestionDecision({
        suggestionId: skipSug,
        kind: fromNowDoS ? "nowdo" : "late",
        target: pSkip ? pSkip.name : String(skipPid),
        decision: "skip",
        reason: "略過遲到釋放建議（規則仍可能在寬限到期後自動釋放）"
      });
      aiDismissed[skipSug] = true;
      saveOrgState();
      render();
      toast("已略過釋放建議（建議紀錄已寫）· 寬限到期仍會自動釋放");
      return;
    }
    var lateAcc = e.target.closest("[data-late-accelerate]");
    if (lateAcc) {
      var accId = lateAcc.getAttribute("data-late-accelerate");
      accelerateLate(accId ? Number(accId) : null);
      return;
    }
    var startBf = e.target.closest("[data-start-backfill]");
    if (startBf) {
      var tidBf = Number(startBf.getAttribute("data-start-backfill"));
      if (tidBf) backfillTargetTableId = tidBf;
      goScreen("wait");
      toast("已帶入空桌目標 · 勾選候位組後可原子補位（N1）");
      return;
    }
    var holdRes = e.target.closest("[data-hold-reserve]");
    if (holdRes) {
      var pidH = Number(holdRes.getAttribute("data-hold-reserve"));
      var selH = document.getElementById("reserve-hold-table");
      var tidH = selH ? Number(selH.value) : null;
      if (!tidH) { toast("請選留桌"); return; }
      holdReservationOnTable(pidH, tidH);
      return;
    }
    if (e.target.id === "btn-demo-late") {
      demoSeedLateHold();
      return;
    }
    if (e.target.id === "btn-demo-clear-eta") {
      demoClearOneForEta();
      return;
    }
    if (e.target.id === "btn-save-late-policy") {
      if (!isManager()) { toast("僅店長可改寬限"); return; }
      var gEl = document.getElementById("policy-grace-min");
      var nEl = document.getElementById("policy-noshow-min");
      setPolicyField("reservationGraceMin", gEl && gEl.value);
      setPolicyField("noShowMin", nEl && nEl.value);
      render();
      toast("已儲存遲到寬限 " + getPolicy().reservationGraceMin + " 分（本店 localStorage）");
      return;
    }
    if (e.target.id === "btn-save-n6-policy") {
      if (!isManager()) { toast("僅店長可改 ETA 參數"); return; }
      var cEl = document.getElementById("policy-clear-min");
      var tEl = document.getElementById("policy-turn-min");
      setPolicyField("clearMin", cEl && cEl.value);
      setPolicyField("avgTurnMin", tEl && tEl.value);
      render();
      toast("已儲存座位 ETA 參數（清 " + getPolicy().clearMin + "／翻 " + getPolicy().avgTurnMin + " 分）");
      return;
    }

    var aiConfirm = e.target.closest("[data-ai-confirm]");
    if (aiConfirm) {
      /* 催菜／遲到鈕同時帶 confirm attr，已由上方處理並寫軌跡 */
      if (aiConfirm.hasAttribute("data-rush-confirm")) return;
      if (aiConfirm.hasAttribute("data-late-confirm")) return;
      var cid = aiConfirm.getAttribute("data-ai-confirm");
      var kind = cid && cid.indexOf("mix-") === 0 ? "mix" : (cid && cid.indexOf("late-") === 0 ? "late" : "nudge");
      aiDismissed[cid] = true;
      recordSuggestionDecision({
        suggestionId: cid,
        kind: kind,
        target: aiConfirm.closest("[data-ai-target]")
          ? (aiConfirm.closest("[data-ai-target]").getAttribute("data-ai-target") || "")
          : "",
        decision: "accept",
        reason: kind === "mix"
          ? "確認採納混單建議（示意·未自動改單）"
          : "確認採納節奏建議（示意·未自動改單）"
      });
      saveOrgState();
      render();
      toast("已確認採納 AI 建議（建議紀錄已寫）· 未自動改單，請店員執行");
      return;
    }
    var aiDismiss = e.target.closest("[data-ai-dismiss]");
    if (aiDismiss) {
      if (aiDismiss.hasAttribute("data-rush-skip")) return;
      if (aiDismiss.hasAttribute("data-late-skip")) return;
      var didAi = aiDismiss.getAttribute("data-ai-dismiss");
      var kindSkip = didAi && didAi.indexOf("mix-") === 0 ? "mix" : (didAi && didAi.indexOf("late-") === 0 ? "late" : "nudge");
      aiDismissed[didAi] = true;
      recordSuggestionDecision({
        suggestionId: didAi,
        kind: kindSkip,
        target: "",
        decision: "skip",
        reason: kindSkip === "mix" ? "略過混單建議" : "略過節奏建議"
      });
      pushOrderEvent(
        state.ticket && state.ticket.tableId ? Number(state.ticket.tableId) : null,
        "",
        "ai_skip",
        "略過 AI 建議 · " + didAi,
        { source: "pos" }
      );
      saveOrgState();
      render();
      toast("已略過此建議（建議紀錄已寫）");
      return;
    }

    var tchip = e.target.closest("[data-ticket-table]");
    if (tchip) {
      state.ticket.tableId = Number(tchip.getAttribute("data-ticket-table"));
      saveOrgState();
      render();
      return;
    }

    var kqAck = e.target.closest("[data-kq-ack]");
    if (kqAck) {
      var aid = kqAck.getAttribute("data-kq-ack");
      (state.kitchenQueue || []).forEach(function (o) {
        if (o.id === aid) {
          o.status = "ack";
          o.prep_started_at = Date.now();
        }
      });
      saveOrgState();
      render();
      toast("廚房已收 · 製作開始（事件）");
      return;
    }
    var kqDone = e.target.closest("[data-kq-done]");
    if (kqDone) {
      var did = kqDone.getAttribute("data-kq-done");
      (state.kitchenQueue || []).forEach(function (o) {
        if (o.id === did) {
          o.status = "done";
          o.ready_at = Date.now();
          o.served_at = Date.now();
        }
      });
      saveOrgState();
      render();
      toast("出餐／送達已記（事件示意）");
      return;
    }


    var hqPeriodBtn = e.target.closest("[data-hq-period]");
    if (hqPeriodBtn) {
      var p = hqPeriodBtn.getAttribute("data-hq-period");
      hqPeriod = p === "week" ? "week" : "day";
      render();
      toast(hqPeriod === "week" ? "已切到「週」示意" : "已切到「日」示意");
      return;
    }
    var hqExport = e.target.closest("[data-hq-export]");
    if (hqExport) {
      var kind = hqExport.getAttribute("data-hq-export");
      toast("匯出 " + (kind === "pdf" ? "PDF" : "CSV") + " 示意·非正式／待 Owner（無真實檔案）");
      return;
    }
    var hqGoto = e.target.closest("[data-hq-goto]");
    if (hqGoto) {
      goScreen(hqGoto.getAttribute("data-hq-goto"));
      return;
    }

    var planBtn = e.target.closest("[data-plan]");
    if (planBtn) {
      changePlan(planBtn.getAttribute("data-plan"));
      return;
    }
    var roleBtn = e.target.closest("[data-role]");
    if (roleBtn) {
      setRole(roleBtn.getAttribute("data-role"));
      return;
    }
    var feat = e.target.closest("[data-feature]");
    if (feat) {
      var key = feat.getAttribute("data-feature");
      if (hasFeature(key)) {
        toast("「" + featureLabel(key) + "」已開啟（目前方案）");
      } else {
        if (!isManager()) {
          toast("店員無法升級方案。請店長在設定操作（示意守門）。");
        } else {
          var slug = unlockSlug(key);
          if (slug) toast("目前方案不含「" + featureLabel(key) + "」。升級「" + unlockPlanName(key) + "」後可開。", { action: "看升級示意", screen: "settings" });
          else toast("目前方案不含「" + featureLabel(key) + "」。");
        }
      }
      return;
    }
  });

  document.addEventListener("dblclick", function (e) {
    var card = e.target.closest("[data-select-table]");
    if (card) {
      cycleTable(Number(card.getAttribute("data-select-table")));
    }
  });

  document.addEventListener("change", function (e) {
    if (!e.target) return;
    if (e.target.id === "org-select") {
      switchOrg(e.target.value);
      return;
    }
    if (e.target.id === "ticket-table") {
      state.ticket.tableId = Number(e.target.value);
      saveOrgState();
      return;
    }
    if (e.target.name === "pay") {
      state.ticket.pay = e.target.value;
      saveOrgState();
      return;
    }
    if (e.target.id === "consent-cross") {
      setConsent(!!e.target.checked);
      return;
    }
    if (e.target.classList && e.target.classList.contains("wait-check")) {
      var id = Number(e.target.value);
      if (e.target.checked) backfillPickIds[id] = true;
      else delete backfillPickIds[id];
      if (state && state.screen === "wait") {
        var hint = document.querySelector(".bf-pick-hint");
        var picks = selectedBackfillPartyIds();
        if (hint) {
          hint.textContent = picks.length
            ? ("已勾選 " + picks.length + " 組：" + picks.map(function (pid) {
                var x = state.waitlist.find(function (p) { return p.id === pid; });
                return x ? x.name : pid;
              }).join("、"))
            : "";
        }
        var invBtn = document.getElementById("btn-focus-invite");
        if (invBtn && hasFeature("restaurant.waitlist.multi_invite") && !invBtn.disabled) {
          invBtn.textContent = picks.length >= 2
            ? ("同時補位 " + picks.length + " 組")
            : "發送補位";
        }
      }
      return;
    }
    if (e.target.id === "bf-target-table") {
      backfillTargetTableId = Number(e.target.value) || null;
      return;
    }
  });

  /* Guest tableside → kitchen queue sync via shared localStorage */
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf(ORG_PREFIX) !== 0) return;
    if (e.key !== orgKey(meta.currentOrgId)) return;
    try {
      var next = JSON.parse(e.newValue || "null");
      if (!next || next.orgId !== state.orgId) return;
      var keepScreen = state.screen;
      state = next;
      if (!Array.isArray(state.kitchenQueue)) state.kitchenQueue = [];
      state.screen = keepScreen;
      render();
      if (state.screen === "pos" || state.screen === "tables") toast("訂單脊柱已同步（桌邊／86）");
    } catch (err) {}
  });

  /* soft poll — tableside／86 寫入同 org localStorage（同頁不觸發 storage） */
  setInterval(function () {
    if (!state) return;
    if (state.screen !== "pos" && state.screen !== "tables") return;
    try {
      var raw = localStorage.getItem(orgKey(state.orgId));
      if (!raw) return;
      var next = JSON.parse(raw);
      if (!next) return;
      var changed = false;
      if (Array.isArray(next.kitchenQueue)) {
        var a = JSON.stringify(state.kitchenQueue || []);
        var b = JSON.stringify(next.kitchenQueue);
        if (a !== b) { state.kitchenQueue = next.kitchenQueue; changed = true; }
      }
      if (next.soldOut && JSON.stringify(state.soldOut || {}) !== JSON.stringify(next.soldOut)) {
        state.soldOut = next.soldOut;
        changed = true;
      }
      if (Array.isArray(next.orderEvents) &&
          JSON.stringify(state.orderEvents || []) !== JSON.stringify(next.orderEvents)) {
        state.orderEvents = next.orderEvents;
        changed = true;
      }
      if (Array.isArray(next.suggestionTrail) &&
          JSON.stringify(state.suggestionTrail || []) !== JSON.stringify(next.suggestionTrail)) {
        state.suggestionTrail = next.suggestionTrail;
        changed = true;
      }
      if (!changed) return;
      render();
      if (state.screen === "pos") toast("訂單脊柱已同步（桌邊／86）");
    } catch (err) {}
  }, 2000);

  /* boot chrome default OV-P0-05 */
  (function bootChrome() {
    var on = getChromeOn();
    document.body.classList.toggle("chrome-off", !on);
    document.documentElement.classList.toggle("chrome-off-boot", !on);
  })();

  /* N1：補位過期釋放 + N5 遲到釋放 + 倒數 chip */
  setInterval(function () {
    if (!state) return;
    if (expireOpenBackfills()) {
      saveOrgState();
      if (state.screen === "wait" || state.screen === "tables") render();
      return;
    }
    if (expireLateReservations()) {
      saveOrgState();
      if (state.screen === "wait" || state.screen === "tables" || state.screen === "pos") render();
      return;
    }
    document.querySelectorAll("[data-countdown-until]").forEach(function (el) {
      var until = Number(el.getAttribute("data-countdown-until"));
      if (!until) return;
      var d = new Date(until);
      el.textContent =
        "倒數 " + formatCountdown(until) + " · 留桌至 " + hm(d) +
        "（" + INVITE_HOLD_MIN + " 分 mock）";
    });
    var sub = document.querySelector(".bf-timeline-sub");
    if (sub && state.backfillRounds && state.backfillRounds[0] && state.backfillRounds[0].status === "open") {
      var h0 = state.backfillRounds[0];
      sub.textContent =
        "進行中 · " + (h0.tableLabel || "") + " · 倒數 " + formatCountdown(h0.until);
    }
  }, 1000);

  /* live dining + kitchen wait timers — update mm:ss without full re-render */
  setInterval(function () {
    if (!state) return;
    if (state.screen === "tables") {
      var cards = document.querySelectorAll("[data-select-table]");
      cards.forEach(function (card) {
        var id = Number(card.getAttribute("data-select-table"));
        var t = state.tables.find(function (x) { return x.id === id; });
        if (!t) return;
        if (t.status === "dining") {
          var timer = card.querySelector(".t-timer");
          if (timer) timer.textContent = formatElapsed(t);
          var stEl = card.querySelector(".st");
          if (stEl) {
            var over = overdueClass(t);
            stEl.textContent = formatElapsed(t) + (over ? "!" : "");
          }
        }
        card.classList.toggle("is-warn", overdueClass(t).indexOf("is-warn") !== -1);
        card.classList.toggle("is-crit", overdueClass(t).indexOf("is-crit") !== -1);
      });
      var focusEl = document.getElementById("focus-elapsed");
      if (focusEl && selectedTableId) {
        var sel = state.tables.find(function (x) { return x.id === selectedTableId; });
        if (sel && (sel.status === "dining" || sel.status === "dirty")) {
          focusEl.textContent = formatElapsed(sel);
        }
      }
    }
    if (state.screen === "pos" || state.screen === "tables" || state.screen === "wait") {
      /* refresh now-do when kitchen overdue flips */
      renderNowDo();
    }
    if (state.screen === "pos") {
      document.querySelectorAll("[data-kq-wait]").forEach(function (el) {
        var at = Number(el.getAttribute("data-kq-wait"));
        if (!at) return;
        el.textContent = "已等待 " + formatWaitMmSs(at);
      });
      var ageFp = "";
      document.querySelectorAll(".kq-card[data-kq-id]").forEach(function (card) {
        var kid = card.getAttribute("data-kq-id");
        var o = (state.kitchenQueue || []).find(function (x) { return x.id === kid; });
        if (!o) return;
        var lv = ticketAgeLevel(o);
        ageFp += kid + ":" + lv + ";";
        card.classList.toggle("is-ok", lv === "ok");
        card.classList.toggle("is-warn", lv === "warn");
        card.classList.toggle("is-crit", lv === "crit");
        if (lv) card.setAttribute("data-kq-age", lv);
        if (o.status !== "done" && !o.checkClosed) {
          var eta = liveEtaForOrder(o);
          var rem = card.querySelector("[data-kq-rem-prep='" + kid + "']");
          if (rem) rem.textContent = String(eta.remainingPrep);
          var dep = card.querySelector("[data-kq-depth='" + kid + "']");
          if (dep) dep.textContent = String(eta.queueDepth);
          var pill = card.querySelector("[data-kq-age-pill='" + kid + "']");
          if (pill) {
            pill.className = "age-pill age-" + lv;
            pill.textContent = "票齡 " + Math.floor(eta.ageMin) + " 分 · " + agePillLabel(lv);
          }
        }
      });
      document.querySelectorAll("[data-foh-eta-order]").forEach(function (box) {
        var oid = box.getAttribute("data-foh-eta-order");
        var o = (state.kitchenQueue || []).find(function (x) { return x.id === oid; });
        if (!o || o.status === "done") return;
        var eta = liveEtaForOrder(o);
        var lv = eta.ageLevel || "ok";
        box.className = "foh-live-eta is-" + lv;
        var a = box.querySelector("[data-foh-age]");
        if (a) a.textContent = String(Math.floor(eta.ageMin));
        var d = box.querySelector("[data-foh-depth]");
        if (d) d.textContent = String(eta.queueDepth);
        var rp = box.querySelector("[data-foh-rem-prep]");
        if (rp) rp.textContent = String(eta.remainingPrep);
        var rs = box.querySelector("[data-foh-rem-serve]");
        if (rs) rs.textContent = String(eta.remainingServe);
        var pill = box.querySelector(".age-pill");
        if (pill) {
          pill.className = "age-pill age-" + lv;
          pill.textContent = agePillLabel(lv);
        }
      });
      if (window.__kqAgeFp && window.__kqAgeFp !== ageFp) {
        /* 票齡色帶跨門檻 → 重繪催菜鈕／建議條 */
        window.__kqAgeFp = ageFp;
        render();
        return;
      }
      window.__kqAgeFp = ageFp;
    }
  }, 1000);

  tickClock();
  setInterval(tickClock, 30000);
  render();

  if (typeof window.fitDeskStage === "function") window.fitDeskStage();

  window.__demoPreview = {
    mockApiGet: mockApiGet,
    getTheme: getTheme,
    getChromeOn: getChromeOn,
    fitDeskStage: window.fitDeskStage,
    getState: function () { return state; },
    getMeta: function () { return meta; },
    render: render,
    goScreen: goScreen,
    mockSeatAssign: mockSeatAssign,
    runAiSeatAssign: runAiSeatAssign,
    ticketAgeLevel: ticketAgeLevel,
    liveEtaForOrder: liveEtaForOrder,
    confirmRush: confirmRush,
    skipRush: skipRush,
    computeSeatWaitEta: computeSeatWaitEta,
    refreshWaitEtas: refreshWaitEtas,
    demoClearOneForEta: demoClearOneForEta
  };
})();
