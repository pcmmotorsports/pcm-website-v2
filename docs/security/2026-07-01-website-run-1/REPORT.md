# PCM 安全體檢 — L1 輕掃報告(2026-07-01、website、run-1)

> **範圍**:M-3 #250 雙扣 anomaly 主動告警 slice 的未提交變更(20 檔;SECDEF 聚合 RPC migration + cron route + LINE/Email notifier adapter + reader adapter + use-case + composition + vercel.json)。
> **層級**:L1 輕掃(單 session 順序、非 fan-out;命中 §2 觸發:`**/migrations/**` + `lib/payment/**` + `api/**` route.ts + GRANT/REVOKE)。
> **誠實邊界**:本次僅掃「本 slice 碰到的攻擊面 + Obvious things」,非全站深掃(L3)。驗證引擎 = 本 slice 關卡2 已跑的 `adversarial-reviewer`(PASS-with-comments)+ codex K2 跨模型(PASS)+ code-reviewer(PASS);findings 已折入。
> **背景**:flag `TAPPAY_3DS_ENABLED` + `ANOMALY_ALERT_ENABLED` 全程 false、prod 未部署 = 零真流量、零即時風險。

## 白話總結(給 Sean)

這道告警功能**沒有開新的資安破口**。它只會「數數」(有幾筆雙扣候選、幾筆退款卡住),把數字用 LINE/Email 通知你,**完全不碰客人的個資、金額、經銷價**。發通知的那條資料庫查詢是用「受控小窗」設計——負責跑通知的窄權帳號自己看不到那些敏感表,只能透過這支唯讀函式拿到「數字」。三個不同的審查員(含一個不同 AI 模型)都認證過,沒有必修的問題。

唯一一個「可以之後再補強」的小點:通知這條 cron 跟現有的自動對帳 cron 共用同一把鑰匙、且沒有額外的「防洪」限流——這跟現有系統一樣、不是這次新增的弱點,已記入 backlog #254 日後補。

## 逐 PCM 攻擊類核對(§4.A 金流電商)

| 攻擊類 | 結果 | 證據 |
|---|---|---|
| **經銷價洩漏** | ✅ 無 | RPC 只回計數 + 年齡秒數(零 amount/price/tier);告警訊息 counts-only;三 adapter + use-case + composition 皆 `import 'server-only'`、pg 只在 `@pcm/adapters/server` subpath、無任何 client component import;測試正向斷言訊息無 UUID/NT$ 樣式。 |
| **會員 tier 偽造** | ✅ N/A | 本 slice 零 tier 邏輯。 |
| **RLS/GRANT — service_role default-grant trap** | ✅ 已避 | migration 明列 `REVOKE ... service_role`(default-grant 收不掉的陷阱)+ `has_function_privilege('service_role',...)=false` assert。對齊 memory `reference_supabase-service-role-execute-default-grant`。 |
| **SECDEF search_path 注入** | ✅ 已硬化 | `SET search_path = ''` + 全識別子 schema-qualified(`public.` / `pg_catalog.`);對齊 R1a3/B1a 範式。 |
| **payment_confirmer 零表權不變式** | ✅ 坐實(雙層) | ① role-hygiene assert(全域 role_table_grants + role_column_grants=0)② effective-privilege assert(`has_table_privilege('payment_confirmer', anomaly 兩表 + payment_charge_attempts, 'SELECT')=false`,關卡2 codex 折入,抓 PUBLIC/membership 污染)。MCP live 驗三表皆 false。 |
| **金額 float / 雙扣冪等** | ✅ 無面 | RPC 回 integer 計數、零金額算術、零浮點;唯讀聚合(STABLE、無寫)→ 無雙扣/race 面。 |
| **cron 認證繞過** | ✅ 硬驗 | `CRON_SECRET` Bearer + `timingSafeEqual`(等長 constant-time)+ 未設/弱→500、缺/錯→401 + `ANOMALY_ALERT_ENABLED` strict `'true'` gate(鏡像 settle-sweep)。 |
| **密鑰入 log / 訊息** | ✅ 無 | LINE token / Resend key 只進 Authorization header;非 2xx 錯誤只含 `status N`(測試斷言 message 不含 token/key/收件者);route catch 用固定 `reason: 'deps_or_unexpected_throw'`、不入 err.message;pg 錯誤 `sanitizeError` 不轉傳原文。 |

## Obvious things

- **SSRF**:notifier POST 端點 = 硬編常數(`api.line.me` / `api.resend.com`),非使用者可控 → 無 SSRF 面。 ✅
- **新依賴 / CVE**:零新 npm 依賴(原生 fetch)。 ✅
- **CORS/cookie/debug**:cron GET 走 Bearer、無 cookie 面、無 debug 端點。 ✅
- **PII/payment_url**:告警訊息 counts-only、零 PII、零單號、零 payment_url。 ✅

## Findings

### LOW-1 — 告警 cron 無應用層限流 + 與 settle-sweep 共用 CRON_SECRET
- **可利用性**:低。認證硬驗正確(無 secret 不可觸發);若 `CRON_SECRET` 洩漏(與 settle-sweep 共用、擴大洩漏面),攻擊者可高頻觸發真告警 → 消耗 LINE/Resend quota + 告警轟炸 Sean(economic/abuse,非資料外洩)。
- **定性**:hardening note,非 HIGH/CRITICAL。**鏡像既有 settle-sweep 範式、非本片新增弱點**;Vercel cron 平台側有排程頻率保護。
- **處置**:記 **backlog #254**(告警 cron 加簡易 per-window 限流 + 評估獨立 secret),上線前評估。不阻擋 commit。

## 正面項(守得好、建立信任校準)

- SECDEF 受控窗設計正確:窄權 cron 角色對敏感表零直讀,唯一路徑經唯讀聚合函式拿「數字」。
- fail-closed 縱深:reader throw → 503;notifier throw → errors → 503 不偽 200;composition「enabled 但零管道 → throw」+ use-case 端第二道防線(踩門檻零 notifier → throw)。
- 訊息文案誠實:open = 雙扣「候選、待查證」(不宣稱已確認雙扣、防誤退款)。
- DDL MCP 零留痕模擬 + live effective-privilege 實查佐證 assert 成立。

## 本次未涵蓋(誠實)

- 非本 slice 檔案的既有攻擊面(L1 只掃本 slice diff + 外圍);全站深掃屬 L3(上線前建議)。
- prod 真連線行為實證:待 Sean db push migration 後,Claude 唯讀 MCP round-trip 驗(§ db push gate)。

## 結論

**L1 輕掃:0 CRITICAL / 0 HIGH / 1 LOW(→ backlog #254)**。經銷價零外洩、SECDEF 安全層正確、payment_confirmer 零表權雙層坐實、cron 認證硬驗、密鑰零外洩、告警訊息零 PII。可 commit。
