# `service_role` 消費者全數盤點 —— `⟦b9-RLSHARDEN⟧` 的分母

> 線【身分】`-auth` · 2026-09-05 · 主視窗 `-94` 派(補我自己在 `⟦b9-RLSHARDEN⟧` 前置盤點寫下的「證不到②」)
> 🛑 **只盤不改。零 apply、零 `REVOKE`、零拍板。**
> 🔴 **本檔讀的是 `origin/dev`(`939c7ecf8`)的內容,不是我工作樹的** —— 為什麼見 §0。

---

## 0. 🔴🔴 先讀這段:**我上一份盤點的分母是錯的,而它錯了一個量級**

我 2026-09-05 交的 `⟦b9-RLSHARDEN⟧` 前置盤點寫「分母 = email/cron 那 **7 個物件**」,結論「**0 條會擋**」。
⇒ 🛑 **那個結論對【那 7 個】仍然成立,而【7 這個分母】把 `apps/admin` 整個漏掉了。**

🔬 **怎麼發現的**(不是想到的,是撞到的):主視窗給我一支 migration 檔名,而我 `ls | grep 270000` **零命中**。
以為是 grep 那族的靜默不匹配 ⇒ 用 python 再撈一次 ⇒ **也是 0**。
⇒ 跑 `scripts/where-is.sh` ⇒ **它在 `dev` 上,不在我的 checkout 裡** ⇒ 量一發:

```
git merge-base --is-ancestor origin/dev HEAD   ⇒ 假
git rev-list --left-right --count origin/dev...HEAD   ⇒ 落後 202 / 領先 6
```
🎯 **⇒ 我的工作樹落後 `origin/dev` 202 顆。**
而我上一份盤點的**碼那一半就是在這棵樹上讀的** ⇒ 📌 **`email/composition.ts` 在 dev 上多了 28 行,
`packages/adapters/src/email/` 底下多了一支我從沒看過的 `SupabaseTrackingCorrectedScannerAdapter.ts`(121 行)。**

🔴 **⇒ 教訓不是「我忘了 pull」** ——
**是「在一棵落後的樹上做全稱盤點,產出的每一個【查無】都是假的,而它們讀起來與真的一模一樣」。**
✅ **⇒ 本檔改用 `git archive origin/dev | tar -x` 解到 `/tmp` 再掃**,不靠 checkout。
🟢 **正對照**:解完之後那支 migration **撈得到**(`ls | grep -c 270000` ⇒ 1)⇒ 證明換的那棵樹是對的。

---

## 1. 分母(數法在下面,可重跑)

```
119  支檔提到 service_role / SUPABASE_SERVICE_ROLE_KEY / PAYMENT_CONFIRMER_DB_URL
 ├─ 60  測試檔                    ← 不進分母(它們不連正式庫)
 ├─ 36  apps/admin  ← 🔴 上一份整個漏掉的那一批。**它們【透過 `createSupabaseServiceClient`
 │                     工廠】消費, 不直接讀 env 名** ⇒ 只認 env 名的尺在這裡會印 0(見 §4c)
 ├─ 12  supabase/migrations       ← 多半是註解 / GRANT 敘述, 不是消費者
 ├─  5  scripts
 ├─  4  apps/storefront           ← 上一份只看了這 4 支裡的 3 支
 └─  2  packages
```
🔬 **數法**(剝註解再數 —— 否則註解裡提到它的也會被算進來):
```bash
git archive origin/dev apps packages scripts supabase | tar -x -C /tmp/devtree
# 然後對 /tmp/devtree 掃三個字面, 逐檔剝掉 // 與 /* */ 再比對
```
⚠️ **`.sh` / `.sql` 那 17 支我【沒有】逐支追它碰哪些表** —— 它們多半是探針與 GRANT 敘述,
**而「多半」不是「全部」** ⇒ 📌 **那 17 支是本檔的已知缺口,不是已經排除。**

---

## 2. 🎯 結論:**拿掉 `service_role` 的 `BYPASSRLS`,會壞的是 3 個物件**

