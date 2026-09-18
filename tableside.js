(function () {
  "use strict";

  var META_KEY = "restaurant-ai-demo-preview-v2-meta";
  var ORG_PREFIX = "restaurant-ai-demo-preview-v2-org-";
  var DRAFT_KEY = "restaurant-ai-demo-preview-v2-tableside-draft";

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

  var DEFAULT_TABLES = [
    { id: 1, name: "T1" }, { id: 2, name: "T2" }, { id: 3, name: "T3" },
    { id: 4, name: "T4" }, { id: 5, name: "T5" }, { id: 6, name: "T6" },
    { id: 7, name: "T7" }, { id: 8, name: "T8" }
  ];

  function parseTableParam() {
    try {
      var q = new URLSearchParams(window.location.search || "");
      var raw = (q.get("table") || q.get("t") || "").trim();
      return raw || null;
    } catch (e) {
      return null;
    }
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hm(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function formatWaitMmSs(at) {
    var totalSec = Math.max(0, Math.floor((Date.now() - Number(at || Date.now())) / 1000));
    return pad2(Math.floor(totalSec / 60)) + ":" + pad2(totalSec % 60);
  }
  function linesEta(lines) {
    var prep = 0, serve = 0;
    (lines || []).forEach(function (l) {
      var p = l.prepMinutes != null ? l.prepMinutes : 8;
      var s = l.serveMinutes != null ? l.serveMinutes : 3;
      if (p > prep) prep = p;
      if (s > serve) serve = s;
    });
    return { prep: prep || 8, serve: serve || 3 };
  }

  /* N3：與櫃台同源票齡＋佇列深度（非靜態行銷分鐘） */
  var TICKET_AGE_WARN_MIN = 8;
  var TICKET_AGE_CRIT_MIN = 15;
  var QUEUE_DEPTH_PENALTY_MIN = 2;

  function findOpenOrderInOrg(data) {
    if (!data || !data.kitchenQueue) return null;
    if (session.lastSentId) {
      var byId = data.kitchenQueue.find(function (o) {
        return o.id === session.lastSentId && o.status !== "done" && !o.checkClosed;
      });
      if (byId) return byId;
    }
    return data.kitchenQueue.find(function (o) {
      return Number(o.tableId) === Number(session.tableId) &&
        o.status !== "done" && !o.checkClosed;
    }) || null;
  }

  function liveEtaFromOrder(order, data) {
    if (!order) return null;
    var prep = order.prepMinutes != null ? order.prepMinutes : 8;
    var serve = order.serveMinutes != null ? order.serveMinutes : 3;
    var sentAt = order.sent_at || order.at || session.lastSentAt;
    var ageMin = sentAt ? (Date.now() - Number(sentAt)) / 60000 : 0;
    var open = (data.kitchenQueue || []).filter(function (o) {
      return o && o.status !== "done" && !o.checkClosed;
    }).slice().sort(function (a, b) {
      return Number(a.sent_at || a.at || 0) - Number(b.sent_at || b.at || 0);
    });
    var depth = 0;
    for (var i = 0; i < open.length; i++) {
      if (open[i].id === order.id) break;
      depth += 1;
    }
    var remPrep = Math.max(0, Math.ceil(prep - ageMin)) + depth * QUEUE_DEPTH_PENALTY_MIN;
    var lv = ageMin >= TICKET_AGE_CRIT_MIN ? "crit" :
      ageMin >= TICKET_AGE_WARN_MIN ? "warn" : "ok";
    return {
      ageMin: ageMin,
      ageLevel: lv,
      queueDepth: depth,
      remainingPrep: remPrep,
      remainingServe: serve,
      prepBase: prep,
      serveBase: serve,
      sentAt: sentAt
    };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return { currentOrgId: "org-demo-a" };
      var m = JSON.parse(raw);
      return m && m.currentOrgId ? m : { currentOrgId: "org-demo-a" };
    } catch (e) {
      return { currentOrgId: "org-demo-a" };
    }
  }

  function orgKey(orgId) { return ORG_PREFIX + orgId; }

  function loadOrg(orgId) {
    try {
      var raw = localStorage.getItem(orgKey(orgId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveOrg(orgId, data) {
    try {
      localStorage.setItem(orgKey(orgId), JSON.stringify(data));
    } catch (e) {}
  }

  function ensureKitchen(data) {
    if (!data.kitchenQueue) data.kitchenQueue = [];
    if (!data.soldOut || typeof data.soldOut !== "object") data.soldOut = {};
    if (!Array.isArray(data.orderEvents)) data.orderEvents = [];
    return data;
  }

  function readSoldOut() {
    var data = loadOrg(session.orgId);
    if (!data || !data.soldOut) return {};
    return data.soldOut;
  }

  function isSoldOut(id) {
    return !!readSoldOut()[id];
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        orgId: session.orgId,
        tableId: session.tableId,
        tableName: session.tableName,
        lines: session.lines,
        locked: session.locked,
        lastSentId: session.lastSentId,
        lastSentAt: session.lastSentAt,
        lastPrepMinutes: session.lastPrepMinutes,
        lastServeMinutes: session.lastServeMinutes,
        fromQr: session.fromQr
      }));
    } catch (e) {}
  }

  var meta = loadMeta();
  var orgData = loadOrg(meta.currentOrgId);
  var tables = (orgData && orgData.tables && orgData.tables.length)
    ? orgData.tables.map(function (t) { return { id: t.id, name: t.name }; })
    : DEFAULT_TABLES.slice();

  var draft = loadDraft();
  var urlTableName = parseTableParam();
  var fromQr = !!urlTableName;
  var prefer = null;
  if (urlTableName) {
    prefer = tables.find(function (t) {
      return String(t.name).toUpperCase() === String(urlTableName).toUpperCase();
    });
    if (!prefer) {
      /* Preview: unknown code still binds label so demo works */
      prefer = { id: -1, name: String(urlTableName).toUpperCase() };
    }
  }
  if (!prefer) prefer = tables.find(function (t) { return t.name === "T3"; }) || tables[0];

  var session = {
    orgId: meta.currentOrgId,
    shop: (orgData && orgData.shop) || "示範食堂",
    tableId: prefer.id,
    tableName: prefer.name,
    lines: [],
    locked: false,
    lastSentId: null,
    lastSentAt: null,
    lastPrepMinutes: null,
    lastServeMinutes: null,
    fromQr: fromQr,
    urlTable: urlTableName
  };

  if (draft && draft.orgId === session.orgId) {
    /* QR URL wins over draft table — simulates scan binding */
    if (fromQr) {
      if (draft.tableName === session.tableName && Array.isArray(draft.lines)) {
        session.lines = draft.lines;
        session.locked = !!draft.locked;
        session.lastSentId = draft.lastSentId || null;
        session.lastSentAt = draft.lastSentAt || null;
        session.lastPrepMinutes = draft.lastPrepMinutes != null ? draft.lastPrepMinutes : null;
        session.lastServeMinutes = draft.lastServeMinutes != null ? draft.lastServeMinutes : null;
      }
    } else {
      var match = tables.find(function (t) { return t.id === draft.tableId; });
      if (match) {
        session.tableId = match.id;
        session.tableName = match.name;
      }
      if (Array.isArray(draft.lines)) session.lines = draft.lines;
      session.locked = !!draft.locked;
      session.lastSentId = draft.lastSentId || null;
      session.lastSentAt = draft.lastSentAt || null;
      session.lastPrepMinutes = draft.lastPrepMinutes != null ? draft.lastPrepMinutes : null;
      session.lastServeMinutes = draft.lastServeMinutes != null ? draft.lastServeMinutes : null;
    }
  }

  function findDish(id) {
    var found = null;
    MENU.forEach(function (c) {
      c.items.forEach(function (it) { if (it.id === id) found = it; });
    });
    return found;
  }

  function cartTotal() {
    return session.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  }

  function addDish(id) {
    if (session.locked) {
      toast("已送廚，改單請找店員");
      return;
    }
    var d = findDish(id);
    if (!d) return;
    if (isSoldOut(id)) {
      toast(d.name + " 已售完（86）");
      return;
    }
    var line = session.lines.find(function (l) { return l.id === id; });
    if (line) line.qty += 1;
    else session.lines.push({
      id: d.id, name: d.name, price: d.price, qty: 1,
      prepMinutes: d.prepMinutes != null ? d.prepMinutes : 8,
      serveMinutes: d.serveMinutes != null ? d.serveMinutes : 3
    });
    saveDraft();
    render();
  }

  function changeQty(id, delta) {
    if (session.locked) {
      toast("已送廚，改單請找店員");
      return;
    }
    var line = session.lines.find(function (l) { return l.id === id; });
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) {
      session.lines = session.lines.filter(function (l) { return l.id !== id; });
    }
    saveDraft();
    render();
  }

  function clearDraft() {
    if (session.locked) {
      toast("已送廚，改單請找店員");
      return;
    }
    session.lines = [];
    saveDraft();
    render();
    toast("已清空草稿");
  }

  function newOrderId() {
    return "g" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function submitOrder() {
    if (!session.lines.length) {
      toast("請先加入品項");
      return;
    }
    var blocked = session.lines.filter(function (l) { return isSoldOut(l.id); });
    if (blocked.length) {
      toast("含售完品項：" + blocked.map(function (l) { return l.name; }).join("、") + "，無法送廚");
      return;
    }
    var data = loadOrg(session.orgId);
    if (!data) {
      data = {
        orgId: session.orgId,
        shop: session.shop,
        screen: "tables",
        plan: "trial",
        seq: 1,
        covers: 0,
        turns: 0,
        tables: tables.map(function (t) {
          return {
            id: t.id, name: t.name, seats: 4, status: "dining",
            party: "", guests: 0, statusSince: Date.now()
          };
        }),
        waitlist: [],
        ticket: { tableId: session.tableId, pay: "現金", lines: [] },
        receipts: [],
        staff: [],
        kitchenQueue: [],
        soldOut: {},
        orderEvents: [],
        backfillRounds: []
      };
    }
    ensureKitchen(data);
    if (!data.soldOut || typeof data.soldOut !== "object") data.soldOut = {};
    if (!Array.isArray(data.orderEvents)) data.orderEvents = [];

    var now = new Date();
    var eta = linesEta(session.lines);
    var mapped = session.lines.map(function (l) {
      return {
        id: l.id, name: l.name, price: l.price, qty: l.qty,
        prepMinutes: l.prepMinutes != null ? l.prepMinutes : 8,
        serveMinutes: l.serveMinutes != null ? l.serveMinutes : 3,
        sent_at: now.getTime(),
        source: "guest_device"
      };
    });

    function recompute(order) {
      var amount = 0, prep = 0, serve = 0, sources = {};
      (order.lines || []).forEach(function (l) {
        amount += (l.price || 0) * (l.qty || 0);
        if ((l.prepMinutes || 0) > prep) prep = l.prepMinutes;
        if ((l.serveMinutes || 0) > serve) serve = l.serveMinutes;
        if (l.source) sources[l.source] = true;
      });
      order.amount = amount;
      order.prepMinutes = prep || 8;
      order.serveMinutes = serve || 3;
      order.sources = Object.keys(sources);
      return order;
    }

    function isOpen(o) {
      return o && !o.checkClosed && o.status !== "void";
    }

    var open = null;
    if (session.tableId && session.tableId !== -1) {
      open = (data.kitchenQueue || []).find(function (o) {
        return isOpen(o) && Number(o.tableId) === Number(session.tableId);
      }) || null;
    }
    /* also match by table name when id is synthetic */
    if (!open && session.tableName) {
      open = (data.kitchenQueue || []).find(function (o) {
        return isOpen(o) && String(o.table).toUpperCase() === String(session.tableName).toUpperCase();
      }) || null;
    }

    var order;
    if (open) {
      mapped.forEach(function (nl) {
        var existing = (open.lines || []).find(function (x) {
          return x.id === nl.id && x.source === "guest_device";
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
      open.actor = "guest_device";
      open.time = hm(now);
      open.at = now.getTime();
      if (!open.sent_at) open.sent_at = now.getTime();
      open.note = "桌邊客人送廚（併單）";
      recompute(open);
      data.kitchenQueue = data.kitchenQueue.filter(function (o) { return o.id !== open.id; });
      data.kitchenQueue.unshift(open);
      order = open;
      data.orderEvents.unshift({
        id: "ev" + Date.now().toString(36),
        at: now.getTime(),
        tableId: session.tableId,
        table: session.tableName,
        kind: "append",
        text: "桌邊QR 加點併入同一單 #" + String(order.id).slice(-8),
        source: "guest_device",
        orderId: order.id
      });
    } else {
      order = {
        id: newOrderId(),
        actor: "guest_device",
        sources: ["guest_device"],
        tableId: session.tableId,
        table: session.tableName,
        time: hm(now),
        at: now.getTime(),
        sent_at: now.getTime(),
        prep_started_at: null,
        ready_at: null,
        served_at: null,
        status: "sent",
        checkClosed: false,
        prepMinutes: eta.prep,
        serveMinutes: eta.serve,
        lines: mapped,
        amount: cartTotal(),
        note: "桌邊客人送廚"
      };
      recompute(order);
      data.kitchenQueue.unshift(order);
      data.orderEvents.unshift({
        id: "ev" + Date.now().toString(36),
        at: now.getTime(),
        tableId: session.tableId,
        table: session.tableName,
        kind: "open",
        text: "開單 · 桌邊QR · #" + String(order.id).slice(-8),
        source: "guest_device",
        orderId: order.id
      });
    }
    if (typeof data.seq === "number") data.seq += 1;
    if (data.orderEvents.length > 100) data.orderEvents.length = 100;
    saveOrg(session.orgId, data);

    session.locked = true;
    session.lastSentId = order.id;
    session.lastSentAt = order.sent_at;
    session.lastPrepMinutes = order.prepMinutes || eta.prep;
    session.lastServeMinutes = order.serveMinutes || eta.serve;
    saveDraft();
    render();
    toast(
      (open ? "已併入同桌訂單 #" : "已開單送廚 #") +
      String(order.id).slice(-8) +
      " · 預估製作 " + (order.prepMinutes || eta.prep) + " 分／送餐 " +
      (order.serveMinutes || eta.serve) + " 分（mock）"
    );
  }

  function startNewOrder() {
    session.lines = [];
    session.locked = false;
    session.lastSentId = null;
    session.lastSentAt = null;
    session.lastPrepMinutes = null;
    session.lastServeMinutes = null;
    saveDraft();
    render();
    toast("已開新草稿，送廚前可改");
  }

  function renderTableSelect() {
    var sel = document.getElementById("ts-table");
    var fixed = document.getElementById("ts-table-fixed");
    var code = document.getElementById("ts-table-code");
    var note = document.getElementById("ts-scan-note");
    if (session.fromQr) {
      if (sel) sel.hidden = true;
      if (fixed) {
        fixed.hidden = false;
        if (code) code.textContent = session.tableName;
      }
      if (note) {
        note.hidden = false;
        note.textContent = "已掃碼綁定「" + session.tableName +
          "」（Preview 示意）。正式版將校驗桌碼／短時效，防改 URL 點他桌。";
      }
      return;
    }
    if (fixed) fixed.hidden = true;
    if (note) note.hidden = true;
    if (!sel) return;
    sel.hidden = false;
    sel.innerHTML = tables.map(function (t) {
      return '<option value="' + t.id + '"' +
        (t.id === session.tableId ? " selected" : "") + ">" +
        esc(t.name) + "（桌碼示意）</option>";
    }).join("");
    sel.disabled = session.locked && session.lines.length > 0;
  }

  function renderMenu() {
    var root = document.getElementById("ts-cats");
    if (!root) return;
    var sold = readSoldOut();
    root.innerHTML = MENU.map(function (c) {
      var items = c.items.map(function (it) {
        var so = !!sold[it.id];
        var dis = session.locked || so;
        return (
          '<button type="button" class="dish ts-dish' + (so ? " is-soldout" : "") +
            '" data-dish="' + it.id + '"' +
            (dis ? " disabled" : "") + ">" +
            '<div class="dish-n">' + esc(it.name) + (so ? " · 售完" : "") + "</div>" +
            '<div class="dish-p">NT$ ' + it.price + "</div>" +
            '<div class="ts-dish-add" aria-hidden="true">' +
              (so ? "已售完" : "＋ 加入") + "</div>" +
          "</button>"
        );
      }).join("");
      return '<div><p class="cat-name">' + esc(c.cat) + '</p><div class="menu-grid ts-menu-grid">' +
        items + "</div></div>";
    }).join("");
  }

  function renderCart() {
    var list = document.getElementById("ts-cart-list");
    var badge = document.getElementById("ts-cart-badge");
    var total = document.getElementById("ts-total");
    var submit = document.getElementById("ts-submit");
    var clear = document.getElementById("ts-clear");
    var hint = document.getElementById("ts-submit-hint");
    var sent = document.getElementById("ts-sent");
    var shop = document.getElementById("ts-shop");

    if (shop) shop.textContent = session.shop;
    if (total) total.textContent = "NT$ " + cartTotal();

    if (badge) {
      badge.textContent = session.locked ? "已送廚·鎖定" : "草稿·未送廚";
      badge.classList.toggle("is-sent", session.locked);
    }

    if (!session.lines.length) {
      list.innerHTML = '<p class="help">尚未點餐。左側大鍵加入；送廚前可改。</p>';
    } else {
      list.innerHTML = session.lines.map(function (l) {
        var qtyCtrl = session.locked
          ? '<div class="qty"><span>' + l.qty + "</span></div>"
          : (
            '<div class="qty">' +
              '<button type="button" data-qty="' + l.id + '" data-delta="-1" aria-label="減少">−</button>' +
              "<span>" + l.qty + "</span>" +
              '<button type="button" data-qty="' + l.id + '" data-delta="1" aria-label="增加">＋</button>' +
            "</div>"
          );
        var prep = l.prepMinutes != null ? l.prepMinutes : 8;
        var serve = l.serveMinutes != null ? l.serveMinutes : 3;
        return (
          '<div class="line">' +
            "<div>" + esc(l.name) +
              '<div class="party-meta">NT$ ' + l.price + "</div>" +
              '<div class="line-eta">預估製作 ' + prep + " 分　·　預估送餐 " + serve + " 分</div>" +
            "</div>" +
            qtyCtrl +
            '<div class="line-amt">NT$ ' + (l.price * l.qty) + "</div>" +
          "</div>"
        );
      }).join("");
    }

    if (clear) {
      clear.hidden = !session.lines.length || session.locked;
    }

    if (submit) {
      if (session.locked) {
        submit.disabled = false;
        submit.textContent = "再開一單";
        submit.dataset.mode = "new";
      } else {
        submit.disabled = !session.lines.length;
        submit.textContent = "送廚";
        submit.dataset.mode = "send";
      }
    }

    if (hint) {
      hint.textContent = session.locked
        ? "送廚後改單請找店員。再開一單會併入同一桌 order id（訂單脊柱）。"
        : "確認後寫入廚房／POS 佇列（本機示意）· 無金流";
    }

    if (sent) {
      if (session.locked && session.lastSentId) {
        var dataLive = loadOrg(session.orgId) || { kitchenQueue: [], soldOut: {}, orderEvents: [] };
        ensureKitchen(dataLive);
        var openOrd = findOpenOrderInOrg(dataLive);
        var live = openOrd ? liveEtaFromOrder(openOrd, dataLive) : null;
        var prep = live ? live.remainingPrep :
          (session.lastPrepMinutes != null ? session.lastPrepMinutes : 8);
        var serve = live ? live.remainingServe :
          (session.lastServeMinutes != null ? session.lastServeMinutes : 3);
        var waitAt = (live && live.sentAt) || session.lastSentAt;
        var wait = waitAt ? formatWaitMmSs(waitAt) : "00:00";
        var ageLv = live ? live.ageLevel : "ok";
        var depth = live ? live.queueDepth : 0;
        var ageMin = live ? Math.floor(live.ageMin) : 0;
        sent.hidden = false;
        sent.innerHTML =
          "<strong>已送廚</strong>　" + esc(session.tableName) +
          "　·　單號 " + esc(String(session.lastSentId).slice(-8)) +
          '<div class="ts-eta is-' + ageLv + '" id="ts-eta" data-ts-live-eta="1">' +
            '<div><span class="ts-eta-k">剩餘製作（同源）</span> <strong id="ts-rem-prep">' +
              prep + " 分</strong></div>" +
            '<div><span class="ts-eta-k">送餐約</span> <strong id="ts-rem-serve">' +
              serve + " 分</strong></div>" +
            '<div><span class="ts-eta-k">已等待</span> <strong id="ts-wait">' + wait + "</strong></div>" +
            '<div><span class="ts-eta-k">票齡</span> <strong id="ts-age">' + ageMin +
              ' 分</strong> · 佇列前 <strong id="ts-depth">' + depth + "</strong> 單</div>" +
          "</div>" +
          '<p class="help">同源票齡＋佇列深度 · 隨時間更新 · mock · 非保證分鐘。改單請店員。</p>';
      } else {
        sent.hidden = true;
        sent.innerHTML = "";
      }
    }
  }

  function render() {
    renderTableSelect();
    renderMenu();
    renderCart();
  }

  document.addEventListener("click", function (e) {
    var dish = e.target.closest("[data-dish]");
    if (dish) {
      addDish(dish.getAttribute("data-dish"));
      return;
    }
    var qty = e.target.closest("[data-qty]");
    if (qty) {
      changeQty(qty.getAttribute("data-qty"), Number(qty.getAttribute("data-delta")));
      return;
    }
    if (e.target.id === "ts-clear") {
      clearDraft();
      return;
    }
    if (e.target.id === "ts-submit") {
      if (e.target.dataset.mode === "new") startNewOrder();
      else submitOrder();
    }
  });

  var tableSel = document.getElementById("ts-table");
  if (tableSel) {
    tableSel.addEventListener("change", function (e) {
      if (session.fromQr) {
        toast("掃碼桌不可改；請掃正確桌上 QR");
        renderTableSelect();
        return;
      }
      if (session.locked) {
        toast("已送廚單不可換桌；請再開一單");
        renderTableSelect();
        return;
      }
      var id = Number(e.target.value);
      var t = tables.find(function (x) { return x.id === id; });
      if (!t) return;
      session.tableId = t.id;
      session.tableName = t.name;
      saveDraft();
      toast("目前桌號 " + t.name);
    });
  }

  /* Preview security hint: if user edits ?table= after load, warn */
  window.addEventListener("popstate", function () {
    var next = parseTableParam();
    if (session.fromQr && next && next.toUpperCase() !== String(session.tableName).toUpperCase()) {
      toast("桌碼與掃碼不符（Preview 警告）");
    }
  });

  render();

  /* sync 86／售完 from counter + N3 live ETA tick */
  setInterval(function () {
    try {
      renderMenu();
      if (session.locked && session.lastSentId) {
        var dataLive = loadOrg(session.orgId);
        if (!dataLive) return;
        ensureKitchen(dataLive);
        var openOrd = findOpenOrderInOrg(dataLive);
        var live = openOrd ? liveEtaFromOrder(openOrd, dataLive) : null;
        var waitEl = document.getElementById("ts-wait");
        var remP = document.getElementById("ts-rem-prep");
        var remS = document.getElementById("ts-rem-serve");
        var ageEl = document.getElementById("ts-age");
        var depEl = document.getElementById("ts-depth");
        var box = document.getElementById("ts-eta");
        if (live) {
          if (waitEl && live.sentAt) waitEl.textContent = formatWaitMmSs(live.sentAt);
          if (remP) remP.textContent = live.remainingPrep + " 分";
          if (remS) remS.textContent = live.remainingServe + " 分";
          if (ageEl) ageEl.textContent = Math.floor(live.ageMin) + " 分";
          if (depEl) depEl.textContent = String(live.queueDepth);
          if (box) {
            box.classList.remove("is-ok", "is-warn", "is-crit");
            box.classList.add("is-" + live.ageLevel);
          }
        } else if (waitEl && session.lastSentAt) {
          waitEl.textContent = formatWaitMmSs(session.lastSentAt);
        }
      }
    } catch (e) {}
  }, 1000);
})();
