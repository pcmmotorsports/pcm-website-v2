# M-4b E10 `A9d2-1` 片級 plan — 訂單備註寫入 server action

> 母 plan(權威)= `docs/specs/2026-08-02-e10-notes-line-plan.md` **v4 §5 的 A9d2-1 段 + F3**。
> 本檔只補「母 plan 沒展開的實作面」;**與母 plan 衝突時以母 plan 為準**。
> 片型 = **高風險片**(鐵則 12 ②權限:授權邊界 + server action)⇒ 全 9 步、關卡1/2 不降級。
> 前置已滿足:`A6` 已 apply 正式站(RPC 在)、`A9a-1` 已收工並 push(讀模型在)。

---

## §1 範圍(做什麼 / 不做什麼)

**做**:三支純函式 + 一支 repository + 一支 server action,讓「寫一筆訂單備註」這條路在**程式層**打通。

**不做(明文邊界)**:
- ❌ **任何 UI** —— 表單、時間軸、更正入口全屬 `A10a`。⇒ 🔴 **本片收工時 action 仍是零呼叫端、員工按不到、27 項驗收貢獻仍為 0**(與 A9a-1 相同,Sean Q2=A 一片一片來的已知代價)。
- ❌ 取消單的 action(母 plan `[49]`:那是 `A9d2-2`、不在本線)。
- ❌ 任何 migration(A6 已 apply;本片零 schema 改動)。

---

## §2 產物

| 檔 | 內容 | 預估行數 |
|---|---|---|
| `apps/admin/src/lib/orders/note-form.ts` | 純解析器(零 React / 零 DB):`parseOrderNoteForm` | ~150 |
| `apps/admin/src/lib/orders/note-repository.ts` | `appendOrderNote()` 呼 `admin_append_order_note` + **14 碼窮盡收斂** + `OrderNoteCallerBugError` | ~130 |
| `apps/admin/src/lib/orders/note-actions.ts` | `'use server'`:授權閘 → 解析器 → repository → **失敗回 state / 成功 PRG**(Sean Q1=A) | ~150 |
| `apps/admin/src/lib/orders/note-action-state.ts` | `NoteActionState` 型別 + 失敗訊息表(**員工看到的字**)+ token 產生器/驗證器(Q2=C) | ~100 |
| `apps/admin/src/components/orders/result-banner.tsx` | 既有檔**只加兩個成功碼**(失敗改走 state ⇒ 不再需要為每個錯誤碼加一則) | +~6 |
| 三支 `*.test.ts` | 見 §6 | ~450 |

鐵則 6:任一檔逼近 300 行 ⇒ 當場拆(S3b-2 的前例:`supplier-actions.test.ts` 撐到 393 行才拆是錯的)。

---

## §3 契約(逐條對照 A6 migration,附 `檔案:行號`)

檔 = `supabase/migrations/20260802150000_m4b_e10_a6_admin_append_order_note.sql`

| # | RPC 事實 | 行號 | 本片的鏡像義務 |
|---|---|---|---|
| C1 | 簽章 8 參數 `(p_order_id, p_note_type, p_body, p_channel, p_occurred_at, p_corrects_note_id, p_actor, p_request_id)` | `:82-89` | repository 逐欄具名送、**不 spread**(S2 契約債①的教訓:spread 繞過 TS 多餘屬性檢查) |
| C2 | `p_actor` 須 `^[a-z0-9_]{1,64}$`,否則 **RAISE(非固定碼)** | `:144-146` | actor 來自 `authorizeAdminMutation().actorId`;**不驗、不改寫** —— 它已是 staff slug,若哪天不是,fail-loud 比靜默正規化好 |
| C3 | `p_request_id` 缺/空/>200/含控制字元 → RAISE | `:147-156` | 見 §4 冪等鍵設計 |
| C4 | `internal` ⇒ channel 與 occurred_at **必須都 NULL**;非 internal ⇒ **都不得 NULL** | `:162-163` | 解析器**按型別分流建構**,不是「有填就送」 |
| C5 | `occurred_at` 界外 → `OCCURRED_AT_OUT_OF_RANGE`;晚於 now+5min → `OCCURRED_AT_IN_FUTURE` | `:164-165` | 解析器**不重做**這兩道(單一真相在 RPC);只做形狀解析 |
| C6 | body 去零寬去空白後為空 → `INVALID_BODY`;>4000 碼位 → `BODY_TOO_LONG` | `:166-167` | 同上不重做;但 §5 有一條**例外**(見 B3) |
| C7 | 回 **14 個固定碼**,其餘一律 RAISE | `database.types.ts:19-22` | repository **窮盡收斂 14 碼**,未知碼 → `OrderNoteCallerBugError` |
| C8 | `DUPLICATE_REQUEST` = 已查驗過的真重送(同單 + body_sha256 相符) | `:170-171` | **按成功處理**(母 plan F3) |
| C9 | request_id 已用過但**內容不符** → RAISE(fail-loud) | `:172` | 映射成 `bug`(叫員工停手),**不得**映射成 `error`(那會叫他再試 = 換個 token 再送一次 = 真的多一筆) |

