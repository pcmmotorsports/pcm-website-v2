# S3b — `/settings/suppliers` 供應商設定頁(片級 plan **v3**)

> **v3 = 折入 Sean 2026-08-01 深夜三拍板:D1=B(自寫過濾)/ D2=A(後半句移交 A10b)/ D3=B(真瀏覽器只按可還原的)。**
> 三題原文與理由 = memory `project_m4b-supplier-master-decisions`;母 plan `:223` 已補 superseded 註記。
> 🔴 **D1 的前提我當場更正過**:Sean 逐字「我以為跟 excel 下拉選單一樣簡單」——
> **功能本身確實那麼簡單**(`datalist` 五行),貴的是「證明它有效的自動測試」。
> 更正後他維持 B,理由改為①測得住「恰 3 筆」②撞名時能定位到那一列。

> 母 plan = `docs/specs/2026-08-01-e10-supplier-master-plan.md`(§4 S3b / 驗收 §5-14~17 / §6 契約債)。
> 交接檔 = `docs/handoff/2026-08-01-supplier-master-handoff.md` §3-1。
>
> **v1 經 codex `gpt-5.6-sol` xhigh 關卡1 判 NO-GO(16 must-fix + 6 nit)。**
> 逐條主對話親驗:**成立 16 + 6、駁回 0**、部分降級 1(M4 → 誠實邊界)。
> findings 逐字 = `/private/tmp/.../s3b-k1.log`(session 暫存;要點已逐條折入本檔並標 `[K1-Mn]`)。
> 🔴 **v1 三處字面被實查推翻**(§8 假零 / 基準行數 / 真瀏覽器驗收的寫入面),詳 §10。
>
> ✅ **Sean 2026-08-01 深夜批准(逐字「開始」),三題已拍板** ⇒ 鐵則 8 已滿足。
> **S3b-1 已收工**(見 §4 manifest 與 §5 驗收);S3b-2 / S3b-3 尚未動工。
> 🔴 K2 抓到本檔曾同時宣稱「未批准、零行 code」與「S3b-1 已收工」—— 那是我更新 §4 時沒回頭改檔頭。
> **改片級狀態時檔頭、§4、§7 三處要一起改**,這是 `feedback_claimed-sync-but-only-patched-touched-lines` 的同型。

---

## §0 分級與判定

| 項目 | 判定 | 依據 |
|---|---|---|
| 內容分級 | **L3** | 供應商名單是週多次異動的營運資料 ⇒ 必須後台 CRUD。本片就是在建那個 CRUD。 |
| 片型 | **高風險片** | 鐵則 12 **②權限**:呼叫 `service_role` → `SECURITY DEFINER` owner RPC + 新增 server action。 |
| 鐵則 8 | **命中** | 跨 3+ 檔 ⇒ **本 plan 等 Sean 批准才動 code**。 |
| 鐵則 4 | 🔴 **v1 破了,v2 拆片** | v1 = 15 檔 / 約 1,555 行 ⇒ 15-45 分鐘不成立(`[K1-M1]`)。**拆成三片**,見 §4。 |
| 鐵則 6 | 適用 | 逐檔 ≤400 行。 |
| SOP | **全 9 步 ×3** | 每片各跑 code-reviewer + codex 關卡2,**不降級**。 |
| DB | **零 migration** | 唯一寫入路是既有的 `admin_upsert_supplier`。 |

**硬前置(逐條標明查法與強度)**

| 前提 | 強度 | 依據 |
|---|---|---|
| `database.types.ts` 已含 `admin_upsert_supplier` + 四處 `\| null` 校正 | ✅ 本 repo 實查 | `packages/adapters/src/supabase/database.types.ts:2230-2243` |
| S2 已 apply **正式站** | 🟡 **未即時查**(`[K1-n3]`) | STATUS/handoff 記 `e21a0b6`;**第二來源** = 上列型別檔由正式站 schema 生成(`bd2add4`)且含該 RPC。Supabase MCP 本 session 未連線 ⇒ 無法即時 `list_migrations` 佐證。若此前提為假,**第一次寫入才會 runtime 炸**。 |
| typed `.rpc()` 可用、不需窄 cast | ✅ 實查 | 對照 `customer-repository.ts:77` 的 `admin_adjust_wallet`(typed)vs `:135` 的 tier(未 apply ⇒ 窄 cast) |

