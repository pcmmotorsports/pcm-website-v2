# 2026-09-10 `⟦db-ACLVALUEPROVENANCE⟧` —— 不做那把尺,而症狀量了:**它在長大**

> 🛑 **這一列板上明寫「不要派」**,誰欄逐字:**主視窗 A 已裁「乙不現在做,開列擋著」**;
> 列尾 ⑤ 逐字:**那支工具沒有做也不做**(主視窗 A 2026-09-08 覆核維持,理由逐字「**它不會讓站早一天開**」)。
>
> ⇒ ✅ **所以「常設的尺 vs 一次性的答案」這個分野,已經有答案了:那把尺【不做】。**
> **這一份不提工具、不寫 plan,只做一件不需要工具的事 —— 量它的症狀今天長成什麼樣。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 一、為什麼還是量了一發:那一列自己預言了一件會持續發生的事

板列 2026-09-08 的發現(不是我的):
· 那 63 筆「找不到來源」的 `GRANT`,來源是**一個曾經在、現在不在的 `pg_default_acl`**(新表出生自帶 `SELECT` 給 `pcm_readonly`)。
· 🎯 而它導出的那句預言逐字:
> `⟦db-INCIDENTNOREAD⟧`(唯讀角色看不到事故)**不是一次疏漏** —— 它是「那個自動授權機制消失了」的**第一個症狀**,
> **而它會繼續發生在每一張新表上。**

⇒ 📌 **一個預言可以量。而量它不需要那支工具。**

---

## 二、【量的】兩天過去,症狀長成這樣

2026-09-10 唯讀查正式庫(`bash scripts/readonly-prod-sql.sh`,零寫入):

| 量什麼 | 板上 2026-09-08 | 今天 2026-09-10 | |
|---|---|---|---|
| `public` 的 `r/v/m/p` 物件總數 | (沒記) | **97** | |
| `pcm_readonly` **讀得到**的 | **69** | **72** | +3 |
| 🔴 `pcm_readonly` **讀不到**的 | **24** | **25** | **+1** |
| `pg_default_acl` 含 `pcm_readonly` | **0** | **0** | **那條路還是關的** |
| ⚪ 正對照:`pg_default_acl` 含 `anon` | **12** | **12** | ✅ 尺看得見 ADP 內容 |
| 🟢 正對照:`service_role` 讀得到的 | (沒記) | **82** | ✅ 尺對不同角色印不同值 |

⇒ 🔴 **那句預言成立了,而且現在有速率:兩天多一個讀不到的。**
⇒ 🔵 而讀得到的 **+3** ⇒ 📌 **有人在手動補,而補的速度追不上長出來的速度。**

### 今天讀不到的 25 個(按 oid,愈後面愈新)

```
53535 v admin_customer_list_v                            76115 v order_balance_base_v
68224 r dbk_external_id_rename_20260904                  76121 v pcm_bank_order_created_email_pending
68337 r pcm_rls_rollback_20260904270000                  76127 r supplier_sync_runs
68359 v pcm_tracking_corrected_email_pending             76153 v pcm_bank_order_still_mailable
68365 v pcm_order_created_email_pending                  78962 v order_refunds_readable
68370 v pcm_unpaid_cancelled_email_pending               79319 v products_list_dealer
68402 r pcm_definer_searchpath_rollback_20260905100000   79596 v pcm_partial_refund_email_pending
68417 r pcm_definer_searchpath_rollback_20260905110000   79605 v pcm_order_effective_amounts_v
68485 v pcm_manual_no_email_excluded                     81091 r pcm_net_exposure_snapshot
68490 r pcm_settle_retry_attempts                        82447 v pcm_bank_order_mail_blocked_by_tax
69854 v pcm_cancelled_email_pending
70265 r pcm_incident
70289 v member_order_balance_v
70367 v pcm_tracking_correction_candidates
70372 v pcm_tracking_corrected_payload_unparseable
```
🔵 板上 09-08 那份的最高 oid 是 **79596**;今天有兩個比它新:**81091 `pcm_net_exposure_snapshot`** 與 **82447 `pcm_bank_order_mail_blocked_by_tax`**。

---

## 三、🎯 而交叉對上了一件事:**這 25 個裡,有兩個不是這個病**

我今天稍早那一輪(`⟦b9-UNTRACKEDGRANT⟧`)量到:**版控裡具名 `GRANT … TO pcm_readonly` 的 12 張表,只有 9 張在正式庫的 ACL 裡**,另 3 張正式庫**根本沒有**:
```
pcm_auth_provider_of · pcm_settle_retry_attempts · supplier_sync_runs
```

【量的】而今天這 25 個讀不到的裡面,**其中兩個就是它們**:
```
68490 r pcm_settle_retry_attempts    ← 版控【有】具名 GRANT, 而線上讀不到
76127 r supplier_sync_runs           ← 同上
```
(第三個 `pcm_auth_provider_of` **不在這 25 個裡** —— 它在 `public` 的 `r/v/m/p` 集合裡就不存在。)

