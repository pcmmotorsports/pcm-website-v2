# security-audit run-1 · Phase 2（獵洞）—— **單線編制**

- **窗**：E（安全稽核）　**日期**：2026-08-16　**目標**：`pcm-website-v2`（分支 `dev` 的工作樹）
- **上游**：Phase 1 產物 `docs/security/2026-08-16-security-audit-run1-phase1-architecture.md`
- **DB 層**：**不重做**。已於 `docs/security/2026-08-16-external-exposure-audit.md` 對正式庫實測過。

> 🔴 **日期更正（留痕，不消滅）**：本檔與稽核總結檔今天一度全部寫成 `2026-08-17`。
> **那不是筆誤，是 E 窗這個 session 的時鐘快了約 8 小時**（`E-691-STOP` 自述 `03:50`，
> 真值是 `2026-08-16 19:32 CST`）。三源一致：`date`、`git log --date` 的 commit 時間、session 環境宣告。
> **兩檔共 15 處已改正**；本檔原名 `2026-08-17-…-phase2-hunt.md`，同時更名。
> ⚠️ `~/pcm-mailbox/` 的信**不回改**（已投遞）⇒ 循信中日期找 repo 檔案時要自行 −1 天。
> 📎 這是 I 窗更正 Phase 1 檔名時發現的；**我自己的每一封信都帶著那個偏移，而我一次都沒察覺** ——
> **時間戳是最不會被複核的字面，因為它每次看起來都「合理」。**

---

## 0. 🔴 先講編制降級（**不要讀成「Phase 2 完成」**）

`security-audit` skill 的 Phase 2 規定：**多個 subagent 平行獵，各自獨立、互不知道對方找到什麼**。
**本輪沒有那樣跑。** 這個 session 被 harness 層明文禁止呼叫 Agent 工具
（不是同儕窗能授權的事，也不是我判斷要省），**所以是我一個人單線跑完。**

| | skill 規定 | 本輪實際 |
|---|---|---|
| 攻擊面分工 | N 個 agent 平行 | **1 個（我）循序** |
| 觀點獨立性 | 各 agent 互相看不到 | **零獨立性**：同一個腦、同一組先驗 |
| Phase 3 對抗驗證 | 獨立 agent 反駁每條 finding | **未跑** |
| Phase 6 獨立覆核 | 獨立 agent 逐條查證 | **未跑** |

⇒ **正確說法：「以單線編制完成 Phase 2，平行度未達 skill 規定；Phase 3 與 Phase 6 未跑。」**
🔴 **這句不要軟化成「Phase 2 已完成」。**
**單線最會漏的正是「我沒想到要找的那一類」** —— 平行編制的價值就在那裡，而本輪沒有。

---

## 1. 結論摘要

**沒有找到可外部利用的漏洞。** 找到 **2 條依賴鏈項目**、**1 條可觀測性缺口**、與 **1 條先前已知**，其餘**查過、乾淨**。

| # | 項目 | 嚴重度 | 可外部利用？ |
|---|---|---|---|
| **P2-1** | `xlsx@0.18.5` 在 `package.json`，**零程式碼引用**，帶 **2 個 HIGH 且官方無修補版** | **中（前瞻性）** | ❌ 今天不可 —— **沒有任何程式碼載入它** |
| **P2-2** | `sharp@0.34.5` libvips 4 個 CVE | 低 | ❌ **web runtime 完全碰不到**（見下） |
| P2-3 | `shipment-actions.ts` 4 支 action 無授權閘 | 低（稽核歸屬，非存取控制） | ❌ 已由 Phase 1 界定 |
| **P2-4** | 🔴 **出貨線五支 RPC 零 `admin_audit_log` 留痕**，而呼叫它們的正是 P2-3 那個無閘的檔 ⇒ **兩層都沒有留痕**（隔壁七條業務線都有） | **中（可觀測性，非存取控制）** | ❌ 外部呼不到（`admin_*` 28 支對 anon／authenticated 皆 0） —— **但「帳號被盜／誤操作」查不出是誰** |

**其餘 dev 工具鏈的 11 個 high／moderate（`vite`／`esbuild`／`turbo`／`@babel/core`／`brace-expansion`／`ws`）
不列為 finding** —— 它們不在 production runtime 裡。
📎 依 skill 原則：**縱深防禦缺口不是漏洞，不要為了讓報告看起來厚而灌 LOW。**

---

## 2. Finding 詳述

### P2-1 `xlsx@0.18.5` —— 未使用的依賴，帶**沒有修補版**的 HIGH

```
package.json:46    "xlsx": "^0.18.5"

pnpm audit:
  HIGH  Prototype Pollution in sheetJS       vulnerable <0.19.3   patched: 無
  HIGH  SheetJS ReDoS                        vulnerable <0.20.2   patched: 無
```

🔴 **`patched` 欄是空的 —— 這兩條在 npm 上沒有可升級的修補版本。**

**可達性 —— 🔴 這個 `0` 是要拿來做決定的，所以附完整分母與對照：**