---

## §1 要改什麼

`/settings/suppliers`:一頁含 ①全名單(含已停用)依 zh-TW 排序 ②新增(打字即時提示既有相似名)
③改名 ④停用/重新啟用。寫入一律經 `admin_upsert_supplier`,稽核由 RPC 同交易寫。

## §2 為什麼

1. Sean 08-01 拍板 1「可自行再增加」+ 拍板 2「不可刪除、只可改名」⇒ 需要新增/改名畫面。
2. 拍板 6「打字快速帶入候選」⇒ 砍掉 A5b 機器猜同後,**typeahead(人眼)是唯一防重複防線**。
3. 母 plan §6 契約債②(撞到**已停用**同名也回 `DUPLICATE_LABEL`)⇒ 沒有出口就是 UI 死路。
4. 母 plan §6 契約債①(`p_supplier_id` 弄丟 ⇒ 靜默降級成新增、多一筆刪不掉的垃圾列)。
5. 本片是 `is_active` 的**第一個**畫面消費者(Sean Q2=A 知情選擇)。

---

## §3 設計

### 3.1 分層

```
app/settings/suppliers/page.tsx      server component,直呼 lib(對照 staff/page.tsx:27)
  └ lib/supplier.ts                  排序/篩選(既有;本片抽共用排序)
      └ lib/supplier-repository.ts   既有 listSupplierRows + 新增 createSupplier / updateSupplier
  └ lib/supplier-actions.ts          三個 server action(授權閘 → 解析 → RPC → 回傳碼收斂 → PRG)
      └ lib/supplier-form.ts         純解析器(零 IO、零 Next 依賴)
  └ components/settings/supplier-*   純顯示 + form action
```

🔴 **`[K1-M7]` 讀取失敗必須 fail-closed**:staff 樣板在 `loadFailed` 時**仍然渲染新增表單**
(`app/settings/staff/page.tsx:47-55` 實查:`<StaffCreateForm />` 在條件式**外面**)。
照抄到供應商上是真危險 —— 名單載不出來 ⇒ 員工看不到「這家已經有了」⇒ 新增一筆**永久**垃圾列。
⇒ **本片刻意偏離樣板**:`loadFailed` 時**不渲染新增表單**,只顯示錯誤 banner。

### 3.2 🔴 排序抽共用函式

```ts
export function sortSuppliersByLabel<T extends { label: string }>(rows: readonly T[]): T[]
export async function listSuppliers(): Promise<SupplierOption[]>          // 既有,改吃上面那支
export async function listSuppliersForSettings(): Promise<SupplierRow[]>  // 新:全部列 + 同一把排序
```

🔴 **`[K1-M10]` 兩組「結果順序」測試證明不了「只有一份 collator」** —— 兩條路各自 `new Intl.Collator('zh-TW')`
會讓兩條測試同時綠。單一來源要用**兩條性質不同**的斷言合起來釘:
1. **行為層**:兩支各用中英混排亂序向量釘住順序(拿掉排序 ⇒ 兩條紅)。
2. **結構層**:`supplier.ts` 全檔 `new Intl.Collator` 字面出現次數 **恰 1**,且 `sortSuppliersByLabel`
   是唯一 export 的排序入口(新增第二份 ⇒ 結構斷言紅)。
   🔴 **誠實**:第 2 條是文字層斷言,擋不住「在別的檔案裡另建一份」——
   那種情況由 code review 與 §5-結構斷言的 grep 範圍(整個 `apps/admin/src`)涵蓋,不是無縫。

### 3.3 呼叫面拆兩支(`[K1-M2]` 的真修法)

v1 說「UUID 解析閘 = 預防」**名過其實** —— parser 只守 FormData 入口,守不住解析之後
action→repository 之間把 id 弄丟。⇒ v2 改成**型別層分流**(memory `feedback_null-dispatch-rpc-silently-downgrades`
逐字記載的根治法;RPC 不能拆〔要動 migration〕,但**呼叫面可以**):

