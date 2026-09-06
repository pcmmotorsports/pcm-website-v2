# Plan · `#299` 三張 fitments 表補進版控 + `⟦b4-PFEREPLAY1⟧` 動帳本

> 端 Sean 批准用,**不動碼**。線【資料】`-db` 2026-09-06。授權 = Sean 逐字
> (`~/pcm-mailbox/端Sean-0905早上佇列.md` 21:58)「…q9: 甲 / q10 甲…」⇒ Q9 補版控 + Q10 可動帳本。
> 鐵則 8 + 12③ ⇒ **批准才做,commit 前過 codex**。

## 1 · 補哪些(開檔數的,不是板上抄的)
DDL 在 `docs/archive/2026-07-25-docs-cleanup/reviews/2026-07-12-s1-apply-sql.sql`(**312 行**)。
`grep -nE '^\s*CREATE (TABLE|VIEW|FUNCTION|INDEX|UNIQUE INDEX|POLICY)'` ⇒ 補 **6 個物件**:
`product_fitments_effective`(`:67` + 索引 `:86 :88 :89` + RLS/POLICY `:98`)·
`_staging`(`:182` + `:200`)· `_sync_log`(`:206`)·
函式 `search_products_by_vehicle`(`:116`)/ `pfe_staging_reset`(`:222`)/ `pfe_sync_commit`(`:240`)。
🔴 **`storefront_fitments_v`(`:16`)不補** —— 它與依賴的 `product_groups_v` 是**報價單庫**物件,
一直在 `~/API大量上架/PCM報價單-V2` 的版控裡。抄過來 = 把別人家的東西餵進我們家的庫。

## 2 · 定義從哪抽(🔴 **不是照抄存檔**)
存檔是 2026-07-12 的,而「DDL 找得到」與「DDL 等於正式庫現況」是**兩個宣稱**。
✅ 抽法 = 唯讀取回正式庫**現況**再逐物件比對存檔,差異逐條列出:
表 = `information_schema.columns` + `pg_indexes` + `pg_constraint` 三張拼(PG 沒有 `pg_get_tabledef`);
函式 = `pg_get_functiondef(oid)`;RLS = `pg_policies`;權限 = `information_schema.role_table_grants`。
🔬 已做掉一格:存檔主表區塊 `grep -c 'CHECK'` ⇒ **5**,五條都具名 ⇒ 與板上宣稱的「正式庫 5 個 CHECK」數目一致。
⚠️ 那只證「存檔與板上一致」,**沒證存檔 = 正式庫** ⇒ 本節不可省。
⚠️ 我的唯讀身分**讀不到** `supabase_migrations`(實測 `permission denied`)⇒ 抽定義那幾發**要有人代跑**。

## 3 · 版本號怎麼取(`⟦b4-PFEREPLAY1⟧` 的核心)
第一個**讀**這張表的是 `20260712183000_products_catalog_page_public.sql`(讀它的共 **11** 支);
而 2026-09-01 那支補版控的 `20260901170000` **排在第 11 個讀者之後** ⇒ 空庫重放照樣炸。
⇒ 版號取 **`20260712180000`**(早於第一個讀者)。
🛑 代價:一支「號碼在過去、apply 在今天」的 migration **破壞 `APPLIED.tsv` 的時序不變式** —— 那正是 Q10 甲放行的東西。

## 4 · 帳本怎麼記
`APPLIED.tsv` 新增一列,**同一顆 commit** 在該檔加一段具名例外,逐字寫
「本列版號早於它被 apply 的時點 —— 這是 `#299` 補登,不是漂移」並附本 plan 路徑。
🔴 **寫進帳本檔本身而不是只寫 commit body**:讀帳本的人不會去讀 commit body,
而**「不變式被破壞」與「有人手滑」在那張表上長得一模一樣**。
⚠️ 補登 migration 對正式庫必須 no-op(`IF NOT EXISTS` / `CREATE OR REPLACE`),
🛑 **而 no-op 要被證明不是被宣稱**:貼前貼後各跑一次對帳(函式 md5 / 欄位數 / CHECK 數 / policy 數),四個數逐字相同才算。

## 5 · 怎麼驗(拋棄式 PG,照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`)
1. 空庫依序跑全部 migration ⇒ 記下**首個失敗在第幾支**(2026-08-25 線 1 基線:195/214,首失敗 #55)。
2. 加入補登那支再跑 ⇒ **驗收 = 首個失敗往後移,且那 6 個物件都建得起來**。
3. 🔴 **負對照必跑**:把補登的版號改成 `20260901…`(晚於讀者)⇒ **必須退回原本的失敗點**。
   📌 沒有這一發,「綠了」不能歸因給版號 —— 也可能是別的東西順便修好的。
4. ⚠️ 已知:312 行一次跑 `EXIT=3` 停在 `:48`(`product_groups_v` 不存在);拆 `:67-160` 與 `:161-312` ⇒ 皆 `EXIT=0`。
5. `scripts/migrations-replay-from-zero.sh` 比的是**檔名排序** ⇒ 本片會**改變它的行為**,
   驗收要包含「補登之後它印什麼」,不要讓它變成新的假綠。

## 6 · rollback
正式庫:本片是 no-op ⇒ **沒有東西要 rollback**;要退 = `git revert` 那顆 + 從 `APPLIED.tsv` 移除該列。
repo:一顆 commit 內完成(migration + 帳本 + `d1-fitments-bootstrap.sql` 改指向)⇒ revert 單顆。
🛑 **不可逆的那一格**:一旦有人拿新版號的 repo 建過新環境,退版號會讓那些環境**與 repo 不一致**
⇒ **退版號要當成新的一片,不是 revert。**

## 7 · 這份 plan 答不出什麼
① **我沒連正式庫抽定義** —— 上面的 CHECK=5 是**存檔的數**,不是正式庫的。
② **漂移量沒有量** —— 存檔 44+ 天沒動,其間有沒有人改過那三張表**沒有人問過**。
③ **估時** 抽定義+比對 60-90 分 / 寫補登 30-45 分 / 驗 30 分 ⇒ **超過 45 分鐘 ⇒ 要拆片**(鐵則 4)。
