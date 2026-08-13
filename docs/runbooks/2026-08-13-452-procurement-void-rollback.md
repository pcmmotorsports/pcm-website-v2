# #452 採購作廢欄 回退 runbook(片 2a-1)

> 對應 migration:`supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql`
> 由來:R3(codex 換角度)MF —— 原檔尾那段「怎麼退」**照做會把系統弄壞**(刪了欄位、函式還在引用)。
> 形狀照本 repo 既有先例 `docs/runbooks/2026-07-30-a7-rollback.md`,該檔檔頭逐字:
> 「**Supabase forward-only ⇒ 回滾 = 災難當天另立 down migration,本檔 = 其執行程序。**」
> 執行者 = 有 context 的 AI session + **Sean 拍板**(鐵則:動 prod DB 必停問)。
>
> ## 🔴 給下一個寫「刪欄位回退」的人(寫在最前面,因為這是第二次了)
>
> `docs/runbooks/2026-07-30-a7-rollback.md` 檔頭 v2 擴列③ 逐字:
> 「**A2b1/A4a 已 apply 且函式體引用取消表**(v1 漏,關卡1 抓 = **DROP 後 42P01 寫入炸彈**)」
> —— 而本檔的存在理由,是**同一族的錯在同一個 repo 第二次出現**(這次是 R3 抓的)。
>
> **⇒ 第二次出現 = 那不是個案,是這類 migration 的固有陷阱。**
> **⇒ 凡是「DROP 欄位」的回退,先問一句:「還有誰在引用它?」**
> 具體要查的三處:①函式體(`pg_get_functiondef` 全文搜欄名)②索引述詞 ③CHECK 述詞。
> 三處都清乾淨,才輪到 `DROP COLUMN`。
> 🔴 **這一句是寫給第三次的人看的** —— 前兩次都是在審查階段才被抓到,不是在寫的時候想到的。
>
> 🔴 **本檔的每一步、每一道閘、以及「順序為什麼不能反」,都在拋棄式 PG 17.10 上實跑演練過**
> (2026-08-13,四發:正向 / 回退後真寫入 / 重複跑被擋 / **錯誤順序的負向演練**)。結果見 §4。

---

## 0. 這份 runbook 存在的理由(先讀這段,它比步驟重要)

原本檔尾那段「怎麼退」只寫了一句「兩支函式還原成本片之前的版本」——
**而那正是唯一真的會炸的那一步,卻被一句話帶過。**

🔴 **實測的失敗長相**(§4 負向演練,逐字):照「先刪欄、不還原函式」的順序退完之後,
員工隔天早上寫一筆採購 ⇒
```
ERROR:  column p.voided_at does not exist
```
⇒ **採購寫入整條停擺,而且是在回退「成功」之後才發作。**

**這與 A7 那支 runbook v1 踩過的是同一顆炸彈** —— 該檔檔頭逐字記著
「**A2b1/A4a 已 apply 且函式體引用取消表**(v1 漏,關卡1 抓 = **DROP 後 42P01 寫入炸彈**)」。
⇒ 同一個 repo、同一族的錯,第二次出現。**順序不是風格,是承重。**

---

## 1. 前置(不滿足就停,不要往下走)

| # | 閘 | 判準 |
|---|---|---|
| P1 | 表看得到 | `to_regclass('public.order_item_procurement') IS NOT NULL` |
| P2 | 作廢欄**存在** | 不存在 ⇒ 2a-1 沒 apply 過或已回退過 ⇒ **不要重跑** |
| P3 | 🔴 **零筆被作廢** | `count(*) WHERE voided_at IS NOT NULL` = 0。**非 0 ⇒ 停** —— 刪欄會讓那些作廢事實與理由**永久消失**,且步 2 的 `ADD CONSTRAINT` 可能**撞重複鍵**而讓整支失敗 |
| P4 | 🔴 **2a-2 尚未 apply** | 偵測到 `admin_void_item_procurement` / `admin_unvoid_item_procurement` ⇒ **必須先逆序回退 2a-2**,否則那兩支會引用已刪的欄位 |

**四道閘都寫在下方 SQL 的步 0 裡,會自己 RAISE**,不需要人工比對。

---

## 2. 執行順序(🔴 不可調換)

| 步 | 做什麼 | 為什麼不能往後移 |
|---|---|---|
| 0 | 四道前置閘 | 見 §1 |
| **1** | **先把兩支函式還原成 452 之前的版本** | 🔴 **這步一旦排在刪欄之後,就是 §0 那顆炸彈。** 函式引用 `voided_at`,欄位先消失 ⇒ 下一次 trigger 發火當場 `column p.voided_at does not exist` |
| 2 | 業務鍵:同名 partial unique index → 回 UNIQUE 表約束(含還原 `COMMENT ON CONSTRAINT`) | 要在步 3 刪欄之前 —— 索引的述詞用到 `voided_at` |
| 3 | 刪配對 CHECK、刪兩欄 | — |
| 4 | 後置斷言(兩支函式指紋回到 452 之前 / 兩欄已消失 / 業務鍵回表約束) | 沒有這步 = 「跑完了」不等於「回到原狀」 |

