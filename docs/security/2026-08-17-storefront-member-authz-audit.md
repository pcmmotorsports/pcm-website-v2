# 前台客人側授權盤點(已登入一般會員的 IDOR / ownership / 經銷價)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:網站庫 storefront app 層 + DB 層
- **威脅模型**:一個【已登入的一般會員】拿自己的合法 session,能不能碰到**不屬於他**的東西。這是「後台側」(`axis2-authz-boundary-audit`)的對照面。
- **方法**:Explore(sonnet)盤點 apps/storefront(分母:11 個 'use server' + 9 個 route.ts = 20,逐支親讀;另掃 lib 70 支 + DB 寫入 primitive 全庫 grep)→ 主對話**親核吃重的三條 + 補一道 DB 層 write policy**。
- **口徑**:只對網站庫 storefront 成立;量到 / 採信分開標。

## 0. 結論:member-side 授權邊界守得住(app 層 + DB 層雙證)

無 IDOR(讀與寫都不行)、ownership 全部 server 端綁、經銷價偽造 cookie 的值**不流進任何算價**(dormant 風險已自標 #215)。

## 1. Ownership 綁定(全部 server 端;Explore 盤點 + 主對話抽核)

20 支入口(11 action + 9 route)身分來源**皆 server**(`getUser()` 或 RPC `auth.uid()`),無一信 client 送的 id 當歸屬。
- ✅ **親核** `api/orders/[orderId]/payment-status/route.ts:73-78`:`.from('orders').select('payment_status').eq('id', orderId).eq('customer_user_id', userId).maybeSingle()` —— **雙軸**(authenticated client 的 RLS + 應用層 `.eq('customer_user_id', userId)`),userId 來自 `getUser()`(`:110-121`)。偽造他人 orderId → maybeSingle 回 null → 404、不觸發 settle。
- `checkout/reconcile-actions.ts:81`:`find_active_sibling_own` RPC 內 `auth.uid()` 鎖死。
- `lib/payment/cardholder.ts:87`:addressId 只在 `listByCustomer(user.id)` 回來的**自己的**清單裡 `.find()`,查無 → `address_not_found`,不是 `WHERE id=addressId` 查全表。
- `checkout/charge-actions.ts:245`:建單 `create_order` RPC **零送 userId/tier/price**,身分/算價全 server 權威。

## 2. IDOR(換 id 讀/改別人)= 無(讀與寫雙層擋)

**讀**:上述雙軸過濾 + 底表 RLS `*_select_own`(`auth.uid()=customer_user_id`,見 `website-db-view-policy-symmetry-check` §5)。
**🔴 寫(本輪補的一道 —— Explore 對 use-case 內部 WHERE 是採信、我改由 DB 層證)**:`customer_addresses` / `customer_vehicles` / `customers` 的 authenticated 寫入 policy **全部 own-only**(量到的):

| 表 | INSERT with_check | UPDATE using/with_check | DELETE using |
|---|---|---|---|
| customer_addresses | `auth.uid()=customer_user_id` | `auth.uid()=customer_user_id`(兩者) | `auth.uid()=customer_user_id` |
| customer_vehicles | `auth.uid()=customer_user_id` | `auth.uid()=customer_user_id`(兩者) | `auth.uid()=customer_user_id` |
| customers | service_role only | `auth.uid()=user_id`(兩者) | service_role only |

⇒ **即使 account/* 的 use-case 忘了把 `user.id` 放進 WHERE(Explore 對此採信、未逐行親讀),DB 的 UPDATE/DELETE policy(USING)也擋住「改到別人的列」,INSERT/UPDATE 的 with_check 擋住「把列寫成別人的」。** member A 寫 member B 的地址/車輛/個資 = 兩層都不行。

**DB 寫入 primitive**:Explore 全庫 grep `.insert(/.update(/.upsert(/.delete(/.rpc(` ⇒ storefront 內**無直接 DB 寫入**(全走 `@pcm/use-cases`/RPC,源碼不在 storefront 範圍);`.rpc(` 僅 2 處=公開唯讀目錄查詢。**採信 Explore 的分母,use-case 內部 WHERE 由上表 DB policy 兜底。**

## 3. 經銷價 / tier(Sean 第二優先)= dormant,偽造 cookie 的值不流進算價

- **pcm-tier cookie client 可偽造**(`lib/tier.ts`,已知 #215/H-1)—— 但**它的值只到一個地方**:✅ 親核 `resolveTierFromRequest` 全部使用點僅 `app/page.tsx:69`(首頁),而該值 `:76` 註解「寫進 `data-tier` 供 dev DOM inspector」、`:149 <div data-tier={tier}>` ⇒ **只進一個 dev 用的 DOM 屬性,不影響顯價**(featured/詳情價釘 general、public view 物理排除 price_store)。
- ✅ 親核 **checkout 路徑不 import `resolveTierFromRequest`**(grep 確認);checkout **改讀 DB 的 `customers.tier`**(`checkout/page.tsx:48 .select('name, tier')` → `:60 customerRow.tier`,階段① 顯示用、價格仍 general-only)⇒ 用的是**正確來源(DB)不是 cookie**。
- 🔴 **a4 問的「三道間接擋之外的第四條路」= 沒有**:那顆偽造 cookie 的值根本沒有被任何算價/結帳決策消費(只到首頁 debug 屬性);checkout 獨立讀 DB tier;下單 RPC server 權威。
- `@/lib/prisma` 於 storefront ⇒ **0 命中**(storefront 不用 Prisma);`'use client'` 檔 import `price_store`/`priceByTier`/`premiumStore` ⇒ **0 命中**(經銷欄在編譯期就不進 client 型別)。

## 4. dormant 風險不變(追蹤,非本輪新洞)

`pcm-tier` 在 M-2-08 接真 `price_store` 讀取前**必改為 server 端查 `customers.tier`**;否則一旦有人在該 gate 前把真 price_store 接上、又沿用 cookie 為 tier 來源,即成真洩漏(升 CRITICAL)。#215/H-1。今天無實害的理由=§3(值不流進算價)。

## 5. 採信 vs 親核 / 未做

- **親核**(讀了實際查詢邏輯):payment-status 雙軸過濾、resolveTierFromRequest 使用點與流向、checkout 讀 DB tier、customer_* 寫入 RLS policy。
- **採信 Explore**:20 支入口的完整簽名盤點、DB 寫入 primitive 全庫 grep 分母、account/* 4 支的 use-case **內部** WHERE(未逐行親讀 —— 但由 §2 的 DB write policy 兜底,IDOR-write 在 DB 層已擋)。
- **未做**:`@pcm/use-cases` / RPC 套件源碼(不在 storefront 範圍);實打(本面全是 code+DB metadata,無需 anon key)。

## 口徑
member-side 授權:app 層(身分 server 綁、無 IDOR)+ DB 層(讀寫 RLS 全 own-only、經銷欄 anon=0)雙證。經銷價 dormant 風險(#215)追蹤中、今天不流進算價。
