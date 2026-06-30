# M-3 #241 結帳同意條款 server 驗 + 法律舉證紀錄 — plan

> 真權威。鐵則 8(動核心 RPC 簽名 + 新表 + RLS/GRANT)+ 鐵則 12(付款/建單脊椎)。
> 背景:Sean 2026-06-30 拍「不要只挑簡單的、一次做完不留後患」+ Gemini 唯讀第二意見(scope/設計判斷,見 §6)。
> flag:`TAPPAY_3DS_ENABLED` 全程 false、prod 結帳關閉中 → 本片 prod 零影響;migration db push = Sean(joins 開 prod flag 前 bundle)。

## 1. 問題(#241,兩個缺口)

1. **無 server 端驗**:結帳同意 checkbox `agreed` 只在前端擋鈕(`payDisabled=!agreed`);server action `chargePaymentAction` **不接收/不驗 consent** → 繞 UI 直打 server action 即可無同意成交(違反「不信任 client」鐵則)。
2. **零法律舉證紀錄**:全系統無任何 consent 持久化(時間戳/條款版本/IP/UA),爭議/盜刷時無法舉證。

## 2. 設計(Gemini 判斷 A + 第四選項:獨立附屬表原子寫入)

### 2.1 資料層 — 新表 `order_legal_consents`(1:1 附屬 orders)
| 欄 | 型別 | 說明 |
|---|---|---|
| `order_id` | uuid PK REFERENCES orders(id) ON DELETE CASCADE | 1:1 綁訂單 |
| `terms_version` | text NOT NULL | server 常數(當前條款版本);非 client 送 |
| `consented_at` | timestamptz NOT NULL DEFAULT now() | DB 權威時間 |
| `client_ip` | text NULL | best-effort(x-forwarded-for / x-real-ip);爭議舉證 |
| `client_user_agent` | text NULL | best-effort(user-agent);爭議舉證 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

- **RLS 啟用 + 零 policy + REVOKE ALL(PUBLIC/anon/authenticated/service_role)** = 對齊 R1b1a anomaly 表範式;IP/UA PII 最大隔離,app 不讀、僅 dashboard/admin 直查。
- 寫入唯一路徑 = `create_order` SECDEF(owner bypass RLS/grant)。
- 無經銷價/cost/金額欄;非價、PII 限 IP/UA。

### 2.2 RPC — `create_order` 5→8 param(DROP 5-param、CREATE 8-param)
- 新增 `p_terms_version text, p_client_ip text, p_client_ua text`。
- 🔴 **`p_terms_version` NULL → RAISE**(「無 consent 不生 order」不變式,DB 層強制)。`p_client_ip/ua` nullable(best-effort)。
- 同 transaction:`INSERT INTO orders … RETURNING id` 後 `INSERT INTO order_legal_consents(order_id=v_order_id, terms_version=p_terms_version, consented_at=now(), client_ip=p_client_ip, client_user_agent=p_client_ua)`。
- zero-regression:本體 = 20260614130000 版逐字 + 三處 delta(簽名加 3 param / null guard / consent INSERT);取價/防撞/IDOR/溢位/快照/權限矩陣逐字不動。
- ACL:REVOKE 8-param FROM PUBLIC/anon/service_role/payment_confirmer;GRANT EXECUTE TO authenticated;DROP 舊 5-param。
- DO assert:8-param 唯 authenticated + 5-param 已 DROP + begin/payment_confirmer 矩陣回歸 + order_legal_consents 表存在 + RLS enabled + grants=0。
- forward-only:不重播既有 0b/#214a DDL。

### 2.3 TS 層
- **`CURRENT_TERMS_VERSION` 常數**(新 `apps/storefront/src/lib/legal/terms-version.ts` = `'2026-06-30'`;條款文字實質改版時 bump;註明日後可改 content hash)。
- **`charge-actions.ts`**:
  - ②e 守門:`if (raw.agreed !== true) return { formError: '請先閱讀並同意服務條款與隱私政策' };`(②d 後、`try{` side-effect 前;零扣款零建單;涵蓋 flag-on/off 兩路徑)。
  - 抓 header:`const h = await headers(); clientIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null; clientUserAgent = h.get('user-agent') ?? null;`
  - PlaceOrderInput 加 `termsVersion: CURRENT_TERMS_VERSION, clientIp, clientUserAgent`(server 注入、非 client)。
