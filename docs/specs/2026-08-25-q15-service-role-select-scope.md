# Q15 · 同族範圍:47 張 ENABLE RLS 的表裡 40 張缺 service_role 可用的 SELECT 政策

> 🔴 **標題那個 40 是【本片 apply 之前】的數。**(codex 對抗審查 R2 抓到的:
> 下面 A 類清單裡**含 `customers`**, 而那正是本片補掉的那一張 ⇒
> **「只補 customers」與「仍有那 40 張」不能同時成立。**)
> ⇒ **本片 apply 之後是 39 張。** 標題保留 40 不改, 因為它是量測當下的事實;
> 而**任何往下游引用的地方要用 39**。要現值就跑下面的數法, 不要抄這兩個數字。

> ## 🟢 2026-08-26 · **Sean 在正式庫跑了那支體檢, 這一段是【量到的】不是推的**
> 探針 `docs/probes/2026-08-26-q15-rls-service-role-audit.sql`, 三列尺自檢全部 `✅ 尺會動`。
>
> | 問題 | 正式庫的答案 | 意思 |
> |---|---|---|
> | `service_role` 有 BYPASSRLS 嗎 | **有** | 今天沒事。Q15 講的是【未來式】, 不是現在進行式 |
> | 誰有效繼承 `service_role` | **只有 `postgres` 1 個**, 而它自己也有 BYPASSRLS | 🟢 **零外溢路徑** —— 補政策不會讓任何人多看到東西 |
> | 開了 RLS 的表 | **50 張**(版控重播算 47) | 差 3 張 |
> | 其中缺 service_role 可用 SELECT 政策 | **42 張**(版控重播算 40) | 差 2 張 |
> | `service_role` 對 `customers` 的 table 權 | **DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE** | 🟢 **SELECT 在**, 而 UPDATE 不在 |
>
> ### 🔴 那 3 張差在哪 —— **是 drift, 而且其中兩張 repo 完全不認識**
> ```
> 線上有 / 版控沒有:
>   product_fitments_effective            <- migration 裡出現在 7 支, 而沒有一支寫 ALTER TABLE ... ENABLE RLS
>                                            (推測走 20260531142534 那支 event trigger `ensure_rls` 自動開的)
>   product_fitments_effective_staging    <- 🔴 supabase/migrations/ 裡【零支】提到它
>   product_fitments_effective_sync_log   <- 🔴 supabase/migrations/ 裡【零支】提到它
> 版控有 / 線上沒有:  無
> ```
> 後兩張在 repo 的其他地方找得到:`docs/archive/2026-07-25-docs-cleanup/reviews/2026-07-12-s1-apply-sql.sql`
> (一份**歸檔的、手動貼上去的 SQL**)+ `packages/adapters/src/supabase/database.types.ts`(從線上產的)。
> ⇒ **它們是手貼進去的, 從來沒有變成 migration。** 而 `ensure_rls` 那支 event trigger 幫它們開了 RLS
> ⇒ **有 RLS、零政策、repo 不知道它們存在。**
> 📌 **這正是「下界穩」為什麼不成立的實例** —— drift 兩個方向都會發生, 而這次是往上。
>
> ### 🟢 而這一發同時關掉了幾個一直標「未確認」的格子
> - **GRANT 那一層是好的**:repo 內零行 `GRANT SELECT ... TO service_role`, 而線上**有** SELECT
>   ⇒ **確認它來自平台預設**(先前那句「推不出來源」現在有答案了)。
> - 而 `UPDATE` **不在**清單裡 ⇒ 與 `20260717010000:174` 那句 `REVOKE UPDATE ... FROM service_role`
>   **互相印證** ⇒ 版控與線上在這一格是對得起來的。
> - **外溢路徑 = 0** ⇒ 那支 migration 的「影響面」從「五格為零、第六格未驗」變成 **六格皆為零**(以量測當下為準)。
>
> ### 🔴 而它也抓到那支 migration 的一個【會誤擋】的 bug, 已修
> `postgres` 出現在「誰繼承 service_role」那一列 ⇒ 代表 **Supabase 的 `postgres` 不是 superuser**
> ⇒ 段A 舊版的 `NOT rolsuper` 攔不住它 ⇒ **貼下去會被自己的閘擋掉, 而那是假紅。**
> ⇒ 已改成同時排除「自己帶 BYPASSRLS」與「表的 owner」——
> 那**不是豁免清單**, 是可證明的斷言:繞得過 RLS 的角色, 本片給不了它新東西。
> 兩個世界實測過:postgres-like(帶 BYPASSRLS)⇒ **通過**;沒帶的 ⇒ **擋下且只點名它**。
>
> ⚠️ **這一整段綁著 2026-08-26 那個時點。** 要現值就重跑那支探針, 不要抄這裡的數字。

