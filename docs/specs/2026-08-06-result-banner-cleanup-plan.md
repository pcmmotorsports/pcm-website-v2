# backlog #332 死碼收尾片 plan v1 — 三筆「無主」死碼一次收

> **產出**:E 窗(九碼退場線)第三棒,2026-08-06 夜跑,依 `E-107-A`。**零實作、本檔只是計畫。**
> **基準**:分支 `nine-code-retire`(HEAD `cecbc96`,上游 dev = `f8ede20`)。
> **來源**:`docs/phase-1-backlog.md:9049`(#332 全文)。
> **本檔內每個 `檔案:行號` 都是本輪親查**;引到的行都印出來比對過。

---

## §0 先講結論(只讀一段的話讀這段)

1. **#332 不必等 A11 全鏈** —— 三筆死碼裡沒有任何一筆的前置是 A9w4a / A9w4c 後半。
   `A11a` plan §4 把 #332 排在退場鏈第四棒,那是**敘事順序不是依賴順序**。可隨時排。
   (唯一會產生耦合的做法 = 「合併三份同字面 RE」,而那件事 §2.3 裁定**不做**。)
2. **拆兩片**:`#332-1`(domain 零 consumer export,輕量片、15 分)/ `#332-2`(兩支 banner,標準片、30-40 分)。
   兩片彼此無依賴,可各自獨立排。
3. **`#332-2` 需要 Sean 先點頭**(§6 Q1)—— 2026-08-02 拍板 B 的字面是「**要再修的話**,兩支元件要一起、並且走 plan」,
   本檔是那個 plan,但「要不要現在修」他還沒說。
4. **對 27 項驗收表的直接貢獻 = 0 格**。這是純債務片,收割回報不得寫成「讓第 N 項變綠」。

---

## §1 現況(逐筆,含實證)

### 1.1 筆①:`WORKFLOW_STATUS_CODE_RE` —— 零 consumer 的 domain export

| 位置 | 現況 |
|---|---|
| `packages/domain/src/order/types.ts:245` | 定義本體 `/^[a-z0-9_]{1,64}$/`;`:236-244` 的 docstring 已自陳「A9w3 起零 consumer」 |
| `packages/domain/src/index.ts:32` | 對外 re-export |
| `packages/domain/src/index.ts:31` | 🔴 **過期註解**:逐字寫「解析層與 adapter `.or` 內插前**共用單一來源**」——兩個 consumer 都在 A9w3 死了,這行現在是假的 |
| `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:18` | 註解,記載「唯一用途已移除」;**歷史敘事、正確,不必動** |
| `packages/domain/src/order/order-number-search.ts:12` | 註解,拿它當「同套路」的例子;**正確,不必動** |

實證零 consumer:全樹 `grep WORKFLOW_STATUS_CODE_RE` 只有上列 4 筆,其中 **2 筆是註解、1 筆是定義、1 筆是 re-export**,
**沒有任何一行 import 它**。

### 1.2 筆②:`settings-result-banner.tsx` 的預設 `MESSAGES` —— 零 caller 的死詞彙

- 表本體 `apps/admin/src/components/settings/settings-result-banner.tsx:8-19`,7 個碼;
  其中 `created`(「已新增狀態選項。」)、`duplicate`(「代碼(code)已存在…」)是 **order-statuses CRUD 專用詞彙**,
  該頁已於 A9w2 下架。
- 元件簽名 `:27-33`:`messages?: SettingsResultMessages`,預設值 `= MESSAGES`(`:29`)。
- **兩個 caller 都顯式傳表**:
  - `apps/admin/src/app/settings/staff/page.tsx:42-44` → `messages={STAFF_RESULT_MESSAGES}`
  - `apps/admin/src/app/settings/suppliers/page.tsx:108-110` → `messages={SUPPLIER_RESULT_MESSAGES}`
  - 測試 `apps/admin/src/lib/supplier-result-messages.test.tsx:27,50` 也顯式傳。
  ⇒ **預設值這條路徑在 production 與測試裡都不可達。**
- 死詞彙字面全樹只剩本檔兩行(`grep '已新增狀態選項'` / `'代碼(code)已存在'` 各 1 命中,均在 `:10` / `:12`)。

### 1.3 筆③:兩支 banner 的原型鏈守門缺陷

| 元件 | 缺陷行 | 受影響頁面 |
|---|---|---|
| `apps/admin/src/components/orders/result-banner.tsx:82-83` | `const msg = MESSAGES[code]; if (!msg) return null;` | 4 頁:`app/orders/page.tsx:80`、`app/orders/[id]/page.tsx:134`、`app/customers/[id]/page.tsx:83`、`app/orders/refund-exceptions/page.tsx:62` |
| `apps/admin/src/components/settings/settings-result-banner.tsx:49-50` | `const msg = messages[code]; if (!msg) return null;` | 2 頁:`app/settings/staff/page.tsx:42`、`app/settings/suppliers/page.tsx:108` |

**共 6 頁**(本輪實測 import 端,與兩支元件註解裡的「6 個」相符)。
機制與嚴重度見 memory `reference_js-index-lookup-hits-prototype-chain`:`?r=__proto__` / `constructor` /
`toString` / `valueOf` / `hasOwnProperty` 取到原型鏈屬性且 truthy ⇒ `if (!msg)` 放行 ⇒ 畫出
`class="… undefined"` 的空框。**不是注入**(`msg.text` 是 `undefined`,React 不渲染文字),
是「守門的名字大於它的能力」。

**拍板紀錄(權威來源)**:`docs/specs/2026-08-01-e10-supplier-s3b-settings-page-plan.md:397`
逐字記載 Q1=**B 退回**,理由是「不在該片產物表、鐵則 8 灰區」;同列並記「退回後受影響頁面**從 5 個變 6 個**」。
兩支元件註解(`result-banner.tsx:68-81` / `settings-result-banner.tsx:35-48`)是同一份拍板的落檔。

---

## §2 三個「先裁掉、不進決策題」的判斷

### 2.1 修法形狀 = `Object.hasOwn`,不改 `Map`

本 repo **兩種硬化慣例並存**,各有適用面:
- `Object.hasOwn` —— `apps/admin/src/lib/payment/refund-ledger-view.ts:29`、
  `apps/storefront/src/app/brands/[slug]/page.tsx:62`、
  `apps/storefront/src/app/dev-preview/brand-page/[slug]/page.tsx:30`。
- `Map.get()` —— `packages/adapters/src/email/ResendEmailSenderAdapter.ts:85-88`(逐字警告「勿順手改回物件字面量」)。

**裁定取 `Object.hasOwn`**:`Map` 那條慣例的成立理由是「key 來自外部 provider 且錯誤碼會落 DB、
取到函式會讓下游 allowlist 改寫」(該檔 `:85-88`);banner 的 key 只影響「畫不畫一個框」,
把六張碼表全改成 `Map` 是為了一個顯示面付結構成本。**取最小 diff、且與距離最近的兩個實作對齊。**

### 2.2 修法本體不必重新設計 —— 歷史上寫過一次

`4833cae`(S3b-2)曾把兩支都修好並上線,08-02 才退回。實作時直接
`git show 4833cae -- apps/admin/src/components/orders/result-banner.tsx apps/admin/src/components/settings/settings-result-banner.tsx`
取回即可。
⚠️ 誠實註記:退回那筆 commit **沒被 `git log -S` 定位到** —— 因為現行檔案的**註解裡**留著
`Object.hasOwn(messages, code)` 同字面,occurrence count 跨退回未變、`-S` 因此不報。
不影響實作(正向 diff 拿得到),但別以為 `-S` 掃過就等於掃乾淨。

### 2.3 三份同字面 RE **不合併**(推翻 backlog #332 條目裡的「一併評」)

同字面 `/^[a-z0-9_]{1,64}$/` 全樹共三份,語意各不相同:

| 位置 | 守的是什麼 | 命運 |
|---|---|---|
| `packages/domain/src/order/types.ts:245` | 訂單 workflow_status 碼形狀 | 本片刪 |
| `apps/admin/src/lib/orders/workflow-form.ts:29`(用於 `:166`) | item writer 表單的狀態碼 | **A9w4c 後半整檔刪** |
| `apps/admin/src/lib/staff-form.ts:9`(用於 `:23`) | 員工 ID 形狀 | 長期存在 |

(另有 `packages/ports/src/IEmailOutbox.ts:33` 等處以字面對齊 DB CHECK,是第四種語意。)

**裁定不合併**:①三者對齊的是**三個不同的 DB 契約**,合併等於把不相干的契約綁在一起,
其中一邊改形狀就得動另外兩邊 ②中間那份**已排定被整檔刪除**,合併進去等於製造一個馬上要拆的耦合。
⇒ 本片只做「刪掉零 consumer 的那一份」。此裁定屬程式結構判斷、非產品判斷,故不入 §6;
**主視窗若不同意可直接推翻,推翻成本 = 改本節。**

---

## §3 片拆

### `#332-1` — 刪 `WORKFLOW_STATUS_CODE_RE` export（輕量片 / L1 / 估 15 分）

- **改**:`packages/domain/src/order/types.ts:236-245` 整段(docstring + export)刪;
  `packages/domain/src/index.ts:31-32` 整段(過期註解 + re-export)刪。
- **不改**:`SupabaseOrderAdapter.ts:18` 與 `order-number-search.ts:12` 兩處註解 —— 它們敘述的是
  **歷史事實**(「A9w3 移除了那段」),刪掉常數不會讓那兩句變假。
- **片型判定**:動 `packages/domain/` 但**非** `packages/ui`,且刪的東西零 consumer
  ⇒ 不命中鐵則 12 六類;走輕量片 SOP ①④⑤⑧⑨。
- **前置**:無。可立即排。
- 🔴 **這片沒有可構造的行為面負測** —— 刪死碼的正確性由編譯器承擔。誠實寫進 commit body:
  唯一驗收是 typecheck/build 綠 + 測試數 Δ **必須為 0**(見 §4 M1)。

### `#332-2` — 兩支 banner 硬化 + 死詞彙清除（標準片 / L1 / 估 30-40 分）

- **改**(一片收完,鐵則 5:同缺陷跨兩支姊妹元件不拆):
  1. `orders/result-banner.tsx:82` → `Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined`
  2. `settings-result-banner.tsx:49` → 同形(對 `messages` 參數)
  3. `settings-result-banner.tsx:8-19` 死 `MESSAGES` 依 §6 Q2 的裁定處置
  4. 回填原型鏈向量測試(位置見下)
  5. §5 的舊字面同批更新
- **前置**:§6 **Q1 必須先拍**(Sean 說 GO 才動);Q2 決定第 3 步與元件簽名。
- **片型判定(誠實)**:鐵則 12⑥ 的字面是「**共用元件 `packages/ui`** 行為改動」,
  這兩支在 `apps/admin/src/components/` ⇒ **字面上不自動命中**。
  但 Sean 08-02 親自把它歸在「動共用元件」灰區並要求走 plan
  ⇒ **依 Sean 拍板從嚴、自願跑 codex 關卡2**;若 Q2=A(props 轉必填)則更無疑義。
- **測試檔位置(不是隨手放)**:settings banner 的向量測試開**新檔**
  `apps/admin/src/components/settings/settings-result-banner.test.tsx`,
  **不放回** `lib/supplier-result-messages.test.tsx`。
  理由:不變量是「**本元件**對任何非自有 key 都不渲染」,它在**元件層**成立,與是哪張碼表無關;
  當初放在供應商碼表的測試裡,正是讓這個缺陷看起來像供應商專屬的原因
  (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。
  orders banner 的向量加在既有 `components/orders/result-banner.test.tsx`(該檔本就是元件層)。
- ⚠️ **fixture 注意**:新測試檔自備最小碼表時,鍵名不得取 `toString` / `constructor` 這類
  —— 否則「不得渲染」那條會被自有鍵滿足而恆真
  (memory `feedback_fixture-value-makes-guard-vacuous`)。

---

## §4 驗收矩陣(每格配突變靶;沒有突變靶的格子標明「靠編譯器」)

| # | 驗收(可 yes/no) | 突變靶(把它做壞,這格必須轉紅) |
|---|---|---|
| M1 | `#332-1` 後 typecheck + lint + build 三綠,且**測試數 Δ = 0、檔數 Δ = 0** | 無行為靶 —— 靠編譯器 + Δ 對帳。Δ≠0 即代表誤刪了別的東西 |
| M2 | `grep WORKFLOW_STATUS_CODE_RE` 全樹只剩 `SupabaseOrderAdapter.ts:18` / `order-number-search.ts:12` 兩處**註解** | 少刪 `index.ts:32` 的 re-export → 命中數不符 |
| M3 | `?r=__proto__` → **orders** banner 渲染空字串、查無 `[role="status"]` | 把 `:82` 改回裸索引 → 本格紅 |
| M4 | `?r=__proto__` → **settings** banner 同上 | 把 `:49` 改回裸索引 → 本格紅 |
| M5 | 五個向量**逐一**入測:`__proto__` / `constructor` / `toString` / `valueOf` / `hasOwnProperty`(兩支各一組 `it.each`,從**陣列常數**導出) | 陣列砍成只剩 `__proto__` → 測試數 Δ 對不上(−8);砍掉整個 `it.each` → M3/M4 消失 |
| M6 | 已知碼照常渲染(修法沒誤殺):orders 側至少 `saved` / `denied` / 三個採購碼;settings 側 fixture 的每個碼 | 把守門寫成 `!Object.hasOwn(...)` → 全部已知碼那幾格紅 |
| M7 | 未知但**無毒**的碼(`'nope'`)仍不渲染 —— 既有 `supplier-result-messages.test.tsx:46-58` 不回歸 | 直接跑既有測試;若 Q2=A 改了簽名而漏改該檔 → typecheck 紅 |
| M8 | 死詞彙零殘留:`grep '已新增狀態選項'` + `grep '代碼(code)已存在'` 全樹 **0 命中** | 只刪其中一個碼 → 另一個 grep 仍命中 |
| M9 | **僅 Q2=A 時**:任一 caller 漏傳 `messages` → typecheck 紅 | 暫時把 `staff/page.tsx:44` 的 `messages` prop 拿掉,typecheck **必須**紅;紅了再還原 |
| M10 | §5 舊字面清單逐條改完,且 `grep '拍板 B 刻意退回'` 全樹 0 命中(現行 code 面) | 只改被 diff 碰到的那幾行 → 本 grep 仍命中 `cancel-actions.ts` |
| M11 | 測試數對帳:**動手前**把預期 Δ 寫進 commit 草稿,收工比實際 Δ | 對不上 = 停下查,不得「大概是對的」就 commit |

**Δ 估算(供起草預期值用,實作時以實跑為準)**:
`#332-2` 檔數 +1(新測試檔);測試數 +11~13 = orders 側 5 向量 + settings 側 5 向量 +
settings 側已知碼正向 1~3。**基準數字**:`f8ede20` 的 commit message 記「364 檔 5128 綠」
—— 這是**引用 commit message、不是本輪實跑**;開工時先跑一次 `pnpm test` 取當下真值當基準。

🔴 為什麼 M11 單獨列一格:A9w2 就是靠它抓到「依索引切段落順手吃掉兩個不相干 describe」
(預期 −4、實際 −12),而**三綠全綠、零紅**(memory `feedback_range-delete-silently-eats-neighbors`)。
本片有兩處「整段刪除」(`types.ts:236-245`、`index.ts:31-32`、死 `MESSAGES`),是同一個坑的形狀。

---

## §5 舊字面同批更新清單(修完之後**必須**一起改的地方)

修完 = 六個檔案裡「這個缺陷還在、Sean 拍板退回」的敘事全部變成假話。
先 grep 建清單再改,不要只改 diff 碰到的行(memory `feedback_claimed-sync-but-only-patched-touched-lines`,已復發 9+ 次)。

**必改(現行 code / 測試 / backlog)**

| 檔案:行號 | 現況字面 | 要改成 |
|---|---|---|
| `apps/admin/src/components/orders/result-banner.tsx:68-81` | 「已知缺陷…拍板 B 刻意退回」整段 | 改成「守門形狀為 `Object.hasOwn`,原因與回歸測試在 X」 |
| `apps/admin/src/components/settings/settings-result-banner.tsx:35-48` | 同上 | 同上 |
| `apps/admin/src/components/orders/result-banner.test.tsx:15-17` | 「🔴 **刻意不測**原型鏈那組向量」 | 反轉:說明現在測了、且為什麼是元件層 |
| `apps/admin/src/lib/supplier-result-messages.test.tsx:42-45` | 「原型鏈那三個向量**已移除**」 | 反轉 + 指向新的元件層測試檔 |
| `apps/admin/src/lib/orders/cancel-actions.ts:38-42` | 「不要照抄…那是假的」+ 🔴**過期數字「7 個頁面」**(現況 6) | 整段重寫:守門已硬化,`order_cancelled` 的結論改由守門承擔而非「剛好不毒」 |
| `docs/phase-1-backlog.md:9049-9062` | #332 ⏳ 待執行;🔴 `:9062` 另有過期數字「`__proto__` 族查詢參數在**五個**頁面仍畫得出空 banner 框」(現況 6) | 標完成 + 指向本 plan 與 commit + 修數字 |

**不改(歷史檔 = 當時的事實,改了才是竄改)**

- `docs/specs/2026-08-01-e10-supplier-s3b-settings-page-plan.md:397`(Q1=B 拍板紀錄)
- `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md:185`(R1 那列的「不順手修」)
- `docs/handoff/2026-08-02-s3b-nightrun-report.md:140-161`

**主對話收割時更新**:memory `reference_js-index-lookup-hits-prototype-chain`
—— 該檔寫「**五個**頁面全中」(現況 6)、且未記錄「修法曾被退回」。

**查過、判定不必改(有理由,別被「五個頁面」這個字面誤導成待辦)**

`grep -rn '五個頁面\|五頁'` 全樹另有 5 處 code 註解引用這個教訓:
`apps/storefront/src/app/brands/[slug]/page.tsx:59`、同目錄 `page.test.tsx:109`、
`components/brand/BrandAboutRedirect.tsx:23`、同名 `.test.tsx:68`、
`apps/admin/src/lib/payment/refund-ledger-view.ts:27`。
五處的句型都是「本 repo 五個頁面**真的中過**」——**過去式、敘述 08-02 當下的事故規模**,
用途是替它們自己那支的 `Object.hasOwn` 寫法留動機。事故當下確實是 5 頁,故**這五處現在不是假話**。
⇒ 本片不改。**唯一該重評的時機**:若把 memory 的數字改成 6,這五處的「五」會跟 memory 對不上
—— 屆時要嘛五處一起改、要嘛把 memory 寫成「08-02 當下 5 頁,S3b-2 後 6 頁」。
**建議取後者**(改一處、且保留時間軸),連同上一行的 memory 更新一起做。

---

## §6 決策題(Sean 拍;prose code block 可直接複製回覆)

```
Q1:兩支 result-banner 的原型鏈守門,現在修不修?

背景:你 2026-08-02 拍板 B 把這個修法退回,理由是「不在那片的產物表內、屬鐵則 8
動共用元件的灰區」,並說「要再修的話,兩支元件要一起、並且走 plan」。
這份 plan 就是你要的那個 plan(兩支一起、含回歸測試、含爆炸半徑 6 個頁面)。
症狀:員工或任何人在網址列打 ?r=__proto__,六個後台頁面會畫出一個空白提示框。
不是資安漏洞(畫不出任何文字、無法注入),是「那道擋未知碼的守門擋不住五個最好猜的字串」。

A. 現在修(排成獨立一片,估 30-40 分,跑 codex 對抗審查)
B. 續押後(維持現狀;plan 留著,等你想修的時候直接開工)

我推薦 A:①押後的原因當時是「不在該片範圍」,現在它有專屬片了,那個理由消失
②修法在 4833cae 已經寫過一次且上線過,不是新設計 ③全 repo 其他六處同型查表都已經硬化,
這兩支是僅存的例外,留著會讓下一個人照抄錯的那份。

A: A|B
```

```
Q2:設定頁 banner 那份「沒人用的預設文案」怎麼處置?(Q1=A 才需要答)

背景:settings-result-banner.tsx 裡有一份七則的預設文案表,其中「已新增狀態選項」
「代碼 code 已存在」是舊的訂單狀態設定頁專用的——那頁已經隨九碼退場拆掉了。
現在兩個還在用這支元件的頁面(員工、供應商)都自己帶文案表,所以那份預設值
一行都跑不到。它的害處是「看起來有人在維護的文案」,下一個人會以為那是備援。

A. 整份刪掉,並把「文案表」改成必填參數(誰漏帶,程式編譯就會報錯)
B. 整份刪掉,但參數維持選填,預設值改成空的(漏帶的話畫面靜靜地不顯示)
C. 只刪掉舊設定頁專用的四則,留「已儲存/沒有權限/儲存失敗」當通用預設

我推薦 A:B 和 C 都留著一條「漏帶文案表也不會有人發現」的路;A 是唯一讓機器
幫忙擋的做法。代價是它算「改元件的對外介面」,所以這片會照高風險片跑對抗審查
(本來就要跑,不額外增加成本)。

A: A|B|C
```

---

## §7 cut point(做到哪裡都可以停,且停在那裡是完整的)

1. `#332-1` 落地後即可停 —— 它與 `#332-2` 零耦合。
2. `#332-2` 內部**不可**只做一支 banner 就停(Sean 拍板逐字「兩支元件要一起」)。
3. `#332-2` 若跑到一半發現 §5 清單改不完:**先停、不 commit** —— 註解說「缺陷還在」而 code 已修好,
   是本 repo 記過 9 次以上的那個坑,寧可整片退回也不要留一份自相矛盾的檔案。

---

## §8 交棒與排程建議

- **給主視窗**:`#332-1` 是**免批准型**(輕量片、零 consumer、零決策題),可直接排進任何一個施工窗的佇列。
  `#332-2` 卡 Q1,建議與 D 線的畫面題**一起送給 Sean**,不單獨打斷他。
- **與九碼退場鏈的關係**:`A11a` plan §4 把 #332 排在 `A9w4c 後半` 之後、`A9v` 之前。
  本檔 §0 已證那不是依賴關係;**若要調整鏈的字面,那是 A11a plan 的修訂、不在本片範圍**。
- **前置狀態**:`#332-1` 無前置,現在就能做;`#332-2` 前置 = Q1 拍板。

## §9 誠實邊界(本 plan 沒做到的事)

1. **未跑關卡1 審查**(依 `E-107-A` 紅線,起草即收工)。
2. **未實跑測試**:§4 的基準數字引用自 `f8ede20` 的 commit message,不是本輪實跑;
   Δ 估算是我依「五向量 × 兩支」推的**估值**,開工時必須用當下實跑值取代。
3. **未查 graphify 連動面**(零實作片;實作開工前照 SOP ② 補)。
4. **§2.3「三份 RE 不合併」是我的裁定**,推翻了 backlog #332 條目裡「一併評」的字面 —— 明寫在此以便被推翻。
5. **未擴大掃描面**:本輪只掃了 `apps/admin` + `apps/storefront` 的 `obj[使用者輸入]` 查表候選,
   確認除兩支 banner 外其餘(`FAILURE_MESSAGES[code]` 一族)的 key 都是**型別 union 而非 URL 字串**
   (例:`refund-action-state.ts:180-188` 的 `code: RefundFailureCode`)⇒ 不在本片範圍。
   `packages/` 未逐檔掃 —— 不是「掃過沒有」,是「沒掃」。

— E 窗第三棒,2026-08-06
