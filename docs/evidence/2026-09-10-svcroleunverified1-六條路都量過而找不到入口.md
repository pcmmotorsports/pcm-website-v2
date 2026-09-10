# 2026-09-10 `⟦f3-SVCROLEUNVERIFIED1⟧` —— **剩下那個限定關不掉,而我第一版把「找不到入口」寫成了「沒有入口」**

> 🔴 **本檔的每一個數字,後面要跟著它的【母體】。跨 repo 的數字不與本 repo 的數字比對,除非兩邊的母體被逐字寫出來。**
> (主視窗 2026-09-10 交代 —— 不是新規矩,是把今天撞了五次的那件事寫在最容易再撞的那扇門上。)

> 板列的關閉條件逐字:**「一發唯讀正式庫 probe(Sean 2026-09-01 已授權唯讀)」**。
> 2026-09-08 `-ship` 跑過、主視窗 A 裁 `⟨不擋⟩` 並寫下**三個限定**;`-db` 補掉「欄級沒量」⇒ **剩兩個**。
> 板上 2026-09-09 `B` 標的仍是 **🔴仍未做 · 卡在 🔧我們**。

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**
🔬 **可重跑的 SQL 全文**:`docs/probes/2026-09-10-svcroleunverified1-recheck.sql`(五段,本檔每個數字都出自它)。

---

## 〇、✅ 開檔前那句推測,**這次對了,而且是逐位對上**

我在 `…rlsharden-第三例…` §6 標了「**開檔前不要引用**」:
> **推的**:它講「`service_role` 讀得到那兩張表只在 mock 驗過」,而我今天量過八格是 `10000111` ⇒ **那可能是同一組受詞。**

【量的】板列 09-08 記的 `relacl` 逐字是 `service_role=rxtm`,而 `rxtm` = SELECT / REFERENCES / TRIGGER / MAINTAIN。
今天複量(順序 `SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN`):
```
orders       t f f f f t t t   ⇒ 10000111
order_items  t f f f f t t t   ⇒ 10000111
```
⇒ ✅ **同一組受詞,而 `rxtm` 與 `10000111` 是同一件事的兩種寫法。**

📊 **命中率更新**:③❌ ④✅ ⑤❌ ⑥✅ ⑦✅ ⇒ **三對兩錯。**
🎯 **它的價值不是命中率** —— 是那五次裡的兩次,**在被引用之前就被擋住了**。

---

## 一、【量的】表權層複量(唯讀,`session_user = current_user = pcm_readonly` · `transaction_read_only = on`,零寫入,`ON_ERROR_STOP on`,零 ERROR)

**母體 = `public.orders` 與 `public.order_items` 兩張表,以 `pcm_readonly` 讀系統目錄。**

| 量什麼 | 板上 09-08 | 今天 09-10 | |
|---|---|---|---|
| `relacl` 逐字 | `{postgres=arwdDxtm, service_role=rxtm, authenticated=r, pcm_readonly=r}` | **逐字相同** | ✅ |
| `relacl_is_null` | `f` | **`f`** | ✅ |
| RLS 開著 / forced | `t` / `f` | **`t` / `f`** | ✅ |
| `service_role` SELECT / INSERT / UPDATE | `t` / `f` / `f` | **`t` / `f` / `f`** | ✅ |
| ⚪ 負對照 `anon` SELECT | `f` | **`f`** | ✅ |
| 🟢 正對照 `authenticated` SELECT | `t` | **`t`** | ✅ |
| 欄數 | 42 / 13 | **42 / 13** | ✅ |
| 🔴 那兩張表的**欄級** ACL | 0 / 0 | **0 / 0** | ✅ |
| `service_role.rolbypassrls` | `t` | **`t`** | ✅ |
| ⚪ 負對照 `anon` / `authenticated` `rolbypassrls` | `f` / `f` | **`f` / `f`** | ✅ |
| 🟢 補量 `service_role` 對 `public` 的 schema `USAGE` | — | **`t`** | ✅ |
| ⚪ 負對照 現造表名 | — | **0 列**(不是噴錯) | ✅ |

### 🛑 而這一段答的是【權限】,不是【行為】—— 這句話不能省

