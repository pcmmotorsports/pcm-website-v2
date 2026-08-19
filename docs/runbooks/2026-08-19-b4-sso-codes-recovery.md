# B4 `sso_codes` 加欄 —— 復原程序

> 2026-08-19 W5 · **規格草稿,零執行、零寫入。** 對應 `docs/reviews/2026-08-19-b2b3b4-findings-triage.md` 的 `B4-16`。
> 標的 = **報價單庫**(`sso_codes`)。B4 的 DDL 見 `docs/specs/2026-08-18-m4b-e8b-b4-spec.md` §3。

---

## §0 🔴 先答:**誰會在什麼情況下打開這一份?**(這決定它住哪、要多短)

```
誰   ：把 B4 那支 migration 套上【報價單正式庫】的那個人（今天：要 Sean 在場）
何時 ：套完之後，發現它不該上 —— 而那通常伴隨「登入出問題」
狀態 ：他很可能【正在處理一個進行中的問題】，而不是在讀規格
```
🔴 **⇒ 兩個直接結論**:
```
① 這一份要【短】，而且【前三行就是要貼的東西】
② 🔴 它的正本要住進【那支 migration 的檔頭】—— 那是他一定會打開的檔
   （本檔是完整版；migration 檔頭放「三行摘要 + 指回本檔」）
📌 今天量過一次：半夜出事的人不會去讀 plan。同一個結論。
```

---

## §1 🔴 先收窄:**有一類根本不需要復原程序**

```
情況 A：apply 【失敗】—— DDL 沒跑完
情況 B：apply 【成功】，而後來發現它不該上
```

**A 需不需要,取決於【那個管道是不是把整支包進一個交易】**:
```
✅ 已量到（W4，2026-08-19）：supabase db push 把每一支 migration 各自包進交易
   ⇒ 失敗 ⇒ 整支回滾、不殘留 ⇒ 【不需要復原程序】
🔴 而【B4 不走那條路】：報價單庫明文禁 db push
   （該 repo docs/ops/MULTI_WINDOW_WORKFLOW.md:165 逐字「絕不跑 supabase db push」）
   ⇒ B4 走 MCP apply_migration
   ⇒ 🔴 而【那個管道是不是交易式的，沒有人量過】
      —— 它正是 `G5-005 §二 #6` 那四條裡【唯一還沒關掉】的一條
      （其餘三條 2026-08-19 已由本窗唯讀查掉）
```
**⇒ 所以 A 這一類【不能沿用 W4 那個結論】。** 而它是**可量的**:
```
缺的那道檢查：套一支【故意會失敗的】無害 migration（例如最後一行引用不存在的欄），
              然後看：① 前面幾行的效果在不在 ② 台帳有沒有多一列
⇒ 兩個世界要印不同的東西
⚠️ 而那要【寫入】⇒ 不在本窗權限內 ⇒ 它是 apply 當天要順手量的一格，不是我現在能關的
```
🔴 **⇒ 在那一格被量掉之前,A 也要照 §3 的步驟走一次(當成可能有殘留)。**

---

## §2 ✅ 而 B 這一類,**可逆性比預期好** —— 理由是那張表是**用完即棄**的

**本窗 2026-08-19 唯讀實測(可重跑)**:
```sql
select count(*) as rows_now,
       count(*) filter (where used_at is not null)  as used_rows,
       count(*) filter (where expires_at < now())   as expired_rows,
       min(created_at), max(created_at)
from public.sso_codes;
```
```
⇒ rows_now 119 ／ used_rows 111 ／ 🔴 expired_rows 119（【全部】已過期）
   最舊 2026-07-13 ／ 最新 2026-08-19 08:20
```
**⇒ 三個結論**:
```
① 🔴 這張表在任何一個時刻，【活著的列幾乎都是 0】—— code 60 秒到期、用一次作廢
   ⇒ DROP COLUMN 丟掉的是【已經死掉的碼上面的欄位值】⇒ 營運上的損失 = 0
   ⇒ ⇒ 這與丟掉 orders 上的一個欄位【完全不是同一件事】
② 而【不是真的零】：那 8 列（119−111）是【過期而未使用】的 —— 失敗或被放棄的登入嘗試
   ⇒ 它們對【鑑識】有價值，對【營運】沒有
   ⇒ 🔴 若當時正在查一件登入異常 ⇒ 先 §3 步驟 0 備份，不要直接 DROP
③ 📎 順帶量到、而【不屬於本文件】的一格：這張表【從 2026-07-13 起沒有被清理過】
   ⇒ 119 列全過期而仍在。✅ **已立案 `#669`**（而它的題不是「有垃圾」，是那 8 列留多久
      —— 對營運沒價值、對鑑識有價值 ⇒ 那是要 Sean 拍的題，且與
      `data-rights-sop.md:29` 是同一個決定的兩面）。本檔只記不處理。
