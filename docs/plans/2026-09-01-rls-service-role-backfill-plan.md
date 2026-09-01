# ⟦0e-RLSBACKFILL1⟧ 那 45 張要不要補 policy —— **而我的結論是「現在不做」**

> 線【出貨】`-0e` 2026-09-01 21:2x CST · 唯讀量測 + 拋棄式 PG 模型 · **本檔是 plan,零實作**
> 前置:`docs/probes/2026-09-01-rls-service-role-live.md`(那 45 張怎麼來的、`BYPASSRLS` 那一格)

---

## 🎯 0. 結論先講:**現在不做,而理由不是「來不及」**

```
① 風險是【未來式】—— service_role 今天有 BYPASSRLS(實查 rolbypassrls = t)
② 而 🔴🔴 **真正要補的【遠少於 45 張】** —— 我量到的:
   走 SECURITY DEFINER RPC 讀的表【根本不需要那條 policy】(下面 §2 有實測)
   ⇒ 而那把分母從 45 砍到【最多 21】, 而實際數字還要再篩
③ 而一次補 45 張 policy 是一個【大改動 + 今天不痛】的組合
   ⇒ 而那個組合的風險不是「做不完」, 是【補錯一張而它不會紅】
```
🛑 **⇒ 所以本 plan 的產出不是一支 migration,是【什麼時候該做 + 誰會踩到它 + 一道擋住錯誤順序的閘】。**

---

## 🔴 1. 而先修一個【分母】:45 不是要補的張數

```
psql 唯讀 21:0x CST:public schema 表 54 張, 全部 relrowsecurity = true
  沒有 service_role 讀得到的 SELECT policy ⇒ 45
```
🔵 **而那 45 張裡,有多少是 `apps/` 真的用 `.from('<表>')` 直接讀的?**

```
量法:git grep -l "from('<表>')" -- apps/admin/ packages/ (與 apps/storefront/), 排 .test.
🟢 尺自檢:orders ⇒ 17 支檔(已知有)· 🔴 現造表名 ⇒ 0
結果:45 張裡【有直接呼叫端】的 = 21 張, 【零直接呼叫端】= 24 張
```
**有直接呼叫端的 21 張**(admin/storefront 檔數):
`orders`(7/2)· `order_items`(5/0)· `customers`(4/3)· `email_outbox`(3/0)·
`admin_audit_log`(2/0)· `order_manual_refunds`(2/0)· `order_refunds`(2/0)·
`shipments`(2/0)· `shipment_items`(2/0)· `customer_wallet_ledger`(1/1)·
`admin_sso_login_events` · `customer_addresses` · `customer_favorites` · `customer_vehicles` ·
`order_item_procurement` · `order_item_procurement_receipts` · `order_item_receipt_requests` ·
`payment_charge_attempts` · `product_fitments_effective_sync_log` · `staff` · `suppliers`(各 1/0)

---

## 🔴🔴 2. 而【走 RPC 讀的表根本不需要那條 policy】—— 這是實測,不是推的

拋棄式 PG 17,一張 **RLS 開 + 零 policy** 的表,用一個**沒有 `BYPASSRLS`** 的角色走三條路:
```
直接 SELECT                          ⇒ 🔴 0
🔵 走 SECURITY DEFINER 函式          ⇒ **3**   ← 讀得到
🟢 正對照 走 SECURITY INVOKER 函式   ⇒ 0       ← 證明救它的是 SECDEF, 不是「包成函式」
🟢 owner 直接讀(force=f)            ⇒ 3
```
📌 **⇒ `SECURITY DEFINER` 以 owner 執行,而 `relforcerowsecurity = 0 張` ⇒ owner 一律不套 RLS。**
✅ **⇒ 所以那 24 張零直接呼叫端的,若它們只被 SECDEF RPC 讀 ⇒ 收掉 `BYPASSRLS` 也不會壞。**
🛑 **而「只被 SECDEF RPC 讀」我【沒有逐張驗】** —— 那是下一步,不是本 plan 的結論。

---

## 🎯 3. 分堆(判準是【誰在讀它】,不是表名)

```
甲 後台 service_role 直接讀       ⇒ 🔴 這一堆才需要補 policy。上限 21 張, 而實際要再篩
   (要篩掉:用 anon/authenticated client 讀的、以及只在 SECDEF RPC 內被讀到的)
乙 顧客站也讀的                   ⇒ customers / orders / customer_wallet_ledger
   🔴 而它們的顧客站那一側走 anon/authenticated ⇒ **已經有各自的 policy**(否則今天就壞了)
   ⇒ ⇒ 所以這一堆補的是【service_role 那一半】, 而不是重寫既有 policy
丙 只被 SECDEF RPC 讀             ⇒ 🔵 §2 證明它們不需要 ⇒ **不補**
丁 完全沒有人讀                   ⇒ 例 order_status_options / legal_terms_versions
   ⇒ 而「沒有人讀」是今天的事實, 不是永遠 ⇒ 它們的處置是【等有人讀的時候一起補】
```
🔴 **而甲乙丙丁的歸屬要逐張開檔判** —— 我今天只量到「有沒有 `.from()` 呼叫端」,
**而那把尺分不出「用哪一把鑰匙讀」。⇒ 那是這份 plan 最大的未完成。**