### 🔴 C9 的判別機制(F4:原 plan 只寫「映射成 bug」,沒寫**怎麼認出它**,而預設行為正好是災難)

RPC 的 RAISE 到 JS 層是**被拋出的 `PostgrestError`(`code === 'P0001'`)**,不是回傳碼。
而樣板 `supplier-actions.ts:86-100` 的分流:**非 `CallerBugError` 的 throw 一律回 `'error'`**(=「稍後再試」)
⇒ 照樣板實作,C9 **必然**落進 `error` ⇒ 員工重載換 token 重送 ⇒ **真的多一筆刪不掉的備註**,
正是 C9 自己警告的那件事。

**規定**:repository 對 `error.code === 'P0001'` 包成 `OrderNoteCallerBugError`
(本 RPC 的**所有** RAISE 面 —— 步 1 參數面 `:134-156`、步 11 冪等面 `:172`、常數自檢 `:123`/`:126` —— 都是 caller-bug 語意,收斂一致)。
🔴 **H6 的 mock 必須帶真實 `PostgrestError` 形狀的 `code` 欄** —— 只 mock 一個裸 `Error` 的話,
這格會恆綠(memory `reference_supabase-update-needs-select-and-chain-mock-fake-green` 同型)。

---

## §4 🔴 冪等鍵設計(本片最重要的決定)

**問題**:`getRequestId()`(`lib/audit/context.ts:18-21`)讀的是 middleware 每個 **HTTP request** 戳的 `x-request-id`
⇒ 員工**雙擊送出 = 兩個 HTTP request = 兩個不同 request_id = 兩筆備註**,
而 `order_notes` 是 **append-only、刪不掉**(A3 `:21-27`)⇒ 那筆重複永久留在時間軸上。

**A6 的 `DUPLICATE_REQUEST` 在這個用法下永遠不會被觸發** —— 母 plan F3 花力氣規定「它要按成功處理」,
但若 key 每次都變,那條規定就是**對一個不可達分支的規定**(= 我在 A6 那片自造死守門 `[38]` 的同型錯誤)。

**修法(本片採用)**:`p_request_id` 改吃**表單自帶的一次性 token**,不是 HTTP request id。
- A10a 渲染表單時產一個 uuid v4 放 hidden input(**契約債,寫進本檔 §8 交給 A10a**)。
- 解析器**強制**該欄存在且為 uuid 形狀;缺 → `invalid`(fail-closed,不 fallback 到 HTTP id —— fallback 等於靜默退回沒有冪等)。
- ⇒ 雙擊 / 重新整理後重送 = **同一個 token** = 第二次回 `DUPLICATE_REQUEST` = 按成功處理 = **只有一筆備註**。

**🔴 F2:本設計推翻一條已落檔的安全決策 —— 必須由 Sean 拍板,不得由我默默改**

`apps/admin/src/proxy.ts:21-24` **逐字**:「correlation id **一律 server 新產、絕不沿用 inbound**…
沿用會讓持 session 者**指定 / 重複 request_id 汙染稽核關聯**(actor 已自報,request_id 是稽核鏈
**僅剩的硬關聯**、必須 server 權威)。忽略 request.headers 的同名值。」
—— 而那行本身是**上一次 Fable 審查的 must-fix 修出來的**。