```
分母（掃了幾個檔）：
  find apps packages scripts -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \
       -o -name '*.mjs' -o -name '*.cjs' \) | grep -v node_modules | wc -l
  ⇒ 1659 個原始碼檔

pattern（不分大小寫、不限 import 寫法，連字串提及都算）：
  … | xargs grep -lni 'xlsx' | wc -l
  ⇒ 【0】個檔
```

**🔴 正向對照（同一條命令、同一組檔案，換成確實有被 import 的套件）**：

| 套件 | 命中檔數 | 說明 |
|---|---|---|
| `zod` | **35** | ✅ pattern 是活的 |
| `sharp` | **8** | ✅ pattern 是活的 |
| **`xlsx`** | **0** | ← 本條 |
| `papaparse` | 0 | 同型：也宣告了但零引用（**無 advisory**，只是死依賴、不是 finding） |

**全 repo（含 `docs/`）不分大小寫掃 `xlsx` 命中 87 處**：`package.json` 宣告 1 處 + `docs/specs` 文字討論 86 處。
**程式碼載入：0。**

⇒ **今天不可利用：1659 個原始碼檔裡沒有任何一個提到它。**
⚠️ **這個數字能撐住的只有「今天不可利用」** —— 它**不**說明「移除之後不會壞」，
但 `0/1659` 加上兩個正向對照，已足以支撐「移除的風險是零」這個決定。

**為什麼還是要報**：`docs/specs/2026-08-14-supplier-excel-import-recon.md` 顯示
**「供應商 Excel 匯入」是規劃中的功能**。那條路一旦開通，就是
**拿一個原型污染 + 無修補版的解析器，去吃外部供應商送來的檔案**。

**建議**：**現在就把 `xlsx` 從 `package.json` 移除**（它沒被用到，移除零風險），
**兩個 HIGH 當場歸零**；真要做 Excel 匯入時再挑一個有在維護的解析器。
⚠️ 動 `package.json` = 鐵則 12 ④ ⇒ **我唯讀，只提。**

### P2-2 `sharp@0.34.5` —— **web runtime 碰不到**

```
HIGH  sharp inherited libvips CVE-2026-33327 / 33328 / 35590 / 35591   patched: >=0.35.0
```

**可達性（兩條獨立證據）**：

```
1. apps/storefront/next.config.ts 全文 9 行，nextConfig = {} ⇒ 沒有 images 設定
   ⇒ remotePatterns 為空 ⇒ next/image 的優化器【不接受任何遠端來源】
2. grep -rn "from 'next/image'" apps/storefront/src apps/admin/src → 【0】
   ⇒ 連本地圖片都沒有走優化器
```

⇒ **`sharp` 在 web 請求路徑上根本不會被載入。**
唯一真的餵 bytes 給它的是 `scripts/image-trim-scan.ts`
（**抓供應商 CDN 的圖 → `sharp` 量測**）＋ 一支測試。

⇒ **嚴重度低**：要利用得先讓一個供應商在自家 CDN 放惡意圖片，**再等有人手動跑那支腳本**。
**建議**：升到 `>=0.35.0`（無 breaking，且那支腳本本來就在吃外部 bytes）。

---

## 3. 查過、乾淨的（**這一節與 finding 一樣重要**）

### 3.1 前端 XSS —— **四個注入點逐一開檔看過，全部安全**

| 位置 | 內容 | 判讀 |
|---|---|---|
| `apps/storefront/src/app/layout.tsx:107` | `serializeOrganizationJsonLd()` | ✅ 走 `safeJsonLd` |
| `apps/storefront/src/app/products/[slug]/page.tsx:162` | `serializeProductJsonLd(...)` | ✅ 走 `safeJsonLd` |
| `apps/storefront/src/components/ProductFAQ.tsx:110` | `safeJsonLd(FAQ_JSONLD)` | ✅ 常數 + 走 helper |
| `apps/storefront/src/components/account/AccountView.tsx:196` | `t.path` | ✅ 本檔 `const NAV`、**7 筆寫死 SVG path**，無外部輸入 |

**`safeJsonLd`（`apps/storefront/src/lib/json-ld.ts:17`）**：
`JSON.stringify(obj).replace(/</g, '\\u003c')` —— **每個 `<` 都被 escape** ⇒ `</script>` breakout 不成立。
🔴 **而且三個 JSON-LD 注入點【共用同一支 helper】** ⇒ 不會出現「A 有 escape、B 忘了」的分歧
（檔頭註解說明這正是 2026-06-05 稽核發現 `ProductFAQ` 漏掉後抽出來的）。

**手寫白名單解析器 `apps/storefront/src/lib/brand-rich-text.ts`** —— 這是最像會出事的地方，**它沒有**：
- 只認 `<br>`、成對 `<strong>`、5 個具名 entity；**其餘一律當純文字**
- 產出是 `{kind, text}` 的**扁平節點**，**完全沒有屬性** ⇒ **沒有 `href`／`src` 這種 sink**
  ⇒ `javascript:` URL 這條路**在型別上就不存在**
