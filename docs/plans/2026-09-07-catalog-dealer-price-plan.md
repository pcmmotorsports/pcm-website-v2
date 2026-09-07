# 目錄頁「經銷客人要看到用經銷價算的篩選與排序」· plan(Sean `Q74` = **要**;鐵則 8 + 12 ⇒ **只 plan, 零改動**)

> 🔴 **本檔的每一個座標我都自己開檔核過** —— 今天已經有兩次轉述座標對不上(`:754` 那列是 `done` · tidy 的路徑少一層)。

## 1. 病(三件行為, 正式庫實測)
`search_catalog_by_vehicle` **兩個多載都只認 `price_general`**(剝掉註解後 `price_store` = **0 次**):
· **篩選** `p.price_general >= / <= p_price_min/max`
· **排序** 三種(`price-asc` / `price-desc` / `recommend`)**全部**比 `price_general`
· 🔴 **預設 `recommend` 的價帶寫死 `4000` / `13800`** ⇒ 📌 **不是點了「按價格排序」才錯, 什麼都不點的預設順序就已經錯了。**

## 2. 範圍(合集, 兩條線各自量到的)
| 層 | 對象 | 讀數(正式庫) |
|---|---|---|
| view | `public.products_list_public` | `pg_get_viewdef` 實測:`price_general` **有** · `price_store` **無** ⇒ **結構上看不到經銷價** |
| RPC | 新 12 參數多載 | md5 `336beaff…` len 17207 |
| RPC | **舊 11 參數多載** | md5 `169bf913…` len 13029 ⇒ 🔴 **修一支不夠**(front 先量到) |
| 呼叫 | `apps/storefront/src/lib/products.ts:451` | 清單本身(我開檔核過:`client.rpc('search_catalog_by_vehicle', …)`) |
| 呼叫 | `apps/storefront/src/lib/vehicle-facet-counts.ts:203` | 🔴 **左側篩選面板的【筆數】**(同上核過)|

🔴 **兩個呼叫點不是一個, 而第二個是最容易漏的**:
⇒ **經銷客人會看到「5,000–10,000 (37)」, 點進去不是 37 件。**(front 自我複驗才抓到。)

🔵 **範圍【不含】`catalog_brand_counts`** —— 我 `grep` 到 6 個 `price_general` 差點把它算進來, **剝掉註解之後是 0**, 它不吃價格。
📌 **今天第五次「`grep` 分不出碼與註解」** ⇒ 本 plan 的每一次計數都先剝註解。

## 3. 代價(Sean 已知並選了要 —— 明寫, 不藏)
🔴 **經銷會員與一般會員會拿到【不同的清單】與【不同的總筆數】。**
· 同一組篩選條件, 兩種身分看到的商品集合不同 ⇒ **客服對帳時「你說的那 37 件」要先問「你是哪一種會員」。**
· 分頁與總數也會分岔 ⇒ **任何把「總筆數」寫進報表或信件的地方, 都要帶身分。**
· `recommend` 的價帶 `4000/13800` 是**用一般價定的** ⇒ 若經銷價普遍較低, **同一個價帶對經銷客人的意義不同** ⇒ **這一格要單獨拍**(是跟著身分換價帶, 還是維持同一個帶?)。

## 4. 🔴 驗收怎麼綁(B 已裁, 我照抄)
**今天全站有經銷差價的變體只有 1 筆** ⇒ 📌 **零判別力** ——
一個只有 1 筆的資料集, **改對與改錯都可能印出同一個畫面**。
⇒ ✅ **不造資料驗收**;驗收綁在**上游同步上線前**那個閘(有真資料的那一刻), **不綁在一個沒有人在看的數**。
⇒ 🛑 **而這代表:本片寫完之後, 在上游資料進來之前, 我們【證不到它是對的】** —— 這句要跟著片子走。