§4 把 `p_request_id`(= 落進 `admin_audit_log.request_id` 的那個值)改成**表單 hidden input**
= client 可自選 ⇒ **直接推翻該決策**。殘餘防線只剩 A6 的查驗式冪等(同單 + `body_sha256` 相符才算重送,
否則 RAISE `:172`),它擋得住「偽造成功」,但擋不住「持 session 者自選稽核關聯值」。
⇒ **列為 §9 Q2 決策題**;未拍板前不動 code。

**誠實邊界(不宣稱涵蓋)**:
- 員工**重新載入頁面**再送一次 = 新 token = 真的第二筆。那是「他真的想再寫一筆」與「他以為沒成功」無法區分的情形,本層不處理。
- 🔴 **F5:上一頁(bfcache)還原的是舊 DOM = 舊 token**。員工按返回、改幾個字、重送 ⇒ 同 token + 不同 body
  ⇒ 撞 C9 的 RAISE ⇒ 看到「停手、通知維護者」,但他做的是**完全正常的操作**。
  ⇒ ①C9 的文案必須涵蓋「同一張表單改內容重送」②§8 給 A10a 一條:實測返回鍵後 token 是否重新產生。
- 稽核的 correlation id 與冪等鍵**因此合而為一** ⇒ 稽核列的 `request_id` 不再等於 HTTP `x-request-id`。
  🔴 **兩者都要進 attempt log 且是驗收格**(F2;只寫在 prose 裡的話,刪掉那行 log 不會有任何測試轉紅)。

---

## §5 解析器契約(`note-form.ts`)

輸入 = `FormData`,輸出 = `{ ok: true, … } | { ok: false }`(沿用 `supplier-form.ts` 形狀)。

| # | 規則 | 為什麼在這層做 |
|---|---|---|
| B1 | `orderId` 必填且為 uuid 形狀 | 路由參數不透傳;非 uuid 打 RPC 只會拿到 `INVALID_INPUT`,擋在前面省一次往返 |
| B2 | `noteType ∈ {internal, contact_log, customer_notified}`;**按型別分流建構** channel / occurredAt | C4:兩組互斥規則,型別層分流比 runtime if 更難寫錯 |
| B3 | body **只做「存在且非全空白」**;🔴 **不重做 4000 碼位上限**(單一真相在 RPC) | 例外:`.length` vs 碼位的坑(S3b-1 前例)⇒ 若哪天要在前端擋,必須用 `[...s].length` |
| B4 | `requestToken` 必填 + **形狀由本片 export 的驗證器定義**(見下) | §4 |
| 🔴 B7 | **`occurredAt` 解析與時區**(F6:原 plan 整條漏掉) | 見下 |
| B5 | `correctsNoteId` 選填,有值須 uuid 形狀 | 更正鏈入口(A10a 用) |
| B6 | 🔴 **不做 trim 以外的正規化** —— body 原文送進 DB | A6 的 `body_sha256` 冪等比對量的是**原文**;這層若改寫內容,重送會被判成「內容不符」而 RAISE |

### 🔴 B7 `occurredAt` 時區(F6:原 plan 整條漏掉,而這是本片最容易靜默寫錯資料的地方)

`<input type="datetime-local">` 的 value **不帶時區偏移**(`2026-08-02T14:30`)。
server 跑在 **UTC** ⇒ 直接 `new Date(value)` 會把員工心裡的**台北 14:30 存成 UTC 14:30 = 台北 22:30**:
**差 8 小時、落在 RPC 的 2020-2100 與 now+5min 界內 ⇒ 靜默接受 ⇒ append-only 永久留存**,
而這一欄正是 **U6 告知義務的證據時間**(「我什麼時候通知客人的」)。

