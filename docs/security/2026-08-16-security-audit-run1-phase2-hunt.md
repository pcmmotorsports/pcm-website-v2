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
| P2-3 | `shipment-actions.ts` **5 支** action 無授權閘（原寫 4 支，F6 更正） | 低（稽核歸屬，非存取控制） | ❌ 已由 Phase 1 界定 |
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
⚠️ **這個數字能撐住的只有「今天不可利用」** —— 它**不**說明「移除之後不會壞」。

> 🔴 **F10 更正（措辭自相矛盾）**：原文下一句寫「已足以支撐**移除的風險是零**」，
> 與前一句「**不**說明移除之後不會壞」**互斥**。**「零」是過強的字。**
>
> **正確措辭：`0/1659` 支撐的是「未見任何原始碼使用、移除風險【低】」，不是「零」。**
>
> ⚠️ 而且**分母本身有邊界**：只涵蓋 `.ts/.tsx/.js/.mjs/.cjs`，
> **沒有涵蓋** shell 腳本、Python、`.json` 設定、或 **repo 外的消費者**。
> ⇒ 要說「零風險」，得先把那幾類也掃過。**本輪沒掃。**

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

> # 🔴🔴 F4 更正（V 窗指出，我重量後確認）：**「web runtime 碰不到」是錯的**
>
> **`next/image` 的 import 數【不是】image optimizer 的可達性控制。**
> Next server **本身就掛著 `/_next/image` 端點**，與有沒有人寫 `<Image>` 無關。
>
> 而 `next.config.ts` 是**全空的 `{}`**（無 `images` 設定，實測 `grep -c images` = **0**）
> ⇒ **本地路徑預設全部允許**；`apps/storefront/public/` 有 **269 個圖檔**（實測）
> ⇒ 外部只要打 `GET /_next/image?url=/<某圖>&w=..&q=..`，
> **web runtime 就會 `require('sharp')` 並把 bytes 餵進去。**
>
> ⇒ **我用「`<Image>` 引用數 = 0」推「sharp 不會被載入」是錯的推論** ——
> **我量的是【誰在用它】，而要問的是【誰打得到它】。**
>
> ## ✅ 但可利用性**沒有**改變，仍然低
>
> libvips 那幾個 CVE 要**惡意 bytes**。而：
> - 本地圖來自 `public/`（**team 自己 commit 的**，可信）
> - `remotePatterns` 為空 ⇒ **外部無法餵任意遠端 bytes 給 sharp**
>
> ⇒ **可達性 claim 錯（本段已改），嚴重度維持【低】，`>=0.35.0` 的升級建議不變。**

~~⇒ `sharp` 在 web 請求路徑上根本不會被載入。~~
**⇒ 更正後：`sharp` 【會】在 web 請求路徑上被載入（`/_next/image`），
但外部餵不進惡意 bytes（本地圖可信 + 無遠端來源）。**
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

### 3.2 Server Action 授權 —— **19 個指令檔 / 30 支 action 逐一建矩陣**

> # 🔴🔴 F6 更正：本節原本的數字**互相對不上**，已全部重量
>
> 原文寫「**28 個檔**」「23 個檔有閘、2 個沒有」—— **`23 + 2 = 25 ≠ 28`，三個數不自洽。**
> 成因（我自己的診斷）：**那幾個數不是同一次、同一把尺量出來的**，
> 而每一個單看都像真的 ⇒ **合起來才露餡。**
> **而原文沒有寫下「量在哪個 commit、用什麼 pattern」⇒ 下一個人重建不出來。** 這次補上。
>
> ```
> commit  : 37b9b896
> 範圍    : apps/admin/src/lib/**/*.ts
> 判定    : 檔案【第一個非空行】是 'use server' 指令（排除「註解裡提到」的假命中）
> action  : grep -c '^export async function'
> 閘      : grep -c 'authorizeAdminMutation('
> ```
>
> **重量結果（自洽）：**
>
> ```
> 指令檔           = 19
> exported action  = 30
>   有閘檔內       = 24
>   無閘檔內       =  6      ← 24 + 6 = 30 ✅
> 無閘檔           =  2      actor-actions.ts(1 支，設計如此)
>                            shipment-actions.ts(🔴 5 支，不是我原本寫的 4 支)
> ```
>
> ✅ **V 窗獨立列舉也得到 19 個指令檔、shipment 5 支 ⇒ 兩顆腦收斂。**
> ✅ **存取控制結論不變**：無閘的就是那 2 個檔，**沒有漏掉任何一道閘**。**錯的只有數字。**

