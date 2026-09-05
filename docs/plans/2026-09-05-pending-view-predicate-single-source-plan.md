# 四支 pending view 的述詞抽成單一來源 — plan(一頁)

> 觸發:codex R2 ① 的修法在碼裡留了一句**我自己寫的已知缺口** ——
> 「述詞是**抄**四支 pending view 的 ⇒ 它們會各自漂, 而今天沒有機械守門綁住」。
> `-f8` 2026-09-05 派工:**把它抽成一支 SQL 函式(單一來源)**。鐵則 8 由 -f8 批、12③ 走 codex。

## 0. 🔴 先答這一題 —— 它決定這片存不存在

**`20260905210000` 貼進正式庫了沒?**

| | 做法 | 成本 |
|---|---|---|
| **甲**(**沒貼**) | **直接改 210000 那一支** —— 它還沒進正式庫, 改它 = 改一份草稿 | 一支檔、四支 view 只改一次 |
| **乙**(**貼了**) | 開新 migration(版本號見 §4)把四支 view **再改一次** | 兩支檔、四支 view 改兩次、多一輪 codex |

🛑 **我答不出來**:板上 `貼板-0905/19_20260905210000_…sql` **排著**, 而「排著」與「貼了」是兩件事。
要答它得跑唯讀查證(`bash scripts/is-migration-applied.sh 20260905210000`)—— **那道授權不在我這裡**。
⇒ 📌 **這一格請 -f8 或主視窗量一發再開工。** 甲的成本大約是乙的一半。
🔵 而**兩案的設計完全相同**, 差別只在「寫在哪一支檔裡」⇒ 下面 §1-§5 兩案共用。

## 1. 現況:同一組述詞今天有幾份

```
pcm_order_created_email_pending          WHERE A①  ┐
pcm_shipped_email_pending                WHERE A②  │ 四支各一份
pcm_tracking_corrected_email_pending     WHERE A③  │
pcm_unpaid_cancelled_email_pending       WHERE A④  ┘
pcm_manual_no_email_excluded  四塊       WHERE A①②③④ 各再一份  ← 抄的, 會漂
```
🔴 **漂掉的症狀不對稱**:pending 那半漂 ⇒ **信寄錯或沒寄**;伴生那半漂 ⇒ **數字說錯話**。
⇒ 今天沒有任何測試看得到「這兩份不一樣了」——**每支測試的分母都是它自己那一份**。

## 2. 改法:四支 SQL 函式,一支對一個掃描面

```sql
CREATE FUNCTION public.pcm_pending_candidates_order_created()
  RETURNS TABLE (order_id uuid, display_id text, notification_email text,
                 customer_email text, order_source text, paid_at timestamptz, created_at timestamptz)
  LANGUAGE sql STABLE AS $$ SELECT … FROM … WHERE A① $$;   -- 🔴 A① 只寫這一次
```
· `pcm_pending_candidates_{order_created, shipped, tracking_corrected, unpaid_cancelled}` 四支。
· 各自回傳**那支 pending view 現有的欄位集合**(欄不增不減 ⇒ `CREATE OR REPLACE VIEW` 夠用)。
· 🔴 **`LANGUAGE sql STABLE`, 不用 plpgsql** —— plpgsql 是最佳化圍籬, 而 SQL 單句可被 inline,
  計畫與今天一樣。⚠️ 這句是**設計理由, 不是量測** —— 收工前要對 `EXPLAIN` 比一次修前修後。
· 然後:
  - pending view = `SELECT * FROM pcm_pending_candidates_X() WHERE <非「手動+留白」>`
  - 伴生 view 第 X 塊 = `SELECT … FROM pcm_pending_candidates_X() JOIN manual_blank …`
  ⇒ 📌 **A① 從兩份變一份;而「手動+留白」那組值域仍是兩份(正向 / 反向), 由測試綁。**

## 3. 這片會弄壞什麼(先寫,不要讓它在收工時才出現)

1. 🔴 **`pg_get_viewdef(...) LIKE '%manual_phone%'` 那幾條自證會變假** ——
   述詞搬進函式之後, **view 定義裡看不到那個字面了**。⇒ 自證要改成問函式的 `prosrc`,
   或改問「view 有沒有引用到那支函式」。**這一格不改 = 一道恆綠的閘。**
2. 🔴 **`notification-fallback-sql-parity.test.ts` 會紅** —— 它 grep 的是 `20260905210000` 檔裡
   `^ {5}OR o\.order_source NOT IN \(` × 4。位置變了 ⇒ 4 變 0。**測試要跟著搬, 不是把數字改小。**
3. 🔴 **四支新函式是新物件** ⇒ 出生自帶 anon 權限 ⇒ **兩道 REVOKE + 事後斷言**
   (`docs/patterns/revoking-function-execute-in-supabase.md`)。而五支 view 都是
   `security_invoker = true` ⇒ 它們 body 裡的函式用**呼叫者**的權限跑
   ⇒ `.husky/invoker-view-execute-gate.py` 會要求**每一支**都有一條字面
   `has_function_privilege( … '<fn>' … )` 的事後斷言 —— **四條逐字寫開, 不用迴圈**(080000 踩過)。
4. 🔵 兩支探針的突變會落在新位置 ⇒ 每一發都要重新確認「它紅在我要的那一句」。

## 4. 版本號

⛔ **`20260905240000` 不能用 —— 沒有 24 點**(版本號是 `YYYYMMDDHHMMSS`, 會被工具當時間戳解析)。
✅ 提 **`20260905230000`**。當場量到 0905 已被佔:`01…14`(除 15/16)、`17`、`18`、`19`、`21`、`22`
⇒ 空的是 `15 / 16 / 20 / 23`。🔴 **而別條線也在建 0905 的檔** ⇒ **動筆的前一秒再數一次**
(我今天已經被同一件事咬過一次:自己先佔的號被別人吃掉)。

## 5. 驗收(每條可 yes/no)

- [ ] 四支 view 的 `pg_get_viewdef` 各自**引用得到**對應那支函式(不是靠字面, 靠 `pg_depend`)
- [ ] 兩支探針全格綠, 且**每一發突變都紅在它要的那一句**(不是紅在 `already exists`)
- [ ] 🧬 新突變:把**任一支函式**的一條述詞改掉 ⇒ pending 那支與伴生那塊**同時**變
      ⇒ 這一格才是「單一來源」的證據(今天改一份、另一份不動 = 沒接上)
- [ ] parity 測試搬到新位置後仍**殺得死突變**(改值域 ⇒ 只死該死的那幾格)
- [ ] 四支新函式:anon 叫不動 / service_role 叫得動, **兩側都有事後斷言**
- [ ] `EXPLAIN` 修前修後比一次 —— 函式有沒有被 inline(§2 那句設計理由要有讀數)
- [ ] rollback 寫成**可執行的步驟**(先 DROP 什麼、再 REPLACE 什麼),不是一段說明

## 6. 我判斷不了、要別人決定的

1. **§0 那一題**(210000 貼了沒)—— 唯讀授權不在我這裡。
2. 🔴 **「單一來源」值不值這個代價**:它把述詞從「四份 + 抄一份」變成「一份 + 四層間接」。
   ⚠️ **間接也有成本** —— 下一個人要查「這支 view 收什麼單」時, 要多開一支檔。
   而今天那份重複造成的實際損害是 **0**(伴生 view 沒有人在讀, 手動單 0 張)。
   ⇒ 📌 **這一段刻意寫下來:我不認為它明顯划算, 而那是 -f8 / Sean 的判斷不是我的。**