## 5. 還沒答的格(動手前要有人答)
1. **`recommend` 價帶**:跟著身分換, 還是維持同一個帶?(§3 第三點)
2. **舊 11 參數多載**:一起改, 還是**趁這次收掉**?(它是 `⟦db-STALEOVERLOAD1⟧`, Sean `Q43`=乙 判過不擋上線 —— 而**那是在不知道它同病之前拍的**)
3. **view 怎麼加**:`products_list_public` 加一欄 `price_store`, 還是另開一支給經銷用的 view?(前者影響所有既有讀者)
4. **身分從哪裡來**:RPC 怎麼知道呼叫者是經銷?(現有 `has_tier` 之類的參數?**我沒查**)

## 6. 🛑 本 plan 證不到什麼
· 我**沒有**讀 `search_catalog_by_vehicle` 的完整 body ——只用剝註解後的字面計數與篩選/排序那幾行。
· 我**沒有**查身分怎麼傳進 RPC(§5 第 4 格)⇒ **那一格沒答之前, 修法的形狀定不下來。**
· 我**沒有**量「經銷價與一般價差多少」——因為**只有 1 筆**, 量了也沒有判別力。
· 兩個呼叫點是我開檔核的, 而**我沒有掃「還有沒有第三個呼叫點在別的 app」**。

---

# 7. §5 第 4 格查掉了 —— **而答案讓修法多一個必須做的東西**(2026-09-07, 唯讀)

## 7-1 讀數
· 兩個多載**都是 `SECURITY INVOKER`**(`prosecdef = f`)⇒ **它以呼叫者的身分跑。**
· body 裡**身分訊號零命中**(剝註解後):`auth.uid` **0** · `auth.jwt` **0** · `current_user` **0** ·
  `current_setting` **0** · `tier` **0** · `has_tier` **0** · `customer` **0**
  ⇒ 📌 **今天這支 RPC 完全不知道呼叫者是誰** —— 它純粹被參數驅動, 而**身分不在參數裡。**
· 🔴 **誰叫得動**:`anon` **能** · `authenticated` **能** · `service_role` **能**(**兩個多載都是**)。

## 7-2 ⇒ 這一格因此變成**安全格**, 不只是「怎麼傳」
兩條路:
· **甲 · 讓 RPC 自己問**(`auth.uid()` ⇒ 查該人的 tier)—— INVOKER + Supabase 會把 JWT 帶進來 ⇒ **技術上做得到**, 而它多一次查表。
· ⛔ **乙 · 由呼叫端傳一個「我是經銷」的參數** —— 🛑 **不可以**:
  這支**對 `anon` 開著**, 而 INVOKER **不會**替你驗那個旗標
  ⇒ 📌 **任何人只要把那個參數送 `true`, 就拿得到用經銷價算出來的清單與筆數。**
  ⇒ **那不是「顯示錯誤」, 那是把經銷價的存在洩出去。**(而 Server 端鐵則逐字:**經銷價絕不傳到一般會員瀏覽器**。)

⇒ ⛔ ~~**所以 §5 第 4 格的答案是:必須走甲**~~ **[2026-09-07 訂正 —— 主視窗 A 指定「補完不要順手選形狀」]**
✅ **這一格答得出來的只有一件:【乙不可以】。**「該走哪一種」**留給 Sean 批 plan 時一起選。**

## 7-2b 🔵 **而 repo 裡已經有一支在做這件事 —— 這是【範本】不是【設計】**
`supabase/migrations/20260907010000_m4b_m208_get_effective_prices.sql` 的 `get_effective_prices`(我自己開檔複驗, 不是照收轉述):
`auth.uid` **3 次** · `FROM public.customers` **1 次** · `'general'` **6 次**;逐字:
`v_tier text := 'general';` / `v_uid uuid := auth.uid();`
⇒ 🔴 **三處 fail-closed**:沒有 `auth.uid()` ⇒ `general` · 有 uid 而 `customers` 查無此人 ⇒ `general` ·
`v_tier IS NULL OR NOT IN ('general','store')` ⇒ `general`。
📌 **⇒ 「身分怎麼進來」在這個 repo 已經有答案, 而且是【失敗時退回一般價】那一種。**