```ts
// supplier-repository.ts —— 兩支具名包裝,各自只餵得出自己那條路的參數
export async function createSupplier(args: {label, note?, actor, requestId}): Promise<'CREATED'|'DUPLICATE_LABEL'>
export async function updateSupplier(args: {id: string, label?, isActive?, note?, actor, requestId}): Promise<'UPDATED'|'NO_CHANGE'|'NOT_FOUND'|'DUPLICATE_LABEL'>
```

- `updateSupplier` 的 `id: string` **必填** ⇒ 傳 null/漏傳 = **編譯錯**,不是 runtime 垃圾列。
- `createSupplier` **簽章裡沒有 id** ⇒ 物理上餵不進去。
- 兩支各自把 RPC 回傳碼**窮盡收斂**;`[K1-M5]` 非五碼之一(**含 `null`**,生成型別只保證 `Returns: string`)
  ⇒ `throw`(對齊 `customer-repository.ts:86` 的 `admin_adjust_wallet RPC 回傳非預期碼`)。
- **`updateSupplier` 收到 `CREATED`** ⇒ 契約債①的偵測層:`throw` + action 轉 `?r=bug`。

🔴 **三層各自的能力界線(不得再說成一句「有預防」)**:

| 層 | 擋得住 | **擋不住** |
|---|---|---|
| 解析器(UUID 形狀閘) | 缺欄位、空字串、非 UUID 字面 | 合法但**指向別家**的 UUID |
| 型別層(兩支簽章) | 弄丟 id、把 create 當 update 用 | 呼叫端刻意傳錯的 id |
| 回傳碼收斂 | RPC 漂移、非預期碼、`CREATED` 出現在改名路徑 | **垃圾列已經寫進去了**——這是偵測不是預防 |

🔴 **`[K1-M4]` 明文不做**:合法 UUID ≠ 正確目標。竄改 hidden input 或 stale 頁面可以改到**別家**供應商,
三層都不會即時報警。admin 目前**沒有逐列授權模型**,任何已授權員工本來就能改任何一家
⇒ 差別只在「誤操作 vs 惡意」。事後可查性由 RPC 的稽核 `before/after` 提供(`20260801160000:284`)。
**本片不建樂觀鎖/逐列授權**,列進 §6 誠實邊界。

### 3.4 輸入規則鏡像 RPC

RPC 對非法輸入是 `RAISE EXCEPTION`(空 label / >100 字 / 控制字元 / 空 patch)。
解析器在 server 端先擋同一組規則,讓那些 RAISE 在正常操作下不可達;真冒出來的 DB error ⇒ `error` + 安全記錄。

🔴 剝空白要用 **31 字元 Unicode 全集**(`20260801160000:115-121`),不能只用 JS `.trim()`
(JS 不剝 U+200B / U+180E / U+200C / U+200D / U+2060 / U+0085)⇒ 否則純 U+200B 的名字會通過解析、到 RPC 才炸成 `error`(其實該是 `invalid`)。
🔴 **本行原本把 `U+FEFF` 列進「JS 不剝」是錯的**(Node v22.22.3 實測:`.trim()` **會**剝 U+FEFF,連同 U+00A0/U+1680/U+2028/U+3000)。
同一個錯字面在 S3b-1 已於 `supplier-form.test.ts:56` 更正過,**這裡當時沒跟著改** —— codex 關卡2 R2 抓到,屬
`feedback_claimed-sync-but-only-patched-touched-lines` 同型(只改了手碰到的那幾行)。
🟡 **另一處同族未改**:`apps/admin/src/lib/customers/wallet-form.ts:66` 的註解也寫「FEFF 不算」——
那是 M-4a 的檔、其 code 行為正確(顯式先剝再 trim,不依賴這個判斷),本片**不順手改別片的檔**,列進早報讓 Sean 決定。
🔴 **`[K1-M6]` v1 宣稱了規則卻沒有對應驗收向量** ⇒ v2 §5 補三條負向向量 + 各配突變。

### 3.5 停用同名的出口(契約債②)

