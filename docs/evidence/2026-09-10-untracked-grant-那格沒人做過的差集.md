# 2026-09-10 ⟦b9-UNTRACKEDGRANT⟧ —— 那格「沒有人做過」的差集,做了

> 板列自己標著一格沒人跑過,逐字:
> 「版控外的 GRANT 總共有幾道」⇒ **只量到這一道**。全庫的 `nspacl` / `relacl` 對版控做差集 ⇒ **沒有人做過**。
> ⚠️ **所以這一列是【一個實例】,不是【一份清單】。**
>
> **這一份把它從【一個實例】變成【一個有界的數字】。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 一、先複量:板上那三批讀數今天還成立嗎

板列自己標了「**`-account` 沒有複量**」「**`-ship` 沒有重跑任何一發讀數**」⇒ 連續兩個窗都是轉述。**今天複量。**

| 板上寫的 | 2026-09-10 複量 | 判 |
|---|---|---|
| `cron` 的 nspacl 含 `pcm_readonly=U/postgres` | `supabase_admin=UC/... \| postgres=U*/... \| pcm_readonly=U/postgres` | ✅ **還成立** |
| 對照:`net` 第二條 grantee 空的 = PUBLIC | 第二條逐字 `=U/supabase_admin` | ✅ **還成立** |
| `pcm_readonly` 在 `pg_shdepend` **82** 列 | **86** 列 | 🔵 **成立而數字長大了**(+4) |
| 🟢 正對照 `postgres` **517** | **527**(+10) | ✅ 尺會咬 |
| ⚪ 負對照 現造角色名 | **0** | ✅ |
| `pcm_readonly` 有 `BYPASSRLS` | `rolbypassrls = true` | ✅ **還成立** |
| 角色層 `default_transaction_read_only` | `rolconfig = default_transaction_read_only=on` | ✅ **還成立** |

🛑 **而我第一發的正對照是死的,修了**:我拿 `postgres:rolsuper` 當「尺印得出 true 嗎」的對照 —— 而**這個庫裡 `postgres` 不是 superuser**(Supabase 就是這樣),所以那一發印 `false`,證不到尺會印 true。
✅ 改量「這個庫裡 `rolsuper=true` 的有幾個」⇒ **1 個**;`rolbypassrls=true` 的 ⇒ **6 個**(`pcm_readonly` · `postgres` · `service_role` · `supabase_admin` · `supabase_etl_admin` · `supabase_read_only_user`)⇒ **尺確實印得出 true,是我挑錯對照角色。**

---

## 二、🔴 板上這一列有一格是舊的:**GRANT 其實已經有人搬進版控了**

板上只知道 `20260902210000`(標 `pcm:never-apply`)。
【量的】而還有一支:**`20260905160000_m4b_pcm_readonly_role_and_grants_into_version_control.sql`** —— 檔名就叫「進版控」,**沒有 never-apply 標記**。

· 它是**補版控型**(檔頭 `-- pcm:ddl-into-vc`)⇒ 帳本那一列自己寫著:**「物件存在」對「這支檔跑過沒」是零判別力**。
· 它**刻意不建 `BYPASSRLS`**(檔內 `:46` 逐字:空庫上建出來的是 `NOLOGIN` 空殼,**它沒有 `BYPASSRLS`**),並且**刻意放行**正式庫那顆 `LOGIN + BYPASSRLS` 的同名角色(`:59-60`)。

⇒ 📌 **所以板上那句「拿版控從零重放,建不出這個世界」【今天仍然成立】,而現在它是【刻意的】不是【遺漏的】。** 那支檔自己寫了為什麼。

---

## 三、🎯 那格沒人做過的差集 —— 做了,而答案不是「一道」

### 3-1 先把範圍收乾淨:哪些角色是「我們的」

【量的】全庫所有出現在 ACL 裡的 grantee(schema 層 + `public` 表層 + `public` 函式層):

```
postgres 1036 · service_role 375 · pcm_readonly 75 · authenticated 55
payment_confirmer 45 · anon 31 · supabase_admin 20 · PUBLIC 10
dashboard_user 6 · pg_database_owner 2 · supabase_realtime_admin 2
supabase_storage_admin 2 · supabase_auth_admin 2 · supabase_functions_admin 1
```
⇒ 14 個。其中 **12 個是 Supabase 平台角色**(平台建的,本來就不在我們版控裡)。
⇒ **真正屬於我們的只有兩個:`pcm_readonly` · `payment_confirmer`。**
· 【量的】`payment_confirmer` 的 `CREATE ROLE` 在 `20260611120000_m3_s2c_confirm_payment_rpc.sql:62`,**無 never-apply** ⇒ **在版控裡**。
· ⚪ 負對照:現造角色名的 `CREATE ROLE` ⇒ **0**。

### 3-2 schema 層 —— **這一層量完了,是 3 道,其中 1 道在版控外**

【量的】我們那兩個角色在 schema 層拿到的全部:
```
payment_confirmer | public | USAGE
pcm_readonly      | cron   | USAGE     ← 🔴 版控外
pcm_readonly      | public | USAGE
```
【量的】全 migrations 找 `GRANT … ON SCHEMA cron …` ⇒ **命中 0**。
🟢 正對照:同一把尺找 `ON SCHEMA public` ⇒ **3** ⇒ 尺會咬。