- 渲染端 `BrandRichText.tsx:36-38` 只做 `<strong>{node.text}</strong>` / `<Fragment>{node.text}</Fragment>`
  ⇒ **React 預設 escape**
- entity 解碼用**單次** regex（`:34-36` 註解明寫理由）⇒ **不會 double-decode**
  （`&amp;lt;` 不會兩跳變成 `<`）

⇒ **即使日後接了後台 CRUD（backlog #271）讓人編輯這些欄位，`<script>` 的結果是「螢幕上看得到那串字」。**

**未涵蓋**：`markdown`／`marked`／`remark`／`rehype`／`showdown` **零依賴**（Phase 1 量過）⇒ 無 markdown 渲染路徑。

### 3.2 Server Action 授權 —— **28 個檔逐檔建矩陣**

跑法：對每個含 `'use server'` 的 `apps/admin/src/lib/**` 檔，數 `authorizeAdminMutation` 出現次數
與 `export async function` 數，逐檔比對。

**結果：23 個檔全部有閘。兩個沒有：**

| 檔 | action 數 | 判讀 |
|---|---|---|
| `shipping/shipment-actions.ts` | 4 | **P2-3，Phase 1 已界定**（`E690-1`，殘留是稽核歸屬非存取控制） |
| `session/actor-actions.ts` | 1 | ✅ **設計如此**：只寫 actor cookie，而 `session/actor.ts:6-7` 明寫 actor **不是**授權邊界；非名單 id fail-closed（`:25` 直接 return） |

### 3.3 🔴 我提出的一條攻擊鏈 —— **被實測推翻**

**假設**：`proxy.ts:12` 的 `SSO_OPEN_PATHS` 讓兩條路徑**不驗 session**。
Next.js 的 Server Action 是「POST 到目前頁面網址 + `Next-Action` header」派送的。
⇒ **那能不能 POST 一個 Server Action 到 `/api/sso/start`，藉白名單繞過整個登入閘？**

**查證**：

```
apps/admin/src/app/api/sso/start/    → route.ts
apps/admin/src/app/api/sso/callback/ → route.ts
```

**兩條都是 Route Handler，不是 page。** Server Action 的派送發生在 app-render 管線，
Route Handler 走的是另一條 ⇒ `Next-Action` header 在那裡不會被解讀。

⇒ **這條鏈不成立。** 留檔的理由：**下一個人會再想到它一次**，而白名單放行 + action 派送
這個組合在別的 Next 專案裡**是**真洞 —— 這裡不是，靠的是那兩條剛好是 Route Handler。
🔴 **也就是說：如果哪天有人把 SSO 入口改成 page，這條鏈就會活過來，而不會有任何東西紅。**

### 3.4 Open redirect —— 兩支 sanitizer + 全部呼叫點