🔬 **這張表的兩半各自的數法**(兩邊都可重跑;**碼那半剝註解,DB 那半唯讀**):
```bash
# 左半(碼要什麼):對 /tmp/devtree 逐檔在 .from('X') 後 240 字元內找第一個動詞
#   ⇒ 產出 23 個物件的需求集合。⚠️ 它會少報, 見 §3①
# 右半(DB 給什麼):唯讀查 pg_policy, 逐物件聚合 service_role 的 polcmd
bash docs/probes/2026-09-05-rlsharden-prereq.sh
```
⇒ 2026-09-05 讀數:**23 個物件**(左半)· 其中 **20 個 policy 已涵蓋** · **3 個沒涵蓋**(下表)。

| 物件 | 碼要的 | RLS | `service_role` policy 給的 | 判定 | 落點 |
|---|---|---|---|---|---|
| `admin_audit_log` | **I**+S | on | 只有 **S** | 🔴 **會壞,缺 INSERT** | `apps/admin/src/lib/orders/order-repository.ts` |
| `admin_sso_login_events` | **I** | on | **一條都沒有** | 🔴 **會壞,缺 INSERT** | `apps/admin/src/lib/sso/login-event.ts` |
| `staff` | **I**+**U**+S | on | 只有 **S** | 🔴 **會壞,缺 INSERT/UPDATE** | `apps/admin/src/lib/staff-repository.ts` |

**其餘 20 個物件 ✅ 不會壞**(`brands` `categories` `email_outbox` `order_items` `order_manual_refunds`
`order_refunds` `orders` `order_item_procurement` `order_item_procurement_receipts`
`order_item_receipt_requests` `payment_charge_attempts` `product_fitments_effective_sync_log`
`product_variants` `products` `shipment_items` `shipments` `suppliers` `sweeper_heartbeat`
+ 2 個 view)—— 它們的 `service_role` policy 已經涵蓋碼要的動詞。

🎯 **而那 3 個的共同形狀值得指出來**:**全是「寫入稽核/紀錄」那一族**(稽核 log、SSO 登入事件、員工異動)。
⇒ 📌 **它們壞掉的樣子不是畫面出錯,是【紀錄靜靜地少一筆】** —— 而那正是最不會被發現的一種壞。

### 🟢 而 26 支 RPC 函式**全部免疫**
🔬 數法(唯讀,一發查完;**分母與命中同一發印出來**,免得只看到一個數):
```sql
select count(*) filter (where prosecdef) as definer,
       count(*) filter (where not prosecdef) as invoker,
       count(*) as 對得上幾支
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (<那 26 支>);
```
⇒ 2026-09-05 讀數:`26 | 0 | 26` —— **碼裡 26 支、庫裡對得上 26 支、invoker 0**。
🟢 那個「對得上幾支 = 26」就是正對照:**若函式改名了,它會小於 26 而不是安靜地全 definer。**
⇒ `SECURITY DEFINER` 以 owner 身分執行 ⇒ **呼叫端有沒有 BYPASSRLS 不影響它們。**

---

## 3. 這份盤點證不到什麼(**這一節比 §2 重要**)

```
①🔴 我的動詞抽取【會少報, 而少報的方向就是漏掉會壞的】
   做法:在 .from('X') 之後 240 字元內找第一個動詞
   ⇒ 鏈得比較遠、或同一個 from 後面接兩個動詞的, 我只拿到第一個
   🔬 而這【不是假設, 是實例】:cron 的 sweeper_heartbeat 我抽到 S,
      而它實際是 .upsert()(= I+U)。這一格結論沒變(policy 給了 ISU),
      而它證明那個方向的漏報真的存在。
②🔴 .sh / .sql 那 17 支沒有逐支追表(§1)
③ 兩個 view(admin_order_list_v · order_refund_effective_verdict)
   RLS 不掛在 view 身上 ⇒ 要看底層表, 我沒有追
④ 沒有實跑「拿掉 BYPASSRLS 之後 admin 還能不能建單」
   ⇒ 那要 apply, 不在授權內 ⇒ 本檔是【碼面掃描 + 授權實查】, 不是端到端驗證
⑤ 非字面 .from(變數) 我掃了一發:3 處, 其中 1 處是 Array.from 的誤命中、
   2 處是 HEARTBEAT_TABLE(已在表內)⇒ 這個盲區【這次是小的】,
   而它會隨著有人改用常數而變大
```
🛑 **①②③④ 每一條的偏向都是【少報會壞的】** ⇒ 📌 **這張表的 3 是【下界】,不是總數。**