⇒ 🔴 **所以「`pcm_readonly` 讀不到」這一個症狀,今天至少有【兩種成因】:**
| 成因 | 形狀 | 例子 |
|---|---|---|
| ① **自動授權機制消失** | 版控裡本來就不會有 `GRANT`(它是出生自帶的)⇒ 找不到來源是**正確的觀察** | 那 23 個 |
| ② **版控說了而沒貼上去** | 版控裡**有**具名 `GRANT`,而線上沒有 ⇒ 那支 migration 沒 apply | `pcm_settle_retry_attempts` · `supplier_sync_runs` |

📌 **而兩種成因印出來的畫面【一模一樣】:`has_table_privilege` 回 `false`。**
🎯 **這正是本列在講的那件事的一個實例** —— 本列問的是「線上這個值是誰給的」,而這裡是它的反面:**線上這個值【沒有】,而是誰沒給的,也答不出來。**
🛑 **而分開它們不需要那支工具** —— 只要**把版控的具名 GRANT 清單,拿去跟線上的 ACL 做一次集合比對**。那我今天做過了(那一輪的檔),**兩份合起來就分得開**。

---

## 四、⇒ 我的判

🛑 **這一列不接** —— 板上兩次裁定「不現在做」,而那支工具**逐字寫著不做**。**我沒有寫 plan,也沒有做任何工具。**
✅ **而我留下的是三個數字與一個交叉對照**,它們的用途只有一個:
📌 **下一個撿起這一列的人,不必從頭量,而且會知道【症狀在長大】與【它至少有兩種成因】。**

🔵 **而那個 `+1 / 兩天` 的速率,是這一份唯一的新東西。** 板上原本只說「它會繼續發生」——
**「會繼續發生」與「兩天多一個」對做決定的人是不同的資訊。**

---

## 五、🛑 我證不到什麼

· **【證不到】那個 `pg_default_acl` 是何時、被誰、為何拿掉的** —— 板列自己標過:**缺的檢查 = 伺服器 log,唯讀連線讀不到**。我也一樣。
· **【證不到】那 25 個裡有幾個是【刻意】不給 `pcm_readonly` 讀的** —— 其中至少 5 個看起來是刻意的
  (`dbk_external_id_rename_20260904` · 兩支 `pcm_definer_searchpath_rollback_*` · `pcm_rls_rollback_*` · `pcm_net_exposure_snapshot`
  —— 那幾張在 `RLS-GATE-EXEMPT` 的理由裡逐字寫著「沒有任何程式要讀它」)。
  ⇒ 📌 **所以那個 25 不是「25 個缺陷」,它是【25 個沒有讀權的物件】,而其中有幾個本來就該是那樣。**
  🛑 **我沒有逐個判。** 那要對每一張問「唯讀角色需不需要看它」,而那是一個決定不是一個量測。
· **【證不到】+1 那一個是不是「新長出來的」** —— 我比的是**兩個時點的總數與名單**,而板上那 24 個的完整名單**沒有全部落檔**
  (它只列了「含 `pcm_incident` 70265 · `pcm_acl_snapshot_digest` 68454 · `products_list_dealer` 79319 · 六支 `email_pending` view」)。
  ⚠️ **而 `pcm_acl_snapshot_digest` 68454 今天【不在】讀不到的清單裡** ⇒ 📌 **它變成讀得到了,所以那個 `+1` 是【至少 +2 又 -1】的淨值,不是「新增一個」。**
· **只做了 `pcm_readonly` × `public` × 表級。** 函式層、其他 schema、其他角色,**都沒做**。

**正式庫零寫入。本份沒有做任何工具、沒有寫 plan、沒有改任何一行權限。**

---

## 六、🔗 這一份只有一半 —— 另一半在那裡

📌 **§3 那個「兩種成因」的分辨器,要兩份檔合起來才成立**:

| 這一份答的 | 另一份答的 |
|---|---|
| **線上讀不到的有哪些**(25 個,含 oid 與名字) | **版控具名 `GRANT` 給 `pcm_readonly` 的有哪些**(12 張,含名字) |
| 而它答不出「其中哪些是版控說過的」 | 而它答不出「線上到底讀不讀得到」 |

**⇒ 另一份:`docs/evidence/2026-09-10-untracked-grant-那格沒人做過的差集.md`**

🎯 **做法(不需要任何工具,一次集合比對)**:
拿那一份 §3-3 的 **12 張版控具名清單**,對這一份 §2 的 **25 個讀不到清單** 取交集
⇒ **交集裡的 = 成因②(版控說了而沒貼上去)· 其餘 = 成因①(自動授權機制消失)。**
【量的】2026-09-10 跑過一次,交集 = **2 個**(`pcm_settle_retry_attempts` · `supplier_sync_runs`)。

🛑 **而只讀其中一份的人,會把兩種成因看成同一種** —— 因為 `has_table_privilege` 對它們**印同一個 `false`**。
