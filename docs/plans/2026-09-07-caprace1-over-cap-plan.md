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

---

# F. codex 關卡 1 其餘四條 —— 逐條處理(2026-09-07)

## F-1 欄位語意未定完整 ⇒ **改成兩個狀態, 不是一個 nullable**
codex 的反例:`NULL = 沒超過` **太強** —— 既有列、算不出上限的列、跳過計算的列**也是 NULL**
⇒ 「未超額」與「**未判定**」印同一個東西。而拍板第二批 `Q4` 逐字要求「**算不出上限也記下、另標紅**」
⇒ 📌 **那不是同一種紅**, 該檔自己也寫過(`v_cap IS NULL` ⇒「畫面層應以 … IS NULL 標一個**與超額不同**的紅」)。
✅ 改成:`over_cap_by integer NULL`(超出幾元)**加上** `cap_state text NOT NULL DEFAULT 'unknown'`
   取值 `'within' | 'over' | 'cap_unknown'`, `CHECK` 綁定三者與 `over_cap_by` 的配對
   (`over` ⇒ `over_cap_by > 0`;`within` / `cap_unknown` ⇒ `over_cap_by IS NULL`)。
   ⇒ **既有列(0 列, 已量)不受影響**;新列一定被寫成三態之一。
🛑 而 codex 另一句我收下但**不在本片解**:「要重建當時判斷還需保留當時餘裕」——
   那是**再多一欄**的討論。**本片不做, 明寫為已知限制**:`over_cap_by` 只答「超出多少」, 不答「當時上限是多少」。

## F-2 🔴 `UPDATE` 是實質洞 —— **這條是 must-fix, 我原本的 plan 完全沒提**
量到的兩件事:
· `trg_pcm_manual_refund_rail_cap` 是 **BEFORE INSERT OR UPDATE OR DELETE**(唯讀查 `tgtype` 三者皆真)
· 觸發順序按名稱字母序 ⇒ `order_manual_refunds_immutable_bu` **先**、`trg_pcm_manual_refund_rail_cap` **後**
  ⇒ 📌 **後者改了 `NEW` 之後, 前者不會再驗一次** ⇒ cap guard 可以寫進一個 immutable 攔不到的值。
codex 的反例(成立):**原本未超額的列, 後來其他退款把額度耗盡;對它做一個值不變的 `UPDATE`,
也會被補上一個【歷史上不存在的】超額標記。**
✅ 修法:**只在 `TG_OP = 'INSERT'` 判定與寫入 `cap_state` / `over_cap_by`**;
   `UPDATE` **原樣保留**兩欄(`NEW.* := OLD.*`), 直接竄改與復活**仍然拒絕**。
✅ `DELETE`:`PCM03` 分支(該檔 `:104-130` 那段)**原封不動**。
   🛑 而 codex 指出一個要小心的形狀:**誤刪那條路若落到 `RETURN NEW`, DELETE 會被靜默取消** ——
   `DELETE` 時 `NEW` 是 NULL(該檔 `:121` 自己寫過)⇒ **新碼一個字都不要碰 DELETE 那條路。**

## F-3 驗收不足 ⇒ 由 4 條擴成 12 條
① 低於餘裕 ⇒ `within` / `over_cap_by IS NULL` ② **等於**餘裕 ⇒ `within`(邊界) ③ 高於餘裕 ⇒ `over` 且 **差額逐字相符**(不是只驗 `> 0`)
④ 餘裕 = 0 ⑤ 餘裕為**負** ⑥ `v_cap IS NULL` ⇒ `cap_unknown`
⑦ 🔴 **防偽輸入**:呼叫者**預填** `over_cap_by = 1` 的 INSERT ⇒ DB 必須覆寫成正確值(nullable 無預設**擋不住**這件事)
⑧ 值不變的 `UPDATE` ⇒ 兩欄不變 ⑨ 作廢 ⇒ 兩欄保留 ⑩ 直接改標記 ⇒ 拒絕 ⑪ 復活 ⇒ 拒絕
⑫ `DELETE` ⇒ 仍 `PCM03`
🔴 **併發**:兩筆同時進 ⇒ **兩筆都入帳且標記正確** —— 🛑 **不可以把「都有記下來」當成「沒有漏標」**(codex 逐字)。
🛑 **codex 審查本身不是行為測試** —— 上面每一條都要真的餵過。

