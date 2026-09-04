# Plan · 車款清單改成一支聚合 RPC(`⟦search-VEHTAXSLOW⟧` 乙案)

> 線【身分】`-auth` · 2026-09-05 · **鐵則 8 + 12③(新 DB 物件)⇒ codex 審 → Sean 批 → Sean 貼**
> **本檔只到 plan。** 病因與現況見板列 `⟦search-VEHTAXSLOW⟧`。

## 0. 要解的是什麼(一句)

`getVehicleTaxonomyCached` 今天要打 **13 次往返**(12,053 列 ÷ 1000)⇒ 冷 **11.8–12.6 秒**
(而 `b4362447d` 分批併行之後是 **2.7–6.2 秒**)。

> 🔴🔴 **收益的定義 2026-09-05 18:5x 被實測改掉了 —— 先讀這一段再讀下面任何一個數字。**
> 逐 `request id` 對完(不是靠時刻猜), 跨兩個部署共 **5 發【冷】請求**:
> ```
> taxonomy 各花  2,699 / 2,822 / 4,914 / 5,484 / 6,164 ms
> 而端到端       0.281 / 0.432 / 1.032 / 0.679 / 0.552 s
> ```
> 🎯 **兩個數掛在【同一顆 request id】上 ⇒ 那幾秒【沒有擋住回應】。這是證明, 不是推論。**
> 🛑 **⇒ 頁面這條路【從來沒有擋過客人】** —— 含**新部署的第一發**(三發全冷、全部 <1.1s)。
> ✅ 而 `12,280ms` 那個數是真的, 它是**另一條路**:`/api/search` 把它放在 `await Promise.all` 裡
>    ⇒ **那裡真的擋**;而**那條路 `6c075c294` 之後已經不叫它了** ⇒ **兩條路今天都不再讓客人等。**
>
> ⇒ 📌 **所以本案買的是**:
> ```
> ① 背景成本(每次冷抓 2.7–6.2 秒的 lambda 時間與 13 次往返)
> ② 第一發的那 0.5–1.03 秒裡, 屬於 taxonomy 的那一部分
> ```
> ⛔ ~~「客人少等 12 秒」~~ · ⛔ ~~「13 → 1 拿掉 12 × 945ms ≈ 11 秒【的客人等待】」~~
> **那兩句已經不成立。** 省下的 11 秒是**背景**的, 不是客人的。
>
> 🛑🛑 **而【機制我解釋不了】, 照實寫**:頁面也是 `await` 它的, 照理該擋。
> 串流 / `unstable_cache` 去重 / 別的 —— **我一個都沒證**。
> ⇒ **這一格是【觀察到的事實 + 未解的機制】, 不是「我懂了」。**
> ⚠️ **⇒ 而它是本案要不要做的關鍵**:若背景成本不痛(今天流量是零), **本案可以緩**;
>    要它變急, 得先有一個「背景成本真的痛」的證據 —— **而那個證據今天不存在。**
`b4362447d` 已改成分批併行(一批 4 頁)⇒ **13 次沒有變少, 只是不再排隊**。
🎯 **本案要的是【一次往返】** —— 而它順帶讓分頁準則 ⑤⑥ 變成**不適用**(沒有翻頁就沒有翻頁途中被寫入)。

## 1. 回什麼形狀 —— **量過的, 不是挑的**

正式庫唯讀實測(2026-09-05,`octet_length(...::text)`):
```
現況 原始 12,053 列                        482,951 bytes
甲  巢狀 JSON(品牌 → 車款 → 年份區間)     409,813 bytes   ← 只小 15%
乙  兩張扁表(品牌 675 + 車款 113,115)     113,790 bytes   ← 小 4.2 倍
```
🛑 **而乙【不是等價的】**:它**丟掉年份**,而 `MockMotoModel.years` 是**年份下拉的資料來源**
(`mock-moto-brands.ts:13-16`;`vehicle-taxonomy.ts` 把區間展開成 `years: number[]`)
⇒ 📌 **選乙 = 年份下拉要另一支查詢或改設計 ⇒ 那不是效能優化, 是功能改動。**

✅ **推甲(巢狀 JSON)** —— 行為逐格不變, 而**真正的收益不在 bytes, 在「13 次往返 → 1 次」**。
⚠️ **而 410 KB 不小**:它每次冷抓都要傳。**沒有量過它在 Vercel↔Supabase 之間要多久** ⇒ 見 §7。

## 2. 物件與權限

