# 2026-09-10 稽核中文化那道閘的盲點 + 我 A1 留下的兩顆紅 —— plan

> 🛑 **等 Sean 批才動手。** 碰稽核 + 碰訂單金額 ⇒ 鐵則 8 與 12 都命中。
> 🔵 **不需要 migration** —— 要改的全是 TS 與測試檔,沒有任何 DB 物件。
> 出處:`origin/dev` 86c8fea60 上四顆紅的查證(主視窗 2026-09-10 派工)。
> 🔴 **本檔第二版** —— codex R1 給了 3 個 must-fix,**其中最重的那個我實測證實它對**:我第一版提的修法根本修不到。第一版的內容不逐字保留,差異寫在 §8。

---

## 1. 為什麼寫這份

`origin/dev` 上有兩顆紅是**我的 A1 造成的**:

| 紅 | 意思 |
|---|---|
| `audit-field-label.test.ts` 分母集合比對 | 我加了稽核欄位 `active_charge_attempt_status` 而**沒去補中文** |
| `subtotal-writers-allowlist.test.ts` | A1 那支函式會寫 `subtotal`/`total`,而我**沒把它登記進 allowlist** |

🛑 **這兩顆的意思是「去登記」,不是「去改測試」。** 登記完自然綠。
**而查的時候撞到一件比這兩顆大的事**,寫在 §3。

---

## 2. 現況(逐字)

### 2-1 分母怎麼來的 —— `audit-field-label.test.ts:69-92`
```ts
function oddPositionLiterals(body: string): string[] {
  // …頂層逗號切段,單引號翻轉 inQuote…
  return parts
    .filter((_, i) => i % 2 === 0)
    .map((p) => /^\s*'([^']+)'\s*$/.exec(p)?.[1])
    .filter((k): k is string => k !== undefined);
}
```
而切段之前,`:37` 先把 INSERT 到**第一個 `;`** 之間切出來當 segment。

### 2-2 兩道閘把字典夾成恰好等於分母
```ts
// :243  const missing = [...scanned, ...APP_WRITER_KEYS].filter((k) => !AUDIT_FIELD_LABEL[k]);
// :249  const known = new Set([...scanMigrationPayloadKeys(), ...APP_WRITER_KEYS]);
// :250  const orphan = Object.keys(AUDIT_FIELD_LABEL).filter((k) => !known.has(k));
```
一格要求「分母 ⊆ 字典」,另一格要求「字典 ⊆ 分母」。**兩格用的是同一個掃描器。**

### 2-3 畫面上未對照怎麼呈現
`audit-detail.tsx:30` 逐字:`const UNMAPPED_MARK = '(還沒對照成中文)';`
`:48-58` 未知欄位回 `known: false`,畫面**同時**印原代碼與這個標記。⇒ 不是靜靜印英文,但**那一欄就是英文**。

---

## 3. 🔴 全庫掃 —— 主視窗要的那個數字

**量法**:把 `audit-field-label.test.ts:28-92` 那三支函式**逐字**抄進一支拋棄式腳本(一字未改),只餵它不同的目錄;對照組 = 同一批檔**砍掉「整行就是註解」的行**之後再掃。差集 = 被註解吃掉的鍵。
腳本:`<scratchpad>/scan.mts`(拋棄式,不進 repo)。🔵 codex 獨立重現了同一組數字。

```
migrations 總數 405 · 含 admin_audit_log 的 71

逐檔量:因為【鍵的上方有整行註解】而不進該檔分母的鍵 = 12 個,分布在 3 支檔
  20260905360000_m4b_pricecopytax_p2_manual_order_computes_tax.sql
      tax_total · price_tax_mode · shipping_fee · item_count
  20260909030000_m4b_invoice5pct_tax_only_when_requested.sql
      tax_total · price_tax_mode · subtotal · shipping_fee · total · item_count · line_tax_bases
  20260909080000_m4b_a1_audit_active_attempt_on_price_change.sql
      active_charge_attempt_id

全庫:閘看到 79 個鍵 · 砍掉整行註解後看到 83 個
⇒ 閘【完全看不到】的鍵(在別的檔也沒被撈到):4 個
   tax_total · price_tax_mode · line_tax_bases · active_charge_attempt_id
⇒ 反方向(砍註解後反而不見的):0 個
```