---

## 4. 對 `⟦b9-RLSHARDEN⟧` 的意思

```
① 那一刀【不是不能下】—— 23 個物件裡 20 個已經有寫明的 policy
② 而要先補 3 條 policy(admin_audit_log INSERT · admin_sso_login_events INSERT · staff INSERT+UPDATE)
③ 補完【再】拿掉 BYPASSRLS —— 順序反了的話, 那三處會【安靜地少寫紀錄】
④ 補 policy 本身 = 動 RLS = 鐵則 12② ⇒ 要 Sean 拍板 + codex
```
🔴 **而 ③ 的「安靜」要寫進 plan 的驗收**:那三處失敗時**不會噴 500**,
PostgREST 對 RLS 擋掉的 INSERT 回的是 **0 列成功**或 42501,而**呼叫端有沒有檢查回傳,我沒有逐支看**。
⇒ ✅ **驗收要用「拿掉之後那三張表的列數還會不會長」,不是「畫面有沒有壞」。**

---

## 5. 可重跑

```bash
bash docs/probes/2026-09-05-rlsharden-prereq.sh          # RLS / policy 那半(唯讀)
bash docs/probes/2026-09-05-service-role-min-scope.sh     # GRANT 那半(唯讀)
```
⚠️ **兩支 probe 的分母都是【當時那一版的碼】** ⇒ 📌 **碼改了要重跑,而不會有東西提醒你。**

---

## 4. 🔵 缺口 ②③ 補完(2026-09-05 線 `-db`;`⟦b9-SRVCONSUMERGAP⟧`)

> **掃的樹**:`git archive dev | tar -x -C /tmp/devtree`(`dev` = `5c1cd0143`,比 `origin/dev` 新)。
> 🔴 **我第一發解的是 `origin/dev`,而本檔不在上面** ⇒ 查無。而 `where-is.sh` 說「② 在 dev 上」——
> 　 **兩把尺不一致,而兩把都對**:那支工具的「dev」是**本地 dev**。
> 　 📌 **`dev` 與 `origin/dev` 是兩個東西,而它們在一句話裡長得一樣。**

### 4a. 結論:這兩個缺口新增 **2 個**會壞

| # | 物件 | 誰碰它 | 座標 | 動詞 |
|---|---|---|---|---|
| 1 | `brands` | `scripts/storefront-probe/up.sh` | `:330` `:332` | `SELECT` |
| 2 | `payment_refund_events` | `scripts/op6a-verify.sh` | `:275` `:391` | `SELECT` · `INSERT` |

兩張都是 **RLS 開著、而沒有 `service_role` 的 SELECT 政策** ⇒ 收 `BYPASSRLS` 之後**讀到 0**。

🔴 **而嚴重度不一樣,不要合併讀**:兩支都是**驗證腳本**不是顧客路徑 ⇒ 壞的是**我們自己的工具**,畫面不會少東西。
⚠️ 而 `storefront-probe/up.sh` 用的是 **service_role 金鑰**(不是 `SET ROLE`)⇒ 它走 **PostgREST 那一層**;
　 收 `BYPASSRLS` 之後**它會不會壞我沒有實測**,只證得到「那張表沒有政策」。**這一格標未確認。**

### 4b. 缺口③(兩個 view)⇒ 新增 **0** 個

| view | `security_invoker` | 底層表 | 判定 |
|---|---|---|---|
| `admin_order_list_v` | `true` | `orders` · `order_items` · `order_item_quantity_summary` · `order_paid_totals_v` | 前三張**都有** SR 政策;第四張是 view 且 RLS 沒開 |
| `order_refund_effective_verdict` | `true` | `order_refund_manual_corrections` | **有** SR 政策 |

🛑 **而 `order_paid_totals_v` 是一個側門** —— 它 `security_invoker=false`(`VIEWOPT` 族實測)⇒ 用 **owner 權限**跑
⇒ 收 `BYPASSRLS` 之後它**照樣讀得到** ⇒ 這裡不算「會壞」,**而它是 `⟦b9-RLSHARDEN⟧` 收後要逐支判的那 4 支之一**。

