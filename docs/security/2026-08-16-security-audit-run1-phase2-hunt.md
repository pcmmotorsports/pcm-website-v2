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

**沒有找到可外部利用的漏洞。** 找到 **2 條依賴鏈項目** 與 **1 條先前已知**，其餘全部是**查過、乾淨**。

| # | 項目 | 嚴重度 | 可外部利用？ |
|---|---|---|---|
| **P2-1** | `xlsx@0.18.5` 在 `package.json`，**零程式碼引用**，帶 **2 個 HIGH 且官方無修補版** | **中（前瞻性）** | ❌ 今天不可 —— **沒有任何程式碼載入它** |
| **P2-2** | `sharp@0.34.5` libvips 4 個 CVE | 低 | ❌ **web runtime 完全碰不到**（見下） |
| P2-3 | `shipment-actions.ts` 4 支 action 無授權閘 | 低（稽核歸屬，非存取控制） | ❌ 已由 Phase 1 界定，**本輪未擴大** |

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

**可達性（量過的，附分母與 pattern）**：

```
pattern: grep -rni 'xlsx' .   (排除 node_modules 與 pnpm-lock.yaml)
命中 87 處 → 全數為 package.json 宣告(1) + docs/specs 文字討論(86)
【程式碼 import 命中：0】
正向對照：同一 pattern 對 'sharp' 命中 package.json + scripts/image-trim-scan.ts + 測試 ⇒ pattern 是活的
```

⇒ **今天不可利用：沒有任何 `.ts`／`.tsx`／`.js` 載入它。**

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

## 5. 建議的下一步（依價值排序，非承諾）

1. **移除 `xlsx`**（零使用、消掉兩個無修補版 HIGH）—— 最便宜的一件
2. **升 `sharp` 到 `>=0.35.0`**
3. **業務邏輯／狀態機那一塊另開一輪**，且**開平行編制** —— 那是本輪缺口最大的地方
4. Phase 3 對抗驗證：**拿本檔每一條「查過、乾淨」去反駁**，特別是 3.1 與 3.4
   （我是同一個腦寫的假設與結論，**那正是對抗驗證存在的理由**）