## F-4 版本銜接 / 顯示接線 / rollback
· **基線**:`20260902020000`(正式庫現行 `372a2f14…` / 6054)—— ⛔ ~~`20260831010000`~~ 作廢。
· **顯示**:🔴 **加欄位 ≠ 那一列看得見** —— `apps/admin/src/lib/payment/manual-refund-read.ts:14` 的逐列查詢**沒有取新欄位**
  ⇒ **前端片是本片的上線條件之一**, 不是後續優化。**沒有它, 拍板那句「標紅」仍然沒有交付。**
· **rollback**:forward-only。而要明寫兩件 —— ①**已寫入的標記怎麼保存**(回退函式不得清欄位)
  ②**兩支函式要一致恢復**(cap guard 與 immutable 是一組, 只回退一支會留下可改的欄位)。

## G. 🛑 本 plan 現在【還是不能動手】, 缺這兩格
1. **Q56 甲/乙未拍**(超收怎麼標)—— 甲成立才有 F-1 的欄位。
2. **前端片誰做、什麼時候做** —— F-4 說它是上線條件, 而它不在我這條線上。

---

# K. 12 條驗收跑完了(拋棄式 PG 17.10, 埠 57340)—— **12/12 過, 而突變測出一件我沒預期的事**

## K-1 這次的鑽機比上一次faithful:**用真的 trigger 函式本體**
從 `20260907180000` 直接抽出兩支函式的**完整定義**灌進拋棄式庫, 只 stub `pcm_manual_refund_rail_cap`
(改成讀一張 `cap_stub` 表, 讓我可以任意設餘裕)。⇒ **被測的邏輯是真的那一份, 不是模型。**

## K-2 12 條逐字讀數
```
① 低於餘裕 ⇒ within / NULL          ② 等於餘裕(邊界)⇒ within / NULL
③ 高於餘裕 250 ⇒ over / 250         ④ 餘裕 0 退 80 ⇒ over / 80
⑤ 餘裕 -500 退 100 ⇒ over / 100     ⑥ cap NULL ⇒ cap_unknown / NULL
⑦ 預填 over/1 ⇒ 被覆寫成 within / NULL      ← 防偽輸入成立
⑧ 額度事後耗盡 + 值不變 UPDATE ⇒ 仍 within / NULL   ← codex F-2 那個反例【擋住了】
⑨ 作廢後 ⇒ 仍 within / NULL
⑩ 直接改標記 ⇒ 被擋:「不可變更:over_cap_by, cap_state」← **逐字印出那兩欄的名字**
⑪ 復活 ⇒ 被擋(voided_at)          ⑫ DELETE ⇒ 被擋(PCM03)
```

## K-3 🔴 **突變沒有造成預期的損害 —— 而原因值得寫下來**
我把 immutable 的黑名單**拿掉那兩欄**再試著直接改標記:
```
🔴 突變(黑名單無兩欄):沒有擋 ⇒ 現值 within / NULL
🟢 還原(黑名單含兩欄):擋下來了 ⇒ 現值 within / NULL
```
⇒ 📌 **兩邊的【現值】都是 `within / NULL`** —— 也就是說**即使黑名單被拿掉, 那次竄改也沒有得逞**。
**為什麼**:cap guard 自己在 `TG_OP = 'UPDATE'` 時把兩欄**搬回 OLD**(F-2 那段)⇒ **它是第二道、獨立的保護。**
🛑 **而兩道的行為【不一樣】, 這一格要寫清楚**:
· 黑名單在 ⇒ **RAISE**(吵的)—— 動手的人**當場知道**
· 黑名單不在 ⇒ **安靜地被搬回去**(不吵)—— 動手的人**以為改成功了**, 而值沒變
⇒ ✅ **兩道都要留**:少了黑名單, 保護還在**而它變安靜了**;而**安靜的保護會讓人以為系統壞了**。

## K-4 🛑 這一發證不到什麼
· `pcm_manual_refund_rail_cap` 是 **stub** ⇒ 我測的是「**guard 怎麼用那個數字**」, **不是那個數字算得對不對**。
· **沒測併發**(codex ⑦ 那個「兩筆各退 80 都標 within」的反例)—— 那要兩個 session, **本輪沒跑**。
· 拋棄式庫**只裝了兩個 trigger**;正式庫那張表上有 **3 個**(含 `no_truncate`)⇒ 我用 `TRUNCATE` 清列,
  **而正式庫 TRUNCATE 會被擋** —— 這個差異不影響上面 12 條的結論, 但**別把這個庫當成正式庫的替身**。
