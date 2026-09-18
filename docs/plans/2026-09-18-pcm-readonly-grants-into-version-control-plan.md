# 把 `pcm_readonly` 的現有授權寫進版控

> 板號 `20260918050000`(主視窗指定)。窗 B(worktree `pcm-ops`)2026-09-18。
> 依據:Sean 2026-09-18 **Q1 拍甲**(補一支把現況寫進版控)+ **Q2 拍甲**(登入紀錄那條留著,而在那一句旁邊寫明理由)。
> **鐵則 8:這份 plan 批了才寫 SQL。本檔零 `.sql`。**

---

## 一句話

正式庫上 `pcm_readonly` 有 **81 個物件**的 SELECT,而版控裡只找得到 **17 個**的出處。
補一支把**現況原樣寫下來**的 migration —— 它**不改變任何權限**,只讓「誰決定給的」查得到。

---

## 🛑 先講這片**不是**什麼

| 不是 | 是 |
|---|---|
| 不是「收掉誰的權限」 | 是「把已經存在的東西寫進版控」 |
| 不是安全事故處置 | 那 81 條**全部只有 SELECT**、`is_grantable` 全 `false` ⇒ 讀得到、**不能寫、不能轉授** |
| 不是「這個角色不該讀錢的表」 | 它**就是拿來查帳的唯讀角色** —— 讀得到錢的表是它的用途 |

🔴 **真正的問題只有一個:沒有地方記著「誰決定的」,而現有的漂移尺看不到它。**

---

## ① 現況(2026-09-18 唯讀正式庫實查,附對照組)

```
pcm_readonly 有權限的【表 / view】   ⇒ 81 個
repo 具名 GRANT … TO pcm_readonly   ⇒ 17 個
🔴 線上有、repo 找不到出處          ⇒ 65 個（🔵 這是【量到的事實】，不改；本片刻意只寫其中 64)
⚪ 反向（repo 有、線上沒有）          ⇒ 1 個
另有：欄級授權 9 個 · schema USAGE 2 個（public / cron）· 函式 1 支
```

🔴 **而漂移尺整個看不到這個角色**:
```
supabase/acl-snapshot.tsv 裡 pcm_readonly ⇒ 0 次
🟢 正對照 同一份快照裡 service_role      ⇒ 470 次
```
`20260909060000:17` 逐字早就寫過:「pcm_readonly 不在偵測射程 ⇒ 一個 GRANT … TO pcm_readonly 即使**永久留著**也不會叫。」

### 🔬 「誰給的」查不到 —— 而這是**證出來的**,不是放棄

```
81 條的 grantor ⇒ 全部 postgres
🟢 對照組：那 17 條【有版控出處】的 grantor ⇒ 也全部 postgres
```
⇒ 📌 **grantor 分不出「migration 給的」與「有人手打的」** —— 因為 migration 也是以 `postgres` 執行。
⇒ 而**時間與執行者 PG 根本不記錄**(acl 只有 `grantee=權限/grantor` 三格)。
⇒ 🎯 **所以「撈不到」本身就是答案,內容是:誰都可以給,而且不留痕。**
⚠️ 連帶:「65 條 grantor 相同 ⇒ 同一次動作」這個推論**在這裡不成立** —— 這個庫裡**所有**授權的 grantor 都是 postgres,那個訊號的分母沒有變化。

---

## ② 要寫進版控的內容

### ⛔ ~~A. 那 9 個欄級授權 **必須具名寫**~~ ⇒ 🔴 **本片【不寫】它們**(R1 F2 打掉)

**它們已經有出處**:`20260906380000:147-151`(貼板 51,2026-09-06 已貼)。寫進本片就是**第二份副本**。
🎯 **而我當時是怎麼讓它走過範圍閘的**:我用的理由是「表級 GRANT 不涵蓋欄級」——
**那句話是對的 PG 行為,它只是不是【有沒有出處】那個判準。**
⇒ 📌 **兩個判準被換掉了,而兩個都成立 ⇒ 沒有任何東西會叫。**
✅ 兩道斷言留著(本片依賴那 9 條還在);要改白名單改板 51 那一支。

### 🔵 而下面這段實測仍然成立 —— 它是「為什麼不能只靠表級」的依據

```
pcm_settle_retry_attempts： attempts / gave_up_at / last_attempt_at / order_id
supplier_sync_runs      ： id / supplier_slug / started_at / completed_at / outcome
```