**結果：17 個檔（24 支 action）全部有閘。兩個檔沒有：**

| 檔 | action 數 | 判讀 |
|---|---|---|
| `shipping/shipment-actions.ts` | **5** | **P2-3，Phase 1 已界定**（`E690-1`，殘留是稽核歸屬非存取控制） |
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

⇒ 🔴 **它一張表都讀不到。** 它只能 `EXECUTE` 那 **23** 支金流 SECDEF 函式。

> # 🔴🔴 F2 更正（V 窗 codex 複驗指出；我獨立覆核後**確認它是對的**）
>
> **下面那句「拿到的人一列客戶資料都讀不到」是【錯的】，已劃掉。**
>
> **`0/55` 只量了【表】這一個面。而 `SECURITY DEFINER` 的存在意義就是【繞過表層權限】** ——
> 我量了表層權限，卻拿它下了關於「這個角色能拿到什麼」的全稱結論，
> **跳過了那些 RPC【回傳什麼】。**
>
> **我自己重量的結果**（production，`pg_get_function_result`）：
>
> ```
> payment_confirmer 可 EXECUTE 的 SECDEF 函式 = 23 支   ← 我原本寫「24 支」，那也是錯的
>   回 void（不吐資料）  =  3 支
>   會回傳資料           = 20 支
> ```
>
> **可構造的鏈**（V 窗提出，我開 migration 覆核過）：
> `claim_due_webhook_events()` → `TABLE(rec_trade_id, order_number, attempt_count)`
> → 拿 `order_number` 餵 `get_active_charge_attempt(orderId)`
> → `rec_trade_id / bank_transaction_id / order_total / order_payment_status / order_display_id`
> （`20260624120007_…` 的 `jsonb_build_object` 逐欄讀過）。
>
> ## ✅ 限定要照帶 —— 不要把這條抬高成 PII 外洩
>
> | | |
> |---|---|
> | **前提** | 必須先有 `payment_confirmer` **憑證外流**（它是 `rolcanlogin = t` 的登入角色） |
> | **拿得到** | 訂單**交易 metadata**：金額、付款狀態、訂單顯示編號、交易碼 |
> | **拿不到** | **姓名／電話／地址／卡號／經銷價** —— 同檔作者逐字：「**只回非 PII 對帳欄（零 token／卡資料／經銷價／customer PII）**」 |
>
> **⇒ 正確口徑（請照這句引用）：**
> > **「撈不到客戶 PII」成立；「一列資料都讀不到」不成立 —— 交易 metadata 經 SECDEF RPC 可達。**
>
> 🔴 **這正是我今晚一整夜在抓的形狀，而我在自己講得最漂亮的那一條上犯了**：
> **量了一個面，下了一個關於全部的結論。**
> **我自己的判別句原封適用：這個結論，如果那個東西根本不從【表】走呢？**
>
> ✅ **2026-08-16 補完：20 支【全部】逐支審過**（原本只讀了 2 支）—— 見下方 §5.1-b。

~~**對威脅模型的意義**：那把憑證外流，拿到的人一列客戶資料都讀不到。~~
**對威脅模型的意義（更正後）**：那把憑證外流，**拿不到客戶 PII，但拿得到訂單交易 metadata**。
損害面是「可以亂動付款狀態」（詐欺）**加上「可以讀到訂單金額／狀態／交易碼」**，
**仍然不是「可以把客戶身分資料撈走」**（Sean 唯一擔心的那件）。

#### 5.1-b F2 完整版：那 20 支會回傳資料的 RPC，**逐支列出回傳欄位**

> **F2 只證明了「有東西會回傳」。而「回傳的是什麼」才決定那把憑證外流的真實損害面** ——
> 那正是威脅模型唯一在意的那件事。所以補完，不留在「未確認」。

**先把可以用型別排除的分掉**（scalar 載不了 PII）：

| 回傳型別 | 支數 | 內容 | PII |
|---|---|---|---|
| `integer` | 6 | 受影響列數／回收筆數 | ❌ 不可能 |
| `boolean` | 5 | 成功與否 | ❌ 不可能 |
| `TABLE(...)` | 3 | 簽章即可見：`attempt_id`／`order_id`／`order_number`／`rec_trade_id`／`attempt_count`／`superseded_at` | ❌ 無 |
| **`jsonb`** | **6** | **要開檔逐支讀 ↓** | — |

**六支 `jsonb` 的回傳鍵（逐支開檔讀 `jsonb_build_object`）：**

