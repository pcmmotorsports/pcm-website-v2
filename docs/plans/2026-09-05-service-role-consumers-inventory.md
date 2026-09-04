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
 ├─ 36  apps/admin                ← 🔴 我上一份【整個漏掉】的那一批
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