🔬 **拋棄式 PG 17.10 實測**:只給欄級 `a` ⇒ 再下**表級** `GRANT` ⇒ 欄 `a` 的 `attacl` **原封不動**。
⇒ 📌 **表級 GRANT 不涵蓋欄級** ⇒ 只寫表級那幾句,那 9 條**不會**被寫進去,
   而**下一個人會以為寫完了**。這句話要寫死在檔頭。

### B. 那 65 條照族寫理由(不一條一句)—— 🔴 實際寫下 **64** 句,見下表 MF2 那一格

> 🛑 一條一句會產出一份沒有人讀得完的東西。理由是**族**共用的:
> **它是查帳用的唯讀角色,這些是它查帳時要看的東西。**

| 族 | 條數 | 物件 |
|---|---|---|
| 訂單主幹 | 13 | `orders` · `order_items` · `order_cancellations` · `order_cancellation_items` · `order_item_procurement`(+`_receipts` / `_void_requests`)· `order_item_quantity_summary` · `order_item_receipt_requests` · `order_legal_consents` · `order_notes` · `order_paid_totals_v` · `order_status_options` |
| 收款 / 退款 | 16 | `order_payments` · `order_refunds`(+`_items` / `_jobs` / `_job_items` / `_manual_corrections` / `_effective_verdict`)· `order_manual_refunds` · `payment_charge_attempts` · `payment_refunds` · `payment_refund_events` · `payment_refund_effective_terminal` · `payment_webhook_events` · `payment_double_charge_anomalies`(+`_events`)· `pending_invoices` |
| 商品 / 分類 | 11 | `products` · `product_variants` · `products_public` · `products_list_public` · `product_variants_public` · `product_fitments` · `product_image_trim` · `brands` · `categories` · `suppliers` · `vehicle_taxonomy_public` |
| 客人 / 券 / 儲值金 | 11 | `customers` · `customer_addresses` · `customer_vehicles` · `customer_favorites` · `customer_wallet_ledger` · `customer_wallet_balance_check` · `coupons` · `coupon_redemptions` · `admin_coupon_list_v` · `admin_coupon_list_blocks_v` · `legal_terms_versions` |
| 稽核 / 登入 / 信件 | ~~6~~ **5** | `admin_audit_log` · ⛔ ~~`admin_saved_order_views`~~ · `staff` · `email_outbox` · `auth_callback_events` · **`admin_sso_login_events`**(見 C) |