**規定**:
1. wire 格式**釘死為帶偏移的 ISO 字串**(A10a 端負責產;契約債見 §8)。解析器**拒收不帶偏移的字面**
   → `invalid`(fail-closed;**不得**自行假設 `Asia/Taipei` 補上去 —— 那等於用猜的寫法律證據)。
   🔴 **`Z` 結尾算合法偏移**(R2 nit:`toISOString()` 產的就是 `Z`,那是 A10a 最自然的產法;
   驗證器只認 `+hh:mm`/`-hh:mm` 會把它擋掉)。
2. 驗收要有**時區向量**:同一個掛鐘時間配不同偏移 ⇒ 送進 RPC 的 UTC 瞬間不同(殺「把 offset 丟掉」的突變)。
3. **不重做** RPC 的界外 / 未來判定(C5),只做形狀。

### 🔴 B4 的 token 形狀:必須由本片 export、不得寫 prose(F3)

repo 現成的 `generateRequestId()`(`lib/request-id.ts:13-15`)回的是 **`req_<uuid>`、不是裸 uuid**。
原 plan §8 只用 prose 寫「uuid v4」⇒ A10a 最自然的寫法(重用那支現成產生器)會**每次都被判 `invalid`、整條功能死掉**,
而本片測試**照樣全綠**(片界外不可驗)。
⇒ 本片 export **一組**產生器 + 驗證器(同一個常數/正規式),§8 的契約債**引用符號名、不引用文字描述**。

---

## §6 驗收(每條都要有能殺掉它的突變)

**H1 授權**:未授權 → `denied` 且 **RPC 零呼叫**;🔴 **並要證明「授權真的短路解析」** —— 餵一個 `get()` 會爆炸的 FormData,未授權時不得爆(S3b-2 R2-R2 的教訓:只釘「回應優先序」釘不住短路)。
**H2 解析失敗** → `invalid` 且 RPC 零呼叫。
**H3 14 碼三類映射逐碼**(母 plan F3):成功型 2 / 可改輸入型 9 / 呼叫端 bug 型 3 —— **逐碼一格**,不得只測代表值。
**H4 `DUPLICATE_REQUEST` 走成功路徑**(與 `APPENDED` **同一個結果頁**),且**不得**顯示成錯誤。
**H5 未知碼 / null** → `OrderNoteCallerBugError` → `bug`(叫員工停手)。
**H6 C9 的 RAISE**(request_id 重用但內容不符)→ `bug`,**不是** `error`。
**H7 internal 送出時 channel / occurredAt 逐欄斷言為 `null`**(深度相等,加欄會轉紅 —— S3b-2 釘 `p_note` 的同一手法)。
**H8 `revalidatePath` 在成功與失敗路徑都被斷言**(S3b-2 前例:漏斷言 ⇒ 刪掉它全綠)。
**H9 冪等**:同一 token 送兩次 → 第二次回 `DUPLICATE_REQUEST` → 成功頁。
🔴 **F1:光這樣寫是恆真格** —— 若實作者照樣板繼續用 `getRequestId()`,而測試 mock 的 header 兩次回同一個
`x-request-id`(最典型的 mock 寫法),這條**照樣全綠 = §4 整個設計靜默不存在**。
⇒ H9 必須:①把 `x-request-id` 設成**與表單 token 不同的值** ②斷言 RPC 實際收到的 `p_request_id`
**字面等於表單 token**(不是等於 header 值)。
**H10 open-redirect 面**(**R2-1 依 Sean Q1=A 重寫**):Q1=A 之後**失敗路一律回 state、不 redirect**
⇒ ~~F11 原本的「denied / invalid 一律 redirect 固定 `/orders`」作廢~~(那條與 Q1=A 直接矛盾,
照它實作會把員工打的 body 丟掉)。
⇒ H10 縮成:**唯二會 redirect 的是兩個成功碼**,其目標 = 寫死常數 + `orderId`,
而該 `orderId` **必然已通過 B1 的 uuid 驗證**(成功路徑蘊含解析成功)⇒ 釘成測試:
非 uuid 的 orderId **永遠到不了 redirect**(它在 B1 就變成 state 了)。
F11 的原始關切仍留作**回歸守門**:哪天有人把任何失敗路改回 redirect,必須先問「這條路手上有已驗的 orderId 嗎」。

