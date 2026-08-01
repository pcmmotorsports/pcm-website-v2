# S3b 夜跑收尾報告(2026-08-02,01:00 待機 → 05:00 開跑 → 06:45 收工)

> 對應交接檔 = `docs/handoff/2026-08-02-s3b-nightrun-handoff.md` §7 的四項要求。
> **未推數當場取(`git rev-list --count origin/dev..HEAD`),等 Sean 手動推。** 本 session 零 push、零正式站寫入、零 migration、零 `.env*` 接觸。

---

## §0 一句話

**S3b-2(action 面)完整收工、S3b-3 的純函式層(S3b-3a)收工;S3b-3 的 UI 元件面未開工。**
🔴 **供應商設定頁還不能用** —— 三個 action 與三支純函式**全 repo 零生產呼叫端**,
畫面要等 S3b-3 的 `page.tsx` + 三個元件 + sidebar 那一片才接得起來。

🔴 **不得讀成「端到端已驗證」**:所有測試都是 mock,證的是「呼叫端把契約接對了」,
**不是**「RPC 在正式站行為如預期」。**新增那條路的接線從未在真環境跑過。**

---

## §1 做了什麼

### 兩個 commit(皆未 push)

| commit | 內容 |
|---|---|
| `4833cae` | S3b-2 供應商 action 面 + 兩支 result-banner 原型鏈缺陷修正 |
| `a56f930` | S3b-3a 供應商共用排序 + typeahead 候選過濾純函式 |

### S3b-2(`4833cae`)

三個 server action(新增 / 改名 / 切換啟用),形狀照 `staff-actions.ts`:
授權閘 → 純解析器 → repository → PRG redirect。**本片零稽核 code**(RPC 同交易寫)。

**錯誤分流沒有收斂成單一 `error`**(這是本片的重點):

| 情況 | 結果碼 | 員工看到的下一步 |
|---|---|---|
| `SupplierCallerBugError` | `bug` | **停手、不要重按**、通知維護者 |
| 一般 DB error | `error` | 稍後再試 |
| `DUPLICATE_LABEL`(新增/改名) | `duplicate` + `&q=<剝過空白的 label>` | 清單定位到那一列,**自己**按「啟用」 |
| 解析失敗 / 授權失敗 | `invalid` / `denied` | 兩者 **RPC 零呼叫** |

**Sean 08-02 兩板都有守門釘住**:Q2=A 撞名只定位不代按啟用(撞名路徑**零第二次寫入**);
Q3=C 改名不填原因(逐欄深度相等斷言,加 note 欄會轉紅)。

**鐵則 6 拆檔兩次**:`supplier-repository.test.ts` 369 → 94(寫入面 25 條逐條原樣搬進
`supplier-write.test.ts`,拆前拆後皆 29 綠、已機器 diff 比對零測試碼差異);
`supplier-actions.test.ts` 392 行補完 codex must-fix 會破 400 ⇒ redirect 面另拆
`supplier-actions-redirect.test.ts`。

### S3b-3a(`a56f930`)

`sortSuppliersByLabel`(唯一排序入口)+ `listSuppliersForSettings`(全部列含停用)
+ `filterSupplierCandidates`(零 React 依賴的 typeahead 過濾)。驗收 16a-16g 已收。

🔴 **這是我當場再拆出來的子片,授權來源是鐵則 4 不是 plan §4** —— §4 預先授權的是
「超過 ~700 行或最大檔逼近 400 ⇒ 候選過濾獨立成 S3b-4」,而**實際觸發是時間**。

---

## §2 三綠與突變的實測數字

| 項目 | 基準線(01:01) | 收工時 |
|---|---|---|
| typecheck / lint | 綠 / 綠 | 綠 / 綠 |
| 完整測試套件 | **284 檔 3562 passed + 1 todo** | **290 檔 3671 passed + 1 todo** |
| build | 綠 | 綠(S3b-3a 未動 `.tsx` ⇒ 該片不需) |

🔴 **基準線是先跑過、確認是綠的,才開始跑突變** —— S3b-1 踩過反例(第一輪突變顯示
「typecheck 紅」,查下去是基準線本來就紅,整輪結論作廢重跑)。

**突變共 6 輪 33 格,全部轉紅:**