🔵 **12 與 4 的差,精確講**:`shipping_fee` / `item_count` / `subtotal` / `total` 這四個**在別的 migration 裡沒被註解擋著**,所以照樣進了分母;而 `tax_total` / `price_tax_mode` **在那兩支檔裡都被擋住,別處也沒有**,所以真的消失。**兩支檔各自的註解問題都還在,只是有四個鍵被別處救回來。**

### 3-1 這 4 個都**沒有中文**
```
tax_total                🔴 字典裡沒有
price_tax_mode           🔴 字典裡沒有
line_tax_bases           🔴 字典裡沒有
active_charge_attempt_id 🔴 字典裡沒有
```

### 3-2 其中三個在手動建單那條路徑上
`20260909030000:888` 起是**真的會執行的** `INSERT INTO public.admin_audit_log`(不是註解、不是自檢字串),`:889` 的 action = `order.manual_create`。
⇒ 📌 **那支 migration 一旦生效,每一次手動建單都會寫 `tax_total` / `price_tax_mode` / `line_tax_bases`,而它們沒有中文 ⇒ 稽核明細那三欄是英文 + `(還沒對照成中文)`。**
🛑 **而我證不到「今天已經在發生」**(codex must-fix,它對):我讀的是 migration 檔,**沒有查線上函式定義、沒有查稽核表裡真的有沒有那樣的列、沒有開瀏覽器**。我第一版寫「這件事今天就在發生,不是假設」—— **那句是推的,已刪。**
🔵 對比:我的 `active_charge_attempt_*` 要等第一筆真實改價才會出現。

### 3-3 補字典之前必須先解決分母
`orphan` 那格(`:250`)用的是**同一個看不到那 4 個鍵的掃描器**。
⇒ 直接補 5 個中文 ⇒ 其中 4 個不在 `known` 裡 ⇒ **`orphan` 那格會紅,而且是 4 個。**
🔵 **而「必須先修抽取器」不是唯一解**(codex nit,它對):把那 4 個鍵塞進 `APP_WRITER_KEYS` 也能讓兩格同時綠。
🛑 **但那是把「掃不到」記成「app 層寫的」—— 事實不對。** 我不推薦,列在 §7 Q2 讓 Sean 決定。

---

## 4. 要改什麼

### A. 分母 —— 🔴 我第一版提的兩個改法,一個實測是死的

**改法甲(第一版推薦)= 放寬正規式讓它容許前面掛註解**
```ts
.map((p) => /^(?:\s*--[^\n]*\n)*\s*'([^']+)'\s*$/.exec(p)?.[1])
```
🔴 **實測結果:一個字都沒修到。** 套上去重跑,405/71/12/4/79/83/0 **每一個數字與沒改之前完全相同**。
✅ 前提斷言過了(改法確實進了執行的那份腳本,`grep -c` = 1)⇒ **不是「尺沒接上」,是它真的沒用。**

**為什麼沒用 —— 兩個原因,都不是正規式管得到的**
1. **註解裡的逗號會把註解自己切開。** 我 A1 那三行註解含 2 個半形逗號 ⇒ 切段後那個鍵所在的段落**開頭是一截沒有 `--` 的中文**(逗號後面的半句),`^\s*--` 根本對不上。
2. **註解裡的分號會把 segment 提早截斷。** `20260909030000:921` 逐字:
   ```sql
   --         AND target = 'order:' || '<那張單的 id>';
   ```
   `:37` 的 segment 切到**第一個 `;`** ⇒ 停在這裡 ⇒ `:922` 的 `'line_tax_bases'` **根本不在被解析的字串裡**。正規式再怎麼放寬也看不到它。