### 4c. 🔴🔴 **[2026-09-05 `-auth` 訂正 —— 這一小節原本的結論是錯的,而它會抹掉三個真 finding]**

⛔ ~~`apps/admin` 有 58 支檔提到那三個字面,剝掉註解之後只剩 4 支而全是 `.test.ts`
⇒ **`apps/admin` 沒有任何非測試的 `service_role` 消費者**~~
⛔ ~~而 §1 的分母寫 `36 apps/admin` —— 那是【提到】的數,不是【消費】的數~~

🛑 **那兩句都是假的,而它們會直接抹掉 §2 那三個「會壞」的 finding** ——
**因為那三支落點【全部三支都在 `apps/admin`】。** 兩份不可能都對 ⇒ 當場量。

🔬 **逐字面分開量**(`apps/admin/src` 底下、非測試 `.ts/.tsx`、剝掉註解):
```
SUPABASE_SERVICE_ROLE_KEY     ⇒  0 支
createSupabaseServiceClient   ⇒ 36 支      ← 差別全在這裡
兩者任一                        ⇒ 36 支
```
🎯 **⇒ `apps/admin` 不直接讀 env,它走【工廠】** ——
而那支工廠 `packages/adapters/src/supabase/client.ts:60-63` 逐字
`createClient(..., requireEnv('SUPABASE_SERVICE_ROLE_KEY'))`。
⇒ 📌 **只認 env 名字的尺,在 `apps/admin` 上【必然】印 0,而那個 0 是【尺沒接上】不是【沒有消費者】。**
🟢 **反向驗**:§2 那三支落點(`orders/order-repository.ts` · `sso/login-event.ts` · `staff-repository.ts`)
**逐支都在那 36 支名單裡**。

✅ **⇒ §1 的 `36 apps/admin` 是對的,而【標籤】要說清楚:它們是【透過 `createSupabaseServiceClient` 工廠消費】。**

### 4c-2. 🎯 而這一格值得單獨記:**兩個窗、兩把尺、各自正確地跑完,而結論相反**

```
-db  掃 env 名字      ⇒ apps/admin 0 支  ⇒ 結論「沒有消費者」
-auth 掃工廠函式名     ⇒ apps/admin 36 支 ⇒ 結論「三個會壞」
```
🔴 **兩把尺都沒有壞** —— 它們量的是**兩個不同的東西**,而**兩邊都把自己的答案講成「消費者有幾個」**。
📌 **判別句(比「你掃了幾支」更早分得出來)**:
> **你掃的是【哪個字面】?那個字面與「我要問的行為」之間差幾層間接?**

⚠️ 而 `-db` 那一節其餘的量測(§4a 的 +2、§4b 的 0、§4d 的分母 19)**與這個錯無關,全部收下** ——
🛑 **一個結論錯了不代表那份工作沒有價值,而把整節丟掉才是更貴的錯。**

### 4d. 🛑 這一輪證不到什麼

- **我沒有重現 §1 那個「17 支」** —— 同樣三個字面、同樣四個目錄,我掃到 `.sh`/`.sql` **319 支**。
  ⇒ 我改問一個**更窄而更有意義**的問題:**哪幾支是真的【以 `service_role` 身分動作】**
  (`SUPABASE_SERVICE_ROLE_KEY` / `PAYMENT_CONFIRMER_DB_URL` / `SET ROLE service_role` / `psql -U service_role`)⇒ **19 支**。
  📌 **⇒ 上面那個 +2 的分母是【那 19 支】,不是 17,也不是 319。**
- 表名是**字面抽的**(`FROM|INTO|UPDATE|JOIN` 後面那個識別字)⇒ 動態 SQL、變數表名、`format(%I)` 我看不到。
- **我沒有實跑** —— 沒有真的收掉 `BYPASSRLS` 再跑那 19 支。本節全部是**靜態比對 + 唯讀查 policy**。

🛑 **①②③④ 每一條的偏向都是【少報會壞的】** ⇒ 📌 **這張表的 3 是【下界】,不是總數。**

---

## 4. 對 `⟦b9-RLSHARDEN⟧` 的意思