1. **列表顯示全部列**(含停用,刪節線 + 「已停用」),每列有 `啟用` / `停用` 按鈕 = 一鍵重新啟用。
2. **新增的候選提示含停用列**且標「(已停用)」⇒ 送出**之前**就看得到。`[K1-M13]` 補進驗收。
3. `DUPLICATE_LABEL` 訊息明寫「若清單中看不到,它可能已停用」。

🔴 **`[K1-M12]` v1 說「零額外機制」是說滿了** —— 名單長到 80 列時,通用訊息無法告訴員工是**哪一列**。
⇒ **D1=B 已拍板 ⇒ 用同一支過濾純函式解決**:撞名時 redirect 帶 `?r=duplicate&q=<剝過空白的 label>`,
頁面把清單**預先過濾到那一列**,員工直接看到它 + 它的「啟用」按鈕。
🔴 `q` 只當**過濾字串**用,永不直接渲染成文字(React 預設跳脫,但這裡明文釘住,對齊 §3.7 第③條)。
🔴 `q` 的長度上限比照 label(100)—— 超長一律忽略,不讓 URL 變成任意長度輸入面。

### 3.6 稽核

**本片不寫任何稽核 code** —— RPC 同交易寫 `admin_audit_log`(`20260801160000:227` / `:284`)。
⇒ 無 staff 那種 `audit_failed` 狀態碼,也沒有「主資料成功但稽核失敗」的窗口。

### 3.7 結果碼與 PRG 安全面

`created` / `saved` / `nochange` / `duplicate` / `notfound` / `invalid` / `denied` / `bug` / `error`。
🔴 `[K1-n6]` 三條安全性質要釘成驗收、不能只靠「照抄 staff 沒問題」:
①redirect 目標是**寫死的站內常數**、無 `return_to` 參數面 ②未知的 `?r=` 值 ⇒ 不顯示任何 banner
③`?r=` 只用於查表,**永不**直接渲染成文字。

---

## §4 🔴 拆片(`[K1-M1]`;鐵則 4)

v1 的 15 檔 / 約 1,555 行不是一片。**流程題,依 memory `feedback_decide-process-questions-yourself` 由我決定、回報給 Sean 有機會推翻。**

| 片 | 內容 | 檔數 | 預估行 | Sean 可肉眼驗? |
|---|---|---|---|---|
| **S3b-1** 寫入面 | `supplier-form.ts`(+test)、`supplier-repository.ts` 加 `createSupplier`/`updateSupplier`(+test) | 4 | ~470 | ❌(對照 S3a,資料層片) |
| **S3b-2** action 面 | `supplier-actions.ts`(+test)、`supplier-result-messages.ts` | 3 | ~600 | ❌ |
| **S3b-3** UI 面 | `page.tsx`、三個元件、`supplier-candidates.ts` 過濾純函式(+test)、smoke test、`supplier.ts` 共用排序(+test)、sidebar | 10 | ~700 | ✅ **這片才是他看得到的** |

**依序做,不並行。** 每片各自走全 9 步。
🔴 **D1=B 已拍板 ⇒ S3b-3 多兩個檔**:`lib/supplier-candidates.ts`(純函式 `filterSupplierCandidates`,
零 React 依賴 ⇒ 可單元測試釘死「恰 3 筆」)+ 一個 `'use client'` 元件負責輸入狀態與渲染候選。
🔴 元件本身**不含比對邏輯** —— 邏輯全在純函式裡,元件只呼叫它。否則「恰 3 筆」又會退回 jsdom 才測得到。
🔴 S3b-3 若實測超過 ~700 行或最大檔逼近 400,**當場再拆一片**(候選過濾獨立成 S3b-4),不硬塞。

### S3b-1 manifest — ✅ **已收工,行數為 `wc -l` 實測**

| 檔 | 新/改 | 基準 | 預估 | **實測** | ≤400 |
|---|---|---|---|---|---|
| `apps/admin/src/lib/supplier-form.ts` | 新 | — | ~110 | **166** | ✅ |
| `apps/admin/src/lib/supplier-form.test.ts` | 新 | — | ~190 | **266** | ✅ |
| `apps/admin/src/lib/supplier-repository.ts` | 改 | 33 | ~105 | **190** | ✅ |
| `apps/admin/src/lib/supplier-repository.test.ts` | 改 | 90 | ~230 | **369** | ⚠️ 距 400 剩 31 行 |

