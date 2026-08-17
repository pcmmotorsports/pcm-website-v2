# 軸二:已登入帳號的授權邊界稽核(帳號被盜/誤操作)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:網站庫 app 層(`pcm-website-v2`)
- **承接**:`E-698` §0-3(a)、§5 第 2 項。上一輪只跑了 `account/*` 七支 + `payment-status`(無 finding),本輪跑其餘。
- **威脅模型**:一個【已登入】帳號(被盜的員工帳號、或一般會員的被盜 token)能不能做它不該做的。**「員工之間不分權限」是刻意設計、不報。**
- **方法**:Explore(sonnet)盤點全部 server action / route handler 的授權檢查 → 主對話**親自核兩條最吃重的宣稱**(下方標 ✅ 已自核 + 檔案:行號),其餘採信盤點。

---

## 0. 結論:授權邊界**今天守得住**,沒有「缺授權檢查」的新洞

真正的前向風險不是已寫好的檢查有漏,是**兩顆還沒接上真身分、日後會漂成洞的架構樁** —— 兩者 code 自己都已標記、非本輪新發現,列為**上線前必關的追蹤項**。

---

## 1. 伺服器端怎麼分會員 vs 員工(兩系統密碼學隔離)

- **admin 入口**:`apps/admin/src/proxy.ts`(middleware,matcher 幾乎管全站)驗 `ADMIN_SESS_COOKIE`(HMAC,金鑰 `ADMIN_SESSION_SECRET`,`session.ts`)。該 cookie **只能經報價單 SSO 回呼**(`app/api/sso/callback/route.ts`)兌換。Mutation 另過共用閘 `authorizeAdminMutation`(`lib/session/authorize.ts`:verifySession + Origin fail-closed CSRF + 具名 actor 供稽核歸屬)。
- **storefront 入口**:無 staff 概念,逐頁/action 呼 `supabase.auth.getUser()`(向 auth server 驗 JWT,非可偽造的 `getSession`)。只分登入/未登入。
- 🔴 **隔離**:不同 cookie 名、不同密鑰、無 rewrite 橋接、各自獨立 Vercel 專案 ⇒ **一般會員的 Supabase JWT 對 admin 側毫無意義**。

## 2. 盤點結果(略去已查的 account/* + payment-status)

- **admin 19 個 'use server' 業務檔**(全改資料或讀 PII/成交價/成本):**逐一有 `authorizeAdminMutation`,兩個例外**:
  - `lib/session/actor-actions.ts` `selectActorAction`:只選操作人身分 cookie,`actor.ts` 自陳「非授權邊界」,不改業務資料 ⇒ **設計如此、非破口**。
  - ✅ **已自核** `lib/shipping/shipment-actions.ts:219-261` `fetchShipmentCandidates`:**內部**讀訂單明細(碰得到成交價+PII)**但回傳窄 DTO(零金額欄,見 §4-③ 收窄)**,只靠 `proxy.ts` 登入閘、略過 Origin/actor。**這是唯一沒過 `authorizeAdminMutation` 的業務檔**,已 Sean 拍板 `Q-AUDIT-1a`=甲(檔內 227-261 行逐字):**存取控制沒失守(仍要求有效 admin session、外部呼不到)、缺的是事後留痕**。仍需 `ADMIN_SESS_COOKIE`(會員拿不到)⇒ **不跨會員↔員工邊界**;因讀敏感而檢查層級低於其他 action,列此複核。(讀取型 action 略過 Origin 的 CSRF 風險低:SOP 擋住跨源頁面讀回應。)
- **admin route.ts 2 支**(SSO start/callback,state CSRF)+ **storefront route.ts 8 支**(facet-counts 唯讀公開+三道白名單;tappay-notify 走 secret 路徑段 timing-safe;cron ×3 `CRON_SECRET` Bearer timingSafeEqual;auth/line callback 是登入端點本身)⇒ **查無「改資料/讀敏感卻無檢查」的 route**。