**🔴 H14 成功 redirect 不得被自己的 try 吞掉(R2-3)**:`redirect()` 是**拋 `NEXT_REDIRECT`**。
樣板 `supplier-actions.ts:163-177` 的結構直覺是「把 RPC 呼叫包 try、catch 裡分流」——
混合形下若順手把成功的 `redirect()` 也放進那個 try,**catch 會吞掉 NEXT_REDIRECT、把已成功的寫入分類成 `error` state**
⇒ 員工看到錯誤訊息、但備註**已經寫進去了**,而他會再寫一次。
⇒ 明訂:成功 redirect **必在 try 之外**(或 catch 對 redirect error rethrow);
驗收要有一格斷言「成功路徑確實拋出 redirect」(mutant:把 redirect 移進 try ⇒ 轉紅)。
**🔴 H11 log 面(F10)**:①attempt log **只准記 `body_length`,禁記 body 全文**(樣板 `supplier-actions.ts:153-158`
刻意只記 `label_length`,但本 plan 原本一條都沒寫 ⇒ 實作把 4000 字備註塞進 log 也全綠)
②DB error log **明文禁記 `details` / `hint`** —— PG 23514 的 DETAIL **會帶整列內容 = 備註全文進 Vercel log**
③**同時記表單 token 與 HTTP `x-request-id` 兩者**(F2 的可追蹤性補償),刪掉任一要轉紅。
**🔴 H12 結果碼集合(F9;範圍已依 Q1=A 縮成成功碼)**:本片 **會 redirect 的碼**(= 兩個成功碼)
**⊆ `result-banner.tsx` 已註冊鍵**(集合斷言)—— 漏註冊時員工 redirect 後看到**一片空白**,
會以為備註沒寫進去而再寫一次。
🔴 ~~舊動機句寫「最需要被看見的正是 `bug` 那個碼」~~ **已不成立**(R3 nit):Q1=A 之後 `bug` 走 state、
根本不 redirect;照舊字面讀會誤把 `bug` 註冊進 banner。

---

## §7 風險

| # | 風險 | 處置 |
|---|---|---|
| R1 | `orders/result-banner.tsx` 目前**帶著已知的原型鏈缺陷**(Sean 08-02 拍板 **B 退回**修正)⇒ 本片新增的碼一樣會被 `?r=__proto__` 畫出空框 | **不順手修**(那是 Sean 拍板退回的東西);本片只加碼、不改查表方式。若他改變主意,那是獨立一片 |
| R2 | action 收工時零呼叫端 | 明寫在 STATUS / commit;**不得**說「備註可以寫了」 |
| R3 | `actor` 是自選 picker cookie、非驗證身分(E8-B) | 稽核列會有非空 actor,但那是自陳;文件不得寫成「誰寫的有據」 |
| R4 | RPC 對 `orders` 取 `FOR UPDATE`(`:168`)⇒ 與改單 / 金流 RPC 的鎖序 | 母 plan §6 R7 已盤過:皆 orders 先行、同向、無環。本片不新增鎖 |

---

## §8 交給 A10a 的契約債(缺一則本片的設計不成立)

1. 🔴 **表單必須帶 `requestToken` hidden input**,值 = **`state.requestToken ?? 本片產生器新產一個`**
   (R2-2:失敗重渲染時**必須沿用 state 帶回的那一把**,換新的等於在 `error` 路上製造第二筆永久備註)。
   產生器符號名見 §5 B4;🔴 **不得**重用 `lib/request-id.ts` 的 `generateRequestId()` —— 它回 `req_<uuid>`、形狀不符。
   缺了它解析器一律回 `invalid`,備註功能整條不能用。
   🔴 **token 的產生點不得落在任何快取層內**(R2-4):`unstable_cache` / `React.cache` 包住表單元件會把 token 凍住
   ⇒ 多次載入拿到同一把 = 第二個人寫備註直接撞 `DUPLICATE_REQUEST` 或 C9 RAISE。
   頁層 `/orders/[id]/page.tsx:14` 是 `force-dynamic`(已實查)⇒ 頁層無此問題,**風險只在元件層自己加快取**。