🔴 **`supplier-repository.test.ts` 369 行,已進入 >300 硬警戒區**(鐵則 6)。
S3b-2 若要往這支加測試 ⇒ **先拆**(建議把寫入面測試獨立成 `supplier-write.test.ts`),不要撐到 400 才處理。

### S3b-2 manifest — ✅ **已收工**(`4833cae`;行數為當場 `wc -l` 實測)

| 檔 | 新/改 | 基準 | **實測** | ≤400 |
|---|---|---|---|---|
| `lib/supplier-actions.ts` | 新 | — | **295** | ✅ |
| `lib/supplier-actions.test.ts` | 新 | — | **393** | ⚠️ 距上限 7 行 |
| `lib/supplier-actions-redirect.test.ts` | 新(**拆檔二**) | — | **228** | ✅ |
| `lib/supplier-result-messages.ts` | 新 | — | **63** | ✅ |
| `lib/supplier-result-messages.test.tsx` | 新 | — | **85** | ✅ |
| `lib/supplier-write.test.ts` | 新(**拆檔一**) | — | **305** | ✅ |
| `lib/supplier-repository.test.ts` | 改 | 369 | **94** | ✅ |
| `lib/supplier-form.ts` | 改 | 166 | **200** | ✅ |
| `lib/supplier-form.test.ts` | 改 | 266 | **299** | ✅ |
| `components/settings/settings-result-banner.tsx` | 改(**計畫外**) | 40 | **49** | ✅ |
| `components/orders/result-banner.tsx` | 改(**計畫外**) | 29 | **35** | ✅ |
| `components/orders/result-banner.test.tsx` | 新(**計畫外**) | — | **43** | ✅ |

🔴 **兩處計畫外改動的理由與待補批**見 STATUS「Sean 待決策」欄 2026-08-02 條。

### S3b-3a manifest — ✅ **已收工**(純函式層;S3b-3 的 UI 元件仍未動工)

| 檔 | 新/改 | 基準 | **實測** | ≤400 |
|---|---|---|---|---|
| `lib/supplier.ts` | 改 | 32 | **71** | ✅ |
| `lib/supplier.test.ts` | 改 | **105** | **237** | ✅ |
| `lib/supplier-candidates.ts` | 新 | — | **56** | ✅ |
| `lib/supplier-candidates.test.ts` | 新 | — | **106** | ✅ |

🔴 **拆出 S3b-3a 的授權來源要講準**:§4 預先授權的是「超過 ~700 行或最大檔逼近 400 ⇒ 候選過濾獨立成 S3b-4」,
而**實際觸發是時間**(夜跑 06:30 不足以做完 UI 面 + 完整審查),順手把共用排序也一起拉出來
⇒ 這是**鐵則 4**(15-45 分鐘可中斷)的授權,**不是 §4 那條**。不得寫成「照 §4 拆的」。
✅ 驗收 16a-16g 已收;**16h(元件層釘住真的接到那支純函式)留 S3b-3**。
🔴 **16h 要一併釘順序,不能只釘數量**:候選來源必須是 `listSuppliersForSettings()` 的輸出;
若 UI 片直接餵 `listSupplierRows()` 的原始列,候選順序會變成 DB 回傳順序而 16h 看不見。

🔴 `[K1-n1]` v1 的基準行數兩處寫錯(`supplier.ts` 32 非 33、`supplier-repository.test.ts` 90 非 ~130),
已用 `wc -l` 實測回填。
🔴 **預估全面偏低(最大偏差 `supplier-repository.ts` +60%)** —— R1 must-fix #4 抓到本欄未回填。
S3b-2 / S3b-3 的預估要照這個係數重估,**不要沿用原數字**(否則是 `[K1-n1]` 的第三次復發)。

---

## §5 驗收條件(S3b-1;逐條可 yes/no。`[K1-n2]` 突變證據改列為子條,不再當獨立規格)

**A. 解析器(`supplier-form.ts`)**
1. 改名/停用解析:非 UUID 形狀的 `id` ⇒ `ok:false`。
2. 建立解析:label 為純 **U+200B** ⇒ `ok:false`(`[K1-M6]`;JS `.trim()` 過不了這關)。
   2m. 突變:把 31 字元集換成 `.trim()` ⇒ 本條轉紅。