板列原本的失敗情境逐字:「表頭或品項查詢失敗 ⇒ 付款信整批 fail-closed、route 回 503」。

· **【量的】** 目錄顯示 `service_role` 對這兩張表有 `SELECT` **表權**、對 `public` 有 schema `USAGE`、且 `rolbypassrls = t`。
· **【推的】** 目前**沒看到**「缺表權」或「被 RLS 濾掉」這兩個阻礙。
· 🔴 **【證不到】實際查詢會成功、付款信會寄出、route 不回 503** —— **那是行為,本檔一列都沒有真的讀。**

📌 **我第一版把這一格寫成「今天仍然不會發生」。那是把權限讀數升格成行為保證,已收窄。**(codex 2026-09-10 must-fix ②)

---

## 二、🎯 限定②:**我找不到入口,而「找不到」不等於「沒有」**

主視窗 A 2026-09-08 限定②逐字:
> 🔴 **沒有真的用 `service_role` 去 SELECT 一列** —— 問的是**權限**,不是**行為**。

板列同時寫著關閉條件是「**一發唯讀 probe**」。📌 **那兩句對不起來,我去量了為什麼。**

### 【量的】我逐條排除的路(母體 = 這條 `pcm_readonly` 唯讀連線)

```
① 直接登入          service_role.rolcanlogin                        f
② 成員關係          pg_has_role('pcm_readonly','service_role','MEMBER')   f
③ SET ROLE 資格     pg_has_role('pcm_readonly','service_role','SET')      f   ← 正確的那把尺
                    🟢 正對照 pg_has_role(自己,自己,'SET')                 t   ⇒ 尺印得出 t
④ SET SESSION AUTH  session_user = pcm_readonly, 而它 rolsuper = f
⑤ 我繼承到什麼      pg_auth_members 查 pcm_readonly 的上游             0 列
⑥ SECURITY DEFINER  owner 是 service_role 的 secdef 函式               0 支
                    🟢 正對照 全庫 secdef 逐 owner: postgres 153 · supabase_admin 3
                    ⇒ 尺看得到 secdef, 而【沒有任何一支的 owner 是 service_role】
service_role 的成員總共只有:  authenticator(PostgREST 那條路) · postgres(owner 那條路)
```

🔵 **③ 這一格是 codex 訂正的**:我第一版用 `USAGE` 判 `SET ROLE` 資格,而**判 `SET ROLE` 該查 `'SET'`**。
📌 **今天三把尺(`MEMBER` / `USAGE` / `SET`)都印 `f`** —— 而**若只跑我原本那把,我會拿到同一個答案而不知道它為什麼對。**

### ⇒ 措辭:**「目前找不到可用入口」**,不是「沒有入口」

· ✅ **已量到排除**:直接登入 · 成員關係 · `SET ROLE` 資格 · `session_user` · 繼承 · `service_role`-owned SECURITY DEFINER。
· 🛑 **【證不到】不存在任何路徑** —— 我沒有逐支讀那 156 支 `secdef` 函式的函式體。
  🔵 而它們的 owner 是 `postgres` / `supabase_admin`,**以那個身分讀不等於以 `service_role` 讀** ⇒ 那種呼叫**答不出限定②要的那件事**。
  🔵 我對其中 **1 支** 有 `EXECUTE`(母體:153 支 postgres-owned)⇒ **量得到的入口只有這 1 支,而它的身分不是 `service_role`。**
· 🛑 **新建函式 / 改 owner / 補 GRANT 全部超出授權**(唯讀與 apply 是兩個授權)。

⇒ 🎯 **所以正確的話是**:板列那句「一發唯讀 probe 就能關」,**對【表權那一層】成立**;
📌 **而限定② 我今天沒有找到任何仍在唯讀授權內的入口 —— 而剩下唯二量到的入口 `authenticator` / `postgres` 都在 API / owner 那一側。**
🔵 **⇒ 傾向(【推的】,不是結論):它掛在「有人真的走一遍後台」那件事上。**

---

## 三、🔴 而我今天撞到【兩個 64】,而我第一版用減法「驗證」了它 —— 那不是驗證