2. 🔴 **`occurredAt` 必須送帶時區偏移的 ISO 字串**(§5 B7);送 `datetime-local` 原始值會被拒。
3. 🔴 **A10a 驗收必含端到端雙擊實測「只留一筆」**(F8)—— 冪等鏈的最終觀察只在 UI 片可得,
   不寫進債就永遠沒人驗。
4. 🔴 **實測返回鍵(bfcache)後 token 是否重新產生**(F5);沒重產會讓正常的「改幾個字再送」撞 C9。
5. 🔴 `customerNotified` 是 `boolean | null`,**`null` 必須顯示「無法判定」**,不得 `?? false`(A9a-1 交下來的)。
6. 更正入口:已被更正的列要 **disable**(母 plan F6;partial unique 一筆只能被更正一次)+ 「不可撤回」文案在**送出前 confirm**。
7. 走更正鏈必帶 **visited 集合與深度上限**(環在 DB 層可達,只是應用路徑不可達)。

---

## §9 決策題 —— ✅ **Sean 2026-08-02 深夜已拍板**

### Q1 = **A:錯誤路徑保留員工輸入**(F7)

action **不用**樣板的 `Promise<void>` + 全路徑 PRG,改**混合形**:
- **失敗**(9 個可改輸入型 + `invalid` + `denied` + `bug` + `error`)→ **回傳 state**,員工打的 body 留在框裡。
- **成功**(`APPENDED` / `DUPLICATE_REQUEST`)→ 仍 `redirect`(PRG:避免重整重送)。

⇒ 簽章 = `(prev: NoteActionState, formData: FormData) => Promise<NoteActionState>`(`useActionState` 形狀)。
🔴 **這是本片定死、A10a 只能繼承的介面** —— 事後改成本高,所以在寫 code 前拍。
🔴 **連動改動**:
- §6 的 H2/H3/H5/H6 斷言對象從「redirect 到哪個 `?r=`」改成「**回傳的 state 物件**」;
  只有兩個成功碼還走 redirect ⇒ **H12(碼集合 ⊆ banner)的範圍縮成「成功碼」**,失敗訊息改由 state 帶。
- 🔴 **新增 H13**:失敗 state **必須帶回員工輸入的 body**(否則「保留輸入」是空宣稱);
  且**不得**把 body 塞進 URL(H11 的 log 面同理)。
- 🔴🔴 **H13 續(R2-2:Q1=A 把 Q2=C 在最需要的那條路上拆掉了)** —— 失敗 state **必須原樣帶回
  `requestToken`**,且 §8 給 A10a 的債改成「表單 token 取 `state.requestToken ?? 新產一個`」。
  **推導**:H8 要求失敗路也 `revalidatePath` ⇒ server component 重渲染 ⇒ hidden input 拿到**新 token**;
  而 `error` 這個分支的定義正是「RPC **可能已 commit**、只是回應斷在路上」(§3 C9 上方的分流表)
  ⇒ 員工重按 = 新 token = **A6 認不出是重送 = 真的第二筆永久備註**。
  ⇒ 驗收加一格,mutant = 「失敗 state 不帶 token」⇒ 轉紅。
- §8 給 A10a 的債 +1:表單必須用 `useActionState` 接,不能當成 `action={fn}` 的 void form。

### Q2 = **C:表單渲染時由 server 發 token、client 只回送**(F2)

- token 由**本片 export 的產生器**在 **A10a 的 server component 渲染時**產生 → hidden input → 回送。
- ⇒ **正常路徑仍是 server 權威**,`proxy.ts:21-24` 的精神在 honest path 上維持。
- 🔴 **誠實代價(Sean 知情選擇,不得寫成「已解決」)**:持 session 者若繞過畫面直接 POST,
  仍可自選 / 重複那個值 —— **A 案與 C 案在這點上一樣擋不住**,C 只贏在正常路徑。
  殘餘防線 = A6 的查驗式冪等(同單 + `body_sha256` 不符即 RAISE `:172`),它擋「偽造成功」、
  不擋「自選稽核關聯值」。⇒ `proxy.ts:21-24` 的註解**登記為文件債**:本片在 `order_note.append`
  這條路上是例外,要在該檔註解補一行指回本 plan(不改行為)。