3. label 101 字 ⇒ `ok:false`;100 字 ⇒ `ok:true`(邊界兩側各一)。
4. label 內含 `\n` / `\t`(剝完前後空白後仍在中間)⇒ `ok:false`。
5. 改名/停用解析:`id` 合法但 label 與 isActive **都沒給** ⇒ `ok:false`
   (對應 RPC 的「沒有要變更的欄位」RAISE,讓它在正常操作下不可達)。

**B. 呼叫面(`supplier-repository.ts`)**
6. `createSupplier` 呼叫 RPC 時,參數物件**逐欄**斷言:`p_supplier_id` 為 `null`、
   `p_label` = 解析後的值、`p_is_active` 為 `null`、`p_actor`/`p_request_id` 為傳入值(`[K1-M3]`)。
7. `updateSupplier` 同樣逐欄斷言,且 **`p_supplier_id` === 傳入的 id**(`[K1-M3]`;
   少了這條,mock 無論收到什麼都回 `UPDATED`,即使實作傳 `null` 也全綠)。
8. `updateSupplier` 收到 `'CREATED'` ⇒ **throw**,錯誤訊息含「多餘的供應商」(`[K1-M2]` 偵測層)。
   8m. 突變:拿掉該分支(讓 `CREATED` 落進成功路徑)⇒ 本條轉紅。
9. 兩支各自:RPC 回 `null` ⇒ throw;回未知字串(`'WHATEVER'`)⇒ throw(`[K1-M5]`)。
10. RPC 回 `error` ⇒ 原樣 throw(不吞成業務結果)。
11. **型別層**:`createSupplier` 的參數型別**沒有** `id` 欄;`updateSupplier` 的 `id` 為必填 `string`
    ⇒ 傳 `null` 是 typecheck 紅(以一段 `@ts-expect-error` 斷言釘住,拿掉會轉紅)。

**C. 全片**
12. 三綠:typecheck + lint(S3b-1 未動 `.tsx` ⇒ 不需 build)。
13. `pnpm test` 全綠(動到既有共用讀模型 ⇒ 跑完整套件)。
14. manifest 逐檔 `wc -l` ≤400,實測回填 §4。
15. S3a 既有 10 條測試零回歸。

> **S3b-2 / S3b-3 的驗收各自於該片開工前補寫**,含:
> `[K1-M8]` `?r=bug` 頁面真的顯示承重警告(jsdom) / `[K1-M9]` sidebar 少了連結要有測試轉紅 /
> `[K1-M7]` `loadFailed` ⇒ 新增表單**不渲染**(+突變) / `[K1-M10]` 排序單一來源兩層斷言 /
> `[K1-n6]` 三條 PRG 安全性質 / `[K1-n5]` log 不含 label 全文的字面要精確。

### S3b-3 的母 plan 驗收 16(D1=B 拍板後的測法,先寫在這裡免得開工時漂移)

純函式 `filterSupplierCandidates(rows, query)`,**零 React 依賴** ⇒ 下列全部是單元測試:

16a. 輸入 `Webike` ⇒ **恰 3 筆**(`Webike TW` / `Webike JP` / `Webike EU`),來源用母 plan §11 的真 seed 名單。
16b. 輸入不存在字串(`zzzz`)⇒ **0 筆**。🔴 **不再要求「不得變成自由文字新增」** ——
   D2=A 已把後半句移交 A10b(它與拍板 1「可自行再增加」矛盾)。本片明文:**候選是提醒、不是關卡**。
16c. **大小寫不敏感**:`webike` 與 `WEBIKE` 各自仍得 3 筆。
16d. **前後空白不影響**:`Webike` 前綴兩個半形空白、後綴一個 ⇒ 仍得 3 筆
   (向量在測試裡用 `'  Webike '` 字面寫,不靠本行的 markdown 呈現)。
16e. **含已停用的候選**(`[K1-M13]`):停用的 `Webike EU` 仍出現在候選裡,且回傳結構帶得出
   `is_active=false` 讓 UI 標「(已停用)」。⇒ 🔴 這條是契約債②的**送出前**防線,
   拿掉它就退回「送出後才撞 DUPLICATE_LABEL」。