· 板上 09-08 的 `53 + 11 = 64`,母體 = **當時 `public` 一般表【總數】**。
· 我今天早上在 `⟦db-RLSHARDENZEROROWS⟧` 量的 `64`,母體 = **全庫「有 `SELECT` 權 × RLS 開著」的表數**。

🔴 **兩個 64,兩個母體。而我差點把它讀成「兩天沒動」。**

### 🛑 而我第一版寫「`54 + 10 = 64` ⇒ 反過來把早上那個 64 又驗了一次」—— **那是恆等式,不是量測**

📌 **那 10 是我用 `64 − 54` 減出來的。** 🎯 **⇒ 今天第五次「一個算出來的數與一個量出來的數印同一個字」,而這一次我還把它當成證據。**(codex nit ①)

### ✅ 所以我回去【獨立量】,而量出來的第一發是 **63,不是 64**

```
我這一發(relkind = 'r')                     全庫 63  = public 54 + 非 public 9
早上那一發 / 09-09 那份                       全庫 64
```
🔴 **差一張。而查出來差在【尺】不是【庫】:**
```
同條件, 只換 relkind 集合:  'r' = 63  ·  'r','p' = 64  ·  全 relkind = 64
多出來的那一張:  realtime.messages   relkind = 'p'(分割表)
🟢 交叉驗:全庫 RLS 開著的表  'r' = 92 · 'r','p' = 93  ⇒ 同一張, 同一格差異
⚪ 負對照 現造 relkind 'Z' ⇒ 0
🔵 public 一般表:'r' = 66 = 'r','p' = 66  ⇒ public 裡沒有分割表 ⇒ 54 那個數不受影響
```
📌 **⇒ 是我這一發自己加的 `relkind='r'` 靜靜地少數一張分割表。** 🎯 **一個看起來正常的輸出,由好幾種原因產生 —— 這次的原因是我自己。**

### ✅ 補上獨立量:非 `public` 那 10 張逐張列名(母體 = 全庫,`relkind IN ('r','p')`,RLS 開,`service_role` 有 SELECT)

```
cron.job · cron.job_run_details
realtime.messages (p)
storage.buckets · buckets_analytics · buckets_vectors · objects
storage.s3_multipart_uploads · s3_multipart_uploads_parts · vector_indexes
⇒ 共 10 張, 【逐張列出來的, 不是減出來的】
```
⇒ ✅ **`54 + 10 = 64` 這次兩邊都是量的。**

🛑 **而它仍然【不是】那份 plan §4-B 的那個 10** —— 那個 10 的母體是「收 `BYPASSRLS` 後真的會變零列」,**含 2 張 `public` 表**(`payment_webhook_events` / `admin_sso_login_events`)。
🎯 **⇒ 同一份報告裡,三個不同母體各自答出一個 10 或 64。**

---

## 四、🟡 而板上那個「印全集」的正對照,今天印出來是五族不是三族 —— 而**我證不到誰對**

板列 09-08 `-db` 那格逐字說它「全庫 `pg_attribute.attacl IS NOT NULL` **印全集**」,列了**三族**。
【量的】今天同一發(母體 = 全庫 `pg_attribute`,`attacl IS NOT NULL`,`nspname='public'`)是 **49 欄 · 五族**:
```
customers 6 欄(多一個 email {service_role=w}) · pcm_settle_retry_attempts 4 欄
products 20 欄 · product_variants 11 欄
🆕 staff 3 欄 {service_role=w}   · 🆕 supplier_sync_runs 5 欄 {pcm_readonly=r}
```
【量的】五族在版控裡**都有出處**(剝整行註解後掃 `supabase/migrations/*.sql`;🟢 正對照:含 `GRANT` 的 migration **302 支** ⇒ 尺會咬):
```
customers  email                       20260908100000  ← 對得上 Sean 0908 拍甲「後台可改客人信箱」
staff      label/is_manager/is_active  20260726120000
supplier_sync_runs 五欄                 20260906380000
```