---

## 🎯 4. 一次補幾張

```
一支補全部  ⇒ 錯一張整支回滾 —— 🔵 而那其實是【好的】:全有或全無
              🔴 而真正的風險不是回滾, 是【補錯一張而它不會紅】——
                 給了一條比預期寬的 policy, 那不會有任何東西叫
分批       ⇒ 每批小、可讀, 而中間狀態存在的時間變長
```
✅ **⇒ 建議:分批,而【每一批的驗收條件相同】(見 §5)。**
📌 **理由不是爆炸半徑,是【可讀性】** —— 一支 45 張的 policy migration,審它的人會逐條看到第 10 張就開始跳。

---

## ✅ 5. 驗收條件(**而這是本 plan 唯一一個可以真的跑的**)

```
□ 拋棄式 PG:建那張表 + RLS 開 + 補上新 policy
□ 用一個【沒有 BYPASSRLS】的角色讀 ⇒ 必須讀得到(而今天不補的話它讀到 0)
□ 🔴 突變:把新 policy 的 USING 改成 false ⇒ 必須讀到 0(證明是那條 policy 在做事)
□ 🟢 反向:anon 讀同一張表 ⇒ 必須【仍然】讀不到(證明沒有補過頭)
□ 而每一張表都要跑這四格 —— 而它是機械的, 可以寫成一支 harness
```
🛑 **⇒ 沒有那一發突變,「補上了」與「補了一條沒有作用的」印同一個綠。**

---

## 🔴 6. 那個順序約束要有機制,而不是只有一句話

**約束**:**補 policy 必須在收 `BYPASSRLS` 之前。** 反過來做會在 **45** 張表上同時發生,**而且全部靜默。**

```
🔵 而 CLAUDE.md 路由表【已經】把「收掉 BYPASSRLS / 動 ALTER ROLE / RLS 收緊」列為觸發情境
   ⇒ 所以路由那一格存在, 缺的是它指到的東西沒有一個【現在數得出來的數字】
🎯 ⇒ 可做的形狀:一支腳本 `scripts/rls-policy-debt.sh`
     它連正式庫數「還有幾張缺 service_role SELECT policy」⇒ 印一個數字
   ⇒ 而路由表那一格改成:「動 BYPASSRLS 之前先跑它;那個數字不是 0 就停下來問」
🛑 而它【需要正式庫連線】⇒ 今天只有一個窗有 ⇒ 那是它的天花板, 要寫在腳本檔頭
```
⚠️ **而那道 pre-commit 閘(`rls-service-role-policy-gate.py`)只擋【新表】**
⇒ 那 45 張是既有的 ⇒ **結構上在它的射程外**
⇒ 📌 **與 `⟦0e-NEWFILEONLY1⟧` 同一族:閘只看新增的,而既有的那一批沒有任何東西在看。**

---

## 🛑 7. 本 plan 證不到什麼

```
· 那 21 張各自【用哪一把鑰匙讀】—— 我只量到「有沒有 .from() 呼叫端」
· 那 24 張零呼叫端的是不是【只被 SECDEF RPC 讀】—— 沒有逐張驗
· §2 那個模型是【我造的形狀】⇒ 它證明機制, 不證「正式庫真的會這樣」
· 「補一條 policy 會不會影響顧客站」—— 沒有量;而乙那一堆是最可能出事的
· 而數字全部是 2026-09-01 21:0x CST 那一刻的;`pg_policy` 隨時可能被 dashboard 改
```

## 🎯 8. 所以現在要做的是什麼

```
① 🔵 不做那 45 張的補 policy —— 風險未來式, 而分母還沒收斂
② ✅ 做那支 scripts/rls-policy-debt.sh(一個數字), 並把路由表那一格指到它
   ⇒ 它便宜、它把「約束」變成「機制」, 而它今天就防得住那個錯誤順序
③ ✅ 把「走 SECDEF RPC 的表不需要那條 policy」寫進 docs/patterns/revoking-…-supabase.md
   ⇒ 因為下一個做這件事的人, 第一個問題就是「45 張是不是都要補」
④ 而真正要補的那一天, 分母從【逐張判「誰在讀它」】開始, 不從 45 開始
```