| 函式 | 回傳鍵 | 作者自述 |
|---|---|---|
| `confirm_order_payment` | `confirmed` / `idempotent`（**兩個 boolean，就這樣**） | 有 |
| `get_active_charge_attempt` | `attempt_id` `status` `rec_trade_id` `bank_transaction_id` `attempt_created_at` `order_total` `order_payment_status` `order_display_id` | 有（「只回非 PII 對帳欄」） |
| `get_payment_anomaly_alert_summary` | 全部是 `*_count` / `oldest_open_age_seconds`（**純聚合**） | 有 |
| `mark_charge_attempt_released_for_user` | `released` | 無 |
| `supersede_charge_attempt_for_user` | `superseded` / `reason` / `record_not_found` | 無 |
| 🔴 `begin_charge_attempt` | `acquired` `reason` `attempt_id` **`fallback_token`** `existing_order_id` `existing_display_id` `existing_rec_trade_id` `existing_bank_transaction_id` `existing_paid` `in_flight_order_id` | 無 |

### ⇒ 結論：**20 支全部零 PII**

**沒有任何一支回傳姓名／電話／地址／卡號／經銷價。**
⇒ **F2 的限定（「撈不到客戶 PII」）在【逐支審完之後】仍然成立** —— 現在它是普查，不是抽樣。

### 🔴 但補一件 F2 沒問到的：`begin_charge_attempt` 會回 `fallback_token`

那不是 PII，**是一把能力憑證** —— 它正是 `mark_charge_attempt_charged_fallback` 的三道護欄之一。

**為什麼仍然不構成升級**（我開檔確認過）：那支 fallback **另外要求 `auth.uid() = customer_user_id`**
⇒ **光有 `payment_confirmer` 憑證（那是 DB 登入角色、沒有 JWT 身分）拿到 token 也用不了。**
⇒ **兩道護欄不是同一把鑰匙**，這是設計對的地方。
⚠️ **但這是「兩道之一外洩」** ⇒ 記入縱深防禦帳，**不要因為今天用不了就當它不存在**。

### 🔴 誰還能呼叫這 20 支？—— **沒有別人**

```
20 支的 proacl 全部是 {postgres=X/postgres, payment_confirmer=X/postgres}
anon / authenticated / service_role  ⇒  20 支全部 false
```
⇒ **這張風險圖只掛在那一把憑證上**，沒有第二個角色分支。**20 支 ACL 一致、零例外。**

### 關於「作者自述」這一欄（為什麼要列）

6 支裡 **3 支有**意圖自述、**3 支沒有**。
🔴 **重點不是「沒自述就有問題」** —— 而是：**「非 PII」是一個判斷，
別人要能複驗那個判斷，就必須看到欄位名。** 所以上表列的是**欄位**，不是我的結論。
✅ **本輪三支「無自述」的實測結果都沒有超出** ⇒ **沒有出現「宣稱與事實不符」的情況**
（那才是比「沒寫」嚴重的那一種）。

---

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

> 🔴🔴 **F5 更正（V 窗指出，我開檔確認）：承重的是【第三道】，我只列了兩道。**
>
> 上面那兩道只證了**一個方向**：「**已到貨的不能再取消**」。
> **它們沒有證反方向**：「**先取消了，之後不能再到貨**」。
>
> **真正擋反方向的是到貨 writer 那支**：
> `supabase/migrations/20260811010000_m4b_e10_352c_item_level_room_guard.sql`
> —— 它用 `v_room = quantity − cancelled − received` 限制登錄量，
> **且與取消走同一筆 `order_items` 的列鎖 ⇒ 併發登錄會序列化**（我開檔讀過 `v_room` / `v_cancelled` 宣告）。
>
> ⇒ **結論（不變量成立）仍然對，但我列的證據撐不起它，而且漏掉了真正承重的那一道。**
> 🔴 **具體風險**：**有人可能以為第三道是冗餘的而把它移除** ——
> 而移除之後，上面那兩道**照樣成立**，**壞掉的是我沒寫出來的那個方向。**
>
> 🔴 **形狀與 F3 相同**：我找到了兩道真的守門，然後寫成「就這兩道相乘」。**全稱句。**

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
- ✅ **出貨／作廢／取消的併發已補**，見 §6.11（CAS + ROW_COUNT，兩方向同時來會序列化）。
  ⚠️ 該節是**讀 code** 不是實測；併發**實測**過的只有掛品項那條（§6.5(b)）。

### 6.6 🔴 退款：**三套帳本**，先分清哪一套是活的