```sql
CREATE FUNCTION public.vehicle_taxonomy_agg() RETURNS jsonb
LANGUAGE sql STABLE
SECURITY INVOKER          -- 🔴 不是 DEFINER
SET search_path = ''
```
🔴 **為什麼是 INVOKER**:它只讀 `public.vehicle_taxonomy_public`,而**那支 view `anon` 本來就讀得到**
(顧客站今天就是用 anon client 直接 select 它)⇒ **沒有任何需要提權的地方**。
🛑 **而 DEFINER 會【擴大】射程** —— 那正是 `revoking-function-execute-in-supabase.md` 記的那一族病:
一個不需要提權的東西掛上 DEFINER,日後有人改它的 body 就變成一條繞過 RLS 的路。
```sql
REVOKE ALL ON FUNCTION public.vehicle_taxonomy_agg() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_taxonomy_agg() FROM authenticated;
REVOKE ALL ON FUNCTION public.vehicle_taxonomy_agg() FROM service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_taxonomy_agg() TO anon;
```
⚠️ **新物件出生就對 PUBLIC 開 EXECUTE ⇒ 先收再給**(本 repo 記過的坑)。

## 3. 事後閘(fail-closed,整檔 ROLLBACK)

```
① 函式在, 且 prosecdef = false(是 INVOKER)、proconfig 含 search_path=""
② anon 有 EXECUTE;authenticated / service_role 【沒有】  ← 正反兩向都要
③ 🔴 內容對帳:SELECT jsonb_array_length(vehicle_taxonomy_agg()) = 67(品牌數)
   而**車款總數也要對** —— 展開之後 = 3,779
   🛑 少了這一格, 一支回 `'[]'::jsonb` 的函式會通過①②
④ 🔵 反向對照:那兩個數【不是寫死的】—— 同一發 migration 裡從 view 現算一次再比,
   否則型錄一變就永遠紅(而那會讓人把閘關掉)
```

## 4. app 端

```
getVehicleTaxonomyCached 的 body 換成一次 rpc('vehicle_taxonomy_agg')
· 分頁迴圈、PAGE_SIZE / BATCH / MAX_PAGES 整段刪掉
· [vehicleTaxonomy] cold 那一行【留著】(改印 bytes / ms)—— 它是冷暖判準
· 回來的 jsonb 要餵進既有的 buildVehicleTaxonomy 之前先轉成 fitments 陣列
  🛑 或者讓 RPC 直接回 buildVehicleTaxonomy 的輸出形狀 —— **而那把「怎麼展開年份」搬進 DB**,
     那是**兩份實作**(TS 一份、SQL 一份)⇒ 🔴 **不做**。RPC 只回原始三元組的聚合。
```

## 5. 回歸測試分母(七個入口)

```
apps/storefront/src/lib/products-vehicle-taxonomy.test.ts   ← 主要, 那 13 格
apps/storefront/src/app/page.test.tsx                       首頁
apps/storefront/src/app/products/page.test.tsx              /products
apps/storefront/src/app/account/page.test.tsx               /account
apps/storefront/src/app/account/vehicle/actions.test.ts     車輛設定
apps/storefront/src/app/api/catalog/facet-counts/route.test.ts
apps/storefront/src/components/ProductsPage.test.tsx
🔴 **2026-09-05 查完了, 而答案是【沒有】**(兩把尺):
   · 尺A(`ls` + grep import):`/cart` 只有 `actions.test.ts`, **沒有 page 測試**;
     PDP `products/[slug]/` **整個目錄只有 `page.tsx`, 零測試檔**
   · 尺B(誰 import 它們):PDP page **0** · cart page **0**
     🟢 正對照:首頁 `app/page` 被 **4** 支測試 import ⇒ **尺是活的**
   ⇒ 🛑 **這兩個入口在回歸分母裡【結構上不存在】** —— 而它們都會叫 `fetchVehicleTaxonomy`
   ⇒ 📌 **本案改壞它們, 三綠與 `vitest related` 都不會紅。**
   🟢 **2026-09-05 補了**:`app/cart/page.test.tsx`(3 格)· `app/products/[slug]/page.test.tsx`(4 格)。🔬 兩發突變:①cart 不叫 taxonomy ⇒ **2 格紅** ②PDP 改成無條件呼叫 ⇒ **1 格紅**。🔵 而 PDP 那支順帶釘住一個**已經在、卻沒人守著的優化**:`hasVehicleParam || hasFitments` 才撈 —— 沒 fitments 又沒帶車的商品頁**不付那筆錢**。⚠️ 而我第一版把參數名寫成 `v`, **那一格當場紅** —— 實際是 `vehicle`(`page.tsx:97-98`)。
```

## 6. Rollback

```
DROP FUNCTION IF EXISTS public.vehicle_taxonomy_agg();
+ app 端 revert 一顆(分頁迴圈整段回來)
🔵 零資料寫入、零 schema 改動 ⇒ 是可逆的
🛑 而【部署順序】:函式要先貼, TS 才能上 —— 反過來每一發都 404 退回舊路… 
   ⚠️ **而這裡沒有舊路** ⇒ 反過來會是【車款下拉整個空掉】。**這一格比搜尋那支嚴重。**
```