```

---

## §3 復原步驟(**逐步可貼,每一步附【怎麼知道它成功了】**)

> 🔴 **順序是硬的**:**先讓應用層停止使用那兩欄,才動 schema。**
> 反過來 = 應用層還在寫一個不存在的欄 ⇒ 而 `authorize` 那條路**寫入失敗會被吞掉**
> ⇒ **登入看起來正常,而身分靜靜地沒被寫進去。**

### 步驟 0 · 先備份那幾列(只有在「當時正在查登入異常」時才需要)
```sql
create table if not exists public.sso_codes_backup_20260819 as
  select * from public.sso_codes;
```
**怎麼知道它成功了(兩個世界)**:
```sql
select (select count(*) from public.sso_codes)                  as src,
       (select count(*) from public.sso_codes_backup_20260819)  as bak;
-- ✅ 兩個數字相同 ⇒ 備份完整
-- 🔴 而【備份表不存在】會讓上面這句【整句報錯】，不會靜靜回 0 ⇒ 兩個世界分得開
```

### 步驟 1 · 先退應用層(不是 DB)
```
把 authorize 那段寫入兩欄的 code 退掉並部署，確認【沒有任何寫入端】還在碰它。
```
**怎麼知道它成功了**:
```sql
-- 部署完成後，等一個 code 生命週期（60 秒）再跑：
select count(*) as written_after
from public.sso_codes
where sub_kind is not null and created_at > now() - interval '5 minutes';
-- ✅ 0 ⇒ 沒有人在寫了
-- ⚠️ 而【0 也可能是「這五分鐘沒有人登入」】⇒ 對照組：
select count(*) as any_login_in_window
from public.sso_codes where created_at > now() - interval '5 minutes';
-- 🔴 這一格 >0 而上一格 =0 ⇒ 才是真的「有人登入而沒寫那兩欄」
-- 🔴 若這一格也是 0 ⇒ 你【什麼都沒證明】，去請一個人登入一次再量
```

### 步驟 2 · 卸掉 CHECK
```sql
alter table public.sso_codes drop constraint if exists sso_codes_sub_shape;
```
**怎麼知道它成功了**:
```sql
select count(*) as still_there
from pg_constraint
where conname = 'sso_codes_sub_shape'
  and conrelid = 'public.sso_codes'::regclass;
-- ✅ 0 ⇒ 卸掉了
-- 🔴 對照組（證明這把尺會印非零）：把 conname 換成一個確定存在的 constraint ⇒ 必須回 1
```

### 步驟 3 · 卸掉兩欄
```sql
alter table public.sso_codes drop column if exists sub_staff_id;
alter table public.sso_codes drop column if exists sub_kind;
```
**怎麼知道它成功了**:
```sql
select string_agg(column_name, ', ' order by ordinal_position) as cols
from information_schema.columns
where table_schema = 'public' and table_name = 'sso_codes';
-- ✅ 回到 7 欄：code_hash, state_hash, amr, auth_time, expires_at, used_at, created_at
--    （2026-08-19 本窗唯讀量到的原始欄位清單）
-- 🔴 而【多一欄或少一欄】都要停下來 —— 不要「差不多對」就往下走
```

### 步驟 4 · 台帳(**而這一格取決於 §1 那個沒人量過的東西**)
```
🔴 如果 MCP apply_migration 把台帳與 DDL 記在同一個交易 ⇒ 這一步不必做
🔴 如果不是 ⇒ 台帳上會留著一筆「已套用」而 schema 已經退回去 ⇒ 下次 apply 會跳過它
⇒ 而【我不知道是哪一種】。
⇒ 處置：先查，再決定：
```
```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 5;
-- 看 B4 那一支在不在。在 ⇒ 需要決定要不要刪那一列（🔴 那是【動台帳】，要另一次批准）
-- 不在 ⇒ 什麼都不用做
```
⚠️ **本檔【不寫刪台帳的 SQL】** —— 動 migration 台帳是一個比 rollback 本身更容易出事的動作,
**而它應該由知道那個管道語意的人來寫。** 這一格明寫【未解】。

---

## §4 🔴 這份文件【沒有】做到的

```
· 沒有執行任何一句 —— 全部是草稿，本窗唯讀
· 🔴 §1 那個「MCP apply_migration 是不是交易式的」【仍未量】
  ⇒ 它決定 A 那一類要不要走這份程序，而它要【寫入】才量得到
  ⇒ 缺的那道檢查已寫在 §1，是 apply 當天順手量的一格
· §3 步驟 4（台帳）刻意不給 SQL —— 理由在該節
· 而【誰有權跑這些】沒有變：報價單庫的寫入仍要走 MCP 且要 Sean 在場
```