```
① 那一刀【不是不能下】—— 23 個物件裡 20 個已經有寫明的 policy
② 而要先補 3 條 policy(admin_audit_log INSERT · admin_sso_login_events INSERT · staff INSERT+UPDATE)
③ 補完【再】拿掉 BYPASSRLS —— 順序反了的話, 那三處會【安靜地少寫紀錄】
④ 補 policy 本身 = 動 RLS = 鐵則 12② ⇒ 要 Sean 拍板 + codex
```
🔴 **而 ③ 的「安靜」要寫進 plan 的驗收**:那三處失敗時**不會噴 500**,
PostgREST 對 RLS 擋掉的 INSERT 回的是 **0 列成功**或 42501,而**呼叫端有沒有檢查回傳,我沒有逐支看**。
⇒ ✅ **驗收要用「拿掉之後那三張表的列數還會不會長」,不是「畫面有沒有壞」。**

---

## 5. 可重跑

```bash
bash docs/probes/2026-09-05-rlsharden-prereq.sh          # RLS / policy 那半(唯讀)
bash docs/probes/2026-09-05-service-role-min-scope.sh     # GRANT 那半(唯讀)
```
⚠️ **兩支 probe 的分母都是【當時那一版的碼】** ⇒ 📌 **碼改了要重跑,而不會有東西提醒你。**

---

## 5. 🔴🔴 **[2026-09-05 · 用【版控裡已有的窄判準】重做 —— 而它訂正了 §2**

> 主視窗 `-94` 派(R3 推翻前提之後)。**只讀,零 apply。** 掃的樹 = `git archive origin/dev`(`c624bc557`)。
> 🟢 正對照:解完拿 `20260904270000` 撈 ⇒ 命中 1;migration 共 315 支。

### 5a. 🛑 §2 的「20 個已涵蓋」是用【寬判準】算的 —— 舊結論加刪除線

⛔ ~~23 個物件裡 **20 個已有涵蓋的 policy**,缺的是那 3 張~~
🔴 **那把尺不看 `polqual`,還把 `polroles='{0}'`(PUBLIC)算成 service_role 覆蓋。**
🔬 **而正確的判準【2026-09-04 就寫在版控裡】,比我早一天**——
`supabase/rls-service-role-select-exclusions.txt:12-15` 逐字:
> ⛔ ~~扣完實測剩 36~~ **已作廢(codex R2)**:那是用【寬判準】算的。判準收窄成
> 「**PERMISSIVE 且 `qual` 是 `true`/NULL**」之後,扣完實測 **40** —— 多的 4 張是目錄表
> (`products` / `product_variants` / `product_fitments` / `product_fitments_effective`),
> 它們現有的 policy 帶 `delisted_at IS NULL` 過濾 ⇒ **收 BYPASSRLS 之後後台會看不到 559 筆下架商品。**

🎯 **⇒ 我 09-05 用一把更寬的尺重做了一遍、得到更樂觀的答案,而且沒有先去看它。**

### 5b. ✅ 主視窗問的三張表,逐張回答

| 表 | 在 `20260904270000` 的哪一邊 | 那支給了什麼 | **本片(第 0 步)還缺什麼** |
|---|---|---|---|
| `admin_audit_log` | **期望名單(40 張)之一** | `admin_audit_log_select_service_role`(`:345` `FOR SELECT … USING (true)`) | **缺 INSERT** |
| `staff` | **期望名單之一** | `staff_select_service_role` | **缺 INSERT + UPDATE** |
| `admin_sso_login_events` | **排除清單(5 張)之一** | **什麼都不給**(理由逐字「寫進去就不再讀」) | **缺 INSERT** |

🔬 **數法**(`git archive origin/dev` 之後,對那支 migration 抽兩個錨之間的 `('name')`):
排除清單 **5** 張 · 期望名單 **40** 張;三張逐一比對如上表。
🎯 **⇒ `20260904270000` 管的是 `polcmd IN ('r','*')`(`:152` `:180` `:297`)= 【只有 SELECT】。**
✅ **⇒ 本片補的 INSERT/UPDATE【不是重工】** —— 那半在版控裡確實沒有人做。
🔵 而 `admin_sso_login_events` **不需要 SELECT**:R3 獨立確認 `login-event.ts:209,253` 兩發 insert **都沒鏈 `.select()`**。

