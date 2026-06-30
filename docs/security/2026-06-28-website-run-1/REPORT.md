# PCM Website 安全體檢 — run-1（L1 輕掃 / 外圍 + 公開端點）

- 日期:2026-06-28 ｜ repo: pcm-website-v2 ｜ 分支: dev
- 範圍:**輕掃(非完整)** — 部署/設定檔 + 3 個對外公開端點 + 外圍 headers/限流。
- 引擎:單 session 唯讀勘查(未跑多代理深掃、未跑 Codex、未跑全站 injection/business-logic 掃)。
- 🔴 **本次未涵蓋(留 L3 深掃)**:全站 injection、訂單狀態機 business-logic、access-control 全面、RLS/GRANT 矩陣全查、依賴 CVE、報價單專案。

---

## 摘要(白話)

最該擔心的「錢 + 客戶資料」這條線**守得非常紮實**(專業水準)。缺口都在**外圍/平台層**(設定沒鋪),不在程式邏輯。沒有發現可直接利用的高危資料/金流漏洞。

| severity | 標題 |
|---|---|
| MEDIUM | F1 缺安全 HTTP headers(可被 clickjacking / 缺 HSTS·CSP 兜底) |
| LOW | F2 未設 Vercel Firewall / BotID(應用層 DDoS·惡意 bot 只靠平台預設) |
| LOW | F3 無 app 層全域限流(最貴金流路徑已有 per-order throttle,故急迫度低) |

---

## 守得好的（正面項,校準信任）

- **訂單枚舉(IDOR)已堵死**:orderId 為 UUID 形狀過濾 + own-only 雙軸(RLS `orders_select_own` + 應用層 `.eq('customer_user_id', userId)`)+ 查無/非本人統一 404(不洩存在性)+ JWT 經 `getUser()` 向 auth server 驗。[payment-status/route.ts](../../../apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts)
- **經銷價零洩漏**:payment-status 只 select 單欄、回應只 `{status}`,零金額/PII。
- **金流防雙扣**:冪等 + 金額整數 + per-order poll-settle throttle(防打爆 TapPay Record)。
- **排程端點**:`CRON_SECRET` + `timingSafeEqual` 硬驗 + 預設關閉 + 全路徑 fail-closed(不偽 200)。[settle-sweep/route.ts](../../../apps/storefront/src/app/api/cron/settle-sweep/route.ts)
- **錯誤回應**:401/404/500 一律 null body + no-store,零內部訊息洩漏。

---

## 發現

### F1 — 缺安全 HTTP headers（MEDIUM）
- **根因**:[next.config.ts](../../../apps/storefront/next.config.ts) 無 `headers()`、無 middleware → 回應缺 `X-Frame-Options`/`Content-Security-Policy`/`Strict-Transport-Security`/`X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy`。
- **攻擊劇本**:攻擊者把 storefront(含登入/結帳頁)嵌進自己網站的隱形 iframe,上面疊假 UI,誘導已登入用戶誤點(clickjacking)。另:缺 HSTS → 首訪可被降級攻擊;缺 CSP → 任何未來 XSS 無兜底。
- **影響**:clickjacking 對已登入用戶可觸發非預期操作;為其他 web 攻擊鋪路。
- **修法**:next.config `headers()` 加上述 headers;CSP 先上 `Report-Only`(只回報不阻擋)確認無誤傷再收緊。
- **驗證狀態**:未經 adversarial-reviewer / Codex 複核(輕掃)。

### F2 — 未設 Vercel Firewall / BotID（LOW，hardening）
- **現況**:[vercel.json](../../../vercel.json) 僅 framework + crons;無 firewall 規則、無 BotID。
- **緩解既存**:Vercel 平台基礎 DDoS 防護 always-on(流量洪流已擋)。
- **修法(Sean 後台操作)**:開 Vercel BotID(擋自動化 bot)+ Firewall 自訂限流規則。屬縱深強化,非漏洞。

### F3 — 無 app 層全域限流（LOW）
- **現況**:storefront 程式無全域 rate limit。
- **緩解既存**:最貴的金流路徑(payment-status→TapPay)已有 per-order throttle;公開端點以 UUID + own-only 擋住枚舉。
- **修法**:若 F2 開 Vercel Firewall 限流即覆蓋此項;或對 line auth / 公開 API 加邊緣限流。

---

## 下一步
- L3 深掃(多代理全站)= 系統提醒 / Sean go,需充足 token budget(本輪 3% 不足以跑)。
- F1 可獨立先補(一個小 slice,動 next.config 屬鐵則 8、先提 plan)。
- findings.json 機讀台帳:本輪因 budget 從略,L3 時補(可累積追蹤)。
