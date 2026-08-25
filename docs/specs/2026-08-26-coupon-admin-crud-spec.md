# Spec · 優惠券後台 CRUD(`fixed` 那一半)

> **狀態:等批。一行碼都還沒寫。**
> 上游:`docs/specs/2026-08-26-coupon-schema-plan.md`(schema plan)· `2026-08-25-coupon-prd.md` §7(Sean 的答案)。
> 產出者:施工窗 pcm-website-v2-1d(線 4),2026-08-26。
>
> 🔴 **本 spec 刻意只定 `discount_type='fixed'` 那一半。**
> `'percent'` 需要 `Q-新1`(打 N 折的進位規則,**這是錢**)—— **Sean 未答 ⇒ 不定、不寫、不預留假設。**
> ⚠️ 而**欄位本身要留**(`discount_type` enum 兩個值都建),**只是後台不給選 `percent`** ——
> 理由見 §5-2:**留欄位 vs 留 UI 是兩件事,而後者才會讓人以為它能用。**

---

## §0 🔴 先講一件檔案面的事,不要跳過

**`apps/admin/src/app/coupons/**` 不在我的檔案面。**
```
我的面(佇列 §0 逐字):
  apps/admin/src/app/customers/**  ·  app/page.tsx
  components/dashboard/**  ·  lib/dashboard/**
```
⇒ **這一片要動的是一個全新的目錄** ⇒ **開工前要主視窗指派,不是我自己認領。**
⇒ 本檔是**規格**,不是動工許可。

---

## §1 這一片照【房子既有的形狀】,不自創

我開檔讀了 `customers` 那一域的完整結構(**27 支檔,非測試**),而它有一套固定的分層。
**券照抄那個分層,逐檔對應**:

| 層 | customers 的既有檔 | 券要新增的 |
|---|---|---|
| 列表頁 | `app/customers/page.tsx` | `app/coupons/page.tsx` |
| 明細頁 | `app/customers/[id]/page.tsx` | `app/coupons/[id]/page.tsx` |
| 表格 | `components/customers/customers-table.tsx` | `components/coupons/coupons-table.tsx` |
| 篩選列 | `customer-filter-bar.tsx` | `coupon-filter-bar.tsx`(啟用/停用/全部) |
| **純函式驗證核** | `lib/customers/tier-form.ts` | `lib/coupons/coupon-form.ts` |
| **server action** | `lib/customers/tier-actions.ts` | `lib/coupons/coupon-actions.ts` |
| 送出鈕 | `tier-edit-submit.tsx` | `coupon-submit.tsx` |
| 讀取層 | `customer-repository.ts` | `coupon-repository.ts` |
| URL 解析 | `customer-list-view.ts` | `coupon-list-view.ts` |

**共用元件直接用,不新做**:`shared/admin-data-table` · `admin-form` · `list-pagination` · `select-filter`。

### 🔴 1-a 而那套分層有一條硬紀律,我逐字抄下來
`tier-form.ts:1-3` 逐字:
> 「純函式核心(**可單測、無 `'use server'`/next 依賴**)。**authz(session/Origin/actor)在 action 檔**;本檔只做『表單 → RPC 參數』**形狀層**」

⇒ **驗證分三層,而它們住在不同地方**(⚠️ 我第一版寫「兩層」而下面列了三個,已修):
```
coupon-form.ts     形狀層(欄位在不在、型別對不對、長度)—— 純函式, 好測
coupon-actions.ts  authz + 呼叫 RPC —— 'use server'
RPC(DB)           🔴 語意權威(唯一性、值域、能不能改)
```
⚠️ **不要把語意驗證寫進 `coupon-form.ts`** —— 那會變成兩份會漂移的規格(`tier-form.ts:2-3` 明寫語意權威在 RPC)。

---

## §2 寫入一律走 owner RPC,**不直接寫表**