### 5c. 🔴🔴 而 F4 的【責任歸屬換了】—— 那兩支漂移偵測器不是被我弄紅的

```
supabase/migrations/20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql:129
  RAISE EXCEPTION 'D0 異常 — admin_audit_log 應為零 policy,實 % 條;拒繼續'
supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:60
  「4. RLS zero-policy + table ACL(client 全鎖、server 最小權限)」
```
🎯 **而 `admin_audit_log` 與 `staff` 都在 `20260904270000` 的【期望名單】裡**
⇒ 📌 **那一支貼下去就會給它們各一條 SELECT policy ⇒ 那兩個「應為零 policy」的斷言【在那一刻就已經不成立】,與本片無關。**
🔬 而 `20260904270000` 全檔 **零處**提到 `20260815020000` / `20260726120000` / 「零 policy」
(數法:`grep -nE '20260815020000|20260726120000|零 policy|zero-policy'` ⇒ 0 命中)。
🛑 **⇒ 那是一個【還沒有人接的接縫】,而它比本片早。** 本片會讓它更明顯,**而不是它的成因**。
⇒ ✅ **「零 policy 縱深要不要正式退場」仍然是拍板題**,而**該問的人不只是本片的作者**。

### 5d. ⚠️ 本節證不到什麼

```
① 我沒有查 20260904270000【貼了沒】—— 帳本的 0 不是答案(CLAUDE.md 路由逐字),
   而 is-migration-applied.sh 要唯讀連線, 本節是純碼面比對 ⇒ 未確認。
   📌 而它決定 5c 是「已經發生」還是「將要發生」。
② §2 那張表其餘 20 個判定, 我【沒有】用窄判準逐一重算 —— 本節只回答被問的三張。
   ⇒ 5a 已證明那把尺是寬的 ⇒ 🔴 那 20 個裡有幾個是錯的, 沒有人量過。
③ 目錄表那 4 張(products 等)的影響本節沒追 —— 它在 exclusions.txt 裡已有結論。
```

---

## 6. 🔬 **窄判準重算全部 23 個(2026-09-05,主視窗派的 ②)**

**判準【抄自】`supabase/migrations/20260904270000…:292-301`,不是我自己造的** ——
`PERMISSIVE` 且 `polqual IS NULL / 'true' / '(true)'` 且 `polroles` 含 PUBLIC(0) 或 `service_role`。
🟢 同一發把**寬尺**(我 09-05 用的、不看 qual)與**窄尺**並排印出來,才看得到差在哪。

```
物件                                   kind RLS  寬尺   窄尺   判定
admin_audit_log                        r    t    S      S      缺 I(第 0 步要補)
admin_order_list_v                     v    f    —      —      🔴 見下方 [R4 A2]
order_refund_effective_verdict         v    f    —      —      🔴 見下方 [R4 A2]
admin_sso_login_events                 r    t    (無)   (無)   缺 I(而它刻意無 SELECT)
staff                                  r    t    S      S      缺 I+U(第 0 步要補)
   🔴 **[R4 A1 補]** ⛔ ~~上一版這張表【漏了 staff】~~ —— 而它是本案最核心的那一列。
      ⇒ 📌 「23 個逐格相同」那句當時只涵蓋 **22 個**, 而漏掉的正是要補 I+U 的那一張。
      🎯 **一張用來支持結論的表, 漏掉的偏偏是結論講的那一列** —— 而它讀起來完全正常。
brands / categories / product_variants  r    t    DISU   DISU   已涵蓋
products                               r    t    DISU   DISU   已涵蓋 ← 🔴 見 6b
email_outbox / sweeper_heartbeat        r    t    ISU    ISU    已涵蓋
order_items / orders / shipments /
shipment_items / order_refunds /
order_manual_refunds / suppliers /
payment_charge_attempts /
order_item_procurement(+receipts) /
order_item_receipt_requests /
product_fitments_effective_sync_log    r    t    S      S      已涵蓋(碼只讀)
```
🎯 **⇒ 23 個裡,寬尺與窄尺【逐格相同】,零差異。**