| sanitizer | 規則 | 判讀 |
|---|---|---|
| `apps/storefront/src/lib/auth/safe-redirect.ts:33` | 必須 `/` 開頭；擋 `//`、`/\`；擋所有 `charCode <= 0x20`、`0x7f`、反斜線 | ✅ |
| `apps/admin/src/lib/sso/state.ts:36` | `/^\/(?![/\\])[A-Za-z0-9/_-]*$/` + 長度 512 + 擋 `/api/sso/*` 迴圈 | ✅ 更嚴（連 query 都不准） |

**呼叫點全查**：storefront 三處 `redirect(sanitizeNextParam(next))`；
LINE callback 走單一 `resolveDestination` 回相對路徑；
LINE start 導的是 **env 組出的 LINE 絕對 URL、非請求輸入**。
admin 的 `redirect(returnTo…)` 共 5 處，`returnTo` 全部先過
`parseCustomersReturnTo` / `parseOrderReturnTo`
（`keyword-search-action.ts:48-50`：必須**恰等於** `/customers` 或以 `/customers?` 開頭）。

⇒ **沒有 open redirect。** 附帶：`keyword-search-action.ts:45-54` 的註解顯示作者**已經想過**
控制字元進 `Location` header 與 **PII 進瀏覽歷史／access log／Referer** 這兩件事。

### 3.5 其他 sink（Phase 1 盤點，本輪未加深）

`eval`／`new Function`／shell exec／檔案上傳／裸 SQL 字串組裝：**全部零命中**。
⚠️ **這是盤點不是獵** —— 本輪把力氣放在 XSS、Server Action、redirect、依賴鏈四條，
**這一格維持 Phase 1 的結論，沒有獨立覆核過。**

---

## 4. 🔴 本輪【沒有】做的

| 沒做 | 為什麼 |
|---|---|
| **Phase 3（對抗驗證）** | 需要獨立 agent 反駁每條 finding。**沒跑** ⇒ 上面每條都只有**我一個人**的判斷 |
| **Phase 6（獨立覆核）** | 同上 |
| **業務邏輯／狀態機攻擊**（order／payment／refund／shipment） | **完全沒碰。** 這是 owner 明列的第 4 優先，也是單線編制最貴的一塊 |
| **跨層鏈** | 只試了 3.3 那一條，且被推翻。**沒有系統性地找** |
| Edge Functions | 未查 |
| 動態驗證 | 全程唯讀、沒有起服務、沒有發任何請求到本專案的 web 層 |

⚠️ **`.env*` 內容全程未讀**（house rule）。只確認過**有沒有被 git 追蹤**。

---

## 5. 續輪：業務邏輯／狀態機（order／payment／refund／shipment）

> §4 把這塊列為「完全沒碰、缺口最大」。**這一節把它補上了**，同樣**單線編制**。
> 範圍：**外部打得到的路徑**。內部員工不分權是刻意的（威脅模型），不報。

### 5.1 🟢 最強的一條：`payment_confirmer` 這個角色**讀不到任何一列客戶資料**

金流狀態機不是跑在 `service_role` 上，而是跑在一個**專用的窄權登入角色** `payment_confirmer`
（`packages/adapters/src/payment/PgPollSettleThrottleAdapter.ts:8`）。**我去量了它到底能做什麼：**

```
rolcanlogin=t  rolsuper=f  rolbypassrls=f  rolcreaterole=f

public schema 55 個關聯 ×  SELECT / INSERT / UPDATE / DELETE / TRUNCATE
  ⇒ 五項全部 granted = 0 / 55
```

⇒ 🔴 **它一張表都讀不到。** 它只能 `EXECUTE` 那 24 支金流 SECDEF 函式。

**對威脅模型的意義**：**那把憑證外流，拿到的人一列客戶資料都讀不到。**
損害面是「可以亂動付款狀態」（詐欺），**不是「可以把客戶資料撈走」**（Sean 唯一擔心的那件）。

**這個好狀態是【被守住的】還是【碰巧的】？—— 兩者都有，分開講：**
- **被守住的**：`20260811060000_…:363-374` 連**誰可以成為 `payment_confirmer` 的成員**都斷言了
  （防「某角色繼承它 ⇒ 間接呼得到那些 RPC」）；`20260624120003_…:129-144` 對異常表明文
  `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role, payment_confirmer` 並斷言 4 角色 7 權限全 false。
- **碰巧的那半（誠實講）**：**沒有任何一條斷言寫著「`payment_confirmer` 對整個 `public` 必須零表授權」。**
  `0/55` 成立是因為 **ADP 那份預設授權的名單裡沒有它**（只有 `anon`／`authenticated`／`service_role`，§7c-2 量過）。
  ⇒ **哪天有人手寫一句 `GRANT SELECT … TO payment_confirmer`，不會有任何東西紅。**
  📎 這正是 A2 那類機制的價值：**現在乾淨靠的是每個人都記得。**

### 5.2 🟢 無簽章的 TapPay webhook —— **補償設計是真的成立的**

`apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts` 沒有簽章驗證
（TapPay 官方不提供），只有**祕密路徑段 + `timingSafeEqual` + 不符回 404 不揭存在**。

**真正扛住它的不是那個祕密，是「notify 說什麼一律不採信」。我去驗這句是不是真的：**

```
pattern: grep -rn 'reportedStatus|reported_status' packages/use-cases/src packages/adapters/src
命中：packages/adapters/src/payment/PgWebhookInboxAdapter.ts:58   ← 只有【寫進 inbox】這一處
      + database.types.ts 的型別宣告
packages/use-cases 內讀取 reportedStatus 的地方：【0】
```

⇒ **webhook 自稱的 `status` / `amount` 只被存檔，從來沒有被任何判斷讀過。**
`settleCharge` 只收 `{ orderId }`（`route.ts:191`），成交權威 100% 是回打 TapPay Record API
（`packages/use-cases/src/settle-charge.ts:255` 起：`record_status ∈ {0 AUTH, 1 OK}` + 識別 + 金額 + 幣別）。

⇒ **就算祕密路徑外流，偽造的 notify 也只能【觸發一次對 TapPay 的重新查證】，無法讓任何訂單變成已付款。**

### 5.3 🔴 第一次列出「任何已登入客人」打得到的 RPC 面

先前每一輪都只量 `anon`。**登入後的面沒有人列過。** 這次列了：**`authenticated` 可 EXECUTE 的 15 支**。

| 類別 | 支數 | 可否被 PostgREST 當 RPC 呼叫 |
|---|---|---|
| 回傳 `trigger` | **8** | ❌ PostgREST 不發布 trigger 函式 |
| `STABLE`／`IMMUTABLE`（型錄查詢） | **4** | ✅ 但**寫不了東西** |
| **`VOLATILE` + `SECURITY DEFINER`（會寫）** | **3** | ✅ ← **真正的攻擊面就這三支** |

**那三支逐支開檔讀守門**：

| 函式 | 歸屬綁定 | 判讀 |
|---|---|---|
| `create_order(…)` | 身分／算價全部 server 權威，**client 永不送價**（`charge-actions.ts:245,272`：金額 = server read-back `orders.total` 單一來源） | ✅ |
| `find_active_sibling_own(p_cart_session_id uuid)` | `WHERE o.customer_user_id = v_uid`，`v_uid := auth.uid()`；`auth.uid()` 為 NULL → 一律回 `none`；回傳**不含** rec／bank（資料最小化） | ✅ **不是 IDOR** |
| `mark_charge_attempt_charged_fallback(attempt, order, rec, token)` | **三道**：① `fallback_token` hash 比對（server 發、明文只在記憶體）② `auth.uid() <> customer_user_id` → 拒 ③ 僅 `pending→charged`、`superseded` 一律拒 | ✅ |

🔴 **第三支是我這輪最想打穿的一支**（名字直譯是「把這筆刷卡標成已收款」，而且**任何登入客人都呼得到**）。
**打不穿**：光有 `attempt_id` 與 `order_id` 沒用，還要**同時**握有 server 發的 token **並且本人就是單主**。
而且它只改 `payment_charge_attempts`，**沒有碰 `orders.payment_status`** ——
真正入帳仍要走 `settleCharge` 的 Record API 查證（§5.2）。
📌 它的錯誤訊息**全部是同一句通用字串**（原始碼標為 `PF-E`）⇒ **「token 錯」與「不是你的單」對外不可區分**，
無法拿它當帳號／訂單存在性的 oracle。

### 5.4 本節**沒有**涵蓋的（缺口誠實列出）

| 沒查 | 為什麼 |
|---|---|
| **退款狀態機**（`refund-actions` / `refund-recovery-actions` / `refund_ledger`） | 只確認過它們**有**授權閘（§3.2 矩陣），**沒有讀狀態轉換邏輯** |
| **出貨／到貨狀態機**（`shipment` / `receipt` / `procurement`） | 同上。且 `shipment-actions.ts` 正是唯一無閘那支（P2-3） |
| **取消／部分取消**（`a8c1` / `a8c2` / `admin_cancel_order` / 部分取消） | 完全沒讀 |
| 「第二條路走到同一個狀態」的系統性盤點 | **只在本節三支上問過這個問題，沒有對全狀態機做過** |
| 併發／race（同一單兩個 attempt、雙擊、sweeper 與 webhook 撞） | 沒設計任何測試去撞它 |

⚠️ **上面四條全部是【管理端】路徑** —— 依威脅模型優先度較低（外部打不到），
**但「外部打不到」這句本身，我這輪只對 §5.3 那三支真的驗過。**

---

## 6. 續輪二：退款／出貨／取消狀態機 —— **鏡頭放寬到「拿到員工帳號的人」**

> 主視窗 2026-08-16 指示：後台正要開給員工用，**「內部人員誤操作／帳號被盜」的重要性正在上升**
> ⇒ 這一輪不只用「外部攻擊者」的鏡頭。

### 6.1 先把外部那一半關掉（**一句查詢，決定後面要不要用外部鏡頭看**）

```
public 裡 admin_* 開頭的函式：28 支
  anon         可 EXECUTE：0 / 28
  authenticated 可 EXECUTE：0 / 28
  service_role 可 EXECUTE：27 / 28
```

⇒ **沒有任何外部身分（未登入訪客、任何已登入客人）呼得到任何一支後台 RPC。**
**⇒ 整個後台狀態機在「外部攻擊者」這個鏡頭下是關的。** 後面全部改用內部鏡頭。

📌 那 **1 支不給 `service_role`** 的是 `admin_update_order_item_workflow`
（`proacl = {postgres=X/postgres}`，**只有 owner**）—— 我**沒有查它現在由誰呼叫**，標**未確認**。
（列出來的理由：一個沒解釋的「27／28」會讓下一個人以為有東西壞了。）

### 6.2 🔴 本輪最實質的一條：**出貨線兩層都沒有留痕**

**方法**：對 13 支會動錢／動狀態的 `admin_*` RPC，逐支找出**定義它的那支 migration**，
數該檔內 `admin_audit_log` 的出現次數。

| RPC | 同交易寫 `admin_audit_log`？ |
|---|---|
| `admin_record_manual_payment` / `admin_reverse_manual_payment` | ✅ |
| `admin_cancel_order` | ✅ |
| `admin_adjust_wallet`（**控制組**：同一量法命中 5 次） | ✅ |
| `admin_set_customer_tier` | ✅ |
| `admin_record_item_receipt` / `admin_delete_item_receipt` | ✅ |
| `admin_update_order_workflow` | ✅ |
| 🔴 `admin_create_shipment` | **0** |
| 🔴 `admin_add_shipment_items` | **0** |
| 🔴 `admin_mark_shipment_shipped` | **0** |
| 🔴 `admin_void_shipment` | **0** |
| 🔴 `admin_unvoid_shipment` | **0** |

**零命中是量過的，不是沒找到**：`grep -c 'admin_audit_log' <定義檔>` **整檔** = 0；
同一條命令對 `admin_adjust_wallet` 的定義檔回 **5** ⇒ **量法是活的**。
另查「有沒有別支 migration 幫出貨補寫稽核列」⇒ 命中的全是**改單／發票**那條線，**沒有出貨**。

#### 🔴 而這五支，正是那個**沒有授權閘**的檔在呼叫的

`apps/admin/src/lib/shipping/shipment-actions.ts` = §3.2 矩陣裡**唯一**沒有
`authorizeAdminMutation` 的業務檔（P2-3 / `E690-1`）。

⇒ **兩個缺口落在同一條線上：**

| 層 | 其他業務線 | **出貨線** |
|---|---|---|
| 應用層具名 actor 綁定 | ✅ `authorizeAdminMutation` | ❌ **無** |
| DB 層同交易稽核列 | ✅ `admin_audit_log` | ❌ **無** |

**⇒ 出貨線是唯一一條【兩層都沒有留痕】的路徑。**

**這【不是】權限漏洞，不要抬高**：
- 存取控制**沒有**失守 —— `proxy.ts` 仍然擋未登入（§3.2、§3.3 已驗），外部呼不到（§6.1）
- 它**不讓任何人做到原本做不到的事**

**它拿走的是【事後查得出來】這件事。** 在「帳號被盜／誤操作」的鏡頭下，
**「誰把那筆出貨作廢的」這個問題，今天沒有任何地方答得出來** ——
而隔壁每一條線（收款、退款、取消、儲值金、等級、到貨）都答得出來。

📌 P2-3 先前被界定為「殘留是稽核歸屬」。**這一輪把那句話的代價量出來了**：
所謂「稽核歸屬」，具體就是**這五支動作在系統裡不存在任何紀錄**。

### 6.3 「第二條路走到同一個狀態」—— 這一輪做了什麼、**沒**做什麼

✅ **做了**：出貨狀態有成對的正／反操作（`void` / `unvoid`、`create` / `add_items`），
**兩個方向都沒有稽核列** ⇒ **反向操作不會留下「曾經被反向過」的痕跡**。
（同族形狀＝主視窗提示的「禁了 DELETE 卻給了 UPDATE」：**擋住一個方向，另一個方向敞著**。
這裡不是權限敞著，是**紀錄兩邊都空著**。）

✅ **後來補做了**：退款／取消的轉移邏輯本體、以及併發 —— **見 §6.5**。
（本節原文寫「一條都沒驗過」，那在寫下的當下為真；§6.5 是同一輪稍後補的，**殘餘缺口見 §6.5(d)**。）

### 6.5 不變量與併發 —— **三條都去讀了轉移邏輯本體**（補 §6.3 標的缺口）

#### (a) 「取消後不能再出貨」—— 🔴 **我的假設被推翻，而推翻它的話寫在原始碼註解裡**

我先量到三支出貨 RPC **零次**提到 `cancel` / `workflow_status`，
且兩支取消 migration **零次**提到 `shipment`（兩邊都用控制組確認過量法是活的）
⇒ 當下看起來就是「**取消與出貨互不知道對方存在**」。

**然後我去開了候選清單那支檔，`shipment-candidates.ts:41` 逐字寫著：**

> `// 🔴 **`cancelled` 是被刻意拿掉的,不是漏掉 —— 不要「順手」加回來**。`

**真正的機制是【兩道守門相乘】，靠算術不靠狀態旗標：**

```
出貨側可出量 ＝ instock − shipped − 已裝箱未出        （不含 cancelled）
取消側可取消量 ＝ quantity − instock − cancelled      （20260805100000:395-406）
                              ↑
                  已到貨的件【永遠取消不掉】
```

⇒ **取消過的件不可能到過貨 ⇒ 不可能進到「可出量」⇒ 不可能被出貨。不變量成立。**

🔴 **留給下一個人的比結論值錢**：
**我又一次重新推導出一個「原始碼已經明文警告過」的假設** —— 與本輪 C 案同一形狀
（那次是 migration 註解，這次是 TS 註解）。
**兩次都是：grep 找到了「沒有」，而「為什麼沒有」寫在旁邊那個檔裡。**
📎 `feedback_assert-scope-only-after-reading-source-file`。

#### (b) 併發：同時掛品項會不會超量裝箱 —— **有鎖，而且鎖對地方**

```sql
PERFORM 1 FROM public.order_items oi
 WHERE oi.id IN (…本次要掛的品項…)
 ORDER BY oi.id            -- 🔴 定序取鎖 ⇒ 兩個併發呼叫不會互相卡死
   FOR NO KEY UPDATE;      -- 🔴 不用 FOR UPDATE：與 FK 的 KEY SHARE 實測死結 40P01
```

**鎖在「可出量」那段聚合【之前】**，且鎖的是 `order_items`（**兩個併發呼叫必然爭同一批列**）
⇒ 第二個交易會等第一個 commit，之後在 READ COMMITTED 下**重讀**，看得到第一個寫進去的箱。
⇒ **「兩個人同時各掛 3 件、instock 只有 5」這個經典 race 是關著的。**
另有死結重試 3 次 + 寫入列數核對（`實際寫入 N 筆 ≠ 清單 N 筆 ⇒ 整筆取消，不留半箱`）。

**🔴 上面那段原本只是「讀 code 推論」。我把那個機制抽出來實跑了一次（拋棄式 PG 17.10）：**

```
情境：instock = 5，兩個併發交易，各自「先讀可出量、再掛 3 件」

  負向對照（不加鎖）                      → 總共掛了 6 件   ← 超量，race 是真的
  真實形狀（聚合【之前】FOR NO KEY UPDATE）→ 總共掛了 3 件   ← 第二個交易正確拒絕
```

🔴 **第一版測試的負向對照【沒有紅】**（兩邊都回 3）—— 因為我讓兩個交易差 0.5 秒起跑，
第二個的 `INSERT` 剛好在第一個 commit **之後**才開始，READ COMMITTED 下它看得到 ⇒ **意外地被序列化了**。
**那一版測試對這個 race 零判別力，而它的輸出長得像「安全」。**
改成「**先把可出量讀進暫存、隔一段時間再寫**」之後對照才紅。
📎 **控制組沒紅的那一輪要整輪丟掉，不能當成通過** —— `feedback_absence-read-as-verified`。

⚠️ **這證的是【機制】，不是【他們那支函式】**：我測的是「聚合前取列鎖」這個形狀本身，
**沒有**搬他們的 schema 來跑。⇒ 它撐得住「這個鎖擋得住這類 race」，
**撐不住「他們函式裡每一條路徑都取到了那個鎖」**（後者我是讀 code 判斷的）。

📌 同段註解記錄了**跨模型審查（Fable）在這裡抓到的兩條 HIGH，而【兩條都不是併發問題】**
（惰性建列 ⇒ 首版 `INNER JOIN` 讓「可出 0 件」的品項靜默放行；跨呼叫累加沒被算進去）。
🔴 還記了一個假綠：**plpgsql 惰性編譯 ⇒ 欄名寫錯時「語法」那格照樣綠，要真的呼叫才炸。**

#### (c) 「退款不能重複發生」—— 🔴🔴 **我驗錯了表。先讀這個框。**

> **2026-08-16 自我更正（原文保留在下方，因為它對【那張表】仍然全部為真）**
>
> 我拿 `payment_refunds` / `payment_refund_events` 當「退款帳本」驗了它的不變量。
> **那兩張表【還沒有任何 writer】。**
>
> `20260812170000_…_initiate_advisory.sql:39` **作者逐字寫著**：
> > `-- 1. 否決條件**現在恆假** —— payment_refunds 尚無 writer(2g 未建)⇒ apply 後行為零變化。`
>
> ⇒ **活的退款表是 `order_refunds`**（活的 RPC = `admin_initiate_order_refund`，
> 前置閘釘的是 `order_refunds_status_check`）。
> **`payment_refunds` 是為了「2g」那片預先建好的新帳本，目前空著。**
>
> **⇒ 下方 (c) 驗的那些守門【是真的、也很好】，但它們現在【沒有在保護任何一筆實際退款】。**
> **⇒ 而 `order_refunds` 的不變量，我【一條都沒驗過】。**
>
> ⚠️ 我**沒有**量到列數（稽核帳號無資料讀取權；`reltuples = -1` 只代表沒統計資訊，**不是**空表的證據）
> ⇒ 「空著」這件事我引的是**作者的註解**，不是我自己的量測。
>
> 🔴 **這是今天第三次同一形狀**：C 案（migration 註解）、取消/出貨（TS 註解）、本條（migration 註解）——
> **三次都是我先用 grep 得出一個結構性結論，而真正的答案寫在旁邊那個檔的註解裡。**
> **判別句：我斷言一張表的行為之前，有沒有先確認【有沒有人在寫它】？**

#### (c-原文) 對 `payment_refunds` 而言，下面全部成立 —— append-only + 防環，且它是全 repo 唯一防 `TRUNCATE` 的地方

`payment_refunds` / `payment_refund_events`：

- **4 個 append-only trigger**（`BEFORE UPDATE OR DELETE` 各一 + 🔴 **`BEFORE TRUNCATE` 各一**）
- **`pr_no_cycle` `BEFORE INSERT` 前手可見守門**（SQLSTATE `P5B02`）
- 尾段斷言驗「append-only trigger 恰 4 個且皆 enabled」「防環 trigger 恰 1 個且 enabled」
- 一列 = 一次物理退款嘗試 = **一把冪等鍵**（對齊 TapPay 退款鍵**恆久消耗、絕不重用**的既有實測）

🔴 **兩件特別值得記：**
1. **那個 `BEFORE TRUNCATE` 是我今天在全 repo 看到【唯一】一處有人專門防 `TRUNCATE` 的地方。**
   而 `TRUNCATE` 正是本輪在別處反覆量到會被漏掉的那一項（Dashboard 開關留著它、
   「只想到 CRUD 四個字」）。**這裡有人想到了。**
2. 該檔檔頭**記錄了作者推翻自己前一版的宣稱**：
   「構造上即 DAG、不需要防環守門」**已證為假、已刪** ——
   因為 **FK 是語句末檢查，單一 statement 內多列互指插得進去**。
   ⇒ **加了 `BEFORE INSERT` 守門之後，DAG 才真的成立。**

#### (c2) 退款金額不變量（`累計退款 ≤ 已收款`）—— **靠 RPC，不靠 schema**

**schema 層【沒有】天花板。** `payment_refunds` 的 CHECK 只有：
`amount > 0`、`currency = 'TWD'`、`lease_token >= 0`、`supersedes_refund_id <> id`、
`idempotency_key` 形狀、`strong_key` 非空。**沒有任何一條把退款總額綁到已收款。**

**天花板在 `initiate` 那支 RPC 裡**：真實退款路徑拿到的是 RPC 回的
`blocked_by ∈ {amount, in_flight, unknown}`（`refund-actions.ts:49-53`），
`amount` 那一格就是「退太多」。
⚠️ **我沒有讀那支 RPC 的累加算術** ⇒ **「第 N 次部分退款仍成立」我沒有驗過，標未確認。**

🔴 **順帶查到一件（不是漏洞，是維護風險）**：
`packages/domain/src/order/refund.ts:193` 的 `computeRefundQuote`
（品項級的退款額度計算，含 `quantity_exceeds_remaining` 守門、有自己的測試、
且從 `packages/domain/src/index.ts:95` 對外導出）——
**全 repo 零呼叫點**（控制組：同檔的 `refundItems` 命中 10 個檔 ⇒ 量法是活的）。

⇒ **同一個「不能退超過」的規則有兩套實作：RPC 那套是活的，domain 這套沒有人用。**
**不是安全洞**（活路徑有守門），但**兩套會各自演化**，
而 domain 那套有測試、看起來很正式 ⇒ **下一個人很可能以為它是權威。**

#### (c3) 那幾道守門有沒有對誰豁免？—— **沒有**（⚠️ 同樣是 `payment_refunds`，見 (c) 的更正框）

問題來自「**豁免誰，就對誰盲**」。逐條看：

- 五個 trigger **都沒有 `WHEN` 子句**，沒有任何角色豁免。
- 🔴 而且作者**明文寫出了為什麼用 trigger 而不是 ACL**（`:162` COMMENT 逐字）：
  > 「**ACL 只擋非 owner，唯一寫入者是 SECDEF RPC（owner）；trigger 對 owner 照樣觸發。**」
  ⇒ **這正是「豁免誰就對誰盲」的正解**：ACL 會豁免 owner，而 owner 恰恰是唯一會寫的人。
- 🔴 **天花板也寫出來了**（`:35-36`、`:162`、`:177` 三處逐字）：
  > 「owner/superuser 可 `DISABLE TRIGGER`、`session_replication_role='replica'`、或 DROP 掉本守門
  > —— **不宣稱防得住它們**。」

⇒ **這是我今天讀到最誠實的一段守門說明**：它同時寫了「防得住什麼」與「防不住什麼」，
而不是只寫前者讓讀者自己以為是全稱。

#### (d) 這三條**仍然沒有**涵蓋的

- 🔴 **`order_refunds`（【活的】退款表）的不變量：一條都沒驗過。** 我驗的是還沒接上的 `payment_refunds`（見 (c) 更正框）。
- **退款金額天花板**：已查*在哪*（(c2)：在 RPC 不在 schema），**但那支 RPC 的累加算術我沒讀**
  ⇒ 「第 N 次部分退款仍成立」**未驗**。
  🔴 而且累加**要問「累加的是哪一個集合」**：失敗的／in-flight 的／已 void 的算不算？
  `blocked_by` 有一個 `unknown` 值 ⇒ **不確定的那些算不算進累計，決定它是保守還是漏。**
- **`sweeper` 與 `webhook` 相撞**沒撞過（`claim_*` 系列有 lease，但**我沒讀它的租約邏輯**）。
- 併發只驗了**掛品項**這一條路；**出貨、作廢、取消**三條的併發**沒看**。

### 6.4 建議（**我唯讀，只提**）

1. **給那五支出貨 RPC 補同交易 `admin_audit_log`** —— 與隔壁七支同形狀，不必發明新機制
2. `shipment-actions.ts` 補 `authorizeAdminMutation`（P2-3；補了才有具名 actor 可寫進稽核列）
   —— **兩件要一起做**：只補其一，稽核列會寫進一個「沒有人」
3. 退款／取消不變量與併發，**另開一輪**

---

## 7. 建議的下一步（依價值排序，非承諾）

1. **移除 `xlsx`**（零使用、消掉兩個無修補版 HIGH）—— 最便宜的一件
2. **升 `sharp` 到 `>=0.35.0`**
3. **業務邏輯／狀態機那一塊另開一輪**，且**開平行編制** —— 那是本輪缺口最大的地方
4. Phase 3 對抗驗證：**拿本檔每一條「查過、乾淨」去反駁**，特別是 3.1 與 3.4
   （我是同一個腦寫的假設與結論，**那正是對抗驗證存在的理由**）