---

> **這份檔的存在理由**:2026-08-26 那支 migration
> (`supabase/migrations/20260826000035_m4b_q15_customers_select_service_role_policy.sql`)
> **只補了 `customers` 一張**。主視窗 2026-08-25 裁【乙】= SQL 不越過 Sean 拍的範圍,
> 而清單隨片落檔, **免得下一個人以為「Q15 關掉了」**。
>
> 量測人 = cf(`pcm-website-v2-d8`), 複驗人 = cc 下手窗(`pcm-website-v2-8d`)。

---

## 🔴 先讀這五行, 再看下面的表

**這 40 張不是待辦清單, 是【同一發爆炸的半徑】。**
「ENABLE RLS + 零政策 + 只給 service_role 進」是 **Supabase 的標準做法**, 本身不是 bug ——
它就是「對 anon / authenticated 鎖死」。
🔴 **洞只在 Q15 那個觸發情境(有人拿掉 `service_role` 的 BYPASSRLS)下才張開。**

## 🔴🔴 而這個數字的限定, 要跟著它一起走 —— 不要只複製下面那張表

```
這個 40 是【靜態重播版控字面】判的:掃 supabase/migrations/*.sql 的
CREATE/DROP POLICY 與 ENABLE ROW LEVEL SECURITY, 逐張問「有沒有任何 FOR SELECT
(或 FOR ALL)且 TO 含 service_role 或 PUBLIC 的政策」。

🔴 一張都沒有實跑。 ⇒ 「拿掉 BYPASSRLS 之後它會空」是【推出來的, 不是量到的】。
🔴 掃的是【版控】不是【線上】。 手動在 SQL Editor 改過的政策不在版控裡, 而本 repo 有 drift 前例
   (`20260531142534` 那支的 event trigger `ensure_rls` = 線上有、版控沒有)。
🔴 **~~這個 40:下界穩、上界不知道。~~** ⇒ **codex 對抗審查 R1 推翻了這個說法, 而它是對的**:
   線上手動【新增】過政策 ⇒ 實際缺口**小於** 40;有 migration 沒套上、或線上手動【刪】過政策
   ⇒ 實際缺口**大於** 40。⇒ **在讀正式庫之前, 40 既不是可靠下界也不是上界, 它只是【版控字面重播的結果】。**
   📌 我原本寫「下界穩」的推理是:「版控裡沒有的政策, 線上也不會有」—— 那句話**假設了 drift 只有一個方向**,
      而本檔上一段自己就寫著 drift 前例是「線上有、版控沒有」⇒ **我引用的那個前例正好推翻我的結論。**
⇒ 落地的人第一件事該是拿 `pg_policies` 對一次。
```
📌 **為什麼這段要寫在表的正上方而不是附錄**:原始報告把這句限定寫在 §6, 距離那張表 130 行 ——
**表會被複製走, 前後文不會。** 而原報告 :204 有一句「⇒ 見 §6 第 2 格」⇒
🔴 **指路不等於給證據:被複製走的那半不會帶著指路那一行。**

---

## 數法(要複量就跑這幾發, 不要引用上面的數字)

```bash
# 分母:ENABLE RLS 的表(去重)
grep -rhiE '^[[:space:]]*ALTER TABLE .*ENABLE ROW LEVEL SECURITY' supabase/migrations/*.sql \
  | sed -E 's/^[[:space:]]*//I; s/^ALTER TABLE (IF EXISTS )?//I; s/[[:space:]]+ENABLE ROW LEVEL SECURITY.*//I' \
  | tr -d '"' | sed -E 's/^public\.//' | sort -u | wc -l          # => 47
# 正對照:customers 與 orders 都要在裡面 => 各 1
# 🔴 負對照的【字面】刻意不寫在這裡 —— 把一個「應該零命中」的字串寫進檔案,
#    下一個人在別的分母上跑同一發時它就變成 1, 而那看起來像「有東西出現了」。
#    (2026-08-25 夜同族第四次, 最後一次的屍體就在【講這個坑的那份教訓檔】裡。)
#    做法:自己隨手編一個這個 repo 不會有的表名餵進上面那條指令, 要看到 0 且 rc=1。
```

🔴 **複驗時撞到的兩把壞尺, 寫下來免得下一個人重踩:**

