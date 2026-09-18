# 把 `pcm_readonly` 的現有授權寫進版控

> 板號 `20260918050000`(主視窗指定)。窗 B(worktree `pcm-ops`)2026-09-18。
> 依據:Sean 2026-09-18 **Q1 拍甲**(補一支把現況寫進版控)+ **Q2 拍甲**(登入紀錄那條留著,而在那一句旁邊寫明理由)。
> **鐵則 8:這份 plan 批了才寫 SQL。本檔零 `.sql`。**
>
> 🔴🔴 **2026-09-18 夜:本份 plan 裡每一個 `64` 都已經不是事實了 —— 實際是 `61`。**
> Sean 同夜 **Q1 拍甲** ⇒ 三張碰錢的表不寫進版控。**舊字面全部留著不改**,
> 新的形狀與新的恆等式在 ↓ **《2026-09-18 夜更正》那一節**(就在 `## R-3` 上面)。
> 🛑 **在讀到那一節之前, 本檔往下每一個 64 都要當成【已作廢的舊字面】。**

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

---

# 附錄 R:**81 條唯讀授權的證據表**(2026-09-18 · Sean Q3 拍甲:整批重審)

## R-0 🛑 **這不是一份分類表 —— 最後一欄【是空的,而且刻意留空】**

要答的是「**這個查帳帳號需要看它嗎**」,而**那是判斷,不是量測**。
本表只把證據擺好;最後一欄由 Sean 填。
🛑 **我沒有幫他填,也沒有寫「建議」** —— 📌 **一個量具不該產出它量不到的東西。**

⛔ ~~上一版用欄名關鍵字產出 🔴🟠🟡⚪ 四級判定~~ **作廢**。它錯兩層:
① 量的是**欄名**,把 `payment_charge_attempts` 判成「不碰錢」;
② 📌 **更重要的是它印出了一個看起來像結論的東西** —— 那四個符號會讓人**跳過證據直接讀結論**。

## R-1 🛑 **這把尺抓不到什麼(先講,再看結果)**

1. 🔴🔴 **四欄全部都是【repo 與 catalog 的字面】—— 沒有一欄看得到【資料本身】。**
   ⇒ **一張今天是空的表,與一張有 26 萬列的表,這把尺印出來一模一樣。**
   (實例:`admin_saved_order_views` 今天 `n_live_tup = 0`,而本表看不出來。)
2. **A 欄(表說明)會過期** —— 那正是 §13-d 那三支檔的病。它是**線索**,不是判準。
3. **B 欄(外鍵)** 抓不到:用 `jsonb` 裝金額的、沒建外鍵的、以及**所有 view**。
4. **C 欄(碼裡讀它)答的是【後台功能要不要它】,不是【查帳要不要它】** ——
   🛑 而**查帳帳號怎麼用,本來就不在 repo 裡** ⇒ 這一欄**答不到本題**。
5. **D 欄(表名)** 抓不到名字中性而內容敏感的(`staff` / `email_outbox` / `auth_callback_events`)。

## R-2 ⚪ 兩組對照都燒過(而且燒出東西)

**正對照 — 舊尺全漏的那四張,新尺必須抓到**
```
payment_charge_attempts · order_cancellations · order_cancellation_items · order_item_costs
⇒ D 欄四張全中「錢」 ✅
```
**負對照 — 必須判成不相關**
```
vehicle_taxonomy_public · product_fitments(+3 個同族) · search_queries
sweeper_heartbeat · pcm_acl_snapshot_digest   ⇒ D 欄全空 ✅
```
🔴 **而負對照第一次跑是【紅的】**:`vehicle_taxonomy_public` 被判成碰錢 ——
因為 `tax` 出現在 `taxonomy` 裡面。⇒ D 欄改成**詞界比對**(`(^|_)tax(_|$)`)才過。
📌 **那一格就是負對照存在的理由:它抓到的是尺的病,不是資料的病。**