🔴 **2026-09-18 改(R2 MF2 · Sean 拍甲)。舊字面留刪除線。** `admin_saved_order_views` **不寫進版控**。
為什麼:`20260828080000:189-197` 逐字寫著「本表**刻意零 GRANT**」「**私有性是 trust boundary,不簡化**」
⇒ 📌 **補出處就是給理由** ⇒ 把它寫進來 = 把一個破洞**追認成設計**。
🔬 2026-09-18 實查,那張表今天 relacl = `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
⇒ ⛔ ~~🔴 **破在兩條**(`service_role=r` 那條連本片都沒碰過)⇒ Sean 拍甲:**兩條都 REVOKE 補回 08-28 的設計**~~
🔴 **同日更正。舊字面留著不刪** —— 改寫會讓錯的字面從歷史裡消失,而下一個人就學不到
我們是怎麼把「**沒出處**」與「**沒查到出處**」講混的。
· 🟢 `service_role=r` **有出處**:`20260904270000:231`(在那份 40 張名單裡)+ `:350` 的 GRANT,
  帳本 `APPLIED.tsv:515` 已貼;該檔 `:7-9` 引 **Sean 2026-09-04 `Q-RLS` 拍甲**,
  而 `:9` 逐字寫明那條 GRANT 是「收掉 `service_role` 的 `BYPASSRLS`」的**前置工程**。
· 🔴 `pcm_readonly=r` **才是孤兒**:repo 零 GRANT 句,且不在任何 `pg_default_acl`
  ⇒ 有人手動下的,而**查不到**是誰、什麼時候(照實寫「查不到」,不寫「沒有」)。
✅ **Sean 重問之後改拍甲**:「只收 `pcm_readonly`(孤兒);`service_role` 留著,
改掉 08-28 檔案裡那句已經被你自己推翻的話」⇒ REVOKE 只收一條,
由**另一片**做(動正式庫權限 ⇒ 鐵則 8 ⇒ 先 plan 等批)。
🛑 **所以本片的表級句數是 64,不是 65** —— 而那條授權**今天仍在線上**。
| 出貨 | 4 | `shipments` · `shipment_items` · `pcm_shipped_email_pending` · `pcm_shipped_email_unsendable` |
| 排程與系統 | 4 | `cron.job` · `cron.job_run_details` · `pcm_b2_shipping_idempotency` · `sweeper_heartbeat` |

🔵 **我查過而【清掉】的三個懷疑**(本來以為說不通,證據推翻了):
- `cron.job` / `cron.job_run_details` ⇒ 10 支 job 的 `command` **零個**含 `secret|token|key|bearer|authorization|password`(只印有無與長度,**沒印值**)
- `staff` ⇒ 欄位只有 `id / label / is_manager / is_active / created_at / updated_at`
- `email_outbox` ⇒ `payload` 欄的說明**逐字**「事件時點不可變、**非 PII 的最小集**」

### 🔴 C. `admin_sso_login_events` —— Q2 那條,理由寫在**那一句 GRANT 旁邊**

**不是寫在檔頭。** 照「更正要落在讀者會走到的地方」。

要寫的內容(用查到的字面,不加油添醋):
> 這張表的表說明**逐字**寫著「🔴 **這張表要防的人包含拿到 `service_role` 金鑰的人**」,
> `ip` 欄逐字「🔴 **PII**」,另有 `user_agent`。
> 🔵 **而 `pcm_readonly` 是另一個角色** ⇒ 給它 SELECT **並沒有推翻那道防線**。
> 🔴 **但它是一張自己標著 PII、存在理由就是鑑識的表** ⇒ 它需要一個**明確的決定**,
> **而 Sean 2026-09-18 拍甲就是那個決定:留著。**
> 📌 寫在這裡,是為了讓下一個看到它的人**不用再問一次**。

---

## ③ 🛑 這片最危險的一格:**還原檔**

🔬 我今天早上為板 207 實測過:**表級 `REVOKE` 會【連帶收掉欄級】**,連那個角色從來沒有表級權限時也照收。

⇒ 🔴 **所以一支「把這 81 條收回去」的還原檔,會把那 9 個欄級一起殺掉** —— 而那 9 條**不是本片給的**。

### 而我認為正確答案更簡單:**這支的還原檔【什麼都不做】**

推論:
1. 本片是 **no-op**(實測:重複 GRANT 之後 relacl 逐字相同)。
2. 那 81 條**在本片之前就存在**。
3. ⇒ 「退回到本片之前」= **現況** ⇒ **正確的還原動作是【不動】。**
4. ⇒ 🛑 **一支去 REVOKE 那 81 條的還原檔,做的不是「退回本片」,是【刪掉本片之前就存在的權限】** ——
   那是一個**新的破壞動作**,而且會順手毀掉 9 個欄級授權。

⇒ ✅ **建議:還原檔只做兩件事 —— (a) 斷言現況仍是那 81+9 條、(b) `RAISE NOTICE` 說明為什麼不動,然後結束。**
   檔頭第一段大字寫明:**「要收掉 pcm_readonly 的權限是【另一件事】,不是退這一片。要做請另開一片,而且要先讀那條 REVOKE 會收欄級的實測。」**

```
Q：還原檔怎麼做？
  甲 什麼都不做（斷言 + NOTICE 說明理由）（推薦）
  乙 REVOKE 那 81 條，再把 9 個欄級補回去
     🛑 我反對：那不是「退回本片」，是刪掉本片之前就存在的東西；
        而且「收完再補回」中間有一個真空窗，沒有理由製造它。
  丙 不寫還原檔
     🛑 我反對：一支沒有還原檔的 migration，下一個人看不出「不動」是刻意的還是忘了。
  我建議甲 —— 而它的價值正是把「刻意不動」寫下來。
```

---

## ④ 驗收(主視窗指定 + 我加的)

```
🔴 貼前貼後 relacl 逐字相同（no-op ⇒ 這是唯一正確的結果）
🔵 而那表示【正向斷言會恆真】⇒ 需要一個會叫的負對照：
   拋棄式 PG 上先 REVOKE 掉其中一條 ⇒ 貼這支 ⇒ 它必須把那條補回來
   🎯 沒有這一格，這支 migration 與一支【空檔】在輸出上長得一模一樣