🛑 **而我第一版由此斷定「那次的全集不是全集」。收回。**(codex must-fix ③)
📌 **檔名日期證不了三件事**:當時貼了沒 · 之後有沒有被 REVOKE 再重授 · 板上那三族是不是抄寫時的摘要。
⇒ ✅ **能說的只有**:**今天是五族,板上 09-08 的文字是三族;差異的成因我分不出來。**
🔵 而**本列的結論不受影響** —— `orders` / `order_items` 的欄級今天仍是 **0 / 0**,而**尺確實看得到欄級**(49 欄非 0)。

---

## 五、⇒ 這一列今天的狀態

| 板上寫的 | 今天 |
|---|---|
| 「只在 mock 驗過,沒在正式庫驗過」 | ✅ **表權層不成立** —— 09-08 驗過,今天複量逐格對上 |
| 失敗情境「付款信整批 fail-closed、route 回 503」 | 🟡 **權限層看不到那個阻礙** —— 而**行為沒驗**,不寫成「不會發生」 |
| 限定① 表權 ≠ RLS policy | ✅ **已答**(`rolbypassrls=t`;那是 `⟦0e-RLSLIVE1⟧`/`⟦b9-RLSHARDEN⟧` 的題) |
| 限定③ 是 `pcm_readonly` 問的目錄讀數 | 🟡 **今天仍是** —— 而目錄題用唯讀就是對的工具 |
| 🔴 限定② 沒有真的用 `service_role` 讀一列 | 🛑 **今天沒找到唯讀範圍內的入口**(六條路逐條量過)—— **而「找不到」不是「沒有」** |
| 關閉條件「一發唯讀 probe 就夠」 | 🔴 **只夠表權那一層** |
| `service_role` 的 `MAINTAIN`/`TRIGGER` 該不該有 | 🛑 **本份不判** —— 與 `⟦b9-SRVMIN⟧` ④ 同題,那一列的 plan 等 Sean |
| 「只有讀,而『只有讀』對 `orders` 就是 PII 面」 | ✅ **仍成立**,沒有被這份的「乾淨」蓋過去 |

⇒ 🛑 **沒寫 plan、沒動任何權限、沒改板、正式庫零寫入。**

---

## 六、🛑 我證不到什麼

· **【證不到】`service_role` 真的讀得出一列** —— §2:六條路逐條量到 `f`/`0`,而**我沒有逐支讀 156 支 `secdef` 函式的函式體**。
· **【證不到】付款信這條路今天真的會通** —— 本檔量的是權限,不是行為。
· **【證不到】那五族欄級授權在 09-08 當天的庫上是什麼樣** —— 檔名日期不是套用日期;`supabase_migrations` 仍 `permission denied`。
· **【證不到】`public` 一般表為什麼從 64 變 66** —— 我只能說**淨增 2**,**沒有比對物件清單**,不排除有刪有加。
· **只量了兩張表的欄級**;其餘 64 張沒逐張看。
· 🛑 **本檔讀數有到期日** —— 它們說的是 **2026-09-10 這一刻**。

---

## 七、🔗 接手用(2026-09-10 存檔)

· **隊列**:主視窗第三輪 3 列 **全部做完**。① `⟦db-RLSHARDENZEROROWS⟧` ✅ · ② `⟦b9-RLSHARDEN⟧` ✅ · ③ **本檔** ✅
· 🔬 **可重跑的 SQL**:`docs/probes/2026-09-10-svcroleunverified1-recheck.sql`(五段全文,含每一個正/負對照)。**本檔的每個數字都出自它。**
· 🔵 **主視窗 2026-09-10 判:限定② 不端 Sean** —— 理由是 `CLAUDE.md` 已有逐字「做完的定義只有一個:Sean 自己開瀏覽器從頭走到尾」,
  而他**本來就要走那一遍** ⇒ 端他等於問他要不要做他本來就要做的事。
  ⇒ ✅ **這一列的狀態寫成:「表權那一層關了;剩的那半掛在 Sean 上線前走後台那一遍,不另外排工。」**
  🛑 **板子由主視窗改,不是我。**
· 🎯 **本檔自己踩過的兩格,寫給下一個人**:
  ① **`relkind='r'` 會靜靜少數分割表** —— 今天 `realtime.messages` 一張,把 64 變成 63。
  ② **一個減出來的數,不能拿去驗證它被減出來的那個數。**

**正式庫零寫入。沒改板、沒動任何權限。**
