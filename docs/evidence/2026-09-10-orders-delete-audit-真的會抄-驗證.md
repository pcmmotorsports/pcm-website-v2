# 2026-09-10 ⟦db-ORDERDELETENOTRACE⟧ —— 那格「證不到它真的會抄」,證完了

> 板列 `⟦db-ORDERDELETENOTRACE⟧` 自己標著一格沒證到,逐字:
> 🛑 **而本包【證不到它真的會抄】** —— 要證只有真的刪一列,而**不可以在正式庫刪一張單來測試**。
> ⇒ ✅ 補法 = 拋棄式 PG 正向貼 → 種一張假單 → `DELETE` → 看 log 表有沒有 3 列。
>
> **這一份就是那個補法。做完了。**

---

## 🔴 先講一件板上寫錯的事:**這一列的狀態是舊的**

板列末格逐字寫「⟨已量 2026-09-09 · B⟩ 🔴仍未做 · 卡在:🧑Sean + 🔧我們……而【正向貼】要他說貼。」

【量的】2026-09-10 唯讀查正式庫(`bash scripts/readonly-prod-sql.sh`,零寫入):

```
① orders 上的 trigger(前提斷言:必須 > 0)      5     ← 板上量到的是 4
② 其中【會在 DELETE 時觸發】的                   1
③ orders_deleted_log 這張表在不在(1=在)         1     ← 板上說沒有
④ 正對照:admin_audit_log 在不在(必須 1)        1
```

三支 trigger 全在、全啟用:
```
 order_items          | pcm_order_items_delete_audit_ad          | O
 order_legal_consents | pcm_order_legal_consents_delete_audit_ad | O
 orders               | pcm_orders_delete_audit_ad               | O
⚪ 負對照:現造的 trigger 名 ⇒ 0 列
```

⇒ 📌 **貼板 103 已經貼了。** repo 側對得上:`supabase/migrations/20260907070000_m4b_orders_delete_audit_trail.sql`。
⇒ 🛑 **不是「仍未做」。板列要翻。**
· 【證不到】**是哪一天貼的** —— `supabase_migrations.schema_migrations` 我的唯讀角色沒有權限(`ERROR: permission denied for schema supabase_migrations`)。

`orders_deleted_log` 目前 **0 列**。
🛑 **而「0 列」推不出「沒有人刪過訂單」**(codex nit,它對)—— 至少四種原因印同一個 0:
真的沒人刪過 · 有人用 `TRUNCATE`(不觸發那三支)· trigger 被 `DISABLE` 過 · 留痕表自己被清過。
📌 **又是那個母題:一個 0,由好幾種原因產生。**

---

## 🎯 正檔:它真的會抄

拋棄式 PG **17.10**(照 `docs/runbooks/throwaway-postgres-for-migration-verification.md` §1 整段貼,沒有手打 `initdb`/`pg_ctl`)。
建最小骨架三張表 → 貼 `20260907070000`(rc=0、`COMMIT`)→ 種一張假單(1 單 + 1 品項 + 1 同意書)→ **真的 `DELETE`**。

```
前提① 三支 trigger(必須 3)        3
前提② log 表刪之前的列數(必須 0)   0
前提③ 種好了嗎(必須 3)            3
DELETE 1
🎯 刪完 log 表有幾列(期望 3)       3

 source_table         | order_id                             | definer_user | session_role | 單號字面   | 金額字面
 order_items          | aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa | postgres     | postgres     |            |
 order_legal_consents | aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa | postgres     | postgres     |            |
 orders               | aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa | postgres     | postgres     | D-FAKE-001 | 1234
```

✅ **三張表各留一列 · `order_id` 三列都串得回同一張單 · 單號與金額的字面都保下來了。**
✅ **子表是被 `ON DELETE CASCADE` 刪掉的,而它們照樣留痕** —— 那一格原本也沒人證過。
🔵 **檔頭那個實錘也一併被證實了**:`current_user` / `session_user` 不加 `pg_catalog.` 前綴是對的 —— 這一發是**執行期**,而它沒炸。📌 「函式建起來了」與「它叫得動」是兩件事,而只有真的 DELETE 一次才問得出來。

