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

## 5. 相關

- `⟦db-ORDERDELETENOTRACE⟧` —— 這張表的板列。
- `⟦b4-MANREFUNDNOAUDIT⟧` —— **方向相反的一對**:那一列是「人工退款**沒有**紀錄」,這一份是「**有**紀錄而沒人知道去查」。
  🎯 **兩者在出事那天的體感一樣。**