**全部包在單一交易**:任一步失敗 ⇒ 整支回滾,**不存在「退到一半」的狀態**。

---

## 3. 可直接執行的 SQL

> 產法:兩支函式的本體**由程式從原始 migration 逐字抽出**
> (`20260803130000:102-161` 與 `20260806180000:180-242`),不是重打。
> 🔴 A2b1 原版是裸 `CREATE FUNCTION`,回退時**必須改成 `CREATE OR REPLACE`**(它被 trigger 依賴,`DROP` 會被擋、`CASCADE` 會把 trigger 一起刪掉)。
>
> **完整檔在** `scripts/452-down.sql`(本 runbook 與它是同一份內容,以該檔為準;本節只說明結構)。

```
BEGIN;
  SET LOCAL lock_timeout = '5s';  SET LOCAL statement_timeout = '120s';
  步 0  DO $g$ … 四道前置閘 … $g$;
  步 1  CREATE OR REPLACE FUNCTION public.pcm_a2b1_procurement_allocation_guard() …   -- 452 之前版本,逐字
        CREATE OR REPLACE FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid) … -- 452 之前版本,逐字
  步 2  DROP INDEX public.order_item_procurement_business_key;
        ALTER TABLE … ADD CONSTRAINT order_item_procurement_business_key UNIQUE (order_item_id, supplier_id);
        COMMENT ON CONSTRAINT …  -- 逐字取自 20260801150000:173-183
  步 3  ALTER TABLE … DROP CONSTRAINT order_item_procurement_void_pair;
        ALTER TABLE … DROP COLUMN void_reason, DROP COLUMN voided_at;
  步 4  DO $v$ … 後置斷言 … $v$;
COMMIT;
```

**步 4 釘的兩顆指紋**(量法 = `md5(pg_get_functiondef(…::regprocedure))`):
- A2b1 回到 `39b9c3a446ad043c9681b0317f3e1961`
- A4a 回到 `4ac2989a58985beae91a491a816086f7`
  (這顆另有兩個獨立來源:`scripts/b2s2b-verify.sh:274`、`scripts/w7d3-verify.sh:361`)

---

## 4. 演練紀錄(2026-08-13,拋棄式 PG 17.10,四發)

| # | 演練 | 結果 |
|---|---|---|
| 1 | 回退前先證系統確實在「有 452」的狀態 | 兩欄在、業務鍵**不在** `pg_constraint`(已是索引)✅ |
| 2 | 跑回退 | 步 4 後置斷言全過、`COMMIT` ✅ |
| 3 | 🔴 **回退之後真的寫一筆採購** | `CREATED`、摘要重算 = 3 ⇒ **A2b1 與 A4a 都活著,沒有炸彈** ✅ |
| 4 | 重複跑回退 | 被步 0 的 P2 擋下:`作廢欄不存在 ⇒ 不要重跑` ✅ |
| 🔴 5 | **負向演練:照錯的順序退**(先刪欄、不還原函式) | 下一筆採購寫入 ⇒ `ERROR: column p.voided_at does not exist` ✅ **證明步 1 的位置是承重的,不是排版** |

⚠️ **演練的天花板(不藏)**:
- 拋棄式庫的資料是 seed,**不是正式庫的資料**。演練證的是「**這個順序在這個 schema 上成立**」,
  不是「正式庫回退一定順利」。
- 第 5 發證的是「錯順序會壞」,**不證「我的順序涵蓋了所有壞法」**。
- **未演練**:2a-2 已 apply 的情況(那時 2a-2 還不存在)⇒ P4 那道閘是**寫下來的、沒被跑過**。

---

## 5. 執行後要做的事

1. 🔴 **這是 forward-only 的世界** ⇒ 回退**不會**把 `supabase_migrations.schema_migrations` 裡那一列拿掉。
   ⇒ 回退之後,`20260813120000` 在 history 上**仍然是 applied**,而 schema 上已經不在。
   **下一個人看 history 會以為它還在。** ⇒ 回退當天**必須**在 `supabase/APPLIED.tsv` 與當日 handoff 寫明「已回退」。
2. 兩支函式的指紋回到 452 之前 ⇒ **`scripts/b2s2b-truth-sync.py` 的 `helper-452` 位置會變成指向一個已不生效的檔**。
   ⇒ 回退當天要把那個位置從 `SITES` 拿掉(連同 `SITES_KEYS_FROZEN` / `BLOCKS_PER_FILE` / `BLOCKS`),否則它守的是一個不再是權威的地方。
3. 把回退的原因與當下的觀察寫進當日 handoff —— **回退不是失敗,是設計裡本來就有的一條路;但它必須留下紀錄。**

— END —
