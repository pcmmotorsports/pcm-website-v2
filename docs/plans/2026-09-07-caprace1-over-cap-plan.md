# `⟦b4-CAPRACE1⟧` 實作 plan(Sean 2026-09-02 `Q1 = 甲`;鐵則 8 因為要動 schema ⇒ **只 plan, 本次零改動**)

## 0. 拍板逐字(不是轉述)
`~/pcm-mailbox/拍板-20260902-06題.md` `Q1` ⇒ **甲** ——
「記得下來但標紅 ⇒ 帳一定跟得上事實, 而超出的那筆看得到」。同節寫著「動 DB 函式 ⇒ 鐵則 12①③ ⇒ codex 不省」。

## 1. 要改哪一行(開檔核過)
`supabase/migrations/20260831010000_m4b_866_manual_refund_raise_plaintext.sql`
· 函式 `public.pcm_manual_refund_rail_cap_guard()`(`:66` `CREATE OR REPLACE`)
· 判斷在 `:153` `IF NEW.refund_amount > v_headroom THEN` ⇒ `:165` `USING ERRCODE = 'PCM01'`
⇒ **甲 = 這裡不再 `RAISE`, 改成讓那一列進去而且標得出來。**

## 2. 🔴 一個真的設計岔路 —— 我不自己選
關閉條件② 逐字是「**那一列要標得出來(欄位或旗標, 讓超收看得見)**」。而 `order_manual_refunds`
**今天 12 個欄位裡沒有任何一個可以拿來標**(唯讀查得:`id/order_id/rail/refund_amount/reason/actor/occurred_at/created_at/voided_at/void_reason/voided_by/request_id`)。

| | 甲 · 加一個欄位 | 乙 · 只寫進 `pcm_incident` |
|---|---|---|
| 動 schema | **要**(`ALTER TABLE ADD COLUMN`, money ledger) | 不用 |
| 標記跟著那一列走 | ✅ 是 | ❌ 不是 —— 事故列與退款列是兩張表 |
| 現成的畫面 | ✅ `apps/admin/src/components/orders/manual-refund-ledger-section.tsx` 已經在列這些列 | ❌ 要另做 |
| 現成的告警 | ❌ 要另接 | ✅ `get_pcm_incident_health` 已經在數 |
| 🔴 已知風險 | 動一張有不可變 trigger 的金流帳本 | ⚠️ **`pcm_incident.resolved_at` 今天零寫入端**(見 `⟦db-INCIDENTRESOLVEUI⟧`)⇒ 事故只進不出 |

**建議 = 甲**(欄位 `over_cap_by integer NULL`;NULL = 沒超過, >0 = 超出幾元)。
理由:②逐字說「**那一列**」, 而乙的標記不在那一列上;且列的畫面已經存在。
🔵 **兩者不互斥** —— 甲做完可以再加乙當告警, 而反過來不行。

## 3. 若走甲, 要帶的東西
· `ALTER TABLE public.order_manual_refunds ADD COLUMN over_cap_by integer`(nullable, 無預設)
  + `CHECK (over_cap_by IS NULL OR over_cap_by > 0)`
· trigger 改:超過上限 ⇒ `NEW.over_cap_by := NEW.refund_amount - GREATEST(v_headroom, 0);` 然後 `RETURN NEW`(不 RAISE)
· 🔴🔴 **不可變性 —— 這一格查完了(唯讀讀正式庫的 `prosrc`, 不是讀 repo 猜)。答案:【要】納入, 而且是硬性的。**
  `order_manual_refunds` 上非內部 trigger **3 支**:`order_manual_refunds_immutable_bu`(`tgenabled = A` ALWAYS · BEFORE UPDATE ·
  `pcm_d3d_manual_refund_immutable`)· `order_manual_refunds_no_truncate_bt`(`A`)· `trg_pcm_manual_refund_rail_cap`(`O`, 就是本片要改的那支)。
  🔑 **關鍵不是「有沒有不可變 trigger」, 是【它用白名單還是黑名單】** —— 我讀了它的 body:
  它是**逐欄列舉的黑名單**(`id / order_id / rail / refund_amount / reason / actor / occurred_at / created_at / request_id` 九欄),
  而該函式**自己的註解逐字**寫著:「🔴 **逐欄列出, 不用『除了 allowlist 以外』的動態寫法**」。
  ⇒ 📌 **所以新欄位【預設不受保護】** —— `over_cap_by` 加上去之後, 若不同時加進那個清單,
  它就是**那張金流帳本上唯一可以事後 UPDATE 改掉的欄位**, 而改它 = 把「這筆超收過」抹掉。
  ✅ **⇒ 本片必須同時改 `pcm_d3d_manual_refund_immutable`, 把 `over_cap_by` 加進第①段那九欄。**
  ⚠️ 而那是**第二支被改的 DB 函式** ⇒ 影響面比原本估的大, codex 審查要涵蓋兩支。
  🔵 **順帶一個對別人有用的讀數**:那張表的不可變 trigger 是**列舉式**的
  ⇒ **任何人往這張表加欄位, 都會靜靜地造出一個可改的欄位**。這不是本片的 bug, 是那個設計的**已知代價**
  (該檔自己選了列舉, 理由寫在它的檔頭)—— 而**它沒有任何閘會提醒下一個加欄位的人**。
