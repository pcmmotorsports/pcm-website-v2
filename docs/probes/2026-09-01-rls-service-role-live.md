# ⟦0e-RLSLIVE1⟧ 「開了 RLS 而 service_role 讀不到」——**對正式庫實查**

> 線【出貨】`-0e` 2026-09-01 **21:0x CST** · **全程唯讀**(零 apply / 零 CREATE / 零 GRANT / **零 ALTER ROLE**)
> 主視窗 `-0a` 交辦。連線 = Sean 2026-09-01 早上開的 `PCM_READONLY_DATABASE_URL`。

---

## 🎯 0. 三句話

```
① service_role 現在【有】BYPASSRLS(rolbypassrls = t)⇒ 🔵 那批表今天是安全的, 風險是【未來式】
② 而「45 vs 37」那個差 8 —— 🔴 不是誰量錯, 是【兩把尺在量兩件事】, 兩個都對
③ 而「BYPASSRLS 拿掉 ⇒ 讀到空的而不報錯」這件事, 我在拋棄式 PG 上【量到了】, 不再是推的
```

---

## 🔴 1. 地基那一格:`service_role` 有沒有 `BYPASSRLS`

**今晚每一份報告都建立在這個前提上,而它從來沒有被量過。**

```
psql 唯讀 · 2026-09-01 21:02:02 CST · select rolname, rolbypassrls, rolsuper, rolinherit from pg_roles
  anon          | f | f | t
  authenticated | f | f | t
  authenticator | f | f | f
  postgres      | t | f | t
  🔵 service_role | **t** | f | t      ← 有 BYPASSRLS
🟢 正對照 這把尺印得出兩種值:全庫 rolbypassrls 分佈 ⇒ f=29 / t=6
🔴 負對照 現造角色名 ⇒ 空
```
✅ **⇒ 所以那批表今天【讀得到】,而風險是「哪天有人收掉 `BYPASSRLS`」。**
🛑 **⇒ 而那正是 CLAUDE.md 路由表把「收掉 `BYPASSRLS` / 動 `ALTER ROLE`」列為觸發情境的理由 ——**
**它的威脅模型不是攻擊者,是一個善意而看起來完全正確的安全強化。**

---

## 🔴 2. 「45 vs 37」的差 8 —— **兩把尺在量兩件事,兩個都對**

```
psql 唯讀 · 21:02:22 CST · public schema, relkind='r'
  表總數                                        = 54
  其中 relrowsecurity = true                    = 54   ← 🔵 每一張都開著 RLS
  🔴 沒有 service_role 讀得到的 SELECT policy    = 45
  🟢 有的(反面)                                =  9
  🔴 而【零 policy】(一條都沒有)               = 37
```
📌 **⇒ `45 − 37 = 8` ⇒ 那 8 張【有 policy,而沒有一條是 service_role 讀得到的 SELECT】。**
✅ **⇒ 所以「37」與「45」都是對的**:
```
37 = RLS 開 + 【一條 policy 都沒有】
45 = RLS 開 + 【沒有 service_role 讀得到的 SELECT policy】(37 是它的子集)
```
🛑 **⇒ 而沒有人知道差在哪,是因為兩邊都只報了數字,沒有報【判準】。**
🔵 **⇒ 一個數字不帶判準,與一個錯的數字,在對帳的時候長得一樣。**

**那 9 張(反面名單比較短,列出來):**
`auth_callback_events` · `brands` · `categories` · `product_fitments` · `product_fitments_effective`
· `product_image_trim` · `product_variants` · `products` · `sweeper_heartbeat`

⚠️ 而 `relforcerowsecurity` 開著的 ⇒ **0 張** ⇒ owner 一律不套 RLS。

---

## 🔴 3. `staff` —— 而它比一般的那 45 張更極端

```
psql 唯讀:relname | rls | force | policies | service_role 可讀的 SELECT policy
  staff    | t | f | **0** | 0     ← 🔴 一條 policy 都沒有
  orders   | t | f |   1   | 0     ← 有 policy 而不是 service_role 讀得到的 ⇒ 屬那 8 張
  products | t | f |   4   | 1     ← 屬那 9 張
表級 ACL:staff ⇒ postgres=arwdDxtm · **service_role=ar** · pcm_readonly=r
```
🔵 **⇒ 表級 ACL 有 SELECT(`a`=INSERT `r`=SELECT)⇒ 擋住它的只會是 RLS,不是權限。**

### ✅ 而「讀不到會怎樣」我【量到了】,不再是推的

拋棄式 PG 17,複製 `staff` 的形狀(RLS 開 + 零 policy):
```
owner(postgres) 讀            ⇒ 3
🟢 有 BYPASSRLS 的角色讀      ⇒ 3
🔴 沒有 BYPASSRLS 的角色讀    ⇒ **0**, 而且【不報錯】(同一 session 後續查詢 rc 正常)
🟢 正對照 加一條放行 policy 之後, 沒有 BYPASSRLS 的角色再讀 ⇒ 3
   ⇒ 證明擋住它的就是 policy 那一格, 不是別的東西
```
🛑 **⇒ 所以那個失敗形狀是【靜默回空】:沒有錯誤、沒有紅,只有一個空的畫面。**
📌 **⇒ 而空資料看起來像正常資料。**

### ⚠️ 而「整個後台鎖死」那一半,**仍然是推的**
```
我量到的:staff 零 policy · service_role 今天有 BYPASSRLS · 而拿掉 BYPASSRLS 的模型會讀到 0 列
我【沒有】量到:apps/admin 那條路真的會因此鎖死
  ⇒ 那要實際跑一次後台(而那需要拿掉 BYPASSRLS ⇒ 🛑 我不做, 它是本題的觀測對象不是旋鈕)
  ⇒ 而 `staff-repository.ts:27,56,68,90,111` 有 5 處引用、同檔註解寫「讀取閘跑在路由之前」
    ⇒ 那是【讀出來的】, 不是跑出來的
```

---

## 🎯 4. 結論與它改變了什麼

```
🔵 好消息:風險是【未來式】—— 今天 service_role 有 BYPASSRLS ⇒ 那 45 張讀得到
🔴 而地基很薄:它由【一個 boolean】撐著, 而那個 boolean 沒有任何東西在看
   (repo 內零 migration 設它;它是 Supabase 平台給的角色屬性)
🛑 而收掉它的那一天, 失敗形狀是【靜默回空】⇒ 沒有人會叫
⇒ 📌 所以「先補 policy、再談收 BYPASSRLS」是唯一安全的順序, 而反過來做會在 45 張表上同時發生
```

## 🛑 5. 本檔證不到什麼

```
· 「整個後台鎖死」—— 讀出來的, 不是跑出來的(見 §3 末)
· 那 45 張各自【今天有沒有被讀】—— 我沒有查呼叫端
· 這些數字是 2026-09-01 21:0x CST 那一刻的;`pg_policy` 隨時可能被 dashboard 改
· service_role 的 BYPASSRLS 是【誰、什麼時候】給的 —— 正式庫答不出來
· 🔴 而 §3 那個模型是【我造的形狀】, 不是正式庫本身 —— 它證明的是【機制】,
  不是「正式庫拿掉 BYPASSRLS 之後真的會這樣」。兩個宣稱。
```