> **這一節存在的理由**：我在 §6.5(c) 驗錯了表。**分不清三套，就會像我一樣驗到一套沒人用的。**

| # | 帳本 | 狀態 | 誰在寫 |
|---|---|---|---|
| **1** | **`order_refunds` + `order_refund_items`** | 🟢 **活的** | `admin_initiate_order_refund` → `admin_finalize_order_refund`（+ `admin_correct_refund_manual_verdict`） |
| 2 | `payment_refunds` + `payment_refund_events` | ⏸ **還沒出生** | **零 writer**（`…initiate_advisory.sql:39` 逐字：「2g 未建」） |
| 3 | `computeRefundQuote`（`packages/domain/src/order/refund.ts:193`） | 💀 **死的** | **零呼叫點** |

**判別句給下一個人：**
> **你要改退款額度上限？先確認你改的那一套【有沒有人在呼叫】。**

#### 6.6-a 第 3 套（死 code）的量法與分母

```
pattern  : grep -rn 'computeRefundQuote'  （排除 node_modules 與 *.test.ts）
命中     : 只有它自己的定義檔 + packages/domain/src/index.ts:95 的【導出】
呼叫點   : 【0】

控制組（同一支檔的另一個符號，同樣的 pattern 形狀）:
  refundItems → 命中 10 個檔  ⇒ pattern 是活的
```

**它有 `quantity_exceeds_remaining` 守門、有自己的測試（`refund.test.ts:205`）、從 domain barrel 導出。**
⇒ **它不會壞，它會誤導** —— **而且它的測試會綠，所以任何機械檢查都不會叫。**
⚠️ **不要自己刪**（動 domain 導出是行為改動）。選項留給 Sean：刪 / 加註解標明非權威 / 改成真的用它。

### 6.7 🟢 `order_refunds`（**活的那張**）的不變量 —— 查了，**擋得住，包含跨次**

**先問「誰在寫」再問「守不守得住」**（這是上一節換來的教訓）：
表 ACL `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, payment_confirmer`
⇒ **只有 owner 寫得進** ⇒ 唯一入口是那三支 SECDEF RPC。**外部零路徑**（`admin_*` 對 anon／authenticated 皆 0/28）。

**單次超量**：`order_refunds_ledger_consistency` **CONSTRAINT TRIGGER（DEFERRED 到 COMMIT）**
驗三件：①至少一列明細 ②header `items_amount = Σ line_amount` ③每列不超原始數量且單價相符。
🔴 **而且它【父子表都掛】**，作者註解逐字：「**只掛子表則「零明細 header」永不觸發**」
—— **這正是「守門掛錯物件」那一類，他們想到了。**

**跨次累積超退（第 N 次部分退款）** ⇒ 🟢 **有擋，在 `pcm_order_refundable_remaining(p_order_id)`**：

```sql
SUM(r.refund_amount) FROM order_refunds r
 WHERE r.order_id = o.id AND r.status IN ('processing','confirmed')   -- 佔額度
-- 另一段 SUM 處理 failed（已更正者），兩段值域互斥 ⇒ 不重複扣
```

⇒ 回答「**累加的是哪一個集合**」：**`processing` + `confirmed` 佔額度；
`deferred` 與「未被更正的 `failed`」不佔。**

🔴 **兩條殘餘風險，都是作者自己寫出來的（不是我發現的）：**

1. **allowlist 是 fail-open 方向**（該函式 COMMENT 逐字）：
   > 「**未來新增任何 status 值預設不佔額度 —— 新增狀態時必須回訪本函式。**」
   ⇒ **加一個新的退款狀態，額度會憑空變多，而不會有東西紅。**
2. **同一個累加有第二套實作**：`admin_finalize_order_refund` 步 7 **自己 SUM** 決定 `payment_status`
   —— **已立案 `#497`**（同檔 COMMENT 記著）。⇒ 兩套 SUM 各自演化的風險已被知道。

📌 **`20260725130100:33-39` 有一段標題叫「本檔不做、留給後續片的防線（誠實揭示，不得宣稱帳本已完備）」**，
逐條列出跨次累積超退與運費綁定兩個缺口並指名歸屬。
**那一段寫於 2026-07-25，而缺口①後來真的被補上了**（`pcm_order_refundable_remaining`）。
⇒ **這是「誠實揭示缺口」真的走完一輪的實例**，不是掛在那裡的免責聲明。

#### 6.7-a 🔴 更正我 §6.5(c) 的另一句

