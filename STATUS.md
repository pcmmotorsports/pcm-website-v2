# STATUS.md

> **2026-09-09 減法版(Sean 拍 Q2 甲)。** 舊版 872 行逐字保存在 `PROGRESS.md` §「2026-09-09 STATUS 主表整檔移出」,也可 `git show 54bb99e18:STATUS.md`。
> 本檔不再每片更新七欄。現況看 `docs/handoff/CURRENT.md`。

- **Phase / Milestone**:Phase 1 / M-4b 後台重建「員工上工」線。北極星(Sean 逐字)=「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」。
- **Branch**:`dev`(= 後台 production,推即上線);顧客站跑 `main`,Sean 手動 FF。當下 hash 用 `git log --oneline -3` 當場看,不寫死。
- **這週(09-09 起)兩條線**:窗 A 前台購買流程、窗 B 後台收單到出貨。定義與進度在 `docs/handoff/CURRENT.md`。
- **Sean 待決策**:寫在 `docs/handoff/CURRENT.md`「等 Sean」一節,用 Q/A code block。
- **舊待辦板** `docs/launch-todo.md`:凍結只讀。要查某列做了沒 `python3 scripts/what-happened-to.py <錨>`。

## 🔴 建表的人要看一眼的一件事(2026-09-18 加)

**新建的表沒有自動開 RLS,不會有任何東西報錯。**

`public.rls_auto_enable()` 是一支 event trigger:有人 `CREATE TABLE` 時它負責自動 `ENABLE ROW LEVEL SECURITY`。
🔴 **而它的 `EXECUTE` 包在 `EXCEPTION WHEN OTHERS THEN RAISE LOG` 裡** ——
   ⇒ 它壞掉**不會讓任何一支 `CREATE TABLE` 失敗**,只會讓那張新表**靜靜地沒開 RLS**。
   ⇒ 🛑 **「建表沒報錯」證不到它還活著。**

**⇒ 建完表自己看一眼**(唯讀,`bash scripts/readonly-prod-sql.sh`):

```sql
SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = '<你剛建的表>';
-- 🔵 負對照:同一發查一張你確定有開的(例如 public.orders)⇒ 該回 t
--    兩格並排才算數 —— 只查一格的話, 「f」與「我查錯表」長得一樣。
```

## ⛔ 板 211(M3:最後 3 支 SECURITY DEFINER 鎖 `search_path`)—— **Sean 2026-09-18 拍甲:不貼**

檔已備好(`supabase/migrations/20260918010000_…_m3.sql`),**但 a1 2026-09-18 查完之後建議不貼**:

- 那三支(`pcm_op2b_reversal_amount` / `record_auth_callback_event` / `rls_auto_enable`)
  在 `docs/plans/2026-09-05-definer-search-path-lock-plan.md` §1 就被分成**堆 D / B / C**,
  逐字標 **`parked`,「收益低風險高」「不要為了數字歸零一起動」**。
- **Sean 2026-09-17 拍的甲是那 12 支**(窗A 的 M2 plan `:190` 逐字)—— **不含這三支。**
- 🔬 **a1 2026-09-18 對正式庫實測**:`anon` / `authenticated` / `service_role` / `payment_confirmer` / `postgres`
  **沒有一個能在 `pg_catalog` 或 `public` 建東西**(`has_schema_privilege(… ,'CREATE')` 全 `f`;
  `pg_catalog` 的 ACL 是 `{supabase_admin=UC/supabase_admin,=U/supabase_admin}`)
  ⇒ **那三支的 `search_path` 沒有可被劫持的一格 ⇒ 它們現在就已經安全 ⇒ 板 211 的收益接近 0。**
  ⇒ 而成本包含動到上面那支**壞掉是安靜的** `rls_auto_enable`。
- ✅ **Sean 2026-09-18 拍甲:不貼。** ⛔ ~~「這是建議,不是定案 —— Sean 還沒答」~~(2026-09-18 已答)
  ⇒ 檔案**留著不刪**:它把「為什麼不做」的證據與那三支的現值都存住了。**要貼等於推翻兩次決定,要 Sean 再明說一次。**
- 🔵 **板 209(M2,那 12 支)不受影響**:那批是漏網不是刻意的例外,Sean 拍過,照常。
- 🔴 **順序仍然寫死**:若兩支都要貼,**板 209 先、板 211 後** ——
  M2 拿 `rls_auto_enable()` 當負對照,211 先貼會讓 M2 拒絕 COMMIT(211 的前置閘②會自己擋)。

證據全文:`~/pcm-mailbox/佇列-資料庫平台帳本-20260918.md`