> ## 🔴🔴 2026-09-18 夜更正:本份 plan 裡的 **64** 已經不是事實了
>
> Sean 2026-09-18 **夜 Q1 拍甲**:`payment_charge_attempts` / `order_cancellations` /
> `order_cancellation_items` 的 `pcm_readonly` SELECT **要收掉** ⇒ 板 050000 **不再把它們寫進版控**。
> ⇒ ✅ **本片實際寫下的是 61 句, 不是 64。**(commit `5cbdc4050`, 分支 `agent/ops-17-receipt`)
>
> 🛑 **本份 plan 的舊字面全部留著不改** —— 它記的是**當時的決定**, 而改寫會讓
> 「我們是怎麼從 64 走到 61 的」從歷史裡消失。要看新的形狀讀本節與那支 migration 的檔頭。
>
> **§R-3 那個恆等式跟著變**(舊字面在下面, 這裡寫新的):
> ```
> 線上 aclexplode                        = 81   （不變）
> 板 050000 實際寫下的                   = 61
> 本片刻意【不寫】的                     =  4   admin_saved_order_views
>                                              + payment_charge_attempts
>                                              + order_cancellations
>                                              + order_cancellation_items
> 其他 migration 已有出處、而線上有的     = 16
> ⇒ 61 + 4 + 16 = 81 ✅
> ```
> 🔵 **而 `order_item_costs`(Sean 同夜 Q2 拍甲也要收)不在上面任何一格的變動裡** ——
> 它一直都屬於「**其他 migration 已有出處**」那 16 條(`20260914010000:109`,
> 帳本 `supabase/APPLIED.tsv:644` 2026-09-14 已貼)。
> ⇒ 📌 **它從頭到尾就不在板 050000 裡, 所以本片沒有「少拿掉一張」。**
> ⇒ 要收它是 `20260918060000`(REVOKE 片)的事 —— 那一片今夜從一張擴成五張。
>
> 🎯 **而這一格本身就是本 plan §R-3 那句話的實例**:
> **「那一格是算出來才發現的, 不是看出來的」** —— 這一次是**去查出處**才發現
> Sean 說的「四張」裡, 這一片碰得到的只有三張。**題目的形狀被查出來的東西改了。**

## R-3 ⚪ 恆等式一(三個數各自獨立算)—— 🔴 **而它修正了本 plan 前面的一個數字**

```
線上 aclexplode                        = 81
板 050000 要寫的                       = 64   （全部在線上 ✅）
其他 migration 已有出處、而【線上有】的 = 16
線上有、而 repo 兩邊都沒有的            =  1   ⇒ admin_saved_order_views（本片刻意排除的那一條）
⇒ 64 + 16 + 1 = 81 ✅

🔴 repo 有而【線上沒有】的 = 2：pcm_settle_retry_attempts · supplier_sync_runs
   ⛔ ~~本 plan 前面寫「反向（repo 有、線上沒有）⇒ 1 個」~~ ⇒ **實際是 2 個。**
```
🔵 而這一格是**算出來才發現的**,不是看出來的 —— 那正是「獨立分母」的用處。

🛑 **而我在算它的時候寫壞過一次**:用了 `cond and A or B`,而 `A` 初始是空集合
⇒ 空集合是 falsy ⇒ **永遠掉到 B**,算出 82 而不是 64+18。
📌 **一個結果「看起來只是差一點」的 bug,比完全壞掉的難發現** —— 抓到它的是恆等式對不上。

## R-4 恆等式二:四欄的**差集**要逐條說得出理由

🛑 **四欄並排,不加權、不合成。**
📌 **一個合成分數會把「四個訊號都說碰錢」與「一個說碰、三個說不碰」壓成同一個數字 —— 而後者才是需要人的那一種。**

⇒ **要先看的是這幾種不同意**:
- **D 空白、B 指向 orders/customers** ⇒ 名字看不出來而它在訂單域裡
- **C = 0 而 A 有說明** ⇒ 後台沒在讀,而有人寫過它在幹嘛 ⇒ 誰在用?
- **A 空白** ⇒ 🔴 **沒有人寫過它在幹嘛,而我們正要把它的授權寫進版控**

## R-5 表(`r` / `p`),共 67 張 —— A 欄空白 **10** 張