16f. 空字串 query ⇒ 回全部(不是 0 筆)。
16g. **突變**:把比對改成「前綴」而非「包含」⇒ 需要一條輸入中段字(`bike`)的向量轉紅;
   把 `is_active` 過濾偷加回去 ⇒ 16e 轉紅。
16h. **元件層(jsdom,一條就好)**:輸入框打字後,畫面上出現的候選數 = 純函式對同一輸入的回傳數
   ⇒ 釘住「元件真的接到那支純函式」,而不是自己另寫一套比對
   (memory `feedback_text-level-tests-cannot-catch-runtime-wiring`)。

---

## §6 誠實邊界

- **`is_active` 仍無下游消費者**。本片讓員工按得到停用開關,但停用**不會改變任何其他畫面的行為**
  —— 真正消費它的是 A10b(採購表單選單),尚未做。⇒ 不得說「停用功能已生效」。
- 🔴 **`[K1-M16]` 改名會追溯改寫所有歷史採購的顯示名**(母 plan §6:243-245,Sean Q1=A 知情選擇):
  三月向「老吳精品」下的單,八月改名後會顯示新名字。**不存下單當時的名稱快照。**
  ⇒ **S3b-3 的改名表單旁必須有一行員工看得到的小字**講這件事,不能只寫在 plan 裡。
- 🔴 **`[K1-M4]` 不做逐列授權、不做樂觀鎖**:合法 UUID ≠ 正確目標;竄改 hidden input 或 stale 頁面
  可以改到別家供應商而三層都不即時報警。事後可查性 = RPC 稽核的 `before/after`。
- **actor 不是經過驗證的身分**(`session/actor.ts:6-7`)。稽核有非空 actor 字串,但那是**自陳**的;真身分屬 E8-B。
- **rollback 撤得掉 code,撤不掉資料**:上線後員工新增的供應商列**不可刪除**(S1a 三道守門)
  ⇒ revert 之後那些列仍在。這是拍板 2 的必然後果,不是缺陷。
- **近似重複三種形狀仍不擋**(內部空白 / 大小寫 / 標點)。typeahead 是**人眼**防線,不是機器守門
  —— 員工無視提示照樣送得出去,而那是拍板 1 的字面要求。