## 7. codex 要審什麼(12③)

```
· INVOKER 那個選擇對不對(有沒有我沒看到的提權需求)
· 事後閘③④ 的對帳夠不夠(回 '[]' / 回一半 / 年份掉了 四個世界)
· 410 KB 的 jsonb 一次回傳:PostgREST 有沒有大小上限?壓縮?超時?
  🔴 **這一格我完全沒量** —— 只量了 bytes, 沒量【傳它要多久】
· 部署順序那格(沒有舊路可退)
```

## 8. 這份證不到什麼

- ⛔ ~~**沒有量過那支 RPC 會多快**~~ ⇒ 🟢 **DB 端那一半 2026-09-05 量了**(唯讀連線, 各連跑):
  ```
  聚合整包一次算完   309 / 313 / 316 / 317 / 329 ms   (五發)
  現況的一頁 1000 列 146 / 148 / 150 ms              (三發)
  ⇒ 🎯 聚合 ≈ 【2.1 頁】的 DB 工, 而它取代的是【13 頁】⇒ DB 端約省 6 倍
  ```
  ⚠️ **而這組數【只含 compute, 不含把 410 KB 傳出去】** —— 我量的是 `octet_length(...)`,
  **回傳的是一個整數, 那 410 KB 從來沒有過線**。⇒ 下一格仍然開著。
  ⚠️ 另外它是**從我這台機器**量的(單頁 ~148ms), 而正式站是 **~945ms/頁** ⇒ **絕對值不可跨環境引用**,
  **可以引用的是【比例】**。
- 🔴 **410 KB 的傳輸時間仍然沒量** ⇒ 有可能一次往返傳 410 KB 比 13 次小往返還慢。
  🛑 **而我今天量不到它**:`.env.local` 裡**沒有主專案的 anon / publishable key**
  (只有 `QUOTE_SUPABASE_PUBLISHABLE_KEY`, 那是另一個專案;以及 `SUPABASE_SECRET_KEY` = service_role)
  ⇒ 📌 **我不拿 service_role 去代打** —— 那是**另一個權限、另一個世界**, 而且它量不到 anon 那條路。
  ✅ **⇒ 這一格要有 anon key 的窗來打**(`-front` 有);或等 RPC 真的存在之後在 dev preview 量。
- 兩個數(67 / 3,779)是**今天型錄的性質**,不是約束。

---

## 9. 🔴🔴 **region 查了 —— 而它把「一次往返」的收益【放大】, 不是縮小**

主視窗 2026-09-05 點出一個方向反了的數,而它是對的:
```
-front 本機(端到端, 非 lambda):1000 列一頁 173–220ms · 2000 列一頁 348–411ms
我本機(psql, compute 為主)   :1000 列一頁 146–150ms
而【lambda 上】               :~945ms/頁(dev preview 逐發實測)
⇒ 🎯 lambda 比兩台【更遠的】機器慢 4.7 倍 —— **方向反了**
```
🔬 **查了 region, 兩邊【同區】**:
```
Vercel function  x-vercel-id 逐字 `hkg1::sin1::…` ⇒ 執行在 **sin1(新加坡)**
Supabase DB      pooler 主機第一段 `aws-1-ap-southeast-1` ⇒ **ap-southeast-1(新加坡)**
```
🎯 **⇒ 地理距離【不是】那 945ms 的成因。** 而那把「每一發往返很貴」這件事**留在 lambda 內部**
(連線建立 / TLS / client 初始化 / 冷啟動 —— **這四個我都沒有量, 不指名**)。

🔵 **⇒ 對本案的意思是【收益更大, 不是更小】**:
若每一發往返的固定成本 ≈ 945ms 而與資料量幾乎無關,
那 **13 → 1 拿掉的是 12 × 945ms ≈ 11 秒** —— 🛑 **而那 11 秒是【背景】的, 不是客人的**(見 §0 那段訂正),
而多傳的 410 KB 只多付一次傳輸。
⚠️ **而「傳 410 KB 要多久」仍然沒量** —— 它仍是唯一能推翻本案的那一格。

🔴 **另外 `-front` 量到一格會改變設計的**:
`db-max-rows = 2000` 是**硬上限**(不設 Range 或要全表 ⇒ HTTP **206**、只回 2000 列)
⇒ 📌 **PostgREST 的一般 `select` 【拿不到 12,053 列】, 不管怎麼要**
⇒ 🎯 **「一次往返」只有走 RPC 回 `jsonb` 這條路做得到** —— 那不是偏好, 是唯一解。
🔵 順帶:那也證實 `PAGE_SIZE = 1000` 是對的 —— **取 2000 會讓「滿頁」與「被截斷」印同一個訊號**。
⚠️ 而 `-front` 的那組數是**它本機端到端**, 不是 lambda ⇒ **不可與 945ms 直接相減。**