我當時寫「`payment_refunds` 的 `BEFORE TRUNCATE` 是**全 repo 唯一**一處專門防 `TRUNCATE` 的地方」。
**錯。** 活的那張也有：**`pcm_refund_ledger_block_truncate`**（production 實查函式清單命中）。
⇒ **正確說法：退款這條線上【兩套帳本都】防了 `TRUNCATE`。**
📎 成因同前：我在**只看過一張表**的情況下下了一個**全 repo 的全稱句**。

### 6.8 `#497` 兩套 SUM 的一致性 —— **它們算的不是同一件事，而且都對**

#### 6.8-a 先數，再判（**幾套？**）

```
pattern: grep -rniE 'SUM\([^)]*refund' supabase/migrations/*.sql
命中 5 處 / 3 個檔
```

**但 migration 會互相取代，檔數 ≠ 活的套數。** 逐處歸屬到函式後：

| 處 | 所屬函式 | 活的嗎 |
|---|---|---|
| `20260801120000:458` | `pcm_order_refundable_remaining` | ❌ 被後面取代 |
| `20260803150000:402` | `pcm_order_refundable_remaining` | ❌ 被後面取代 |
| **`20260814190000:412,417`** | **`pcm_order_refundable_remaining`** | ✅ **活的（最後一版）** |
| **`20260803150000:776`** | **`admin_finalize_order_refund` 步 7** | ✅ **活的** |

**app 層另有一處**：`apps/admin/src/lib/payment/refund-recovery-read.ts:119` 的
`ledgerConfirmedSum`（`reduce`）—— **第三處**，但它是**對帳／回復畫面的讀取**，不參與判定。

⇒ **參與判定的活實作 = 2 套**（`#497` 說的那兩套），**沒有第三套在判定路徑上**。

#### 6.8-b 它們算的集合 —— **不一樣，而這是【對的】**

```sql
-- 額度（pcm_order_refundable_remaining）
WHERE status IN ('processing','confirmed')      -- 在途的【也】佔額度

-- payment_status（admin_finalize_order_refund 步 7）
WHERE order_id = v_order_id AND status = 'confirmed'   -- 只認【已確認】
v_target := CASE WHEN v_sum >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
```

**兩個方向逐一判（不是只找「有沒有差」）：**

| | 它回答的問題 | 集合 | 差異的方向 |
|---|---|---|---|
| 額度 | 「**我還能再退多少？**」 | 含 `processing` | **保守** —— 在途的先佔住，**防的是「同一筆錢被退兩次」** |
| `payment_status` | 「**這張單真的退掉了嗎？**」 | 只含 `confirmed` | **保守** —— **不會因為一筆還沒確認的退款就把單標成已退清** |

⇒ 🟢 **不是不一致，是兩個不同的問題各自用了正確的集合。**
**若把它們「統一」，兩邊都會壞**：
額度只算 `confirmed` ⇒ **在途期間可以重複退**；`payment_status` 算進 `processing` ⇒ **退款失敗後單子錯標已退清**。

> 🔴 **給修 `#497` 的人**：這張單**不是「有 bug 要統一」**。
> **統一它們才會製造 bug。** 要做的是**寫下為什麼不同**，不是消除不同。

#### 6.8-c 🔴 但**同一個 fail-open 風險出現在【兩處】，而只有一處有警告**

`pcm_order_refundable_remaining` 的 COMMENT 逐字警告：
> 「**未來新增任何 status 值預設不佔額度 —— 新增狀態時必須回訪本函式。**」

**而步 7 那句 `status = 'confirmed'` 是【裸的字面】，沒有任何註解。**

⇒ **加一個新的退款狀態（例如 `confirmed_manual`）：**
- 額度那套：不佔額度 ⇒ **可以多退** ⇒ 有警告，但警告在函式 COMMENT 裡
- 步 7 那套：不算進 `v_sum` ⇒ **單子永遠標不到 `refunded`** ⇒ **零警告**

**⇒ 兩處都會靜默出錯，而其中一處連提醒都沒有。**

### 6.9 規格：把「記得回訪」換成「會紅」（**我唯讀，只交規格**）

> 主視窗的判準：**「記得」不是修法。** 而這條的形狀特別毒 ——
> 📎 前面三次是「**答案寫在註解裡而我沒讀**」；
> **這次是「警告寫在註解裡，而未來要改它的人根本不會打開那支函式**」。

**建議做成一道斷言（隨每次 `db push` 跑）**：釘住 `order_refunds.status` 的**值域集合**，
新增任何值 ⇒ **當場紅**，訊息直接指名這兩處要回訪。