- H11 仍要求 **token 與 HTTP `x-request-id` 兩者都進 log**(可追蹤性補償)。

---

## §10 關卡1 紀錄

- **codex**(`gpt-5.6-sol` xhigh):兩次皆未產出結論(第一次 10 分鐘逾時、第二次背景跑 exit 0
  但輸出只有讀檔過程、零 finding)⇒ 依「同一件事最多重試 2 輪」**停止重試**;跑前後 `git status --porcelain`
  比對**零留痕**。
- **Fable `adversarial-reviewer`(換模型、換角度)= NO-GO**:8 must-fix(F1/F2/F3/F4/F6/F7/F10/F11)
  + 3 consider(F5/F8/F9)。**逐條親驗:全部成立、駁回 0。**
  親驗重點三處:`proxy.ts:21-24` 逐字確認(F2 成立且該行本身是前一次 Fable must-fix 的產物)、
  `request-id.ts:13-15` 確認回 `req_<uuid>` 非裸 uuid(F3 成立)、
  `supplier-actions.ts:86-100` 確認非 CallerBugError 一律落 `error`(F4 成立)。
- **本輪折入**:F1/F3/F4/F5/F6/F8/F9/F10/F11 已寫入上列各節;**F2 與 F7 升為 §9 決策題**(不由我拍)。
- Fable 的收斂條件逐字:「plan 補上 F4 的 P0001 判別機制與 F1 的 arg 斷言後,剩餘條目不足以擋 GO」
  ⇒ 兩者皆已折入;**複核只需對 F1/F4/F6/F11 四條**,不需重審全輪。
- **R2 複核 = NO-GO,3 must-fix + 1 consider + 1 nit,逐條親驗全成立、駁回 0。**
  🔴 **三條 must-fix 全部是 Sean 兩拍板帶進來的新洞**(R1 看過的版本裡不存在)⇒ 第二輪不是形式:
  - **R2-1**:F11 的「denied/invalid redirect 到 `/orders`」與 Q1=A「失敗回 state」**直接矛盾**,
    照 §6 字面實作會把員工的 body 丟掉 ⇒ H10 改寫成「唯二 redirect = 成功路」。
  - **R2-2(真洞)**:失敗 state 沒規定帶回 `requestToken` + H8 要求失敗也 revalidate
    ⇒ 重渲染換新 token ⇒ **`error`(可能已 commit)路上重按 = 第二筆永久備註**
    ⇒ 冪等設計在它最該生效的那條路上被靜默拆掉。已補 H13 續 + §8-1 改為沿用 state 的 token。
  - **R2-3**:`redirect()` 拋 `NEXT_REDIRECT`,包進 try 會被 catch 吞成 `error`
    ⇒ **寫入已成功卻告訴員工失敗** ⇒ 新增 H14。
  - R2-4(consider)/ F6-nit(`Z` 也是合法偏移)亦已折入。
  - Fable 自驗並更正了我一處引用:`force-dynamic` 在 `page.tsx:14`(它寫 `:15`),我以實查為準。
- **R3 窄複核(只對 R2-1/R2-2/R2-3 三條)= GO**:三條全判「真修、零位移」;
  另指出一句過時動機文字(H12 原本寫「最需要被看見的正是 `bug` 碼」—— Q1=A 後 `bug` 走 state 不 redirect),
  已改寫。**關卡1 至此收斂:R1 NO-GO 8 → R2 NO-GO 3 → R3 GO,共 11 must-fix + 4 consider/nit,逐條親驗、駁回 0。**
- 🔴 **本表的行號自己也錯過一輪**:§3 契約表原本系統性偏移 2-6 行(關卡2 MF5 抓),
  且 `note-repository.ts` / `note-form.ts` 的註解是**從這張表繼承**下去的 ⇒ 一張表錯,三個地方一起錯。
  已全部改以 `grep` 實查值重寫。**教訓**:契約表的行號要逐條 grep 錨定字串取得,不能用 `sed` 視窗目測。