| 輪 | 格數 | 目標 |
|---|---|---|
| S3b-2 R1 | 9 | 失敗分流 / `?q=` 編碼 / 定位 / 授權閘 / revalidate / 兩支 banner / 型別層(**判官 = tsc**) |
| S3b-2 R2 | 5 | code-reviewer 逼出的新守門(撞名 revalidate、log 不記全名、啟用成功碼…) |
| S3b-2 R3 | 4 | codex R1 逼出的(閘順序、切換結果碼、注入矩陣、文案不代按) |
| S3b-2 R4 | 4 | codex R2 逼出的(**真短路** vs 只有優先序、切換路徑 revalidate、撞名寫入次數、null rejection) |
| S3b-3a R1 | 8 | 前綴 vs 包含 / 偷加 is_active / rpcTrim / 大小寫 / 空 query / 設定頁濾停用 / 就地排序 / **第二把 collator** |
| S3b-3a R2 | 3 | **同檔**第二把 collator / 拿掉 tiebreak / 掃描範圍縮到只掃 lib |

還原用**檔案備份逐位元組比對**,不用 `git checkout`(會清掉未追蹤的新檔)。

**逐檔行數(當場 `wc -l`,全部 ≤400)**:actions 295 / actions.test **393**(⚠️ 距上限 7 行)/
actions-redirect.test 228 / result-messages 63 + test 85 / write.test 305 / repository.test 94 /
form 200 + test 299 / supplier.ts 71 + test 237 / candidates 56 + test 106 /
orders banner 35 + test 43 / settings banner 49。

---

## §3 審查

| 片 | 輪 | 模型 | 結果 |
|---|---|---|---|
| S3b-2 | R1 | Claude opus `code-reviewer` | **FAIL** 4 must-fix + 8 nit |
| S3b-2 | R2 | codex `gpt-5.6-sol` xhigh 關卡2 | **NO-GO** 3 must-fix + 8 nit |
| S3b-2 | R3 | codex `gpt-5.6-sol` xhigh 關卡2 第二輪 | **NO-GO** 2 must-fix + 8 nit |
| S3b-2 | R4 | **Fable** `adversarial-reviewer`(換模型換角度) | **GO** 0 must-fix,1 consider + 2 nit |
| S3b-3a | R1 | Claude opus `code-reviewer` | **FAIL** 4 must-fix + 6 nit |

**共 13 must-fix + 32 nit,逐條親驗、駁回 0、已全折。** codex 兩輪跑前後 `git status` 比對**零留痕**。

🔴 **四輪的 findings 幾乎零重疊,每輪打在前一輪看不到的層** —— 這四條最值得你知道:

1. **兩道閘的順序沒被測**(codex R2 抓,opus 沒看到):授權閘測試餵**合法**表單、解析閘測試餵
   **已授權**身分 ⇒ 把解析移到授權前,兩組**照樣全綠**,但未授權者送一張爛表單會拿到
   `invalid` 而不是 `denied` = 對**未經授權**的人洩漏表單規則。
2. **我補的修法只釘住「回應優先序」、沒釘住「真的短路」**(codex R3 抓):解析搬到前面但仍先回
   `denied` ⇒ 仍全綠。改用「`get()` 會爆炸的 FormData」讓「解析器有沒有被碰到」變成可觀察事件。
3. **啟用切換那條路的 `revalidatePath` 完全沒被斷言**(codex R3 抓):刪掉它四個結果碼全綠
   = 驗收 5 在那條路上是假綠。我前兩輪的突變只蓋到失敗路徑與撞名路徑。
4. **結構斷言數的是「檔案數」不是「建構次數」**(S3b-3a R1 抓):在同一檔內再建第二把 collator
   —— 最可能的落點,就在第一把旁邊 —— 照樣全綠。

🔴 **我在這一夜寫錯過三次字面值**(全被審查抓到、全已更正):`supplier-actions.ts` 行數
292 vs 實際 295 / `supplier.test.ts` 基準 110 vs 實際 **105**(plan `[K1-n1]` 同型**第三次**)/
plan `:132` 說 JS `.trim()` 不剝 `U+FEFF`(Node 22 實測**會**剝,同一個錯在 S3b-1 已更正過
`supplier-form.test.ts`,**這裡當時沒跟著改**)。⇒ 這三次都是「憑印象寫數字」,不是新錯誤類型。

---

## §4 沒做到什麼

1. **S3b-3 的 UI 元件面完全沒動** —— `app/settings/suppliers/page.tsx`、`supplier-table.tsx`、
   `supplier-edit-row.tsx`、`supplier-create-form.tsx`、sidebar 那一行 nav,以及驗收 **16h**
   (元件層釘住「真的接到那支純函式」)。**夜跑的時間全部用在 S3b-2 的四輪審查上。**
2. **真瀏覽器驗收沒跑**(照 D3=B 本來就留白天當著你的面跑)。
3. **新增那條路從未在真環境跑過** —— 只有 mock 背書。
4. **`is_active` 仍無下游消費者**(A10b 才有)⇒ 不得說「停用功能已生效」。
5. **27 項驗收仍是 2/27**,一格都沒動 —— 這是你 Q1=A 拍板時就知情的前提。