`tier-actions.ts:18-19` 逐字記著這條紀律(⚠️ 我第一版寫 `:16-19`,**開檔核之後修正** —— `:16-17` 講的是 step-up 與形狀層,不是這一條):
> 「寫入走 `admin_set_customer_tier` **owner RPC**(UPDATE 單欄 **+ audit 同交易**、同值 **NO_CHANGE 零寫入**、**EXECUTE 僅 service_role**;稽核在 RPC、action 不另接)」

⇒ 券要三支 RPC:
```
admin_create_coupon(...)    建券
admin_update_coupon(...)    改券(而【已收款】那類限制見 §3-2)
admin_set_coupon_active(...) 啟用 / 停用   ← Q7甲「停用取代刪除」的實體
```
🔴 **沒有 `admin_delete_coupon`。** Sean `Q7=甲`,而**不做刪除的方式是「不寫那支 RPC」**,不是「UI 不放按鈕」。
⇒ **UI 不放按鈕擋得住員工,擋不住下一個接手的工程師。**

**既有前例**(不是我發明的):`grep -rlnE 'admin_(create|insert|add)_' supabase/migrations/*.sql` ⇒ **10 支**(負對照 `admin_zzzcreate_` ⇒ 0)⇒ **建立類 RPC 在本 repo 有既成形狀,實作時挑一支最近的開檔對齊。**

---

## §3 畫面上有什麼

### 3-1 列表頁 `/coupons`
```
欄:優惠碼 · 說明 · 折抵 · 結束日 · 已用/總量 · 狀態(啟用/停用)· 建立者
篩選:狀態(全部 / 啟用中 / 已停用)   ← 走 URL, 照 customer-filter-bar 的 GET 表單形狀
排序:結束日 · 已用次數(照 customer-list-view 的 SORT_PARAM 白名單紀律)
🔴 「已用/總量」顯示 N/M —— 而 N 來自 coupon_redemptions 的 count
   ⇒ 列表頁一次撈 N 張券 ⇒ **N+1 查詢風險** ⇒ 實作時要一發聚合, 不是逐張券再查一次
```

### 3-2 明細/編輯頁 `/coupons/[id]`
```
可改:說明 · 結束日 · 總量上限 · 每人上限 · 最低消費 · 可否疊會員價 · 啟用旗標
🔴 不可改:優惠碼(code)
   理由:券已經發出去了, 改碼等於【讓客人手上那張失效而畫面不會說】
   ⇒ 要換碼 = 停用舊的 + 建新的。**這一條寫進 RPC, 不只寫進 UI。**
⚠️ 而「已經有人用過的券, 還能不能改折抵金額」—— **本 spec 判【不能】**, 理由:
   已成立的訂單記著當時折了多少(`orders.discount_total`), 改券不會回頭改訂單
   ⇒ 改完之後「這張券折多少」與「那些訂單實際折了多少」對不起來, 而**畫面上看不出來**
   ⇒ ✅ **Sean 2026-08-26 已拍 `d 甲` = 不能改。原本是我判的, 現在是他拍的。**
   ⇒ 🔴 **而「不能改」的實體是【不寫那支能改金額的 RPC 參數】, 不是【UI 不放輸入框】**
      —— 同 §2 的紀律:UI 擋得住員工, 擋不住下一個接手的工程師。
```

### 3-3 建券頁
```
必填:優惠碼 · 折抵金額 · (結束日 / 總量 / 每人上限 / 最低消費 依 Sean 的答案全部要有欄位)
🔴 折扣方式:本版【只有「折 NT$ N 元」一個選項】, 而它仍然是一個 select 不是寫死
   ⇒ 理由見 §5-2
⚠️ 碼的產生方式 = 員工自己打(Q5甲 的配套)
   ⇒ ✅ **Q-新2 已答**(2026-08-26)—— Sean 逐字「**沒關係,猜到就猜到**」
   ⇒ 🔴 **他明說這個風險他接受** ⇒ 那個提示【不再是防猜的配套】
   ⇒ **提示保留, 而理由換成【避免員工彼此撞碼】**(可用性, 不是安全)
      —— 措辭是 Sean 的品味題, 仍不寫死
```