### ✅ 2-verify 三支 auth 關鍵 guard 主對話親讀(不採信盤點)—— 2026-08-17
- **cron `CRON_SECRET` ×3**:`safeEqual` 先比長度再 `timingSafeEqual`(settle-sweep 全讀 44-48;三支皆**定義且呼叫**:`requireCronSecret` line 84/114/84 → `if(!safeEqual(presented,expected))` line 90/120/90 → 401);`requireCronSecret` 未設/<32 → **500 fail-closed**;Bearer 缺 → presented='' → 長度不等 → 401;**認證在限流之前**(未持 secret 的 flood 不佔額度)。
- **`tappay-notify` secret 路徑段**:同 `safeEqual`(本體 43-48 全讀);`requireNotifySecret` ≥32 URL-safe → 500;不符 → **404(不揭存在)**(line 115+120)。
- **SSO state CSRF**:`newState()` = `crypto.getRandomValues(Uint8Array(16))` **128-bit CSPRNG**(`lib/sso/state.ts:28-32`);state cookie `httpOnly`+`SameSite=Lax`+prod `Secure`/`__Host-`;callback 綁定 `decoded.s === queryState`、**cookie 缺即拒**(`callback:57-59`);失敗只清 state cookie 不清 session;`returnTo` 走白名單(擋 open-redirect);`no-referrer`+`no-store`。state 用 `!==` 非 timing-safe,但 state 是單次隨機 nonce、非長期祕密 ⇒ 可接受。
- ⇒ **三族實作正確**,盤點的「均合格」在主對話親讀下成立。

### ✅ 2-verify-b 登入流 guard 親讀(2026-08-17 續)—— OAuth callback 是常見 CSRF/state 坑
- **LINE OAuth**(`api/auth/line/{start,callback}`):`generateState/Nonce`=`randomBytes(32)` **256-bit CSPRNG**(`lib/auth/line.ts:74-80`);callback `resolveDestination:51` 的 CSRF 檢查(`!code||!state||!storedState||!nonce||!safeEqual(state,storedState)`)**在 `exchangeCodeForToken(code)` 之前**(state 不符到不了 code 兌換);`verifyIdToken(idToken, nonce)` 綁 nonce 防重放;**失敗回 LINE_ERROR_REDIRECT、不呼叫 verifyOtp ⇒ 不建 session;callback 尾只 delete LINE_STATE/NONCE/NEXT、不碰 Supabase session cookie ⇒ 失敗不清既有登入**(同 SSO 那把尺);`authenticateLineUser` 有 `collision_not_line` 防冒登入。
- **Google OAuth**(`auth/callback`):CSRF 委派 Supabase SDK PKCE(`exchangeCodeForSession` 內部驗 code_verifier,**採信 SDK、非 app 實作**);open-redirect 用 `redirect()`+相對路徑(codex 關卡2 must-fix 擋 host-header)。
- **open-redirect 命脈** `sanitizeNextParam`(`lib/auth/safe-redirect.ts`,三處共用):拒非 `/` 開頭 / `//host` / `/\host` / 反斜線 / 控制字元 / 空白 ⇒ 正確白名單。LINE 在 start 存前 + callback sink 雙重套用。
- ⇒ **登入流 guard 實作正確**;唯一「採信非親驗」處=Google 的 PkCE 在 Supabase SDK 內(標明)。
- **storefront server action**:`checkout/charge`·`reconcile` 有 `getUser()` 閘 + RPC 內 `auth.uid()` 鎖 own-only;`cart/actions resolveCartLines` 只讀公開 general 價(無 PII、無經銷價)。

## 3. 一般已登入會員能否跨界

| 問 | 結論 | 依據 |
|---|---|---|
| (a) 讀經銷價/成本 | **今天不能**,但有已知未關破口(見 §4-①) | 讀價路徑釘死 `tier='general'` + view 物理排除 `price_store` |
| (b) 呼叫 admin 改資料動作 | **查無** | admin cookie 只能經 SSO 兌換,與 storefront session 密碼學隔離 |
| (c) 讀他人客戶資料(IDOR) | **查無** | `reconcile-actions` own-only 走 DB `auth.uid()`;掃 `customer_id\|customerId` 無「以 client 傳入 id 直查他人」寫法 |

## 4. 🔴 兩顆「日後會漂成洞」的架構樁(自標,追蹤,非新 finding)

**① storefront `pcm-tier` cookie(Sean 第二優先=經銷價,最高風險的一顆)**
✅ **已自核** `apps/storefront/src/lib/tier.ts:31-38,51-53`:cookie **client 可偽造**、只驗字面合法性、**不查 `customers.tier`**。
目前**無洩漏**,靠兩層物理擋:讀價路徑釘死 `general` + `products_public` view 物理排除 `price_store` + mapper `toUIProduct` 對 store/premiumStore 恆 dummy 0 ⇒ 偽造 tier 最多看到「店價 NT$0」破圖。
🔴 **M-2-08 接真 tier-aware pricing(讀真 `price_store`)之前,tier 來源必改為 server 端 `getUser()` 查 `customers.tier`;若沿用此 cookie 為唯一來源,一般會員偽造 cookie 即取得真經銷價 = 違反專案最高安全鐵則(升 CRITICAL)。** backlog `#215` / 安全稽核 H-1。