```sql
DO $$
DECLARE
  c_known constant text[] := ARRAY['processing','confirmed','failed','deferred'];  -- ← 依實際值域填
  v_now   text[];
BEGIN
  -- 從 CHECK 約束取出目前允許的值域（不是從資料取 —— 資料為空時會恆綠）
  SELECT array_agg(x ORDER BY x) INTO v_now
    FROM (SELECT unnest(...) AS x FROM pg_catalog.pg_constraint
           WHERE conrelid='public.order_refunds'::regclass
             AND conname='order_refunds_status_check') s;

  IF v_now IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(c_known) x) THEN
    RAISE EXCEPTION
      'order_refunds.status 值域變了（現=[%]，本斷言已知=[%]）。'
      '🔴 新增狀態必須【同時】回訪這兩處，否則會靜默出錯：'
      '① pcm_order_refundable_remaining —— 新值預設【不佔額度】⇒ 可以多退；'
      '② admin_finalize_order_refund 步 7 的 `status = ''confirmed''` —— '
      '新值不算進 v_sum ⇒ 單子永遠標不到 refunded。',
      array_to_string(v_now,','), array_to_string(c_known,',');
  END IF;
END $$;
```

🔴 **兩個設計要點**：
1. **值域取自 `CHECK` 約束，不是取自資料** —— 取資料的話，**表是空的就恆綠**
   （本 repo 今天已經在別處踩過「掃到 0 個物件也會過關」）。
2. **錯誤訊息本身就是那份回訪清單** —— 讓觸發的人**不需要去讀任何 COMMENT**。
   **這正是這條的病根：警告放在沒有人會打開的地方。**
   > 🔴🔴 **本點標記為【不可簡化】**：實作時很容易把它縮成 `RAISE EXCEPTION 'unknown status'`，
   > **而那就退回原病** —— 觸發的人拿到一句沒有資訊的錯誤，還是得自己去找要改哪兩處、各自會怎麼壞。
   > **訊息裡必須逐字指名那兩處與各自的後果。**

⚠️ `c_known` 的實際值域**我沒有逐字核對**（我讀到的是約束名 `order_refunds_status_check` 存在，
以及程式碼用到的四個值）⇒ **實作者要先 `pg_get_constraintdef` 讀出真值再填，不要照抄我的陣列。**

### 6.10 `sweeper` × `webhook` 租約 —— **先數 writer，再判**

#### 6.10-a 誰在呼叫那套租約（**四支全部是活的**）

| 租約 RPC | 呼叫端 |
|---|---|
| `claim_due_webhook_events` | `PgWebhookInboxAdapter.ts:85` |
| `claim_expired_pending_attempts` | `PgChargeAttemptAdapter.ts:224` |
| `claim_stuck_unsettled_attempts` | `PgChargeAttemptAdapter.ts:173` |
| `claim_order_poll_settle`（節流） | `PgPollSettleThrottleAdapter.ts:45` |

（**控制組**：純讀函式 `pcm_order_refundable_remaining` 對同一組 pattern 命中 **0** ⇒ pattern 有鑑別力。）

#### 6.10-b 🔴 `settleCharge` 有**四個**入口，其中**三個節流、一個不節流**

`settleCharge` **自己沒有任何 claim／lease** —— 節流是**呼叫端**加的。逐一數：

| 入口 | 有沒有先 `claimPollSettle` |
|---|---|
| `checkout/charge-actions.ts:382` | ✅ |
| `checkout/reconcile-actions.ts:92` | ✅ |
| `api/orders/[orderId]/payment-status/route.ts:141` | ✅ |
| 🔴 **`api/checkout/tappay-notify/[secret]/route.ts:191`（webhook 的 `after()`）** | ❌ **沒有** |
| 🔴 **`checkout/callback/page.tsx`（3DS callback）** | ❌ **沒有** ← **F3 補上，原表漏了這條** |