⇒ ✅ **schema 層的差集是【完整清單】:3 道裡有 1 道在版控外,就是板上點名的那一道。**

### 3-3 🔴 表層 —— **這一層才是重點,而它不是一道,是六十三道**

| | 讀數 |
|---|---|
| **正式庫**:`pcm_readonly` 有 SELECT 的**相異表** | **72 張** |
| **版控**:全 migrations 裡 `GRANT … TO pcm_readonly` 點名的**相異表** | **12 張**(14 條 GRANT 語句) |
| 🟢 正對照:`service_role` 在正式庫的相異表 | **90 張** ⇒ 尺會咬 |

版控點名的那 12 張逐字:
```
admin_order_list_v · order_pending_refunds · orders_deleted_log · pcm_acl_drift_status
pcm_acl_snapshot_digest · pcm_auth_provider_of · pcm_settle_retry_attempts
product_fitments_effective · product_fitments_effective_staging
product_fitments_effective_sync_log · search_queries · supplier_sync_runs
```

⛔ ~~72 − 12 = 60~~ 🔴 **那個減法是錯的,而它看起來完全正常。**
【量的】實際做集合比對(不是相減):

```
① 版控點名 12 張裡, 正式庫【也有】的            9
② 版控點名而正式庫【沒有】的                    3
   是哪幾張  pcm_auth_provider_of · pcm_settle_retry_attempts · supplier_sync_runs
③ 🔴 正式庫有而版控沒點名的(真正的差)         63
🟢 正對照:prod 總數(必須 72)                   72   ⇒ 尺會咬
```

⇒ 🔴 **真正的答案是 63 張表,不是 60。**
📌 **為什麼會差 3**:版控點名的 12 張裡有 3 張**正式庫的 ACL 裡根本沒有**
(那三支 migration 沒 apply 或那些物件還不存在)⇒ **它們不在被減的那一堆裡,減法卻把它們減掉了。**
🎯 **而 60 這個數字看起來完全正常** —— 它有兩個真實的分母、一個合法的減法。
**只有真的去做集合比對才問得出來。** 📌 今天第 N 次:**一個算出來的數,與一個量出來的數,印同一個字。**

🛑 **而這把尺我先確認過它不會歪**:版控裡若有 `GRANT … ON ALL TABLES IN SCHEMA …` 或 `ALTER DEFAULT PRIVILEGES`,我按表名數就會嚴重低估。
【量的】對 `pcm_readonly` 找那兩種形狀 ⇒ **命中 0**;🟢 正對照:全庫 `ON ALL TABLES` 字面 ⇒ **1** ⇒ **尺會咬,而 `pcm_readonly` 真的沒有走那條路。**

---

## 四、⇒ 這一列的狀態要改

| 板上寫的 | 今天量到的 |
|---|---|
| 「版控外的 GRANT **只量到這一道**」 | 🔴 **schema 層 1 道 + 表層 63 張** —— 而 schema 層那一層**是完整清單** |
| 「這一列是【一個實例】,不是【一份清單】」 | 🔵 **對 `pcm_readonly` 而言,清單量出來了。** 對全庫仍不是(見下) |
| 「拿版控從零重放,建不出這個世界」 | ✅ **仍成立**,而現在**是刻意的**(`20260905160000:46,59-60` 自己寫了理由) |
| 關閉條件 ② 「那個狀態進了版控」 | 🟡 **一半**:12 張表 + `public` USAGE 進了;**63 張表 + `cron` USAGE + 角色屬性沒進** |

---

## 五、🛑 我證不到什麼

· **【證不到】那 63 張是誰、什麼時候、為什麼授的** —— 關閉條件 ① 仍然沒答。我只證了「它們不在版控裡」。
· ⛔ ~~【證不到】那 12 張是不是 72 張的子集~~ ⇒ ✅ **量了**(見 §3-3):12 張裡只有 9 張在正式庫,真正的差是 **63**。
· **這仍然【不是全庫的差集】** —— 我只做了**我們自己那兩個角色**。平台 12 個角色(`postgres` 1036 條、`service_role` 375 條…)**沒有做**,理由是它們本來就不由我們的版控建。
  🛑 **而那個理由是【推的】** —— 我沒有證「平台角色的 ACL 都是平台給的」,可能有某一道是我們自己 GRANT 上去的。
· **【證不到】`payment_confirmer` 的表層 45 條有幾條在版控外** —— 這一份只做了 `pcm_readonly` 的表層。
· **【證不到】函式層** —— `pcm_readonly` 有 1 條、`payment_confirmer` 有 43 條,**都沒做**。
· 關閉條件 ④(「寫不進去」從設定值升成示範過的阻擋)**沒動** —— 那要真的試寫,而唯讀與 apply 是兩個授權。

---

## 六、⇒ 我判:**這一列仍然成立,而它現在有一個數字**

🔵 **不是「不成立⇒不修」,也不是「成立⇒立刻修」。**
· 板上那句「只量到這一道」**已經不對** ⇒ 要改。
· 而「該不該把那 63 張搬進版控」是一個**決定**,不是一個量測 ⇒ 那要 plan + Sean(碰 GRANT ⇒ 鐵則 8)。
· 🛑 **本份只量,沒有寫 plan,也沒有動任何 GRANT。**

**正式庫零寫入。**