## 7-2c 可能的形狀(**列出來, 不選**)
· **甲 · RPC 自己問**(照 `get_effective_prices` 的樣子:`auth.uid()` ⇒ 查 tier)
  ⇒ 好處:與既有範本一致、fail-closed 已經有寫法可抄。**代價**:目錄頁是最熱路徑, **每次多一次查表**(成本我沒量)。
· **丙 · 另開一支經銷專用的 RPC, 用 ACL 分開**(一般那支維持不變, 經銷那支只授給該授的角色)
  ⇒ 好處:**一般客人那條路一個字都不動**;**代價**:兩支要一起維護, 而**今天已經因為兩個多載吃過苦頭**。
· **丁 · 價格解析留在 server 端**(RPC 只回原始欄位, 由 server 依身分挑)
  ⇒ 🛑 **而它與 Server 端鐵則「經銷價絕不傳到一般會員瀏覽器」相衝的地方要先想清楚** ——
  若 RPC 一律回兩種價再由 server 挑, **那兩種價就都離開資料庫了。**
⇒ **三種都沒有被排除, 而乙已經被排除。**

## 7-3 🛑 這一格證不到什麼
· 我**沒有**驗「Supabase 在這條路徑上真的會把 JWT 帶進來」—— 那是**平台行為**, 我只證了函式是 INVOKER。
· 我**沒有**查顧客站實際用哪個 key 連(`anon` 還是別的)—— 我的唯讀連線是 `pcm_readonly`, **問不到別人用什麼**。
· 我**沒有**量那一次查表的成本(§7-2 最後那句是**推的**)。

---

# 8. §5 四格全部補完(2026-09-07 · 唯讀實測;主視窗 A 傳達 Sean `q74: 要` ⇒ plan 不再是「等批」)

> 🔴 **本節每一個讀數都附【它是在哪裡量的】**:`repo` = 版控字面 · `prod` = `scripts/readonly-prod-sql.sh` 唯讀連線當場量。
> 負對照:同一發查一個不存在的欄 `price_zzz_does_not_exist` ⇒ **0 列**(量具會回答「沒有」)。

## 8-1 【格 2】舊 11 參數多載 —— ⛔ **它不是 stale, 它是【左側篩選面板】的正線**

| 呼叫點(repo, 剝註解後逐鍵數) | 參數顆數 | `p_new_since` | 打到哪一支 |
|---|---|---|---|
| `apps/storefront/src/lib/products.ts:451` | **12** | 有 | 新多載 `336beaff…` |
| `apps/storefront/src/lib/vehicle-facet-counts.ts:203` | **11** | ❌ **無** | 🔴 **舊多載 `169bf913…`** |

正對照:`p_new_since` 全 src 命中 **16** 處;負對照 `p_zzz_nonexistent` **0**。
⇒ ✅ **答案:兩支都要改, 而【不可以趁這次收掉舊那支】** —— 收掉它 = 左側篩選面板的筆數整個掛掉。
⇒ 🛑 **`⟦db-STALEOVERLOAD1⟧` 那個名字會誤導下一個人**(「stale」讀起來像沒人叫)。**要收它, 得先讓 front 那半補 `p_new_since`;那是【另一片】, 不在本片範圍。**

## 8-2 【格 3】view 怎麼加 —— ⛔ **加欄到 `products_list_public` 不可以, 而理由不是洩漏, 是【它讀不到】**