- **`PlaceOrderInput` domain**(`packages/domain/src/order/types.ts`)加 `termsVersion: string; clientIp?: string | null; clientUserAgent?: string | null;`(註:server 注入欄、非 client→server 線契約)。
- **`place-order.ts` use-case**:加 `if (!input.termsVersion) throw`(縱深、對齊 cartSessionId guard)。
- **`SupabaseOrderAdapter.placeOrder`** + **mapper**:傳 `p_terms_version/p_client_ip/p_client_ua`。
- **`useChargePayment.tsx`**:`ChargeArgs` 加 `agreed: boolean`;submit payload 加 `agreed: args.agreed`。
- **`CheckoutView.tsx`** line ~128:`charge.submit({ …, agreed })`(無視覺變更;鈕已 `payDisabled=!agreed` 對齊 design,**不加 inline 提示**=維持 design 真權威)。

## 3. agreed===true server 驗的定位(別誇大)
client 可偽造 `true`,但「嚴格要求且驗證」確立 **non-repudiation API 契約**:繞 UI 者必須在 payload 主動建構 `{agreed:true}` = 明確積極發送同意訊號,舉證責任推回發起端。非單純 defense-in-depth、是數位契約承諾界線(Gemini §3)。

## 4. 影響面 / rollback / 分級
- 檔:1 migration(新表+RPC)+ ~9 TS/test。schema 變更 → Sean db push(flag off、joins 開 prod flag bundle、prod 零影響)。
- rollback:Supabase forward-only;migration 檔尾附逆序;TS 純加法 revert。
- 分級:L1(條款 label 不動);鐵則 8+12 → 本 plan 關卡1(Gemini done + 試 codex)、關卡2(adversarial-reviewer + code-reviewer + codex if quota);三綠 + 完整 vitest;真機驗收=Sean(production build)。

## 5. 驗證
- migration MCP 模擬(BEGIN..ROLLBACK 零留痕):catalog(表/欄/FK/PK)+ RLS enabled + grants=0 矩陣 + create_order 8-param ACL + null terms_version RAISE + 行為(建單同時寫 consent、consent 綁正確 order_id、IP/UA null 容忍)+ 零留痕後驗。
- 三綠(動 .tsx → build)+ 完整 vitest;charge-actions.test(agreed 缺/false → formError + placeOrder 未呼);place-order/adapter/hook/view test 補。

## 6. Gemini 第二意見摘要(2026-06-30 唯讀、零留痕;Claude triage 採納)
- 範圍:server 驗證 alone **不夠**,必須連同意紀錄一起做(合規舉證 + 避免重開 payment code)。
- 設計:選 A(改 RPC 原子寫入);否決 B(RPC 替沒驗證的事背書=偽造紀錄)、否決 C(拆 RPC 破原子性=幽靈訂單)。第四選項:獨立 `order_legal_consents` 表、create_order 同 transaction 原子寫(orders 乾淨、PII 隔離)→ **採納**。
- 漏掉:記 IP+UA(爭議/盜刷舉證極重要)、terms_version 用有意義版號、checkbox 具名(design 已具名)、consent 依附訂單不重複記 user_id。→ 全採納。

— END —

---

## 7. codex 關卡1 fold(2026-06-30 round1 = FAIL 3 BLOCKER/2 HIGH/2 MEDIUM/1 NIT,Claude triage 全採納)

> codex(gpt-5.5、`-s read-only`、零留痕)refute-first 審本 plan。以下修正併入上方設計,以本節為準。

### 7.1 新增登錄表 `legal_terms_versions`(解 B1 content_hash 歸宿 + H4 版本合法性)
| 欄 | 型別 | 說明 |
|---|---|---|
| `version` | text PK | 條款版本(= TS `CURRENT_TERMS_VERSION` '2026-06-30') |
| `content_hash` | text NOT NULL | design-reference 服務條款+隱私政策文字 sha256(證明「同意哪份內容」;條款改版必 bump version+hash) |
| `effective_at` | timestamptz NOT NULL | 生效時間 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
- RLS 啟用 + SELECT policy `USING(true)`(版本/雜湊非 PII、公開)+ REVOKE INSERT/UPDATE/DELETE(僅 migration seed)。
- migration seed 當前版本 + hash。