**加上 sweeper 走 `claim_stuck_unsettled_attempts` 的列級 claim。**
> 🔴🔴 **F3 更正（V 窗指出，我重量後確認）**：原文寫「**唯一**一個沒有互斥的入口」，**錯**。
> **我重量了全部呼叫點**（`grep -rl 'settleCharge(getSettleChargeDeps'`，排除測試）：
>
> ```
> tappay-notify/[secret]/route.ts   claimPollSettle = 0   ← 沒節流
> checkout/callback/page.tsx        claimPollSettle = 0   ← 沒節流（原表【漏了這條】）
> payment-status/route.ts           claimPollSettle = 1
> checkout/charge-actions.ts        claimPollSettle = 1
> checkout/reconcile-actions.ts     claimPollSettle = 1
> lib/payment/composition.ts        claimPollSettle = 0   ← 工廠不是入口，不計
> ```
>
> ⇒ **沒節流的是【兩個】：webhook 與 3DS callback。**
> **安全性結論不變**（§6.10-c 的終點冪等同時覆蓋這兩條），
> **但依賴那棵冪等樹的路徑比我寫的多一條** ——
> 🔴 **有人日後以為「只有 webhook 會 race」而在 callback 那條省掉冪等，就會引 bug。**
>
> 🔴 **形狀：我找到了一條真的沒節流的路，然後把它寫成「唯一」。全稱句今晚第四次。**
> 📎 traps §⑯ 那條原封適用：**這句話的範圍，比我實際看過的範圍大嗎？**

⇒ **`settleCharge` 有【兩個】入口沒有互斥（webhook 與 3DS callback），可與 sweeper 同時對同一張單跑。**

#### 6.10-c 兩個失敗方向**都判**（不是只找「同時拿到」）

**方向①：租約太短／兩邊同時拿到** ⇒ webhook 與 sweeper 併發結算同一單。
**安全性不靠互斥，靠終點寫入是冪等的 —— 我去讀了那支：**
`confirm_order_payment`（`20260810170000` 版）有
①隔離層級閘（非 READ COMMITTED 直接 `RAISE`）②`FOR UPDATE` 鎖臨界區
③取消守門**排在冪等樹之前**（註解逐字：「冪等樹的提前 `RETURN` 也是『成功』，讓它先跑等於沒擋」）
④`paid` 且 `rec_trade_id` + `amount` 雙等 ⇒ **no-op 冪等成功（真 `RETURN`、不 `UPDATE`、不刷時間戳）**。
⇒ 🟢 **併發結算會收斂，不會重複入帳。**
⚠️ **殘餘（非正確性）**：同一單可能對 TapPay Record API **多打一次**。

**方向②：租約沒還／卡住不重試** ⇒ 這個方向**有專門的天花板函式**：
`expire_stuck_attempts_at_ceiling`、`expire_webhook_events_at_ceiling`
（外加 `claim_*` 回傳的 `attempt_count` 供上限判斷）。
⇒ 🟢 **「拿了不還」這個方向被想過了**，不是只做了 claim 就收工。

#### 6.10-d 結論與**我沒驗的那半**

🟢 **沒有找到正確性缺陷。** webhook 不節流是**刻意的**（該檔 `:14` 逐字：
「best-effort 快路徑 … 最終保證交 3DS-4 sweeper」）。

🔴 **但要寫清楚這條的實際形狀**：
> **那條路的安全，不是由它自己保證的，是由 `confirm_order_payment` 的冪等性保證的。**
> **⇒ 這是一條跨檔依賴，而【沒有任何測試在斷言它】。**
> 哪天有人「優化」掉那棵冪等樹（它看起來只是提早 return），**webhook 這條路會第一個壞，
> 而壞的樣子是重複入帳。**

#### 6.10-e ✅ **已補實測**（2026-08-16，拋棄式 PG 17.10）—— 原本這裡寫「沒做」

> 上面整段原本是**讀 code**。做成最小 harness 跑了一次，**結論成立，而代價比我寫的更具體。**

**情境**：**三個**入口同時結算同一張 100 元的單 ——
`tappay-notify` 的 `after()`、**`checkout/callback/page.tsx`**（F3 補上的第二條沒節流的）、以及 sweeper。
兩個版本**只差有沒有那棵冪等樹**（它的形狀就是「提早 `RETURN`」）。

```
🔴 控制組（冪等樹被「優化」掉）  →  order_payments 3 列 / 合計 300 元   ← 一張 100 元的單記了三次
✅ 真實形狀（有冪等樹）          →  order_payments 1 列 / 合計 100 元
```

⇒ **控制組確實紅了** ⇒ harness 有鑑別力（不是兩邊都綠的空測）。
⇒ **§6.10-c 的推論成立**：那兩條沒有互斥的路，**安全確實只由那棵樹保證**。

🔴 **而它壞掉的樣子現在有數字了：不是「可能重複入帳」，是【一張單記三次、金額三倍】。**
📎 這也順帶量化了 F3 的實質：**依賴那棵樹的入口是【兩條】不是一條**
⇒ **拿掉它，兩條路一起壞**，而三條有節流的入口**完全不會有徵兆**。