- **測試全是 mock**:action 測試 mock 掉 RPC,頁面測試 mock 掉 action。
  ⇒ 本片證的是「呼叫端把契約接對了」,**不是**「RPC 在正式站行為如預期」——後者由 S2 的 77 條 + S2-C 的 36 條背書,
  而那兩支跑在本機 PG17.10、C locale,**不外推正式站**(#305)。
- 🔴 **`[K1-M14]` / D3=B — 真瀏覽器驗收只按「可以還原的」**:
  本機沒有可用的替代環境(本機那顆 PG17 沒有 PostgREST 那一層,supabase-js 連不上)
  ⇒ 真瀏覽器一定打在**正式站**(實查:root `.env.local` 命中正式站 project ref)。
  **Sean 拍板 B**:可以按**停用 → 再啟用回來**、**改名 → 再改回原名**(資料回到原狀,只留稽核列,
  而稽核本來就該記錄這些);**絕不按「新增」**——供應商不可刪除,新增是唯一不可逆的動作。
  🔴 **殘餘缺口(不得說滿)**:**新增那條路的接線從未在真環境跑過**,只有 mock 測試背書。
  「按鈕真的接到 `createSupplier` 且真的寫得進去」這句話,在本線收工時**仍然是未經真環境驗證的**。
  🔴 收工報告必須逐字寫出這句,不得寫成「端到端已驗證」。
  🔴 操作前後各截一次圖 + 各記一次該列的 `label`/`is_active`,**證明真的還原了**,不是宣稱還原。
- **零 migration、零 TapPay 接觸面、零金額欄位。**

---

## §7 決策點 — ✅ **三題皆已拍板(2026-08-01 深夜)**

| 題 | 拍板 | 落點 |
|---|---|---|
| **D1** typeahead 實作與測法 | **B 自寫過濾**(未採 A 原生 `<datalist>`) | §4(多兩個檔)、§5 的 16a-16h |
| **D2** 驗收 16 後半的歸屬 | **A 移交 A10b**;S3b 只保留「候選是提醒、不是關卡」 | 母 plan `:223` superseded 註記、§5-16b |
| **D3** 真瀏覽器碰正式站到什麼程度 | **B 只按可以還原的**(停用↔啟用、改名↔改回);**絕不按新增** | §6 |

🔴 **D1 的前提我講歪過、當場更正**:Sean 逐字「我以為跟 excel 下拉選單一樣簡單」。
**功能本身確實那麼簡單**(`datalist` 五行就有),貴的是「證明它有效的自動測試」。
更正後他維持 B,理由改成①測得住「恰 3 筆」②撞名時能定位到那一列(§3.5)。
⇒ **同型教訓第二次**(前一次 = A7b 的 Q4 也是根據被誇大的描述答的)。
逐字與理由全文 = memory `project_m4b-supplier-master-decisions`。

**尚待 Sean:批准本 plan v3 + 三片拆法**(鐵則 8)。批准前零行 code。

---

## §8 相關既有紀錄與連動面(偵察 pass;🔴 v1 此節有兩處假證據,已重跑)

| 來源 | 命中 | 對本片的影響 |
|---|---|---|
| `docs/phase-1-backlog.md` grep 供應商 | **14 命中**,全屬爬蟲上架線(`supplier_slug` / `rpm-import` / `syncDescription`) | 無條目與主檔線衝突。🔴 **v1 寫「`docs/BACKLOG.md` 零命中」是假零** —— 該檔**不存在**,`2>/dev/null` 把錯誤吞掉(`[K1-M15]`)。結論不變,**證據換掉**。 |
| `apps/admin/src` grep `supplier` | 只有 `supplier.ts` / `supplier-repository.ts` + 兩支測試 | 消費面乾淨,本片是第一個 UI 消費者(**本日實 grep**) |
| graphify `supplier` 查詢 | 命中全屬爬蟲上架線 | 🔴 **`[K1-n4]` 圖是 08-01 11:19、`supplier.ts` 是 22:05 ⇒ 圖上看不到 S3a**(實查兩者 mtime)。⇒ 「零連動」的承重來源是**上一列的本日 grep**,不是這張圖。 |
| STATUS §下一步 | 逐字要求「排序抽共用函式」「三條契約債」 | 已折進 §3.2 / §3.3 / §3.5 |
| memory `feedback_null-dispatch-rpc-silently-downgrades` | A5a 同形狀;逐字記載根治法 = 型別層分流 | ⇒ §3.3 的兩支包裝函式;A5a 可沿用 |
| memory `feedback_text-level-tests-cannot-catch-runtime-wiring` | 直接適用 | ⇒ §3.2 的結構斷言不得單獨當證據;真瀏覽器見 D3 |
| memory `feedback_control-named-beyond-its-actual-power` | 直接適用 | ⇒ §3.3 三層能力表逐層寫「擋不住什麼」 |
| Vitest `beforeEach` 陷阱 | `supplier.test.ts:16` 已寫大括號 | 新測試檔一律大括號 body;repo 另 4 處**不順手改**(Sean 未拍板) |

---

## §9 rollback

零 migration ⇒ `git revert` 即完全還原 code。
唯一不可逆 = 上線後員工建立的供應商列(§6)。三片依序 revert(S3b-3 → -2 → -1)。

---

## §10 v1 被實查推翻的三處字面(留著防再犯)

1. **§8「`docs/BACKLOG.md` 零命中」** —— 檔案不存在,`2>/dev/null` 把命令失敗吞成零結果。
   同型教訓 = `docs/lessons-learned.md` §13(凡結論將寫「查無」)。
2. **§4 基準行數兩處** —— 憑印象寫,未 `wc -l`。違反字面值三來源律。
3. **§5-18 真瀏覽器驗收** —— 寫成「新增一家 → 改名 → 停用」而沒問「這打到哪個資料庫」。
   實查 root `.env.local` 命中正式站 ref ⇒ 照做會在正式站留下不可刪除的測試資料。

— END v2 —