**改法乙(第一版寫的「切段前砍註解」)** —— 位置寫得太含糊。若在切 segment **之後**才砍,原因 2 已經發生過了,救不到 `line_tax_bases`。

### A' 真正的修法(本版提出)= **在整支檔進入任何解析之前,先砍掉「整行就是註解」的行**
就是我 §3 對照組用的那一招。**證據 = §3 的數字本身**:對整庫 71 支檔套用之後
· **多出來的鍵:恰好 4 個**,而且四個都是人工核過的真鍵
· **少掉的鍵:0 個** ⇒ 沒有打壞任何現在數得到的東西

**🛑 而它的殘餘風險我查過,兩個都真的存在於這個庫**
| 風險 | 查到什麼 | 判 |
|---|---|---|
| 區塊註解 `/* */` 裡藏 INSERT | **1 支**:`20260813120000_…procurement_void_schema.sql:215` | ⚪ **本改動不影響** —— 原版與砍註解版**都**看不懂 `/* */`,所以它在兩邊都一樣。這是既有的分母問題,不是本改動帶進來的 |
| 字串字面裡有 `--` | 有,例如 `20260804180000:322` `position('-- row_count 守…' in v_def)` | ⚪ **不受影響** —— 那些行的**行首不是 `--`**(是 `OR position(`),而本改法只砍行首 |
| 多行字串字面裡有一行以 `--` 開頭 | 🛑 **我的檢查器不可靠** —— 我用正規式找,回報 245 筆,而抽樣看前 5 筆**全是檔頭註解被誤判成字串**。⇒ **這一格我沒有可信的答案** | 🔴 見 §6 |

### A'' 那 4 個鍵是不是「被砍註解復活出來的假鍵」—— 逐個開檔確認過,不是

| 鍵 | 在哪 | 那一段真的會跑嗎 |
|---|---|---|
| `tax_total` · `price_tax_mode` | `20260905360000:788` 的 INSERT ⇒ 鍵在 `:806-807` | ✅ INSERT 當行前綴無 `--`、不在字串中段;action = `order.manual_create` |
| `tax_total` · `price_tax_mode` · `line_tax_bases` | `20260909030000:888` 的 INSERT ⇒ 鍵在 `:906-907`、`:922` | ✅ 同上 |
| `active_charge_attempt_id` | `20260909080000:326` | ✅ 我自己寫的 |

⇒ 📌 **這 4 個都是真鍵,不是假鍵。** 那個「砍註解會不會復活被註解掉的 INSERT」的風險,**對這 4 個當場消掉**。
🛑 **而它不等於「以後也不會」** —— 未來的檔仍可能出現那個形狀,所以 §4-A' 的驗收第 3 格(塞一支被註解掉的假 INSERT)還是要跑。

### 🔴 動手時的固定步驟:每一發突變都要先斷言它落地了

📌 **一發沒套進去的突變,跟一發套進去而尺沒咬到的突變,印出來是同一個「不紅」。**
本片查證時我踩了兩次:一次是 A1 的收款閘突變,一次是這裡的 `v_subtotal :=`(那個字面在本體裡根本不存在,實際是 `INTO v_subtotal`)。

```
做法:突變之後、跑尺之前,先斷言【檔案真的變了】
  diff <原檔> <突變檔> | grep -c '^>'   ⇒ 必須 > 0,否則停下來看突變寫法
```

**驗收(缺一不算)**
1. 改完重跑 ⇒ `missing` 應出現全部 4 個鍵。
2. **負對照**:改完之後,把 `20260909080000` 那三行註解刪掉再跑 ⇒ 結果應**與不刪相同**(證明修的是「註解擋住」)。
3. **反向負對照**:塞一支「整段 INSERT 被 `--` 註解掉」的假 migration ⇒ **不得**多出鍵。
4. **值不得被當成鍵**:塞 `jsonb_build_object('kind', -- note\n 'full')` ⇒ 不得抽到 `full`。
   🔵 3、4 是 codex 給的反例形狀,我照收。