🔵 那 9 個欄級：貼後 attacl 逐字不變
```
🔵 我再加兩發:
- ⛔ ~~**欄級的負對照**:先 REVOKE 掉其中一個欄級 ⇒ 貼這支 ⇒ **它必須補回來**(證明那 9 句真的有寫、不是只寫了表級)~~
  🔴 **2026-09-18 改(R2 MF3)。舊字面留著不刪。** 為什麼改:**R1 F2 把本片那兩句欄級 GRANT 拿掉了**
  ——理由是那 9 欄的出處已經在 `20260906380000:147-151`(板 51, 已貼), 寫在這裡就是第二份會各自漂移的副本。
  ✅ **改後的期望值**:先 REVOKE 掉其中一個欄級 ⇒ 貼這支 ⇒ **由後置閘② 擋下、拒 COMMIT**(本片不補, 它只斷言)。
  📌 差別很重要:「補回來」是**本片在動 ACL**,「擋下來」是**本片發現板 51 被人動過而停下**。實測走的是後者。
- ⛔ ~~**不越界**:貼完之後 `service_role` 的授權**一個字不變**(本片不該碰別的角色)~~
  🔴 **2026-09-18 改(R2 MF3)。舊字面留著不刪。** 為什麼改:**R1 F7 判定這句講過頭** ——
  本片實際量得到的只有 **service_role 的物件【數】前後相同**, 量不到「一個字不變」(權限型別、is_grantable、grantor 都沒問)。
  ✅ **改後的期望值**:貼完之後 `service_role` 持有 SELECT 的**物件數前後相同**。
  📌 判別句:**一個比不出來的宣稱, 寫進驗收段就是一道恆綠的閘。**

---

## ⑤ 一個要先答的範圍題

```
Q：這支要寫 65 條，還是 81 條全寫？
  甲 只寫那 65 條（沒有出處的）
     ✅ 一條授權只住在一個地方 —— 那 17 條的出處留在它們原本的 migration 裡
     ⚠️ 代價：沒有任何一個檔案「一眼看得到 pcm_readonly 的完整現況」
  乙 81 條全寫（當成一份權威清冊）
     ✅ 一個檔案看得到全部
     🛑 而它造出【兩份會各自漂移的副本】—— 哪天有人用別的片收掉那 17 條之一，
        這份清冊還寫著它 ⇒ 那正是我今天一整天在修的病
  我建議甲。理由:今天所有的病都是「同一件事有兩份副本」造成的，不要在治它的那一片裡再造一份。
  🔵 而「一眼看得到全部」那個需求，用檔頭一行指路解決（指向那 17 條各自的 migration 版本號）。
```

---

## ⑥ 影響

| 誰 | 會不會不一樣 |
|---|---|
| 客人 | **完全不會**(零行為、零資料) |
| 員工 | **完全不會** |
| `pcm_readonly` 本身 | **完全不會** —— 實測重複 GRANT 是 no-op |
| 下一個查「這個角色為什麼讀得到 X」的人 | **會** —— 他查得到了 |

鎖:⛔ ~~這一格我還沒量~~ ⇒ 🔵 **2026-09-18 量完了**(R1 F10:plan 是被批的那份文件,不能停在「還沒量」):
```
GRANT        ⇒ 目標表【零筆鎖】（它只碰 pg_class 與其索引）
COMMENT ON   ⇒ ShareUpdateExclusiveLock
ALTER TABLE  ⇒ AccessExclusiveLock
SELECT       ⇒ AccessShareLock
```
🛑 而我沒有停在「查 `pg_locks` 沒看到」—— 另做行為測試(掛著不 COMMIT、另一條連線去動那張表)⇒ **讀得到也寫得進去**;
⚪ 對照組 `ALTER TABLE ADD COLUMN` ⇒ **當場被擋**。📌 沒有那一格,兩個「不擋」分不出【真的不擋】與【我的測法對什麼都說不擋】。
⇒ ✅ **不會擋到線上任何查詢或寫入** ⇒ 貼板時機不是問題。

---

## ⑦ 規矩

- **鐵則 8**:這份 plan 批了才寫 SQL。
- **鐵則 12**:碰權限 ⇒ 對抗審查一輪。R1 必修修完才 commit;**R2 還有必修 ⇒ 停下端主視窗,不跑 R3**。
- 三綠(只動 `.sql` ⇒ typecheck + lint)。
- 🔴 **拋棄式 PG 真跑** —— 含上面那三個負對照。
- 🛑 **板不自己貼。** 貼板順序:與碼無關 ⇒ 等推 main 那一發跑完再貼。
- 🛑 **Q3(納入漂移偵測射程)這片做完再問,不要順手加** —— 基準沒對之前納入,只會產出一份 81 行的雜訊。
