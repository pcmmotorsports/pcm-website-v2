# plan · ⟦db-RLSHARDENZEROROWS⟧ + ⟦b9-RLSHARDEN⟧ —— 收 `BYPASSRLS` 那天,誰會安靜地看到比較少的東西

> 線【權限/信件】窗 C · 2026-09-09 · **本檔只是清單 + plan。窗 C 沒有寫任何 migration、沒 apply、沒 push。**
> 讀數 = `pcm_readonly` @ 正式庫 · `bash scripts/readonly-prod-sql.sh` · **2026-09-09 10:4x–11:0x UTC** · 唯讀零寫入。
> 兩列同族,合起來的受詞是主視窗定的那一句:**「收緊那天,誰會安靜地看到比較少的東西」**。

---

## 0. 三句話

1. 🔴 **`⟦db-RLSHARDENZEROROWS⟧` 今天成立**,而它自承「沒量」的那一格 **我量到了 —— 射程比原文大很多**。
2. 🎯 **`⟦b9-RLSHARDEN⟧` 的關閉條件前半【已經不成立了】** —— 它逐字要的那 3 條 policy 今天都補上了,而且給對角色。**不用再做那件。**
3. 🔴 **`service_role` 自己帶 `BYPASSRLS`** ⇒ 📌 **它今天走不到那些 policy;收 BYPASSRLS 那天是那些 policy 的第一次生效,不是第二次。**

🛑🛑 **而最重要的一句要寫在最前面:§4 那三份清單是【待逐張實讀的候選】,不是【確定會變零列的名單】。**
理由在 §5:我算的是「有沒有一條適用的 permissive SELECT policy」,**沒有求值 `USING` 運算式,也沒有真的以那個角色讀過一列**。
⇒ 📌 **它可能高估(policy 適用但我算漏)也可能低估(policy 算得到而 `USING` 回 false)** —— 兩個方向都會錯。
⇒ ✅ **要拿來做「收不收 BYPASSRLS」的決定,還缺一道行為驗證(§7 第 4 點寫了怎麼做)。**

---

## 1. `⟦db-RLSHARDENZEROROWS⟧` —— 原文宣稱 vs 今天

| 原文宣稱 | 2026-09-09 實測 | 判定 |
|---|---|---|
| `public.pcm_acl_snapshot_digest` 的 `relrowsecurity = t` 而 policy 數 = **0** | `rls_on = t` · `policies = 0` · owner `postgres` · `force_rls = f` · `pcm_readonly` 有 SELECT 權 = `t` | ✅ **仍成立** |
| `pcm_readonly` 的 `rolbypassrls = t` | **`t`** | ✅ **仍成立** |
| ⚪ 尺自檢:同法問 `pcm_acl_drift_status` ⇒ RLS `f` / policy 0(它是 view) | `relkind = v` · `rls_on = f` · policies 0 | ✅ 一致 |

⇒ 📌 **PostgreSQL default-deny 那條推論照樣成立**:RLS 開著而零 policy ⇒ 一個 `NOBYPASSRLS` 的角色讀到零列,而 `has_table_privilege` **照樣回 `t`**。
⇒ ✅ 原文那句「唯一分得開的檢查是【真的去讀一列】」**今天仍然對**。

### 🔴 而它自承「沒量」的那一格 —— 量到了,是全庫規模不是兩個物件

原文逐字:「**我沒量的**:全庫還有幾個授權是靠 BYPASSRLS 才有效的(我只查了這兩個物件);`pcm_readonly` 以外的角色有沒有同型。」

**帶 `BYPASSRLS` 的角色共 6 個**:
```
rolname                  rolsuper  rolbypassrls  rolcanlogin
pcm_readonly             f         t             t
postgres                 f         t             t
service_role             f         t             f     ← 🔴 原文沒講的那一個
supabase_admin           t         t             t     (superuser, 平台的)
supabase_etl_admin       f         t             t     (平台的)
supabase_read_only_user  f         t             t     (平台的)
```

**收掉 `BYPASSRLS` 後,每個角色會有幾張表安靜變零列**(已扣掉「自己是 owner 且未開 FORCE」的豁免):