### B. 補字典(`audit-field-label.ts`)
| 鍵 | 中文(草案) | 誰的 |
|---|---|---|
| `active_charge_attempt_status` | 改價當下的付款狀態 | 我 |
| `active_charge_attempt_id` | 改價當下的付款編號 | 我 |
| `tax_total` | 稅額合計 | 稅那條線 |
| `price_tax_mode` | 價格稅別 | 稅那條線 |
| `line_tax_bases` | 各品項稅基 | 稅那條線 |

🛑 後三個不是我這條線的 ⇒ §7 Q1。
⚠️ `price_tax_mode` 是封閉字集(`exclusive`/`inclusive`)⇒ 值也該有中文,那要動 `AUDIT_VALUE_LABEL`,**本 plan 不含**。

### C. 登記 allowlist(`subtotal-writers-allowlist.test.ts`)
加一列 `'20260909080000_m4b_a1_audit_active_attempt_on_price_change.sql'`,照既有體例附「算法有沒有動」的證明。

**🔴 我第一版的證明不合格,codex 說對了**
我原本比 `v_line_total` / `v_subtotal` / `v_total` / `UPDATE public.*` 四個字面,得到 0 差。
codex 實際做了三個突變 —— 加總條件加 `AND false`、拿掉 `exclusive` 判斷、單價改成 `p_unit_price + 1` —— **三次我那個篩選都還是 0 差。**
⇒ 📌 **它篩不到的行例如**:`SET unit_price = p_unit_price,`(109→226)· `WHERE id = p_order_item_id;`(111→228)· `FROM public.order_items i WHERE i.order_id = p_order_id;`(142→259)· `IF v_ord.price_tax_mode = 'exclusive' …`(131→248)· `WHERE id = p_order_id AND version = p_expected_version;`(160→277)。

**✅ 改用完整本體 diff 當證明(codex 獨立重現同一組數字)**
```
比對:docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql(貼前線上實體)
      vs supabase/migrations/20260909080000_…sql 的函式本體
本體全 diff:+29 行 / -2 行
  -2 行 = 'zero_price_reason' 那行補了逗號、$function$ 補了分號
  +29 行,非註解的只有:
      v_a1_attempt_id / v_a1_attempt_status 兩個宣告
      一個 BEGIN…SELECT INTO…EXCEPTION…END 查詢塊
      'active_charge_attempt_id' / 'active_charge_attempt_status' 兩個稽核鍵
```
🛑 **而完整 diff 也只證得到「既有算錢的碼一行沒動」,證不到「新增的查詢不影響這筆交易成不成功」** —— 那一格由 A1 那支自己的前置閘②(索引存在且 UNIQUE)守著,不由這一列背書。

---

## 5. 影響 / rollback

· 三塊都是**純 TS / 測試檔**,零 DB 物件、零 migration、零資料。
· rollback = `git revert`。沒有需要對正式庫做的事。
· 對客人:**零影響**(稽核明細是後台畫面)。
· 對 Sean:後台稽核明細那幾欄從英文變中文。

---

## 6. 🛑 我證不到什麼

· **「今天已經在漏」我證不到** —— 我讀 migration 檔,沒查線上函式定義、沒查稽核表有沒有那樣的列、沒開瀏覽器。migration 裡有可執行的 INSERT,只證明**那個版本走到那裡會寫**。
· **對照組與被測物共用同一個不完整的掃描器** ⇒ 79→83 不是完整 SQL 語意解析。**「總共只漏 4 個」只在這個掃描器的世界裡成立**;動態組出來的鍵、別種寫入形狀、區塊註解,都不在射程內。
· **多行字串字面裡有沒有以 `--` 開頭的行,我沒有可信答案**(我的檢查器誤判率高到不能用)。⇒ **A' 上線前這一格要重量一次。**
· **我沒有掃 app 層寫入端** —— `APP_WRITER_KEYS` 是手維護的清單,那邊有沒有同型的漏我不知道。
· **行尾註解**(`'key', v, -- 說明`)造成的漏,這次的量法看不到。
· `20260813120000:215` 區塊註解裡有一段 `admin_audit_log` ⇒ **現在的分母可能本來就含假鍵**,而原版與砍註解版都看不出來。