⚠️ **誠實邊界**：證的是**機制**（同構最小模型，含 `FOR UPDATE` 臨界區與人工放大的競態窗），
**沒有搬真 schema／TapPay stub** ⇒ 撐得住「冪等樹是那兩條路的唯一防線」，
**撐不住「真實函式的每一條路徑都如此」**。冪等規格 §3 的 N1/N2/N3 仍要在真函式上跑。

### 6.11 出貨／作廢／取消的併發 —— **CAS，不是鎖；沒有天花板是【因為沒有租約】**

#### 6.11-a 先數入口（第一動）

五支 RPC **全部有活的呼叫端**：`create` 6 / `add_items` 5 / `mark_shipped` 3 / `void` 4 / `unvoid` 3。
（控制組：一個不存在的名字回 **0** ⇒ 計數有鑑別力。）

#### 6.11-b 正反成對操作：`void` × `unvoid` **同時來**會怎樣

**兩支都不是「先查再改」，是把狀態述詞寫進 `UPDATE` 的 `WHERE`（CAS）：**

```sql
-- void                                    -- unvoid
UPDATE shipments SET deleted_at = now()    UPDATE shipments SET deleted_at = NULL
 WHERE id = ? AND deleted_at IS NULL;       WHERE id = ? AND deleted_at IS NOT NULL;
GET DIAGNOSTICS v_n = ROW_COUNT;           GET DIAGNOSTICS v_n = ROW_COUNT;
IF v_n <> 1 THEN RAISE …                   IF v_n <> 1 THEN RAISE …
```

⇒ **兩個方向同時來**：兩者在同一列上序列化，**先到的改成 1 列、後到的 `WHERE` 不再成立 ⇒ 0 列 ⇒ `RAISE`**。
**不會兩邊都成功，也不會靜默覆蓋。** 錯誤訊息逐字是「**這個包裹的狀態剛剛被別人改過…請重新整理畫面確認**」。

🔴 **而作者把這條的來歷寫在旁邊**：
> `-- 🔴 WHERE 帶上 deleted_at IS NULL（W3-3 的 F6 教訓：只有 id= 會有 TOCTOU）`
> `-- 🔴 …（W3-3 F6 的 TOCTOU 教訓，本線第三次用）`

**「本線第三次用」** ⇒ 這不是零星補的，是**這條線上固定的做法**。
`mark_shipped` 同款（且註解點明「0 列的成因有二：①真的沒這箱 ②**併發**把它作廢或出貨了」）。

#### 6.11-c 「拿了不還」那個方向 —— **它在這條線上不存在**

退款／金流線有專門的天花板函式（`expire_stuck_attempts_at_ceiling` 等）。
**出貨線 `grep 'ceiling'` ⇒ 0。** 上一輪我把這標成「缺口」的候選，**這輪去量了，結論相反：**

```
shipments / shipment_items      欄名含 lease|claim|lock|attempt|expire|token|until  ⇒ 【0】
payment_charge_attempts /
payment_webhook_events           同一 pattern                                        ⇒ 【9】
  （attempt_count、released_at、last_expired_settle_at、settle_attempt_count …）
```

⇒ **兩條線用的是【不同的併發策略】：**

| | 策略 | 需要天花板嗎 |
|---|---|---|
| 金流／退款線 | **claim／lease（有狀態，東西被「持有」）** | ✅ 需要 —— 持有者掛了就要有人回收 |
| **出貨線** | **CAS（無狀態，沒有東西被持有）** | ❌ **不需要 —— 沒有東西可以卡住** |

🔴 **⇒ 「出貨線零天花板函式」不是缺口，是 CAS 策略的必然結果。**
**我上一輪的猜測（「沒有的話那是缺口」）被這個量測推翻了。**
📌 **留檔理由**：下一個人看到「一條線有天花板、另一條沒有」很自然會當成不一致 ——
**判別式是「這條線上有沒有東西被【持有】」，不是「有沒有天花板函式」。**

#### 6.11-d 但這條線**確實**有一個缺口 —— 只是不在併發上

🔴 **併發是好的，而這五支動作【零 `admin_audit_log` 留痕】（§6.2 / P2-4）。**
⇒ **兩件是同一條線的兩半**：
**併發控制擋住了「兩個人同時改壞」，但如果哪天真的出錯（或有人蓄意），事後沒有任何地方查得到是誰。**

#### 6.11-e 誠實邊界

⚠️ **本節是讀 code，不是實測**（對照 §6.5(b) 的掛品項 race 我**是**實測過的）。
CAS 的正確性是 Postgres 的語意保證，**但「每一條路徑都真的走了 CAS」是我讀出來的，不是跑出來的。**

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