---

## §5 白天需要你看的清單

### 🔴 要你拍板 / 補批的(依重要性)

1. **兩支共用 result-banner 我改了,不在 plan 產物表內**(鐵則 8「動共用元件」灰區)。
   缺陷是真的:`messages[code]` 直接索引,而 `code` 來自 `?r=` 是 URL 上的任意字串
   ⇒ `?r=__proto__` / `constructor` / `toString` 取到**原型鏈屬性且為 truthy**
   ⇒ `if (!msg) return null` 這道守門形同虛設,畫出一個 `class="… undefined"` 的空框。
   **五個頁面全中**(staff / order-statuses / orders 列表 / 訂單詳情 / 客戶詳情)。
   修法 = `Object.hasOwn`;orders 那支原本零測試也補了。
   **無注入風險**(`msg.text` 是 undefined ⇒ React 不渲染),純粹是「守門的名字大於它的能力」。
   👉 **要退回的話一句話就好**,revert 這兩處不影響其餘部分。
2. **`supplier-form.ts` 新增 `boundSupplierQuery` 也不在產物表**。理由:驗收 4 後半
   「q > 100 不帶 q」若只從 action 走真解析器測**構造不出來**(label 恆 ≤100)= 恆真斷言。
3. **`apps/admin/src/lib/customers/wallet-form.ts:66` 的註解有同一個 `U+FEFF` 錯字面**。
   那是 M-4a 的檔、**code 行為正確**(顯式先剝再 trim),只有註解錯。
   **本片沒有順手改別片的檔** —— 要我改就說一聲。
4. **S3b-3 開工前的硬前提(Fable R3 抓)**:撞名防線只擋「剝空白後逐字相同」,
   **大小寫 / 內部空白 / 標點變體一律不擋**(`suppliers_label_unique` 是區分大小寫的普通
   UNIQUE)⇒ `akoso` 與 `AKOSO` 會被 DB 當兩家、乾脆回 `CREATED`、零錯誤、而且**永久刪不掉**。
   ⇒ **typeahead 是硬性驗收,不是可選的 UX 潤飾。**

### 🟡 你會想知道但不用決定的

- `supplier-actions.test.ts` **393 行,距 400 硬上限剩 7 行** ⇒ 後續任何新增必須先拆檔。
- 這一夜審查逼出來的東西裡,**沒有一條是產品邏輯錯**;13 條 must-fix 有 11 條是
  「你的測試沒有釘住 X,拿掉 X 仍全綠」。code 本體從第一版到現在只改了三處實質行為
  (兩支 banner 的 `hasOwn`、失敗路徑補 `revalidatePath`、排序加 tiebreak)。
- 未推數**不寫死**(2026-07-25 Sean 拍板 A:自指數字每多一個 commit 就當場變假 —— 本檔自己的
  commit 就是第 5 筆)⇒ 當場取:`git rev-list --count origin/dev..HEAD`。
  本夜產出的三筆 = S3b-2 / S3b-3a / 本報告,前面還有 `cdf5f6a`(前一夜交接)與 `d7fe3b9`(S3b-1)。

---

## §6 下一個 session 的起點

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain && git log --oneline -3
```
預期:branch=`dev`、**工作樹乾淨**、HEAD = **本報告這一筆 docs commit**
(`docs(handoff): S3b 夜跑收尾報告 …`),其下依序是 S3b-3a、S3b-2。
🔴 **hash 與未推數本檔一律不寫死**(同 STATUS 的 2026-07-25 拍板 A):當場取
`git log --oneline -4` 與 `git rev-list --count origin/dev..HEAD`。
本檔前一版就在這裡寫死了 `a56f930`,而寫下那行的 commit 自己就讓它變成過期字面。

**下一片 = S3b-3 UI 元件面。** 開工前必讀四條(已寫進 STATUS「下一步」欄):
① typeahead 是硬性驗收 ② **切換啟用的控制項不能用原生 checkbox** ——
`parseSupplierActiveForm` 只收字面 `true`/`false`,原生 checkbox 送 `on`/缺席 ⇒ 每次都 `invalid`;
照 `staff-edit-row.tsx` 用 hidden input 帶 `String(!current)`
③ **`loadFailed` 時不渲染新增表單**(刻意偏離 staff 樣板)
④ `?q=` 只當過濾字串、**永不直接渲染成文字**,長度收斂用既有的 `boundSupplierQuery`。

🔴 **16h 要一併釘順序,不能只釘數量**:候選來源必須是 `listSuppliersForSettings()` 的輸出;
若直接餵 `listSupplierRows()` 的原始列,候選順序會變成 DB 回傳順序而 16h 看不見。

— END —