| 角色 | 有 SELECT 權 × RLS 開著 | 因 owner 豁免 | 🔴 **真的會變零列** |
|---|---|---|---|
| `supabase_etl_admin` | 93 | 0 | **84** |
| `supabase_read_only_user` | 93 | 0 | **84** |
| `pcm_readonly` | 60 | 0 | **51** |
| `postgres` | 93 | **66** | **25** |
| `service_role` | 64 | 0 | **10** |

⚠️ **owner 豁免這一格是我補量的,不是推的**:全庫 RLS 開著的表共 **93** 張,其中 `relforcerowsecurity` 開啟的 **0 張**,owner 是 `postgres` 的 **66 張** ⇒ 📌 **postgres 那 66 張是靠「表擁有者預設繞過 RLS」豁免的,不是靠 `BYPASSRLS`** ⇒ 我第一發的尺對 postgres **虛報了 66 張**,已修正。

---

## 2. 🎯 `⟦b9-RLSHARDEN⟧` —— **關閉條件的前半已經不成立了**

### ① 「讀那一半」:原文的答案(不會壞)**今天仍成立**
四張表的 `service_role` SELECT policy 逐條:
```
customers      customers_select_service_role      SELECT  service_role  USING true
orders         orders_select_service_role         SELECT  service_role  USING true
order_items    order_items_select_service_role    SELECT  service_role  USING true
order_payments order_payments_select_service_role SELECT  service_role  USING true
```
⇒ ✅ **「客戶列表有、每個人訂單數 0」那個畫面【不會】發生** —— 與 `-auth` 2026-09-08 的答案一致。
⚪ **負對照仍然對得上**:`admin_sso_login_events` 的 SELECT policy ⇒ **今天仍是 0 條**(它只有一條 INSERT)⇒ **那把尺分得出兩堆,不是恆真。**
✅ **`permissive` 那一格也補量了**:全庫 policy 共 **103 條,`polpermissive` 全部是 `t`,restrictive 0 條** ⇒ 📌 **「有一條 permissive 就放行」在這個庫上成立,不必擔心被某條 restrictive 悄悄擋掉。**

### ② 🎯 「壞在寫的三張表」:**三條都補上了,而且給對角色 —— 這一格已不成立**

| 表 | 原文(09-05 inventory) | 2026-09-09 逐條實測 | 判定 |
|---|---|---|---|
| `admin_audit_log` | 要 I+S,**只有 S** | `..._insert_service_role` INSERT · service_role · WITH CHECK `true`<br>`..._select_service_role` SELECT · service_role · USING `true` | 🎯 **I 已補,已不成立** |
| `admin_sso_login_events` | 要 I,**一條都沒有** | `..._insert_service_role` INSERT · service_role · WITH CHECK `true` | 🎯 **I 已補,已不成立** |
| `staff` | 要 I+U+S,**只有 S** | `staff_insert_service_role` INSERT · service_role<br>`staff_select_service_role` SELECT · service_role<br>`staff_update_service_role` UPDATE · service_role | 🎯 **I+U 已補,已不成立** |

🛑 **這一格我特地分兩步量,不只看「有沒有那個命令別」**:先數 policy 的 `polcmd`,再逐條印 `polroles` 與 `pg_get_expr`。
📌 **理由**:一條 INSERT policy 若給的是 `authenticated` 而不是 `service_role`,「命令別齊了」會是一個**假綠**。實測 6 條 policy 的 `roles` 欄**全部是 `service_role`**、`polpermissive` 全 `t` ⇒ 給對了。