---

## §4 PRG 與結果碼(照既有,不自創)

`tier-actions.ts:20-21` 逐字:
> 「PRG:結果碼 → revalidate + redirect 帶固定 query(`?r=saved/noop/not_found/invalid/denied/error`);**DB error 不外洩瀏覽器**、server log 只留識別欄位」

⇒ 券沿用同一組,**加一個**:
```
saved · noop · not_found · invalid · denied · error
+ duplicate_code    ← 券獨有:優惠碼撞了
```
🔴 **`duplicate_code` 要是一個【獨立的碼】不是併進 `invalid`** ——
員工看到「格式錯誤」與「這個碼已經有人用了」要做的事完全不同。

---

## §5 這份 spec 沒有定的(逐條,不含糊)

```
5-1 ✅ **已答**(2026-08-26 `d 甲`)—— 不能改。從「我判的」升級成「他拍的」。
5-2 ✅ **Q-新1 已答**(2026-08-26 `a 甲` 四捨五入)⇒ `percent` 那一半【解鎖】。
    ⚠️ 而**本 spec 的 §3-3 仍寫著「只有折 NT$ N 一個選項」** —— 那一句現在【過期了】,
    要在實作前改成兩個選項。🔴 **我把它留在這裡而不是直接改, 是因為改 UI 選項會連動
    「折扣方式」那顆 select 的驗證與 RPC 參數形狀, 那屬於實作片、要主視窗劃面之後一起做。**
    下面那段原文保留:
    而【欄位要建、UI 不給選】:
      · 欄位不建 ⇒ 之後要動 schema(migration 已 apply 的不能改)
      · UI 給選而規則未定 ⇒ 員工建得出一張【算不出金額】的券
    ⇒ **留欄位 vs 留 UI 是兩件事, 而後者才會讓人以為它能用。**
5-3 碼的提示文字 —— 卡在 Q-新2
5-4 7 種拒絕理由的文案 —— Sean 的品味題
5-5 列表頁「已用/總量」的聚合怎麼寫 —— 實作階段的事, 而 **N+1 風險已在 §3-1 點名**
5-6 券的稽核列要記哪些欄 —— 照 RPC 慣例「audit 同交易」, 而【記哪些欄】沒定
5-7 ✅ **OD 上【沒有】券的後台畫面稿 —— 我查了, 而這一格從「沒查」變成「查過了」**
    量法(2026-08-26 走磁碟, 不走 MCP —— `list_projects` 今晚實測回空而磁碟上有 11 個專案):
      優惠券 ⇒ 15 檔 · coupon ⇒ 6 檔
      🔴 而【全部落在 `pcm-home-redesign` 三個變體】= **顧客站**, 不是後台
      四個後台專案(`pcm-admin-order-ui` / `pcm-admin-shell-4dir` / `pcm-product-admin-4dir` / `pcm-524f`)
      ⇒ **零命中**
      正對照 訂單 ⇒ 379 檔 · 商品 ⇒ 909 檔(尺是活的) · 負對照(當天靶)⇒ 0
    ⇒ **後台建券畫面沒有稿** ⇒ 視覺照 `docs/design/admin-design-system.md`(BMW M),
      而**版面要 Design session 或 Sean 定, 不是照本檔的欄位清單直接畫**
    ⚠️ 而那 15 檔我**只數了檔數沒開檔** —— 它們是顧客站那一側的券(結帳輸入格),
      **與本 spec 無關, 而做顧客站那半的人要開**
```

📎 上游:[schema plan](2026-08-26-coupon-schema-plan.md) · [PRD §7](2026-08-25-coupon-prd.md) ·
形狀來源:`apps/admin/src/lib/customers/tier-form.ts` · `tier-actions.ts`(逐字引用見 §1-a / §2 / §4)