| 壞法 | 症狀 | 為什麼難發現 |
|---|---|---|
| `ALTER TABLE [a-z_."]+ ENABLE ...`(不容多空白) | 回 **40 張表** | 🔴 **它正好等於「命中 40 張」那個正確答案** ⇒ 兩件不一樣的東西印同一個數字。停手就會寫下「我複驗過, 對」, 而證據是假的 |
| 單行 `grep 'FOR SELECT TO service_role'` | 回 **1 條** ⇒ 推出「46 張缺」 | 跨行寫的政策看不到。而 `grep -rniE 'FOR SELECT TO PUBLIC' ... \| wc -l` ⇒ **0** —— 那個 0 的意思是「我的尺是單行的」, 不是「沒有這種政策」 |

📌 判別句:**我的尺回了一個【我預期的數字】時, 那正是最該再換一把尺的時候。**

⚠️ 無 `TO` 子句的政策預設 `TO PUBLIC` ⇒ **service_role 也吃得到** ⇒ 那種要算成「有政策」。
範例 `20260505130758_init_brands_categories.sql:57-60` 的 `brands_select_public`(四行, 無 `TO`)。

---

## A 類 · app 端直接 `.from()` 讀寫(20 張)—— 拿掉 BYPASSRLS 當場受害

```
orders 12 · customers 11 · email_outbox 9 · order_refunds 5 · shipment_items 5
customer_addresses 4 · customer_vehicles 4 · order_items 4 · staff 4
customer_wallet_ledger 3 · customer_favorites 3 · admin_audit_log 3 · shipments 3
order_item_procurement 2 · order_item_procurement_receipts 2
order_item_receipt_requests 2 · admin_sso_login_events 2
payment_charge_attempts 1 · suppliers 1 · order_manual_refunds 1
```
(數字 = app 端 `.from('<表名>')` 的命中數;分母 = `git ls-files` 取的版控 .ts/.tsx, 排除 `.next/` 與 `.test.`)

## B 類 · app 端零 `.from()`, 只被 RPC / view 碰(20 張)—— 受害與否看那支函式的 owner

```
payment_webhook_events · pending_invoices · payment_double_charge_anomalies
payment_double_charge_anomaly_events · legal_terms_versions · order_legal_consents
order_status_options · order_refund_items · order_notes · order_cancellations
order_cancellation_items · order_item_quantity_summary · order_refund_jobs
order_refund_job_items · pcm_b2_shipping_idempotency · order_payments
payment_refunds · payment_refund_events · order_item_procurement_void_requests
order_refund_manual_corrections
```

---

## 🔴 為什麼「只補 customers」會生出一個【比全空白更危險】的中間狀態

`orders` 與 `order_items` **各只有 1 條政策, 都是 `FOR SELECT TO authenticated`**
(`20260604120000_m3_s2a_orders_order_items.sql:193` / `:197`)—— **與 customers 完全同型。**

而 `admin_customer_list_v` 的三個聚合欄(`active_order_count` / `active_spend_total` /
`last_active_ordered_at`)是 `FROM public.orders` 的純量子查詢
⇒ **補了 customers 之後, 客戶列表的列會回來, 而那三個數字全是 0 / NULL。**

🔴 `active_order_count = 0` 在畫面上與「這位客戶真的沒下過單」**長得一模一樣**, 沒有人會叫。
📌 而那支 view 的 migration 自己寫著「NULL 不得留白, 留白與載入失敗長得一樣」——
**同一份檔警告過「NULL 像壞掉」, 而沒有人警告「0 像真的」。**

---

## 🔴 RLS 不是唯一的平台依賴 —— 本片只堵得住兩層裡的一層

```
RLS 那層塌(拿掉 BYPASSRLS)      ⇒ 查得到、回 0 列        ⇒ 看起來像「沒有資料」
GRANT 那層塌(REVOKE table 權)  ⇒ 查不到、PostgREST 報錯 ⇒ 看起來像「系統壞了」
```
repo 內 `GRANT`/`REVOKE ... ON customers` 共 **5 處**, 全部列出:
```
20260523034911:229  REVOKE ALL PRIVILEGES ON TABLE customers FROM anon, authenticated;
20260523034911:230  GRANT SELECT ON TABLE customers TO authenticated;
20260523034911:231  GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE customers TO authenticated;
20260717010000:174  REVOKE UPDATE ON TABLE public.customers FROM service_role;
20260717010000:175  GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE public.customers TO service_role;
```
⇒ **零行 `GRANT SELECT ON customers TO service_role`**。
🔴 **~~⇒ table 權也是平台預設來的~~ 與 ~~「要有東西可以 revoke 才寫得出來」~~ 兩句都被 codex R2 推翻:**
- 零行 GRANT **推不出來源** —— 它可能來自線上手動 GRANT / `ALTER DEFAULT PRIVILEGES` / owner / 角色繼承。
- **`REVOKE` 可以是 no-op** —— 對一個本來就沒有的權限 REVOKE 不會報錯
  ⇒ `20260717010000:174` 的存在**證不到**「預設 GRANT 在」。