prod 讀數:
· `public.products` 全欄 **28**、其中 `price*` **3** 欄;**有欄級 ACL 的 20 欄**裡 `price_general` **在**、🔴 `price_store` **不在**。
· `public.products` 整表 `relacl` = `{postgres, service_role, pcm_readonly}` ⇒ **anon / authenticated 整表零權限, 只有欄級。**
· `products_list_public`:**16 欄**(逐欄列出, `price_store` **不在**)· `reloptions = {security_invoker=true}` · `relacl` 含 `anon=r`。
· repo 佐證:view 自己的註解逐字 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`(`20260906910000…:267` 與 `:405`)。
· SQL 側讀者分母:`FROM/JOIN products_list_public` 命中 **10 支 migration / 分母 382**,**全部都是 catalog RPC 那一族**(無其他讀者)。

⇒ 📌 **`security_invoker=true` 代表這張 view 用【呼叫者】的權限讀底表** ⇒ 把 `price_store` 加進去之後,
**anon 一旦選到那一欄就是 `permission denied`, 不是看到經銷價。**
⇒ ✅ **答案:不加進這張 view。** 兩條備選(**列出來, 不選**):另開一支**不授 anon** 的經銷 view / 或讓 RPC 自己去底表取。

## 8-3 【格 4】身分怎麼進來 —— 🔴 **答案比 §7 那時更硬:任何形狀都得先解決「INVOKER 讀不到 `price_store`」**

prod 讀數(⑤格):**兩支多載 `prosecdef = f`**(INVOKER)· owner `postgres` · `proconfig = {search_path=public, pg_temp}`。
⇒ 顧客站用 `anon` 打這支(`products.ts` 逐字 `createSupabaseAnonClient()`)⇒ **函式以 anon 的身分跑**
⇒ 🛑 **anon 對 `price_store` 零權限** ⇒ **今天的形狀下, 這支函式【拿不到經銷價】, 不管它知不知道你是誰。**

⇒ 因此可行形狀剩兩條, 而**兩條都改變安全姿態**:
· **甲′ · 改 `SECURITY DEFINER`**(照 `get_effective_prices` 的 fail-closed 範本:`auth.uid()` ⇒ 查 `customers.tier` ⇒ 查無退 `general`)
  🔴 **代價要明寫**:這支**對 `anon` 開著**, 一旦 DEFINER, **函式體裡任何一個沒防好的路徑都是以 owner 的權限在跑**。⇒ 鐵則 12 最高風險格。
· **丙′ · 另開一支經銷專用 RPC + 只授該授的角色**(一般那支一個字不動)
  🔴 **代價**:多一支要維護, 而**今天已經因為兩個多載吃過苦頭**(8-1)。
· ⛔ **乙(呼叫端傳旗標)已排除**(§7-2);⛔ **「給 anon `GRANT SELECT (price_store)`」更不行** —— 那就是把經銷價公開, 直接違反 Server 端鐵則。

## 8-4 【格 1】`recommend` 價帶 `4000` / `13800` —— **這格是 Sean 的, 我只把事實擺好**
repo 字面:`c_recommend_band_lo constant int := 4000;` / `c_recommend_band_hi constant int := 13800;`
(**5 支 migration 各一份**;最新 `20260906910000…:161-162`)。用途 = `recommend` 排序把落在帶內的商品排前面(`:227` / `:365` 起那段 `row_number()`)。
⇒ **問題形狀**:經銷價普遍較低 ⇒ 同一個帶套在經銷價上, **會把原本「中高價」那一群整個推出帶外**。
⇒ 兩個選項(**Sean 拍**):**維持同一個帶**(簡單、而經銷客人的推薦順序會偏掉)/ **跟著身分換一組帶**(準、而多一組要定的數字)。

## 8-5 🛑 本節證不到什麼
· 我**沒有**驗「Supabase 在 anon 這條路徑上會把 JWT 帶進來」—— 那是平台行為, 我只量到函式是 INVOKER。
· 我**沒有**量 DEFINER 化之後的成本, 也**沒有**逐行審過函式體有沒有可被 DEFINER 放大的路徑 —— **那是 codex 那一輪要做的事。**
· 8-1 的「12 / 11 顆」是**剝掉註解後逐鍵數**的, 不是憑呼叫端的型別;型別那層(`database.types.ts`)我**沒查**。