| 物件 | D 表名 | B 外鍵指向 | C 碼裡讀它 | A 表的說明(前 150 字) | **需要看嗎** |
|---|---|---|---|---|---|
| `cron.job` | — | — | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `cron.job_run_details` | — | — | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.admin_audit_log` | — | — | 4 | M-4a M0-S2 統一稽核 log(PRD §6.2)。後台所有寫入(tier 變更 / 取消 / 手動建單 / 排序…)同交易或緊接寫一筆。append-only:service_role 僅 INSERT、無 UPDATE/DELETE;client(anon/authenticated)零 | |
| `public.admin_saved_order_views` | — | staff | 0 | M-4b 後台訂單「儲存的檢視」。staff_id IS NULL = 共用(Q-檢視-3=乙);is_shared 是算出來的、寫不進去。讀寫唯一路 = 四支 SECURITY DEFINER RPC;本表零 GRANT。 | |
| `public.admin_sso_login_events` | 個資 | — | 2 | M-4b 後台 SSO 登入事件(Sean 2026-08-18 Q04=乙)。Vercel Hobby runtime log 只留 1 小時、drain 要 Pro ⇒ 鑑識視窗一小時 ⇒ 寫進自家 DB。🔴 這張表要防的人包含拿到 service_role 金鑰的人 ⇒ 只 INSERT+SE | |
| `public.auth_callback_events` | 個資 | — | 0 | 顧客站登入回呼的每日計數(板 :395)。每天最多 10 列(1 成功 + 9 失敗原因),結構上有界。只記「有沒有被打過、成敗、我方 reason code、當天幾次」,零 PII、不存 state、不存原始 error。admin SSO 有自己的 admin_sso_login_events, | |
| `public.brands` | — | — | 6 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.categories` | — | categories | 8 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.coupon_redemptions` | 錢 | coupons customers orders staff | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.coupons` | 錢 | staff | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.customer_addresses` | 個資 | customers | 4 | M-1-14:收件地址 + 發票合一(對齊 design AccountPage InlineAddressForm L686-757)。每 customer 至多一筆 is_default。 | |
| `public.customer_favorites` | 個資 | customers products | 3 | 會員收藏清單（#191）。一列 = 一個人收藏了一個商品。複合主鍵：同一人同一商品只能一筆，由 DB 保證去重，不靠應用層。刻意不放商品快照欄：收藏指向商品本身，不是當時那個商品的樣子（與 order_items 相反）。零金額／零訂單資訊。⚠️ 【不是零個資】（codex 對抗審查 must-fi | |
| `public.customer_vehicles` | 個資 | customers | 4 | M-1-14:會員愛車(對齊 design AccountPage InlineVehicleForm L760-798)。每 customer 至多一輛 is_primary。Phase 2 升級為獨立 Vehicle entity 接 vehicle service ecosystem(對齊 d | |
| `public.customer_wallet_ledger` | 錢/個資 | customers | 4 | M-1-14 Q1=B 拍板:wallet_balance / total_deposit 存 customers 表欄位、ledger AFTER INSERT trigger 自動同步(非 view 即時算)。customer_wallet_balance_check view 留作 admin | |
| `public.customers` | 個資 | users | 23 | M-1-14:會員主表、user_id = auth.users.id 1:1。tier 由後台手動標記(Q1=A、對齊 design TierComponents L27)、客人不可自改(column-level GRANT REVOKE + RLS)。 | |
| `public.email_outbox` | 個資 | orders | 20 | M-4a Email 通知片薄 outbox(plan v3 §4;Sean 07-16 拍 S1=A 完整版)。app 層於「confirm RPC 成功、payment_status 轉 paid」後寫入(交易外、不改 create_order、不進訂單交易 → 寄信失敗絕不影響下單扣款);af | |
| `public.fx_rates` | 錢 | staff | 2 | append-only:每次改匯率新增一列,舊列不改不刪(trigger 擋 UPDATE/DELETE/TRUNCATE)。現在的匯率 = 每幣別 effective_from <= now() 中最新一列。TWD 固定 1(CHECK)。寫入只走 admin_fx_rate_set(is_man | |
| `public.home_banners` | — | supplier_inbound_emails | 1 | 首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙;20260918020000 更正三處過期字面;20260918030000 更正 FK 連帶那一段)。draft ⇒ published ⇒ archived(單列不回頭;要重做走 admin_home_ | |
| `public.legal_terms_versions` | — | — | 0 | M-3 #241 條款版本登錄表。version=條款版本鍵(= storefront CURRENT_TERMS_VERSION);content_hash=該版本對外文字之 sha256。🔴 2026-07-24(#291)起 hash 來源 = apps/storefront/src/data | |
| `public.order_amount_requests` | 錢 | order_items orders staff | 2 | M-4b-03 改金額審核:員工提「這一項改成多少、為什麼」, 管理者核 / 退。pending → approved / rejected / superseded(終態不可再變)。 核准 = admin_review_order_item_amount 同交易呼既有 admin_update_o | |
| `public.order_cancellation_items` | 錢 | order_cancellations order_items | 0 | M-4b E10 A7:逐品項取消量。同一次取消涵蓋幾個品項就有幾列;同一品項可跨多次取消累積(部分取消分次)。🔴 order_items.cancelled_quantity 的真相來源 = 本表 SUM(cancelled_quantity),那條等式由 A4a 重算 trigger 維護,本片 | |
| `public.order_cancellations` | 錢 | orders staff | 0 | M-4b E10 A7:訂單取消動作的真相表(每次取消一列;同一張單可取消多次 = 部分取消可分次)。🔴 service_role only:內部取消原因(含 internal_error「我方疏失」)絕不進 orders —— 那張表對登入客人開放讀自己的單。寫入一律走 owner RPC(A8a | |
| `public.order_item_costs` | 錢 | fx_rates order_items staff | 1 | 訂單品項成本(老闆:成本模式;20260914010000)。三欄外幣 + 幣別 + 寫入當下抄的匯率(改匯率不回頭重算)。台幣總計 / 利潤不存, 讀時算(cost-view.ts)。零 anon/authenticated 權;寫只走 admin_set_order_item_costs(is_ | |
| `public.order_item_procurement` | — | order_items suppliers | 5 | M-4b E10 A2:向供應商採購的真相表(每個 order_item 可有多列 = 同一品項拆給多家供應商)。🔴 2026-07-31(A1)起:摘要值 ordered_quantity / instock_quantity 落在 **public.order_item_quantity_sum | |
| `public.order_item_procurement_receipts` | — | order_item_procurement | 3 | M-4b E10 A2(Sean 2026-07-29 拍板 A2-1=A 擴充):逐批到貨明細。一筆採購分幾批到貨就有幾列。🔴 2026-08-10 #352-a2 起:**不再是 append-only** —— 提供受守門的刪除(admin_delete_item_receipt),守門只有一 | |
| `public.order_item_procurement_void_requests` | — | — | 0 | M-4b E10 #452 片 2a-2 乙:採購作廢的冪等帳。**append-only —— 零 UPDATE、零 DELETE 路徑**。每一次成功的作廢留一列。重送同一個 request_id:**payload 相同**回 DUPLICATE_REQUEST(不再作廢第二次);**payl | |
| `public.order_item_quantity_summary` | — | order_items | 0 | E10 A1:訂單品項的數量摘要(衍生值,非真相)。真相在 A2 採購表、A7 取消明細與 B2 包裹表;本表存在的理由是「列 300 筆訂單時不要每次重算」(master plan Q9=B)。🔴 員工專用:anon/authenticated 零權限 + RLS zero-policy —— S | |
| `public.order_item_receipt_requests` | — | — | 2 | M-4b E10 #352-a1:到貨登錄的冪等帳。**append-only —— 零 UPDATE、零 DELETE 路徑**。每一次成功的到貨登錄留一列。重送同一個 request_id 時:**payload 相同**才回 DUPLICATE_REQUEST(不再產生第二筆到貨);**pay | |
| `public.order_items` | — | orders product_variants | 8 | M-3 訂單明細(S2-a)。歷史凍結快照:unit_price/line_total/variant_sku/product_snapshot(白名單 title/sku/spec)。🔴 無 price_store/price_by_tier/cost。商品改價不影響舊單。 | |
| `public.order_legal_consents` | 個資 | legal_terms_versions orders | 0 | M-3 #241 結帳同意紀錄(1:1 附屬 orders)。consent signal + terms_version(FK)+ consented_at + client_ip/UA(best-effort 爭議舉證、PII)。寫入唯一路徑 = create_order SECDEF owne | |
| `public.order_manual_refunds` | 錢 | orders | 5 | 非卡退款登記(現金 / 匯款)。Sean 2026-08-20 Q8=乙 逐字「那只是記一筆帳」。🔴 本表記的是【一件已經發生的事】,不是【一個要發起的動作】—— 錢是人交回去的,系統沒有動作可做。🔴 **刻意沒有 status**:它出生就是既成事實。卡片退款需要 processing/faile | |
| `public.order_notes` | — | order_notes orders | 1 | M-4b E10 A3:訂單的內部備註與聯絡紀錄(append-only)。三種 note_type:internal 內部備註 / contact_log 聯絡紀錄 / customer_notified 已告知客人(U6 缺貨告知義務的證據)。🔴 service_role only:內部備註絕不 | |
| `public.order_payments` | 錢 | order_payments orders staff | 1 | OP1 收款帳本(master-plan v2 :655 第 3 批第 1 項)。記的是**收款流入 + 對它的沖銷更正**。🔵 沖銷列的金額規則由 **amount 欄的 COMMENT** 定義 —— 🛑 **本則【只指路、不斷言那道保護的生效狀態】**:20260918040000 之前這裡兩 | |
| `public.order_pending_refunds` | 錢 | order_cancellations order_manual_refunds orders | 1 | 待退款:一張單被【整單取消】,而它在現金/匯款兩軌上還有收過而沒退回去的錢。Sean 2026-09-01 拍甲逐字「錢收了沒紀錄, 今天起停止」。🔴 本表與 order_manual_refunds 的語意【相反】:那張表記【已經發生的事】(它的 COMMENT 逐字「刻意沒有 status … | |
| `public.order_refund_items` | 錢 | order_items order_refunds | 0 | M-3 RF2a 退款明細 —— 🔴 **2026-08-01 A7c 起已凍結,無任何寫入端**(Sean 拍板③「不追品項」/ Q1=A 帳本改記金額)。保留原因:既有結構、正式站 0 列、且被 A7b-M 的 order_refund_job_items 引用為形狀樣板。禁 INSERT/UP | |
| `public.order_refund_job_items` | 錢 | order_items order_refund_jobs | 0 | M-4b A7b 退款工作表的帳本快照明細(Q4=B)。形狀逐欄對齊 order_refund_items,讓隔日寫帳本是「搬」不是「算」。🔴 至少一列 / Σ line_amount = jobs.items_amount / quantity ≤ 原品項 / unit_price = 訂單快照 | |
| `public.order_refund_jobs` | 錢 | order_cancellations order_refunds staff | 0 | M-4b A7b 卡片退款工作表(一次要退的錢 = 一列)。TapPay 退款隔日生效 ⇒ 送出與確認之間需可持久化、可重入、可對帳的中間狀態。狀態機七態、16 條 edge 的守門全在 A7b-T,本片只有 schema。🔴 本表在 A7b-T 之前由 order_refund_jobs_dorm | |
| `public.order_refund_manual_corrections` | 錢 | order_refunds | 0 | #473b-1:對 order_refunds 人工判定(failed/manual_failed)的更正,append-only、一次更正一列。🔴 本表**不改動 order_refunds 任何欄位**,包括 status —— 舊列原樣留著當「我們曾經判錯」的證據。🔴 語意 = Sean Q- | |
| `public.order_refunds` | 錢 | orders | 3 | M-3 RF2a 退款帳本 + M-4b A7c(2026-08-01 Sean Q1=A 改形狀:**記金額,不記品項**)。一次退款登記一列。金額 = 單一欄 refund_amount(只有 > 0、**無上界** —— 拍板⑤ DB 不做防超退)。冪等鍵 = bank_refund_id;r | |
| `public.order_status_options` | — | — | 0 | M-4a 後台訂單處理狀態詞彙(Sean 可設定+顏色;設計檔 2026-07-13)。orders.workflow_status soft-ref 本表 code(無硬 FK);soft-delete 用 is_active、不硬刪;client(anon/authenticated)全鎖、只 | |
| `public.orders` | — | coupons customer_addresses customers | 26 | M-3 訂單主表(S2-a)。寫入只走 create_order RPC(SECURITY DEFINER、authenticated 無直接 INSERT);客人只讀自己(RLS)。無經銷價欄、無 view。金額 integer 元位、CHECK 守 server 權威。 | |
| `public.orders_deleted_log` | — | — | 0 | 訂單刪除留痕(⟦db-ORDERDELETENOTRACE⟧, Sean 2026-09-07 Q35 甲)。每一列 = 一列被刪掉的資料的整列 jsonb。🔴 它記不到【人】, 只記得到 DB 角色 —— SQL Editor 直下的刪除多半都是 postgres。🔴 它不是備份:重建需要人判斷 | |
| `public.payment_charge_attempts` | 錢 | orders | 3 | M-3-S2-d charge 簿記 + 防雙扣鎖(plan v6 §2、PF-X1/X2)。寫入唯 SECURITY DEFINER RPC(begin/mark×2 主軌 payment_confirmer、fallback 備軌 authenticated+token);表零直接權限(RLS | |
| `public.payment_double_charge_anomalies` | 錢 | orders payment_charge_attempts | 0 | M-3 3DS R1b1a 雙扣 anomaly 主表(PRD §2.1 + canonical §4 R1b1a)。released→charged late success 雙扣明確化留痕(genesis 寫入在 R1b1c markCharged 同交易)。old_attempt_id UNI | |
| `public.payment_double_charge_anomaly_events` | 錢 | payment_double_charge_anomalies | 0 | M-3 3DS R1b1a append-only 稽核 event 表(PRD §2.2 + canonical §4 R1b1a line 160-162)。anomaly 每個狀態操作 / 退款結果同交易寫對應 event(s)(reopen 寫 refund_not_executed + r | |
| `public.payment_refund_events` | 錢 | payment_refund_events payment_refunds | 0 | M-4b L5b 子表:append-only 事件流。`sent`=外呼已送出(write-ahead:父列與 sent 事件須先 commit 才准打 TapPay)。attempt 歸屬由父表決定 ⇒ 事件無從與它不一致。🔴 仍由 L5b-2 強制的**五條**(逐條見本片 migration | |
| `public.payment_refunds` | 錢 | payment_charge_attempts payment_refunds | 0 | M-4b L5b 父表:一列=一個 logical refund=**一次物理退款嘗試=一把冪等鍵**(TapPay refund 鍵恆久消耗、絕不重用)。🔴 insert-only(append-only trigger);**複合**自我 FK `(attempt_id, supersedes_ | |
| `public.payment_webhook_events` | 錢 | — | 0 | M-3 3DS-0a ②-⑥ webhook durable inbox(master plan v5 §3)。TapPay notify 落地點:rec_trade_id 去重主鍵、白名單欄位 + raw sha256 hash(不存原文=不落 PII)、processed/attempt_cou | |
| `public.pcm_acl_snapshot_digest` | — | — | 0 | ⟦b9-ACLDRIFT5⟧ 每天一列 ACL 摘要。digest=八族全文的 md5;row_count 與 digest 一起存 —— digest 相同而列數不同在數學上不可能, 所以它是一個免費的「這支 SQL 有沒有整段沒跑」對照。families 存每族各自的 md5 與列數, 讓人一眼 | |
| `public.pcm_b2_shipping_idempotency` | 個資 | — | 0 | B2 出貨 writer RPC 的冪等落腳表(收據存根簿)。純機械帳表、無業務語意。🔴 **永存:禁止 TTL、禁止清理排程、禁止在災難 runbook 裡被 DROP/TRUNCATE/重放。**冪等鍵是**稽核證據**不是快取 —— 鍵過期後同鍵重試會被當成新請求 ⇒ at-most-once | |
| `public.pcm_net_exposure_snapshot` | — | — | 0 | ⟦b9-PROBESCHED⟧ 每天一列 net 曝露面【取樣讀數】(來源 scripts/check-anon-grants-prod.sh 的 E686 那段)。🔴🔴 **這一欄要讀 delta, 不要讀絕對值** —— 正式庫的基線【不是 0】。2026-09-08 唯讀實量(pcm_read | |
| `public.pending_invoices` | 錢 | orders | 0 | M-3 3DS-0c 待開票 durable 表(S1=B、Sean 後台手開、master plan v5 §5)。settleCharge 成交(paid)點經 record_pending_invoice 冪等寫;order_id UNIQUE 冪等鍵(paid 重入不重複開)。🔴 只記待開旗 | |
| `public.product_fitments` | — | products | 0 | 相容車輛正規化索引(衍生自 products.fitments jsonb、trigger 自動同步)。推薦引擎 Case A 反查「以車查商品」用。單一真相仍為 products.fitments;此表可 DROP 重建。moto_brand/model_code 存原始名(非 slug)。 | |
| `public.product_fitments_effective` | — | products | 1 | 展開後(direct+inherited)車款索引。來源=報價單 storefront_fitments_v 每日 staging-snapshot 同步(service_role 寫、單交易替換)。車款搜尋讀此表;product_fitments(direct、trigger 衍生)另供推薦引擎。 | |
| `public.product_fitments_effective_staging` | — | products | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.product_fitments_effective_sync_log` | — | — | 1 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.product_image_trim` | — | — | 0 | 商品卡片圖去白邊 bbox(plan docs/specs/2026-07-19-product-image-trim-plan.md)。url=products.images->>0 的供應商 CDN 位址(公開、無 PII);status=ok(有 bbox)/no_trim(深底或無白邊、前端 | |
| `public.product_variants` | — | products | 7 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.products` | — | brands categories staff | 9 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.search_queries` | — | — | 0 | 客人在顧客站打的搜尋字(語料, 不是流量統計)。🔴 刻意不含任何指向個人的欄位 —— Sean 2026-09-04 拍 Q1(plan v5 §0)。🔴 保存期限 2 年(Sean 2026-08-21 拍), 而【本支沒有做刪除排程】—— 一個沒有東西在跑的保存期限等於沒有保存期限, 排程另開一 | |
| `public.shipment_items` | 個資 | order_items shipments | 6 | M-4b E10 第 2 批:包裹內容(B2 停損版 S1b)。append-only —— 入箱後不可改、不可刪(A6)。🔴 Sean 2026-08-05 Q-a=C 知情拍板:**裝箱數量打錯的唯一補救 = 整箱作廢重開**,資料庫刻意不放寬;補救的便利性做在出貨畫面的「照這箱內容開一張新的」 | |
| `public.shipment_order_ship_clearances` | 個資 | orders shipments | 1 | P0-1 出貨資格證明(20260915230000)。一列 = 這一箱在持訂單鎖、pcm_order_ship_blocked 判準通過那一刻, 這張單可以出。寫入只經 admin_claim_hct_dispatch / admin_mark_shipment_shipped(片 1b)與本檔回 | |
| `public.shipments` | 個資 | customers | 10 | M-4b E10 第 2 批:出貨包裹主表(B2 停損版 S1a-1)。一單多包 + 多單併一箱(U1);**本表刻意沒有 order_id** —— 一箱可含多張訂單,關聯走 shipment_items。🔴 本片落地時**零應用 writer**:service_role 只有 SELECT,出 | |
| `public.staff` | 個資 | — | 6 | 後台操作者名冊。🔴 id 為永久識別碼、永不重用(Sean 2026-08-16 拍板):離職 = is_active=false,不是 DELETE;新人拿新代號,不撿空出來的。原因:admin_audit_log.actor 是 text 欄不是 FK,重用代號會讓歷史稽核紀錄改變解讀。 🔴 給 | |
| `public.supplier_inbound_emails` | 個資 | — | 1 | 讀過的廠商新品信(20260916150000;PRD §3.3,Sean Q8 甲;20260918030000 更正保留期那一句)。只存必要欄位、不存信件內文。90 天後由 supplier_inbound_emails_purge_expired() 處理,而 20260918030000 起 | |
| `public.suppliers` | — | — | 3 | M-4b E10 供應商主檔(Sean 2026-08-01 拍板)。**設計意圖**:採購改為從本表選、不手打自由文字(FK 與選單皆在後續片,本片尚未建立)。停用走 is_active=false;本片不提供任何刪除路徑(表級無 DELETE/TRUNCATE 權 + 兩支 block trig | |
| `public.sweeper_heartbeat` | — | — | 1 | sweeper 存活心跳（甲′＝單列三值 upsert，每個 job 一列）。存在理由：告警的觸發條件全部要靠 sweeper 活著才成立 ⇒ sweeper 死掉時，正好用來報告它的那個計數器會停在 0 而不告警。零 PII／零金額／零訂單編號／零 rec_trade_id。無歷史（刻意）：只答「 | |

## R-6 View(`v` / `m`),共 14 張 —— 🔴 A 欄空白 **1** 張

🛑 **view 另外分一區(Sean 2026-09-18 拍甲)。** 它們的 **B 欄結構性全空**(view 沒有外鍵)
⇒ 混在同一張表裡比,**表的空白與 view 的空白會長得一樣**。
🛑 **不展開成底表來判** —— 那會讓「這張 view 給不給」被「它底下的表碰不碰錢」代理掉,
而**底表碰錢不等於這張 view 碰錢**(view 可能只取一部分欄)。

| 物件 | D 表名 | B 外鍵指向 | C 碼裡讀它 | A 表的說明(前 150 字) | **需要看嗎** |
|---|---|---|---|---|---|
| `public.admin_coupon_list_blocks_v` | 錢 | — | 0 | 🔴 **(空白 —— 沒有人寫過它在幹嘛)** | |
| `public.admin_coupon_list_v` | 錢 | — | 0 | 後台優惠券列表(已用次數 / 建立者名稱)。🔴 已用次數口徑:一律排除【已退回】的 redemption(reverted_at IS NOT NULL 者不計)。🔴 本 view【刻意不使用 security_invoker】—— 底表 coupons/coupon_redemptions 在片1 | |
| `public.admin_order_list_v` | — | — | 1 | #484a/#488 訂單列表讀取源:orders 全欄 + goods_axis(none/ordered/instock/shipped)。🔴 寫法契約:orders 欄位必須 o.* 原樣帶出、不得 GROUP BY/DISTINCT/join order_items ——PostgREST | |
| `public.customer_wallet_balance_check` | 錢/個資 | — | 0 | M-1-14 Q1=B 拍板:對帳工具、計算 ledger SUM 供 admin 端 cross-check customers.wallet_balance / total_deposit 是否一致(trigger drift 防線)。Phase 1 不放 storefront hot path | |
| `public.order_paid_totals_v` | 錢 | — | 0 | #841:每張訂單的帳本已收淨額(直接加總 amount, 沖銷列為負)。security_invoker=false 是刻意的 —— 讓本 view 以擁有者身分讀底表, 讀本 view 的人不需要底表權限。🔴 **而【不要】把它讀成「底表沒有人讀得到」**:2026-09-18 唯讀實查, or | |
| `public.order_refund_effective_verdict` | 錢 | — | 1 | #473b-1:每筆 refund 現行有效的人工判定更正(seq 最大者)。Sean Q-473-1=A「最新一筆說了算」。🔴 **所有讀取面一律消費本 view**,不得再自己對 order_refund_manual_corrections 取 max(seq)。🔴 沒有更正過的 refund | |
| `public.payment_refund_effective_terminal` | 錢 | — | 0 | M-4b 沖銷片一級交付物:每顆 refund 的**有效終局**(終局集合 且 沒有 manual_reversal 指向它)。至多一列(由 pre_one_effective_terminal trigger 保證,不是由索引)。indicates_refund=錢動過了嗎:result_con | |
| `public.pcm_acl_drift_status` | — | — | 0 | ⟦b9-ACLDRIFT5⟧ 片二:一列就答完「權限快照與上一次一不一樣」。🔴 **definer view(security_invoker 沒開)—— 而那是刻意的**:讀的人用【view 擁有者】的權限讀底表, 因為底表對四個應用角色四道 REVOKE 全收 ⇒ invoker view 會讓 | |
| `public.pcm_shipped_email_pending` | 個資 | — | 0 | 「已出貨、未作廢、還沒排過 order_shipped、而且至少一個信箱非空」的 (箱, 單) 配對。一列 = 一封要寄的信。 🔴 空白定義走 public.pcm_js_trim_whitespace() 單一來源(2026-09-05 ⟦b4-SHIPPEDBTRIMNARROW⟧ 從裸 btr | |
| `public.pcm_shipped_email_unsendable` | 個資 | — | 0 | 已出貨、未作廢、還沒排過信,而**兩個信箱候選都是空的**的 (箱, 單) 配對 = 這幾位客人收不到出貨通知。 🔴 它是 pcm_shipped_email_pending 的補集,兩支的其餘條件逐字相同 —— **改一支必須改另一支**。 🔴 空白定義走 public.pcm_js_trim_w | |
| `public.product_variants_public` | — | — | 1 | Variant public projection(S1 加末欄 supplier_slug、共 11 欄):含 price_general / supplier_slug,排除 price_store + metadata。security_invoker=true。RLS EXISTS(pare | |
| `public.products_list_public` | — | — | 0 | P4 list projection: card-only public fields + brand/category display keys + created_at (16 cols). security_invoker=true; excludes price_store, price_b | |
| `public.products_public` | — | — | 17 | Detail projection(附件片 3a 加末欄 sound_clips;20260915220000 再加末欄 content_changed_at、共 21 欄):含 price_general / supplier_slug / highlights / manuals / video | |
| `public.vehicle_taxonomy_public` | — | — | 1 | 車輛下拉用的四欄投影(#277 C 案,2026-08-11 Sean 拍板):車型取 product_fitments 與 product_fitments_effective 的聯集,**年份只取 product_fitments(direct)**。🔴 年份不取 effective 的理由:e | |
