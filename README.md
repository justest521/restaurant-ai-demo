# restaurant-ai-demo

MoreYou 餐飲 AI **Demo Preview**（N1–N6 mock）。櫃台腦、候位、POS、掃碼點餐、廚列、財務／客人／總部等畫面，全部是本機靜態示意。

**Preview ≠ Production。** 無後端、無真實金流、無正式 LINE、無正式 Supabase、不 Deploy 真環境。正式 DB／上線僅 Owner 核准。本 repo 給後續 **Cursor Cloud Agents（Grok）** 施工，不是正式授權產品。

## 本機怎麼開

純靜態檔，不需要 npm／Next／build。

```bash
# 在 repo 根目錄
python3 -m http.server 8766
```

瀏覽器開：http://127.0.0.1:8766/

- 櫃台腦：`index.html`
- 客人掃碼點餐：`tableside.html?table=T3`
- 佈局 A／B／C 靜態示意：`layouts/`（主 Preview 預設＝**C 單焦點舞台**）

也可直接開 `index.html`。建議 DevTools 自訂裝置 **Sunmi T3**：`1920 × 1080`、觸控。預設舞台＋Paper；⋯選單可開機框／切 Steel。

## N6 候位座位 ETA（4 次點擊驗收）

**座位等 ≠ 出餐等。** ETA 只讀當下桌況＋候位佇列＋人數；改桌態下一幀重算。與桌況同源，**無第二假 timer**。示意·非保證。

1. 櫃台：`index.html` → ⋯ **重設示範** → **訂位／候位** → 開「名單」：見各組 **第 N 組**＋座位 ETA 帶（空桌／待清／等翻桌）與理由晶片。
2. 切 **桌況** → 選一張 **待清**（如 T5／B3）→ **循環下一態** 清成空桌（或抽屜／設定按 **示範：清一桌看 ETA 變**）。
3. 回 **訂位／候位**：同一組 ETA 應變短或變「可叫號／較快」。
4. （可選）**更多 → 客人**：見一行「位子還要多久（候位）」≠ 出餐文案；設定可改待清／翻桌示意分；開發者工具可呼叫 `__demoPreview.mockApiGet("waitSeatEta", orgId)`（`orgId` 來自 `__demoPreview.getMeta().currentOrgId`）。

標籤：Preview · mock · 與桌況同源 · 示意·非保證 · 非 Production。

## N1–N5 驗收入口（各約 4 次點擊）

操作前建議 ⋯ **重設示範**，避免舊 `localStorage` 干擾。資料在本機：`restaurant-ai-demo-preview-v2-org-{orgId}`。

| 編號 | 能力 | 最短路徑 |
|---|---|---|
| **N1** 原子補位 | 同桌同時邀 ≥2 組，先確認者得桌 | 切 **示範食堂 B** → 候位勾選 **謝小姐＋潘小姐** → 目標 **B2** → **同時補位 2 組** → 謝確認入座、潘「已被訂走」 |
| **N2** 訂單脊柱 | 同一桌＝同一個 order id（POS ↔ 桌邊 QR ↔ 廚列） | **桌況 T3** → 模擬掃碼 → 桌邊加點送廚 → 回 **POS-1** 同單；櫃台再加點仍併入；菜單 **86** 後桌邊售完 |
| **N3** 廚票齡 | 綠／黃／紅；催菜確認寫事件、不改承諾 | **POS-1** 開廚列 → 超時單 **確認催菜** → FOH／客人 ETA 隨票齡＋佇列更新 |
| **N4** 建議紀錄 | 確認／略過可稽核，不自動改單 | 催菜或分配 **確認／略過** → **更多** 見建議紀錄 |
| **N5** 遲到釋放 | 訂位留桌逾寬限 → 釋放桌，可接 N1 補位 | **桌況** 選訂位保留（T4／B5）→ **加速遲到** → 對空桌發起補位 |

尖峰三頁：桌況／訂位候位／POS-1。洞察在 **更多**（總部報告／財務／客人／競品／設定）。假 API：`__demoPreview.mockApiGet(resource, orgId)`。

## 產品基線（Preview mock）

- 事件時間軸（送廚／製作／出餐）＋預估製作／送餐／已等待
- AI 建議（混單／催菜／分配）需店員確認、**不自動改單**
- FOH／客人出餐 ETA＝同源票齡＋佇列深度（與 N6 座位 ETA 分開）
- 店家切換 A／B（試營運／中價）；多組補位閘控
- 無真 ML、無保證分鐘

## 檔案

```
index.html          櫃台腦
app.js              N1–N6 mock 邏輯（含候位 ETA 與桌況同源）
styles.css
tableside.html      客人掃碼點餐
tableside.js
tableside.css
layouts/            A／B／C 佈局示意（C＝Owner lock）
```

後續功能請開 Cloud Agent PR，勿把 Production／真實金流／正式 DB 寫進這個 Preview。