---

## 7. 要 Sean 答的三題

```
Q1:稅那三個欄位(tax_total / price_tax_mode / line_tax_bases)要不要跟我的兩個一起補中文?

    背景:它們不是我這條線的,是手動建單那條線的。手動建單的稽核紀錄裡有這三欄,
          而它們沒有中文 ⇒ 後台稽核明細會顯示英文欄名加「(還沒對照成中文)」。
          (🛑 我沒有查線上實際狀況,只讀了碼。)

    甲(推薦)= 五個一起補。
        理由:分母修好的那一刻,那三個會【立刻變成一顆紅】,而紅測試依規矩必須修完才能提交
              ⇒ 分開做的話,本片會卡在提交前等另一條線,而那條線今晚不一定有人在。
        代價:我改到不是我這條線的檔;那三個中文名稱是我照欄位語意取的,沒有人覆核過。
    乙 = 只補我的兩個,稅那三個開一列轉給那條線。
        理由:各線各修,責任清楚。
        代價:本片會卡住不能提交,直到那條線補完。

A: 甲|乙
```

```
Q2:分母要怎麼修?

    甲(推薦)= 整支檔進解析之前,先砍掉「整行就是註解」的行(plan §4-A')。
        證據:對 71 支檔實測,多出恰好 4 個真鍵、少掉 0 個。
        代價:多行字串字面裡若有以 -- 開頭的行,會被誤砍。這一格我還沒有可信的量測
              ⇒ 我會在動手前先把它量清楚,量不出乾淨答案就回報,不硬做。
    乙 = 不修分母,把那 4 個鍵登記進 APP_WRITER_KEYS(手維護清單)。
        理由:一行搞定,今晚就能綠。
        代價:🛑【把「掃不到」記成「app 層寫的」,而那不是事實】。
              下一個因為註解而消失的鍵,還是會安靜地不見。

A: 甲|乙
```

```
Q3:我第一版提的「改法甲(放寬正規式)」實測完全沒用,而我是在 codex 指出之後才去量的。
    要不要我把「提修法之前先實測那個修法」寫成這條線的固定步驟?

    甲(推薦)= 要。理由:今天我三次遇到「以為修好了/以為紅了」而實際沒有,
              三次都是加了前提斷言或實測才發現。
    乙 = 不要,規則已經夠多了(對齊 09-09 的減法版)。

A: 甲|乙
```

---

## 8. 第一版與本版的差

| 第一版寫的 | 本版 | 誰指出的 |
|---|---|---|
| 改法甲(放寬正規式)可修 | 🔴 **實測完全無效**,改提 A'(檔層先砍註解) | codex must-fix ③,我實測證實 |
| 「算錢的行 0 差」= 算法沒動 | 🔴 **那個篩選篩不到 5 類會改金額的行**,改用完整本體 diff | codex must-fix ④(它做了 3 個突變證明) |
| Q1/Q2 的代價 | 🔴 建立在改法甲有效的錯前提上,兩題重寫,並加 Q3 | codex must-fix ⑥ |
| 「必須先修抽取器」 | 🔵 收窄:還有 `APP_WRITER_KEYS` 這條路,只是事實不對 | codex nit ② |
| 「這件事今天就在發生」 | 🔴 **刪掉** —— 那是推的,我沒查線上 | codex nit ⑤ |
| `known` 在 `:250` | `:249`(`:250` 是 `orphan`) | codex nit ⑦ |
| 標記寫「未對照」 | 逐字是 `(還沒對照成中文)`(`audit-detail.tsx:30`) | codex nit ⑦ |