⇒ 正確寫法:**那道 table 權從哪來【未確認】**, 要靠下面「落地前必跑」的 ③ 去正式庫問。
📌 而這一格的形狀值得記:我原本那句是**一個聽起來很紮實的間接推理**, 還自己標了「不升格」——
   **標了「這是間接證據」並沒有讓它變成有效的證據**, 它只是讓我不再去查。

⇒ **補不補那道 GRANT 是另一個範圍決定, 本片不擅自擴。已端給 Sean。**

---

## 落地前必跑(那支 migration 的檔頭也寫了一份)

```sql
-- ① service_role 到底有沒有 BYPASSRLS(Q15 的整個前提)
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'service_role';

-- ② 🔴 誰【有效繼承】service_role 的權限 —— 補政策唯一可能的外溢路徑
-- 🔴 codex R1 訂正:~~原本這裡是「列出 pg_auth_members 的直接 member」~~ **那把尺太窄**。
--    RLS 的角色比對走 `has_privs_of_role`(**尊重 INHERIT**), 不是忽略 INHERIT 的 MEMBER
--    ⇒ 只列直接 membership 會【漏掉間接繼承】那條路, 而那正是外溢會走的路。
--    `pg_has_role(..., 'USAGE')` 就是 has_privs_of_role 的語意。
SELECT r.rolname
  FROM pg_catalog.pg_roles r
 WHERE r.rolname <> 'service_role'
   AND NOT r.rolsuper
   AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')
 ORDER BY 1;
-- 預期只有 authenticator。多出任何一個 ⇒ 停下, 那是新的可見面。
-- 正對照(這把尺要對一個你知道答案的輸入回 true, 否則上面那發作廢):
--   SELECT pg_catalog.pg_has_role('service_role','service_role','USAGE');   -- 要回 t
-- 📌 而那支 migration 的段 A 已經把這一發做成【會 RAISE 的閘】 ——
--    註解裡的「查到就停」擋不住任何人, 貼下去照樣會建政策。

-- ③ service_role 對 customers 的 table 權從哪來
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'customers' AND grantee = 'service_role';
-- ⚠️ information_schema 對零權限帳號會回 0 而不報錯 ⇒ 用有權限的身分跑, 或改走 pg_catalog 的 relacl

-- ④ 19 支 SECURITY DEFINER 函式的 owner
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 2, 1;
-- owner = postgres ⇒ 繞 RLS ⇒ 不受本片影響。owner = service_role ⇒ 受影響, 回頭重算影響面。
```

🔴 **在跑完 ② 之前, 影響面的正確寫法是「五格為零、第六格未驗」, 不是「不會擴權」。**
🔴 **~~PG 的政策 role 比對走 `pg_has_role(current_user, polroles, 'MEMBER')`~~** ——
**codex 對抗審查 R2 推翻, 而它是對的**:RLS 原始碼走的是 **`has_privs_of_role`**(對應
`pg_has_role(..., 'USAGE')`), **尊重 INHERIT**。
差別會改變答案。而 🔴 **這裡還有第二層, codex R3 抓到的**:
**PG 16+ 的繼承由【每一筆 membership 自己的 `inherit_option`】決定, 不是看角色的 `rolinherit`。**
實測(PG 17.10):`ALTER ROLE authenticator NOINHERIT` 之後 ——
```
rolinherit                                          => f
pg_auth_members.inherit_option(該筆 grant)          => t   <- 改 rolinherit 不會回頭改它
pg_has_role('authenticator','service_role','USAGE')  => t   <- 所以政策【會】套用
```
⇒ **「這個角色是 NOINHERIT」與「這筆 membership 會繼承」是兩件事。**
⇒ 用 MEMBER 那把尺會多報;只列**直接** membership 的尺會**少報間接繼承那條路**;
   而只看 `rolinherit` 的尺會**少報 inherit_option 那條路** —— **三種都會漏, 而漏的方向才是危險的。**