### ✅ 負對照 —— 那個 3 不是別的東西產生的

```
前提:trigger 真的停了嗎(必須 3)                   3   ← tgenabled='D'
(同樣種一張單、同樣 DELETE)
🔴 負對照:停掉之後 log 表總列數(必須仍是 3)        3   ← 一列都沒進去
```
⇒ 📌 尺是活的。**綠的那個 3 是 trigger 抄出來的,不是別的原因。**

---

## 🔴 而順帶量到一個【新的洞】:`TRUNCATE` 完全不留痕

```
前提:TRUNCATE 之前 orders 有幾列(必須 1)                    1
NOTICE: truncate cascades to table "order_items"
NOTICE: truncate cascades to table "order_legal_consents"
TRUNCATE TABLE
🎯 TRUNCATE 之後 log 表總列數(若仍是 3 ⇒ 不留痕)             3   ← 一列都沒多
   而 orders 現在剩幾列(必須 0 ⇒ 資料真的沒了)               0
```

📌 **原因**:那三支是 `AFTER DELETE … FOR EACH ROW`,而 **`TRUNCATE` 不會觸發 row-level 的 DELETE trigger**。
⇒ 🎯 **這一列存在的理由(訂單被直接 SQL 弄不見而沒人知道)在 `TRUNCATE` 這條路上【原封不動地還在】。**

### 它有多嚴重 —— 量過再說

【量的】唯讀查正式庫:對 `orders` / `order_items` / `order_legal_consents` 有 `TRUNCATE` 權限的應用角色
(`anon` / `authenticated` / `service_role` / `pcm_readonly` / `authenticator`)⇒ **0 個**。
🟢 正對照:`service_role` 對 `orders` 有 `SELECT` ⇒ `true` ⇒ 尺會咬。
表擁有者 = `postgres`。

⇒ 🟡 **判定:低可能性,而【正好命中這一列的原始劇本】。**
· 一般應用路徑碰不到 —— 五個角色一個都沒有 TRUNCATE。
· 🔴 **但這一列的原始事件本來就不是走應用路徑** —— 板上逐字記著「**Sean 09-04 請窗刪掉測試單,23 ⇒ 1**」,那是**直接下 SQL**。而直接下 SQL 的那個身分(`postgres` / SQL Editor)**就是唯一做得到 TRUNCATE 的身分**。
· ⇒ 📌 **這道稽核擋得住「下次有人 `DELETE`」,擋不住「下次有人 `TRUNCATE`」。而兩者對 Sean 來說是同一件事:單子不見了。**

### 補法(**沒動,等 Sean**)

加一支 `AFTER TRUNCATE … FOR EACH STATEMENT` 的 trigger,記「這張表在這個時刻被 TRUNCATE 了、由誰」。
🛑 **statement 級的 trigger 拿不到 `OLD`** ⇒ 它記得到「發生過」,**記不到「刪掉的是哪幾筆」**。那是機制天花板,不是實作偷懶。
🛑 **動 schema ⇒ 鐵則 8 ⇒ 要先寫 plan 等 Sean 批。本份只回報,沒有動任何東西。**

---

## 🛑 我證不到什麼

· 【證不到】**貼板 103 是哪一天貼進正式庫的** —— 帳本 schema 我的唯讀角色讀不到。
· 【證不到】**正式庫裡那支函式的本體是否逐字等於 repo 那份** —— 我取到線上定義但**沒有做逐字比對**(這一份的重點是「會不會抄」)。
· 【證不到】**真的在正式庫刪一張單會怎樣** —— 那要在正式庫刪單,不做。本份全部在拋棄式 PG 上。
· 拋棄式 PG 的骨架是**我自己建的最小三張表**,不是正式庫的完整 schema ⇒ **欄位、約束、其他 trigger 的互動沒有涵蓋**。
· 【證不到】**有沒有人在 trigger 上線之前刪過單** —— log 表從 0 開始,它答不出上線前的事。

---

## 收攤

拋棄式叢集已停、目錄已刪、埠 55059 **0 個 listener**。正式庫**零寫入**。