### 7.2 `order_legal_consents` 修正
- `terms_version text NOT NULL REFERENCES legal_terms_versions(version)`(FK → 只收已登錄版本,解 H4)。
- `client_ip text CHECK (client_ip IS NULL OR length(client_ip) <= 128)`、`client_user_agent text CHECK (... <= 1024)`(解 M8;TS 端也截斷 belt+suspenders)。

### 7.3 create_order RPC 修正
- `p_terms_version` 驗:`NULL OR btrim(p_terms_version)=''  → RAISE`(解 H4 空字串);FK 自動擋未登錄版本。
- IP/UA 寫入前 `left(p_client_ip,128)`/`left(p_client_ua,1024)` 截斷(DB CHECK backstop)。
- DO assert 補:① 4-param **與** 5-param 皆不存在(解 N9 replay drift bypass overload)② `order_legal_consents` + `legal_terms_versions` 存在 ③ consent 表 RLS enabled **且 `relforcerowsecurity=false`**(解 H6:否則零 policy 連 SECDEF owner 都寫不進)④ consent 表 grants=0(PUBLIC/anon/authenticated/service_role)。

### 7.4 不變式誠實限縮(解 B2)
「無 consent 不生 order」**僅限 create_order(唯一 app 建單路徑)**:p_terms_version 必填 + 同 transaction 原子 INSERT consent。owner/手動 SQL 直 INSERT orders 不在威脅模型內(authenticated 無直接 INSERT 權、service_role 已收)。plan/commit/comment 不誇大為 DB 全域不變式。

### 7.5 charge-actions 守門位置 + 負測(解 B3)
- ②e agreed guard 放 **`try{` 之前**(buildCardholder/preflightReleaseSibling/placeOrder/findTotal/confirm/initiate/settle **全部之前**)。
- 負測(flag-on **與** flag-off 兩組):agreed 缺/false → 回 formError **且** buildCardholder / preflightReleaseSibling / placeOrder / findTotal / confirmPayment / initiatePayment / settleCharge **全部未被呼叫**(防未來把 guard 移到 preflight 後的副作用回歸)。

### 7.6 IP header(解 M7)+ database.types(解 H5)
- IP:`x-vercel-forwarded-for ?? x-forwarded-for ?? x-real-ip`、取第一段 trim、TS 截斷 128;標 best-effort 非強身分證據。`await headers()`(Next 16 async)。
- 影響面補:`packages/adapters/src/supabase/database.types.ts` — 🔴 **本片只手動對齊 create_order Args 8 key**(`.rpc` 呼叫 typecheck 所需);`legal_terms_versions`/`order_legal_consents` **兩表 Row 型別待 Sean db push 後 `generate_typescript_types` 整批重生**(app 無 `.from()` 讀此二表、不影響 typecheck;對齊既有 pre-push 窄對齊範式、codex 關卡2 MEDIUM 誠實化)+ `SupabaseOrderAdapter` + `mappers/order.ts` + `mappers/order.test.ts` 鎖 8 key。

### 7.7 命名誠實降級(解 B1)
本片 = **「結帳同意紀錄」(consent signal + terms_version + content_hash + IP/UA)**,非「完整法律舉證」。完整法律效力另需 **#235**(結帳條款連結 `href="#"` → 接可讀條款/隱私頁,design-reference LegalPage.jsx 已備、屬前端/內容片)。本片記 content_hash 提供「同意哪份內容」provenance、#235 提供「客人讀得到」,兩者合一才完整。本片不做 #235(前端/內容、可獨立),列為耦合相依。

### 7.8 codex 未阻擋方向
codex 同意「RPC 原子寫 + 獨立表 + IP/UA」大方向、未指過度工程。新增 `legal_terms_versions` 為 codex H4 建議(FK 登錄)、非自行擴張。

— END §7 —