· md5 前後釘 + 多載/secdef/proconfig/owner 釘 + `BEGIN`/`COMMIT` + `lock_timeout`(照 `20260907140000` 的形狀)

## 4. 驗收(照板列四條, 逐條可 yes/no)
① 超過上限**不再 RAISE**, 那一列**進得去** ② 那一列 `over_cap_by` **> 0**
③ 🔴 **負對照**:沒超過上限的那一筆 `over_cap_by` **必須是 NULL** ④ codex 不降級(鐵則 12①③)

## 5. 🛑 本 plan 證不到什麼
· ⛔ ~~「我沒有查新欄位要不要納入不可變 trigger」~~ **[2026-09-07 已查, 見 §3]** —— 答案是【要】, 而且要同時改第二支函式。
· 我**沒有**確認 `manual-refund-ledger-section.tsx` 顯示新欄位要改多少 —— 那是前端片, 不在本 plan。
· 我**沒有**跑任何寫入或併發測試。

---

# 🔴🔴 關卡 1 codex `FAIL` ⇒ 而它指到一支我沒發現的檔, **而那支現在【正在正式庫上單獨跑】**

## A. 事實(全部唯讀量到, 每一格可重跑)
`supabase/migrations/20260902020000_m4b_pcm01_record_not_block.sql`(293 行)**已經存在**, 它做的就是「**記得下來**」那一半。
`bash scripts/latest-definition-of.sh pcm_manual_refund_rail_cap_guard` ⇒ **newest = 20260902020000**(共 3 代)。
正式庫現行 `md5(prosrc)` = **`372a2f14cc6e82afd23c9daad983ef48`** len **6054**
= 我對 `20260902020000` 自算的 md5 與長度, **逐字相同** ⇒ 📌 **那一版就是正式庫現在跑的。**

## B. 🛑 而那支檔的**第 3-4 行**逐字寫著
> `-- ══ 🛑🛑 **本支【不得單獨上線】** ══`
> Sean 拍的甲逐字是「記得下來, **但標紅**」—— 那句話有兩個動詞, 而「但」把它們綁在一起, **而本支只做得到前半**。

它自己列的傷害(它當時就量過):
> 今天 員工把金額打成 15000(多一個 0)⇒ **被擋** ⇒ 他會發現
> 只上本支 ⇒ 15000 **安靜地進帳本**, 而畫面上【完全沒有東西會變】
> (`manual-refund-entry-section.tsx` 176 行提「上限 / cap / 餘裕」⇒ **0 處**)

## C. ⇒ 結論改寫(這已經不是 plan 的問題)
🔴 **「標紅」那一半不是加值功能, 它是【一個現在就開著的缺口的另一半】。**
正式庫今天的行為 = **超額的人工退款會安靜進帳本, 而沒有任何地方看得見**。
⇒ 那道被拿掉的閘**同時是一道打字檢查**, 而**打字檢查那個角色沒有人接手**。
⇒ 🛑 **這一格我不判嚴重度、也不判要不要緊急處理** —— 已在 2026-09-07 端給主視窗 A。

## D. 本 plan 因此要改的地方
1. 基線改成 `20260902020000`(**不是** `20260831010000`)—— 前置閘要釘 `372a2f14…` / len 6054。
2. 本片 = **補上那句話的後半**, 而不是「改變現行行為」—— 措辭要換, 否則讀的人會以為現在還在擋。
3. codex 其他四條(欄位語意 / UPDATE 與 DELETE 兩條路 / 驗收不足 / 前端銜接與 rollback)另立一節處理, **未做**。

## E. 🛑 我證不到什麼
· 我**沒有**查「已經有多少筆超額的列進去了」—— 那要讀 `order_manual_refunds`, 我的唯讀角色沒試過。
· 我**沒有**判這算不算事故 —— B 段那個傷害是**該檔作者當時量的**, 我只證了「它現在確實單獨在線上」。
