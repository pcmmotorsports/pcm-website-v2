# 訂單被刪掉了 —— 去哪裡查、查得到什麼

> **什麼時候讀這一份**:客人說「我的訂單不見了」· 對帳少一筆 · 有人問「那張單是誰刪的」。
> **來源**:`supabase/migrations/20260907070000_m4b_orders_delete_audit_trail.sql`(⟦db-ORDERDELETENOTRACE⟧,Sean 2026-09-07 `Q35` 甲)。
> **為什麼要有這一份**:2026-09-08 量到 —— repo `docs/` 裡 `orders_deleted_log` **零命中**
> (🟢 正對照 `sweeper_heartbeat` 32 支檔 · `order_pending_refunds` 18 支 · ⚪ 負對照現造表名 0)
> ⇒ 📌 **有一張稽核表,而沒有任何一條流程會叫人去查它。**
> 🛑 **一個沒有人知道要去查的稽核表,與沒有稽核表,在出事那天印同一個東西。**

---

## 1. 它記什麼

三張表被 `DELETE` 的時候,**整列**抄一份進 `public.orders_deleted_log`:

| 被刪的表 | trigger |
|---|---|
| `orders` | `pcm_orders_delete_audit_ad` |
| `order_items` | `pcm_order_items_delete_audit_ad` |
| `order_legal_consents` | `pcm_order_legal_consents_delete_audit_ad` |

三支都是 `AFTER DELETE … FOR EACH ROW`。
🔵 **為什麼三張都掛**:兩張子表是 `ON DELETE CASCADE` ⇒ 只掛 `orders` 的話,它們仍然安靜地消失。

## 2. 去哪裡查(一句)

```sql
SELECT deleted_at, source_table, session_role, application_name, client_addr, txid,
       row_data
FROM public.orders_deleted_log
WHERE order_id = '<那張單的 uuid>'
ORDER BY deleted_at, source_table;
```
- 有索引 `(order_id, deleted_at)` ⇒ 用 `order_id` 查很快。
- **不知道 uuid、只知道單號**:先從別的地方拿 uuid;`row_data` 裡有整列原始欄位,也可以
  `WHERE row_data->>'display_id' = 'PCM-2026-XXXX'`(⚠️ **那條沒有索引,慢**)。
- **誰讀得到**:`service_role` 與 `pcm_readonly` 有 `SELECT`。`anon` / `authenticated` 沒有。

## 3. 🔴 查得到什麼、查不到什麼(這一節才是重點)

### ✅ 查得到
- **那一列被刪掉的完整內容**(`row_data`,整列 jsonb)
- **什麼時候刪的**(`deleted_at`)
- **哪一張表**(`source_table`)
- **同一個交易裡刪了哪些**(`txid` 相同的就是同一發)
- **從哪連進來的**(`client_addr` / `application_name` / `backend_pid`)
- **PostgREST 走的話有 JWT**(`jwt_claims`)

### 🛑 查不到
- 🔴 **「是誰刪的」—— 這一格答不出來。**
  - `definer_user` **恆等於函式擁有者**(多半 `postgres`)⇒ 它答的不是這題,**不要拿它當答案**。
  - `session_role` 才是線索(登入的那個角色),**而 SQL Editor 直下時它多半也是 `postgres`**
    ⇒ 📌 **分不出是哪一個人。那是機制天花板,不是這份 SOP 沒寫。**
- 🔴 **「被改成別的狀態」查不到** —— 它只記 `DELETE`。訂單被改成 `cancelled`、被改金額、被改狀態,**這張表一列都不會有**。
  ⇒ 那些要問 `admin_audit_log`。
- 🔴 **它不是備份** —— 重建要人判斷 FK 順序與關聯列。
- 🔴 **它不擋刪除** —— 刪還是會刪掉,它只是留一份影本。
- ⚠️ **`order_legal_consents` 那一列少了兩欄**:`client_ip` 與 `client_user_agent` **存之前就拿掉了**(PII),
  拿掉了哪些寫在 `row_data->'_redacted_keys'` 裡。⇒ **看得到「它被刪了」,看不到那兩個值。**

## 4. 🔴 查到「零列」的時候,先分清楚是哪一種零

