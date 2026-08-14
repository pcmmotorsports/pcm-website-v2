# `#484a` apply 當天的三道檢查 —— **給 Sean 自己判讀**

> 片 A1(訂單貨品軸 view)apply 之後**第一件事**。**三道**都過才算成功(第三道是權限,不能省)。
> 🔴 這一片同時碰 migration 與 app,而**壞掉的位置在部署之後、repo 裡的守門看不到**
> (前例:08-07 A9h 正式站壞 8 小時、08-14 早 Vercel 建置快取送舊 CSS)。

## 🔴 先讀:A1 apply 當下,**打開後台是驗不到這支 view 的**

codex 關卡2 抓到、我確認屬實:**A1 apply 的時候,程式碼還在讀舊的 `orders`**
(adapter 換源是 A2)⇒ **開 `/orders` 看得再正常,也只證明舊路徑還活著,證不到新 view。**
原本這份 runbook 寫「開一次訂單列表就是 smoke」——**那是量錯東西**,已改掉。

⇒ **A1 的兩道檢查都不是用眼睛看畫面,要用指令問資料庫。**
⇒ **這兩道請把指令交給我(主視窗)或工程端跑** —— 需要 service key,不是你要自己弄的東西。

## 檢查 1:PostgREST 認不認得這支 view 的關聯(**A1 唯一真正的新風險**)

用**真正的 `ADMIN_ORDER_LIST_SELECT`**(逐字,與 `SupabaseOrderAdapter.ts:87` 同一份)打 view 一次。
🔴 **要留下 response body** —— 上一版寫 `-o /dev/null` 把它丟了,那樣**根本看不到 `PGRST200`**
(codex 關卡2 R2 抓到:表格叫人判讀一個已經被丟掉的東西)。

```bash
# 🔴 `SEL` 內含 ", " 空白,直接內插進 URL 會被 curl 擋在門外
#    (實測 curl 8.7.1:`URL rejected: Malformed input to a URL function`,exit 3 = 連送都沒送出去)
#    ⇒ 用 -G + --data-urlencode 讓 curl 自己編碼,不要手動拼 URL。
SEL='goods_axis,id, display_id, created_at, payment_status, fulfillment_status, total, order_source, payment_channel, display_position, cancelled_at, tier_at_checkout, invoice_status, customer_user_id, customers(name), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version, vehicle_snapshot, product_variants(products(brands(name))), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity))'
curl -sG -w '\nHTTP=%{http_code}\n' \
  "$SUPABASE_URL/rest/v1/admin_order_list_v" \
  --data-urlencode "select=$SEL" --data-urlencode 'limit=1' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

| 回什麼 | 意思 | 怎麼辦 |
|---|---|---|
| **HTTP=200** 且 body 是一列 JSON(看得到 `order_items`、`customers`、`brands`) | ✅ embed 接得上 | 繼續檢查 2 |
| **HTTP=400** 且 body 含 **`PGRST200`** / `Could not find a relationship` | ❌ **失敗** —— view 的欄位追不回底表 | **停,照回退章節。** 不要重試 |
| 其他 | ❓ | 一樣停 |

⚠️ **這一段的判別力來自「用的是逐字同一份投影」** —— 用一個簡化過的 select 打出 200,
證不到真投影也會 200(那正是上一版的毛病:只測了 `order_items(id,variant_sku)` 兩層)。

## 檢查 2:筆數一樣嗎(**硬條件**)

Supabase Dashboard → SQL Editor 貼(唯讀):

```sql
select (select count(*) from orders) as 舊路徑,
       (select count(*) from admin_order_list_v) as 新路徑,
       (select count(*) from orders) = (select count(*) from admin_order_list_v) as 相等;
```

**`相等` 要是 `true`。不相等就停,不要自己判斷「應該是對的」。**

## 檢查 3:anon / authenticated 讀不到它(**這條是 codex 逼出來的,不能省**)

本專案的 `ALTER DEFAULT PRIVILEGES` 會**自動把新建 view 授權給 `anon` 與 `authenticated`**,
migration 裡有兩行 `REVOKE` 去收 —— **要驗那兩行真的生效**:

```sql
-- 🔴 **一次看完整 ACL,不要只問我想得到的那三個角色**(code-reviewer nit:只問三個 =
--    migration 與檢查共用同一個假設,第四個角色漏收時兩邊互相驗不出來)
select relacl as 完整授權清單 from pg_class where relname = 'admin_order_list_v';
```

**清單裡只准出現 `postgres` 與 `service_role`。** 只要看到 `anon=` 或 `authenticated=` 或任何其他角色 = 停 ——
那支 view 帶著訂單全欄(含收件地址快照)。

## ⏭ 這一片**不需要**看畫面

`/orders` 的畫面驗收屬於 **A2**(adapter 真的換源之後)。A1 apply 完畫面應該**一個像素都沒變** ——
**如果畫面變了,那才是異常。**

## 失敗時的回退(**順序是硬性的,不能顛倒**)

1. **先** revert 應用層那顆 commit 並等部署完成
2. 確認訂單列表正常
3. **才** 跑 `scripts/484a-down.sql`

🔴 反過來做會讓線上 app 指向一個不存在的東西,整頁壞掉。

## 順帶:這一片修好了什麼(檢查 2 過了之後可以自己試)

改版**前**:訂單列表的「出貨狀態」下拉選「已到貨」⇒ **一定是 0 筆**(那個欄位從沒被更新過)。
改版**後**:選「已到貨」回的筆數,應該**等於**列表上狀態膠囊寫著已到貨的那幾張單。

---

## 附:apply 之前這支 view 已經驗到哪(給審查者看,不是給 Sean 看)

在**拋棄式 Postgres**(`127.0.0.1:54455`,不是正式庫、不是 branch、零花費)上實跑,
腳本 `docs/probes/484a-view-probe.sh` 可重跑:

- `CREATE VIEW` 原文 **EXIT=0**;緊接著真的 `DROP VIEW` **EXIT=0**、零留痕
- 負向對照:語法錯 → `syntax error at or near`;表不存在 → `relation … does not exist`(兩種錯分得出來)
- 四值 oracle 全 PASS,含**零品項單 → `none`** 與**一件訂滿一件沒訂 → 退回 `none`**
- 突變(判序倒置)⇒ `instock` / `shipped` 兩格紅;**`ordered` 那格抓不到**(誠實記下)

🔴 **仍未驗、只有 apply 之後才問得到的**:PostgREST 對**這支 view** 的 embed
(既有的 `products_public` 證了機制,沒證這一支)⇒ **這就是上面檢查 1 存在的理由。**
🔴 **正式站那 13 筆裡 12 筆是 `none`** ⇒ 那組對 `none` 有判別力、對其餘三值幾乎沒有。