✅ **本列關閉條件逐字**(`docs/launch-todo.md:679`):「先補 3 條 policy(`admin_audit_log` 的 I · `admin_sso_login_events` 的 I · `staff` 的 I+U`)」
⇒ 🎯 **要的是 I / I / I+U ——【今天都在】。前半達成。**
⚠️ **順帶一個原文自己的數錯**(codex 提):它寫「**3 條**」,而括號裡列的其實是 **4 條 policy**(`admin_audit_log` 的 I + `admin_sso_login_events` 的 I + `staff` 的 I 與 U)。**四條今天都在,所以結論不變**,但引用時不要跟著它寫 3。

### ③ codex 提的「寫完還要讀回來」那一格 —— 查過了,兩邊都乾淨
一條 `INSERT` policy 不夠,若寫入端還要把新列讀回來,就同時需要 `SELECT` policy。逐個查呼叫端:
- `staff`:`apps/admin/src/lib/staff-repository.ts:67-71` 逐字 `.insert(input).select(STAFF_COLUMNS).single()` ⇒ **需要 I + S** ⇒ `staff` 兩條都有 ✅
- `admin_sso_login_events`:`apps/admin/src/lib/sso/login-event.ts:209` 逐字 `client.from('admin_sso_login_events').insert({ ...baseRow, ...identityRow })` ⇒ **沒有 `.select()`** ⇒ 只要 I ⇒ 有 ✅(它也確實只有 INSERT policy、沒有 SELECT)
- `admin_audit_log`:I 與 S 都有 ✅
🛑 **`WITH CHECK` 我只讀了字面**(三條寫入 policy 都是 `true`),**沒有實際寫一列去試** —— 那是正式庫寫入,不做。

🛑 **後半(收 `BYPASSRLS`)沒做,而那是 Sean 的決定,不是我的。**

---

## 3. 🔴 兩列原文都沒講的一格:**那些 policy 今天沒有在起作用**

`service_role` 的 `rolbypassrls = **t**`。

⇒ 📌 **意思是**:`customers_select_service_role`、`staff_insert_service_role`、`admin_audit_log_insert_service_role` …… 這些 policy,**當檢查身分就是 `service_role` 時走不到** —— PostgreSQL 先看 `BYPASSRLS`,才輪到 owner / FORCE,所以連 `FORCE ROW LEVEL SECURITY` 都推翻不了這個豁免。
⇒ 🛑 **所以「policy 補齊了」不等於「policy 驗過了」。**

🛑 **而這句話的射程要收窄(codex 提的,對)**:
- 它說的是**「檢查身分是 `service_role` 的那條路」**。**不能推成「這些 policy 對所有路徑都沒作用」** —— 另一個 `NOBYPASSRLS` 的角色若繼承了 `service_role`,會**適用**那些 policy(📌 `BYPASSRLS` 這個屬性本身**不隨一般權限繼承**);走 view 或 `SECURITY DEFINER` 也會換成別的身分檢查。
- **今天的角色屬性也證明不了「歷史上從沒執行過」。** 正確講法是:**本次沒有驗證「移除 `BYPASSRLS` 之後那些 policy 的行為」。**
- ⚠️ **也不要說「兩列原文都沒講」** —— `⟦b9-RLSHARDEN⟧` 原文本來就在談 `BYPASSRLS` 與 `service_role`。**我能說的只是:它的關閉條件沒有把「那些 policy 從未在收權後被走過」列成一格。**

---

## 4. 清單:收 `BYPASSRLS` 那天,**哪些角色 × 哪些表**要逐張實讀

🛑🛑 **這三份是【候選清單】,不是【確定名單】。** 判準是「有沒有一條適用的 permissive `SELECT`/`ALL` policy」,**沒有求值 `USING`、沒有真的讀過一列**(射程見 §5、§6)。**兩個方向都可能錯。**

### 4-A · `pcm_readonly` —— 51 張候選(這是**我們自己的**唯讀角色,施工窗與查證腳本都靠它)
```
public.admin_audit_log                        public.order_notes
public.admin_saved_order_views                public.order_payments
public.admin_sso_login_events                 public.order_pending_refunds
public.auth_callback_events                   public.order_refund_items
public.coupon_redemptions                     public.order_refund_job_items
public.coupons                                public.order_refund_jobs
public.customer_addresses                     public.order_refund_manual_corrections
public.customer_favorites                     public.order_refunds
public.customer_vehicles                      public.order_status_options
public.customer_wallet_ledger                 public.orders
public.customers                              public.orders_deleted_log
public.email_outbox                           public.payment_charge_attempts
public.legal_terms_versions                   public.payment_double_charge_anomalies
public.order_cancellation_items               public.payment_double_charge_anomaly_events
public.order_cancellations                    public.payment_refund_events
public.order_item_procurement                 public.payment_refunds
public.order_item_procurement_receipts        public.payment_webhook_events
public.order_item_procurement_void_requests   public.pcm_acl_snapshot_digest
public.order_item_quantity_summary            public.pcm_b2_shipping_idempotency
public.order_item_receipt_requests            public.pending_invoices
public.order_items                            public.product_fitments_effective_staging
public.order_legal_consents                   public.product_fitments_effective_sync_log
public.order_manual_refunds                   public.search_queries
public.shipment_items                         public.shipments
public.staff                                  public.suppliers
public.sweeper_heartbeat
```
🔴 **裡面有 `orders` / `order_items` / `order_payments` / `customers` / `payment_refunds` / `email_outbox`** ——
⇒ 📌 **這是本列風險的形狀**:那天起,走 `pcm_readonly` 的正式庫唯讀查證(`scripts/readonly-prod-sql.sh`、`~/pcm-mailbox/0905查證/run.sh`)**在這些表上可能回零列,而每一道權限尺照樣綠**。
⇒ 🛑 **比「畫面壞掉」更糟的地方在於它印出的是令人安心的空結果。**
⚠️ **而「所有查證都會瞎掉」是說過頭的** —— **直接讀表**才走這條路;走 view 的不一定(§5-E:有 5 支非 `security_invoker` 的 view,它們以 owner 身分讀,`postgres` 是那些表的 owner ⇒ **那條路仍讀得到**)。

### 4-B · `service_role` —— 10 張候選
```
public.admin_sso_login_events        storage.buckets_vectors
public.payment_webhook_events        storage.objects
realtime.messages                    storage.s3_multipart_uploads
storage.buckets                      storage.s3_multipart_uploads_parts
storage.buckets_analytics            storage.vector_indexes
```
🔴 **`public.payment_webhook_events`(policy 0 條)與 `public.admin_sso_login_events`(只有 INSERT 沒有 SELECT)是我們自己的表** —— 其餘 8 張是 `storage` / `realtime`,平台的。

### 4-C · `postgres` —— 25 張候選(另 66 張靠 owner 豁免)
🔵 這一格**優先度最低**:`postgres` 是 66 張表的 owner,而全庫 `FORCE ROW LEVEL SECURITY` **0 張** ⇒ 那 66 張本來就繞得過。剩 25 張才是真的受影響。

### 4-D · `supabase_etl_admin` / `supabase_read_only_user` —— 各 84 張候選
🛑 **這兩個是平台自己的角色,不是我們建的** ⇒ 收不收、要不要收,**不是我們的決定**。列在這裡只為了讓那天的人知道分母。

---

## 5. ⚠️ 我的尺:第一版有 bug,修了;而修完仍然**只是分類器,不是校準過的預測**

### 5-A · 🔴 codex 抓到的兩個真 bug —— 我改了,而**改完數字一模一樣**
第一版的判準用 `角色 oid = ANY(polroles)` 直接比對,而且沒有分 permissive / restrictive。**兩個都是錯的**:
- **漏了角色繼承** —— PostgreSQL 實際走的是 `has_privs_of_role`,一個角色可以**繼承**到 policy 的適用範圍。正確寫法是 `pg_has_role(目標角色, policy角色, 'USAGE')`(要用 `USAGE` 不是 `MEMBER`,因為 `MEMBER` 不分可不可繼承)。
- **owner 豁免也一樣** —— 不能只比名字;**能繼承到 owner 權限的角色**在未開 `FORCE` 時同樣豁免。

**修正後重跑,與舊算法逐格對照:**
| 角色 | 舊算法 | 修正後(繼承 + permissive) | 差 |
|---|---|---|---|
| `pcm_readonly` | 51 | **51** | 0 |
| `postgres` | 25 | **25** | 0 |
| `service_role` | 10 | **10** | 0 |
| `supabase_etl_admin` | 84 | **84** | 0 |
| `supabase_read_only_user` | 84 | **84** | 0 |

🔴 **而「數字沒變」不是「本來就沒錯」—— 是這個庫剛好讓那兩個 bug 不發作,而我量得出為什麼:**
- **restrictive policy 全庫 0 條**(103 條 policy,`polpermissive` 全 `t`)⇒ permissive/restrictive 那個分支在這裡不會動。
- **繼承圖裡沒有相關的邊**(實測 `pg_auth_members`):`pcm_readonly` 與 `service_role` **不繼承任何角色**;`supabase_read_only_user` / `supabase_etl_admin` 只繼承 `pg_monitor` / `pg_read_all_data` / `supabase_privileged_role`,**而這三個都沒有出現在任何 policy 的 `polroles` 裡**。
- `postgres` 確實繼承一堆(含 `service_role`、`anon`、`authenticated`、`pcm_readonly`),而**那些會受影響的表已經落在它的 66 張 owner 豁免裡**,所以沒有移動它的數字。
⇒ 📌 **這份對照本身就是「繼承那條路今天沒有作用」的證據** —— 而**它有保存期限**:哪天有人 `GRANT` 一個角色給 `pcm_readonly`,或加一條 restrictive policy,這兩個結論就同時失效。

### 5-B · 🛑 而修完之後,它**仍然沒有被校準過**
✅ 尺**會分支**的證據:對不同角色給不同答案(51/25/10/84)· 認得 owner 豁免(`postgres` 66,其他 0)· 認得命令別(`admin_sso_login_events` 有 1 條 policy 而 SELECT 仍算 0)。
🛑 **但那證明的是「分類分支有在動」,不是「零列預測是對的」** —— codex 的原話,而它是對的:同一套錯算法也能做到上面三件。

🛑 **而我原本想用的負對照【沒有燒起來】**:`anon`(沒有 `BYPASSRLS`)對 RLS 表有 SELECT 權的共 6 張,`reads_zero_today` = **0** ⇒ 那 6 張都有適用 `anon` 的 policy ⇒ **這一發既不是已知該紅的案例,也沒有提供任何行為對照。**
⇒ 📌 **要真的校準,需要的是行為驗證**:在一個有已知非空資料的環境裡,對照「無適用 policy ⇒ 零列」與「有適用 policy ⇒ 讀得到」,再涵蓋 owner / FORCE。🛑 **而那不必也不該在正式庫寫測試資料。**
⇒ ✅ **在那道驗證做完之前,§4 三份清單的身分是【待逐張實讀的候選】。**

### 5-C · 逃生口:5 支非 `security_invoker` 的 view(這一格是 codex 提醒我補的)
`pcm_readonly` 讀得到、而**以 owner 身分執行**的 view:
```
public.admin_coupon_list_blocks_v   owner postgres   reloptions 空
public.admin_coupon_list_v          owner postgres   reloptions 空
public.order_paid_totals_v          owner postgres   {security_invoker=false}
public.pcm_acl_drift_status         owner postgres   reloptions 空
public.vehicle_taxonomy_public      owner postgres   {security_invoker=false}
```
⇒ 📌 **它們以 `postgres` 的身分讀底下的表,而 `postgres` 是那些表的 owner(未開 FORCE)⇒ 收掉 `pcm_readonly` 的 `BYPASSRLS` 之後,走這 5 支 view 的路仍然讀得到列。**
⇒ 🛑 **所以「收權後查證全瞎」是錯的,而「收權後查證沒事」也是錯的** —— **要逐條路分開判**,而板上原文本來就要求「四個非 `security_invoker` view 逐支判定」。⚠️ **我今天只列出它們,沒有逐支判定。**

## 6. 🛑 我證不到什麼

1. 🔴 **數字會【兩個方向都錯】,不是下限。**(我上一稿寫「是下限、只會更多」—— **那是錯的,已刪。**)
   - **可能低估**:我沒有求值 `USING`。一條 `USING (auth.uid() = user_id)` 在我的尺下算「有 policy」,而對一個沒有 JWT 的後端角色**仍然回零列** ⇒ 算進「有」卻實際會少。
   - **可能高估**:①今天的繼承圖若改了(有人 `GRANT` 一個角色給 `pcm_readonly`),算成 0 的表會變成讀得到 ②**本來就是空的表**不會因為收權而「變少」,但它照樣列在候選裡 ③走 view / `SECURITY DEFINER` 的路以別的身分讀(§5-C)。
   ✅ **唯一分得開的檢查,仍然是原文那句**:以那個角色的身分**真的去讀一列**。
2. 🔴 **「安靜」這個字也不一定成立** —— 有些情況它會**吵**:缺 schema `USAGE` 會報權限錯誤;`row_security=off` 在需要套用 RLS 時會**報錯而不是繞過**。⇒ 📌 **不要預設「一定是無聲的零列」。**
3. 🔴 **`count(*)=0` 加看 `rolbypassrls` —— 分不開「空表」與「被濾光」。**(原文給的那個做法,我照抄了,而它其實不夠。)兩種情況的讀數**完全相同**。要分開需要**同一份資料快照的可信基準**,或已知存在的測試資料。⚠️ **而收權【前】用仍帶 `BYPASSRLS` 的角色去讀,驗不到收權【後】的行為。**
4. 🛑 **板上原文要求「四個非 `security_invoker` view 逐支判定」—— 我今天只列出 5 支(§5-C),沒有逐支判定。** 這一條是缺的。
5. **「寫」那一半我只量了 policy 的存在與角色,沒量 `WITH CHECK` 會不會擋** —— 三張表的 `with_check_expr` 都是 `true`,但那是**逐字讀出來的**,我沒有實際寫一列去試(也不該,那是正式庫寫入)。
6. **平台角色(`supabase_etl_admin` / `supabase_read_only_user` / `supabase_admin`)** 我只列分母,**沒有查它們今天在跑什麼** ⇒ 收它們的影響我答不出來。
7. **這份清單有保存期限,而失效條件講得出來**:①有人打開 `FORCE ROW LEVEL SECURITY`(今天 0 張)⇒ `postgres` 那 66 張豁免消失 ②有人加一條 restrictive policy(今天 0 條)③有人 `GRANT` 一個角色給 `pcm_readonly` / `service_role`(今天兩者都不繼承任何角色)。
8. 讀數是 2026-09-09 10:4x–11:2x UTC 那幾發的。

---

## 7. 改什麼 · 影響 · rollback

🛑 **本片不寫 migration**(主視窗 2026-09-09 明令)。產出就是上面那份清單 + 下面這個決定題。

### 建議的順序(而做不做、什麼時候做,是 Sean 的決定)

1. **先不動 `pcm_readonly` 的 `BYPASSRLS`。** 它是我們查證正式庫的唯一眼睛;收掉那天,**51 張表會對每一次查證回零列而所有尺照樣綠**(§4-A)。要收的話,前置條件是先給它 policy,或明寫「這些表只給 BYPASSRLS 角色讀」。
2. **`⟦b9-RLSHARDEN⟧` 的「補 3 條 policy」不用做了**(§2 已量到補完)。
3. **`pcm_acl_snapshot_digest`(RLS 開著、policy 0)** —— 原文給的兩條路今天都還沒走:①補 policy ②在檔頭明寫「它只給 `BYPASSRLS` 角色讀」。**②是純註解,零風險,而它擋的正是「下一個人把零列讀成乾淨」。**
4. **真的要收 `BYPASSRLS` 的那一天**,順序寫死:
   - **先做一道行為驗證**(§5-B):在**非正式庫**的環境裡,用已知非空的資料對照「無適用 policy ⇒ 零列」與「有適用 policy ⇒ 讀得到」,把 §4 的清單從【候選】升成【名單】。🛑 **沒有這一道,下面每一步都是在賭我的算法。**
   - 對升級後的清單上**每一張表**,以那個角色的身分跑一發 `SELECT count(*)`(不是看權限,是真的讀一列)
   - ⚠️ 讀到 0 分不開「空表」與「被濾光」(§6 第 3 條)⇒ **要先有一份收權【前】的同源基準**,不能只靠看 `rolbypassrls`
   - 🔴 **`⟦b9-RLSHARDEN⟧` 原文要求的「四個非 `security_invoker` view 逐支判定」還沒做**(§5-C 只列出 5 支)⇒ **那一格要補**
   - 🔴 **那天要有人在旁邊看畫面**(主視窗定)

- **影響**:見 §4 三份清單。
- **rollback**:`ALTER ROLE <角色> BYPASSRLS;` 收回來。🛑 但**那不是零成本的 rollback** —— 收掉到發現之間,所有讀數都是靜靜偏低的,而**那段時間寫進文件的數字不會自己回頭修正**。
- 🛑 **這一族碰 RLS ⇒ 真要動的那天,鐵則 8 走 plan 等 Sean 批、SQL 由主視窗代貼。**

---

## 8. 兩列的判定(交給主視窗更新板)

| 錨 | 判定 | 依據 |
|---|---|---|
| `⟦db-RLSHARDENZEROROWS⟧` | 🔴 **今天仍成立**,而且射程比原文大得多(原文查 2 個物件;實測 5 個角色 × 最多 84 張表) | §1 |
| `⟦b9-RLSHARDEN⟧` | 🎯 **關閉條件前半【已不成立】** —— 3 條 policy 都補上了且給對角色。後半(收 `BYPASSRLS`)未做,是 Sean 的決定 | §2 |
| `service_role` 自帶 `BYPASSRLS` ⇒ 檢查身分是它時走不到那些 policy | 🔴 原文談過 `BYPASSRLS` 與 `service_role`,而**關閉條件沒有把「那些 policy 從未在收權後被走過」列成一格** | §3 |
| §4 三份清單的身分 | ⚠️ **【待逐張實讀的候選】,不是確定名單** —— 缺一道行為驗證(§5-B) | §5 |

---

## 9. codex R1 審查 —— 4 個 must-fix + 1 nit,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ①must-fix · §2 判「已不成立」不夠硬:沒查 permissive/restrictive、沒查寫完要不要讀回來 | **補量了**:全庫 103 條 policy 全 permissive、restrictive 0 條;逐個查寫入端 —— `staff` 有 `.select()` ⇒ 要 I+S(有)、`admin_sso_login_events` **沒有** `.select()` ⇒ 只要 I(有)。§2③ 新增一節 |
| ②must-fix · §1/§4 判準漏角色繼承,owner 豁免同病 | **算法改了**:`= ANY(polroles)` ⇒ `pg_has_role(..., 'USAGE')`,owner 也走繼承。**重跑後五個角色數字逐格不變**,而 §5-A 量出「為什麼不變」(restrictive 0 條 + 相關繼承邊 0 條)並寫明保存期限 |
| ③nit · §3「全部沒起作用/第一次執行」說過頭;「兩列原文都沒講」不實 | §3 整段收窄:限定在「檢查身分是 service_role 的那條路」,補上「BYPASSRLS 不隨一般權限繼承」「view / SECURITY DEFINER 換身分」,並改成「本次未驗證移除後的行為」。**刪掉「兩列原文都沒講」** |
| ④must-fix · §5 三個方向只證明分支有動,不是校準 | §5 拆成 5-A(bug 與修正)/ 5-B(**明寫仍未校準**,並寫出要怎麼校準)/ 5-C(view 逃生口)。§0 與 §4 標題把清單降級為**候選** |
| ⑤must-fix · §6「下限只會更多」不成立,且漏三項 | **「下限」那句刪掉**,改成「兩個方向都會錯」並各舉例;補上「不一定安靜(會報錯)」「count=0 分不開空表與濾光」「四支 view 逐支判定沒做」 |

🛑 **codex 結論是「不可拿目前清單作為收 BYPASSRLS 的決策依據」。本稿沒有推翻它 —— 反而把它寫進 §0 與 §7:清單是候選,決策前還缺一道行為驗證。**
🛑 主視窗 2026-09-09 定:**純 .md 這一片只跑 R1,不跑 R2。**