### 🔴🔴 **[R4 A2] 那兩個 view 的「不算」理由是【錯的】,不只是措辭**

⛔ ~~view, RLS 不掛它身上 ⇒ 不用管~~
🔬 **R4 實查**:`admin_order_list_v` 與 `order_refund_effective_verdict` 兩支的
`reloptions = {security_invoker=true}`(而 `public` 的 17 支 view 裡 **15 支**有這個選項)
⇒ 📌 **`security_invoker` 的 view 會把【呼叫者】在底表上的 RLS 套下去** ——
**它不是一道遮罩,它是一片玻璃。**
⇒ 🛑 **所以那兩列不能寫「不用管」,要寫「要看它的底表」** —— 而**底表我沒有逐一追**
(`-db` 的 §4b 追過一次,結論新增 0;而它那次用的是 `dev` 的樹,不是今天這一版)。
⚠️ **⇒ 這兩列的判定現在是【未確認】,不是【已涵蓋】。**

### 6b. 🛑 **而那個「零差異」不是我的尺變好了 —— 是【世界變了】**

R3 的 F1 說 `products` 只有 `USING (delisted_at IS NULL)` 那條,**而那在它讀的時候是對的**。
🔬 現在逐條列 `products` 的 policy:
```
products_select_public         SELECT  (delisted_at IS NULL)   PUBLIC      ← 舊的那條, 還在
products_select_service_role   SELECT  true                    service_role ← 🎯 270000 加的
products_insert/update/delete_service_role                     service_role
```
⇒ 📌 **`20260904270000` 已由 Sean 2026-09-05 03:1x 貼進正式庫(主視窗確認)⇒ 它把那個缺口關掉了。**

🔴🔴 **⇒ 所以「我的寬尺今天給出正確答案」是【碰巧】,不是【它夠好】**:
· 寬尺會把 `products_select_public`(PUBLIC + 帶過濾)**算成覆蓋** —— 那正是 F1 指出的錯。
· 而今天它剛好也命中 `products_select_service_role`(真的 `true`)⇒ **兩把尺印同一個答案。**
· 🛑 **在 `270000` 貼進去之前,同一把寬尺會給出【錯的】答案** ——
  而我 09-05 跑它的時候,那一支**已經貼了** ⇒ 我拿到對的答案,**而我的尺沒有變。**
⇒ 🎯 **這一格要記的是:一把壞掉的尺在世界修好之後會開始印對的答案,而它壞的事實沒有改變。**
　　(同族:memory `feedback_a-negative-control-becomes-a-positive-control-when-the-world-moves-on` 那一類。)

### 6c. ✅ 第 0 步要不要復活 —— 我的判斷:**要,而且射程要縮**

```
仍然成立的:三張表的【寫入】那半, 版控裡確實沒有人做
  admin_audit_log         缺 INSERT
  staff                   缺 INSERT + UPDATE
  admin_sso_login_events  缺 INSERT(而它刻意不需要 SELECT)
要改的:
  ① 檔頭「23 個裡 20 個已涵蓋」的來源要改成【窄判準 + 6a 這張表】, 不是我原本那把寬尺
  ② 「零行為改變」對【那兩支零-policy 偵測器】為假 —— 而 F4 的成因是 270000 不是本片
     ⇒ 改成:本片不製造那個接縫, 而它會讓那個接縫更明顯;接縫本身另開一列
  ③ R2 補的七道前提斷言(RLS 開著 / ACL 齊 / 欄級三欄)全部保留 —— 6a 證明它們仍然需要
```
⚠️ **而我不自己復活它** —— 暫停是主視窗裁的,復活也該他裁。本節只給判斷與理由。

### 6d. 本節證不到什麼
```
① 我沒有重算【23 之外】的東西 —— 這 23 個的來源仍然是 §2 那把「.from() 字面」的尺,
   而它的已知盲區(embedded resource、動態表名)R3 的 F5 已經指出, 本節沒有補。
② 「已涵蓋」只答【policy 那一層】—— GRANT 那層在 §2 的 probe 裡, 兩層都要過。
③ 我沒有實跑任何一條路徑 —— 全部是唯讀查目錄 + 讀碼。
```