**② admin `getSessionActor` 仍是自選 cookie、非真登入身分**
`actor.ts` 自陳非授權邊界;`authorizeAdminMutation` 的 `actorId` 來自使用者下拉自選、系統不驗。⇒ 稽核留痕「記的是誰」還不可信,真登入線(E8-B)上線後自動變真、本檔不用改。

## 4-③ LOW–MEDIUM 防禦縱深(帳號被盜放大器,非邊界破口)—— 2026-08-17 補掃

**掃 mass/批次/不可逆動作的結果(帳號被盜情境唯一可能是新洞的地方)**:
- ✅ **乾淨負向**:admin 無批次/bulk 變更動作、無 export-all/CSV/下載端點(mass PII 一鍵匯出)、唯一硬刪是**單筆** `admin_delete_item_receipt`(`receipt-repository.ts:250`,過 authorizeAdminMutation)。量法:`grep -rniE 'batch|bulk|mass|purge|deleteAll|clear|csv|content-disposition|attachment' apps/admin/src`,命中皆為 React `export function`/型別/常數,無真 mass 端點。

- 🔴 **一個觀察** `fetchShipmentCandidates`(`shipment-actions.ts:219` → `shipment-candidates.ts:227-236`):**orderIds 陣列零長度上限**(只有 `length===0` 早退,然後 `Promise.all(orderIds.map(findAdminOrderDetail))` 逐張打)。
  - 檔內註解自陳假設「員工一次勾的張數是個位數 ⇒ 不預先最佳化」——**但這是 server action,呼叫端不受 UI 個位數的現實約束**。被盜的 admin session 可直接餵上千個 orderId:
    - (a) 🔴 **【2026-08-17 收窄 —— C 窗實作時開 DTO 核出,取代我原本的誇大】**:~~一次撈全部訂單的成交價 + PII~~ **不成立**。C 窗開 `shipment-candidates.ts` 的回傳 DTO 核出:**它回的是窄 DTO、零金額欄**,`recipient` 只有**第一張單**的。⇒ 真正的批次外洩面 = **大量訂單的【品項 / 料號 / 單號】對映**(非成交價、非完整 PII)。
      🔴 **原本錯在哪(留成因,不寫「其實沒那麼嚴重」)**:我從「函式【碰得到】什麼」推「它【回得出】什麼」—— `shipment-candidates.ts` 帶 `server-only`、確實碰得到成交價與 PII(那正是它要 `server-only` 的理由),**但「碰得到 ≠ 回得出來」,中間隔著一個我沒開檔看的 DTO**。〔codex 兩輪把這句當 must-fix、C 窗已加上限 `b5500042`〕
      ✅ **E 窗 merge C 窗實作後【親開 DTO 核】**(`shipment-candidates.ts:78-130`):`ShipmentCandidateItem` 欄=`orderId`/`orderItemId`/`orderDisplayId`/`variantSku`(`:92` 註明**非價格欄**)/`title`/`remaining`/`blockedReason`,**零金額欄**;`ShipmentCandidates.recipient`(`:125`)**只取第一張單**。⇒ 收窄成立、我親眼核過,不只採信 C 窗。上限 `MAX_SHIPMENT_CANDIDATE_ORDERS=50`(`shipment-limits.ts`)**擋掉不截斷**,與我規格一致。
    - (b) **無界並行 DB fan-out**(N 個 orderId = N 次 `findAdminOrderDetail`)⇒ 自我 DoS 味道(**DoS 幅度未量,標推**)。**這條不受上面收窄影響,是真危害;上限=50 後每請求也連帶有界。**
  - 🔴 **口徑**:**不跨授權邊界**(資料本就員工可見、仍要有效 admin session、外部呼不到)⇒ 在「員工不分權限」前提下不是高。它是**帳號被盜(Sean 擴充威脅模型)**下的縱深缺口 + robustness smell,**與 facet-counts 的無界 fan-out 同形狀**。
  - **建議修法(引先例)**:給 orderIds 一個長度上限(對齊 UI 個位數現實),與既有做法一致(`ORDER_ITEMS_EMBED_LIMIT=200`、facet-counts 白名單上限)。施工窗判。

## 5. 未做 / 邊界

- 採信 Explore 盤點的部分(除上兩條已自核外)未逐檔重讀 code;若要對某支 action 下「絕對安全」需個別再核。
- 未實打任何請求(唯讀 code + metadata)。
- storefront 各 route 的細節防護(白名單/timing-safe)採信盤點,未逐條實測。

## 口徑

本檔只對**網站庫 app 層**成立。這是**負向結論**(邊界守得住)+ 兩個**追蹤項**(非新洞),寫檔目的是讓下一個窗不必重審同一面。