| 可能 | 怎麼分 |
|---|---|
| 那張單**沒有被刪**(是別的問題) | 去 `orders` 查它還在不在 |
| 被刪了,**而 trigger 那時還沒上線** | 比 `deleted_at` 與這支 migration 貼進正式庫的日期(查 `supabase/APPLIED.tsv` 第三欄) |
| trigger **被停用或被改掉了** | 那支 migration 的事後斷言逐張表驗四件:存在 · **啟用**(`tgenabled='O'`)· **指向 `pcm_log_order_row_delete`** · **AFTER DELETE ROW**。重跑那段就知道 |
| **我沒有讀權限** | `SELECT has_table_privilege(current_user,'public.orders_deleted_log','SELECT');` ⇒ false 就是沒查,不是查無 |

🛑 **最後一列最容易被讀錯** —— 📌 **「我讀不到」與「它沒有那一列」印同一個東西:什麼都沒有。**

## 5. 🔴 要清訂單資料的時候:**一律用 `DELETE`,不要用 `TRUNCATE`**

> **Sean 2026-09-10 拍板【丁】** —— 這件事**不做程式**,就是這一條規矩。

```sql
-- ✅ 這樣清:有留痕
DELETE FROM public.orders WHERE …;

-- 🛑 不要這樣清:一列都不會留
TRUNCATE public.orders CASCADE;
```

### 為什麼 —— 四個數字,都是 2026-09-10 量的

| 量到什麼 | 讀數 |
|---|---|
| `TRUNCATE` 之後留痕表多幾列 | **0**(拋棄式 PG 實測:資料全沒了,`orders_deleted_log` 一列都沒多) |
| `TRUNCATE orders CASCADE` 會遞迴清到幾張表 | **26 張**,其中 **14 張碰錢**(退款單 · 人工退款 · 收款紀錄 · 刷卡嘗試 · 待開發票 …) |
| 有 `TRUNCATE` 權限的應用角色 | **0 個**(`anon`/`authenticated`/`service_role`/`pcm_readonly`/`authenticator` 都沒有)⇒ **唯一做得到的是 `postgres`** |
| 若真的做自動留痕,`TRUNCATE` 會慢多少 | 5 萬列時 **9ms → 644ms**(未受控的數量級參考) |

🔴 **`TRUNCATE` 不留痕的原因**:那三支是 `AFTER DELETE … FOR EACH ROW`,而 **`TRUNCATE` 不觸發 row-level 的 trigger**。
🔴 **而 `CASCADE` 的範圍不看 FK 是不是 `ON DELETE CASCADE`** —— 連 `DELETE` 時會被 `RESTRICT` 擋住的表也一起清。

### 🛑 為什麼不做成自動的(下一個人一定會問)

甲乙丙三條路都查過、量過,**每一條都有致命缺陷**:

| 走法 | 為什麼不走 |
|---|---|
| 只替那三張表加留痕 | 另外 **23 張照樣消失** ⇒ 📌 事後你會看到「三張表被清了」而看不到退款資料被清了 —— **比不做更容易誤導** |
| 26 張全加 | 每有人加一張參照 `orders` 的新表就多一個洞,**而沒有任何東西會叫** ⇒ 清單會持續腐爛 |
| 加 trigger **擋住** `TRUNCATE` | 實測擋得住,**而 `SET session_replication_role = replica` 一行就繞過** ⇒ 📌 **是減速丘不是牆**;而且 PostgreSQL **不支援** event trigger 管 `TRUNCATE`(`ERROR: event triggers are not supported for TRUNCATE TABLE`)⇒ **它也要逐表掛**;還會擋到我們自己 10 支驗證腳本 |

⇒ 📌 **三條路的真實防護力,其實都跟這一條規矩差不多 —— 因為它們都擋不住「決定要做的人」。**
⇒ ✅ **所以就明講是規矩,不包裝成機制。**

🛑 **而三條路都擋不住的東西**:`DROP TABLE` / `DROP SCHEMA`(連 trigger 自己都沒了)、留痕表自己被清掉。

### 依據

· `docs/plans/2026-09-10-truncate-leaves-no-trace-plan.md` —— 甲乙丙丁四個選項與各自的量測。
· `docs/evidence/2026-09-10-orders-delete-audit-真的會抄-驗證.md` —— `DELETE` 那條路**真的會抄**的實測(刪一張單 ⇒ 3 列,單號金額都在)。

---

## 6. 相關

- `⟦db-ORDERDELETENOTRACE⟧` —— 這張表的板列。
- `⟦b4-MANREFUNDNOAUDIT⟧` —— **方向相反的一對**:那一列是「人工退款**沒有**紀錄」,這一份是「**有**紀錄而沒人知道去查」。
  🎯 **兩者在出事那天的體感一樣。**
