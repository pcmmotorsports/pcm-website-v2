# Q74 第 2 片 · plan —— 經銷專用目錄 RPC(`search_catalog_by_vehicle_dealer`)

> 線【資料】`-db` · **鐵則 8 ⇒ 只 plan、零改動, 等主視窗批** · **鐵則 12 ①③⑥ ⇒ 動碼前跑 codex, 不降級**
> 🕐 **本檔每一個正式庫讀數的量測時點 `2026-09-07 15:5x UTC`** · `pcm_readonly` **唯讀零寫入** · 座標 `origin/dev=b7e9bef77`
> **兩個已拍**:`Q74-a` = **丙′**(主視窗 A;另開一支經銷專用 RPC, **一般那支一個字不動**)· `Q74-b` = **同一組**(Sean;推薦排序的價帶**不隨身分換**)

## 0. 🔴 先訂正一個我自己今天量錯的數 —— 因為整份 plan 的驗收掛在它身上
我今天第一發問「有幾筆經銷價與一般價不同」, 印出 **25768**。**那個數是錯的**, 而它錯得很像對的。
**同一發把三種問法一起印**(2026-09-07 15:58 UTC):
```
a 全部 .................................. 25769
b price_store 是 NULL ................... 25768
c price_store 有值 ...................... 1
d price_store IS DISTINCT FROM general .. 25768   ← 🔴 我第一發用的就是它
e 有值【且】與一般價不同 ................ 0      ← ✅ 有判別力的是這個
f 有值且相同 ............................ 1
🔵 負對照(必為 0 的條件)⇒ 0
```
🎯 **`d = b + e`** —— **`IS DISTINCT FROM` 把「根本沒有經銷價」也算成【不同】。**
⇒ 📌 **今天真正的判別力仍然是 0**(昨晚那個讀數成立)。
🛑 **⇒ 而這正是本片驗收那一格的全部理由**(見 §4)。

## 1. 病(不變, 而座標重量過)
`search_catalog_by_vehicle` 的**篩選 / 排序 / recommend 價帶**三處都只認 `price_general`;而**經銷客人畫面上看到的是經銷價**。
**今天兩支多載的姿態(實測)**:
```
11 參數  md5 169bf9136f502dd8269f699255782342 / 13029 · prosecdef=f · search_path=public, pg_temp
12 參數  md5 336beaff1188c7670e85134db5aa623b / 17207 · prosecdef=f · search_path=public, pg_temp
兩支的 proacl 都含 anon / authenticated / service_role
```
🔵 **範圍只做 12 參數那一支**(昨天量到:facet 那條路四處 `p_price_min`/`p_price_max` 皆字面 `null` 且 `p_sort='new'` ⇒ **11 參數那支永遠不吃價格**)。
⚠️ **而 11 參數那支【仍然是活的正線, 不可以收掉】** —— 它是左側篩選面板的筆數來源。

## 2. 前置(**已完成, 這是 plan 的地基**)
**貼板 92 已貼**(主視窗貼, `20260908000000`)⇒ 今天實測:
```
public.products_list_dealer   relkind=v · reloptions=(NULL) ⇒ security_invoker 未設(=false)
                              relacl={postgres=arwdDxtm/postgres}    ← 🟢 **沒有 service_role**
                              owner=postgres
```
⇒ ✅ **那張 view 讀得到 `price_store`, 而 `anon`/`authenticated`/`service_role` 都拿不到它。**

## 3. 要建什麼(**丙′**)
```
public.search_catalog_by_vehicle_dealer( 與 12 參數那支【同簽章】 )
  SECURITY DEFINER · SET search_path = ''        ← 照範本 get_effective_prices(prosecdef=t · search_path="")
  owner = postgres
  兩道 REVOKE(FROM PUBLIC / FROM anon, authenticated)後 → GRANT EXECUTE TO authenticated
    🔴 範本的 proacl 逐字是 {postgres, authenticated} —— **anon 不在**, 本片照它
  body = 12 參數那支的逐字複本, 只改兩處:
    ① public.products_list_public  ⇒  public.products_list_dealer
    ② 開頭加 fail-closed 身分檢查(照 get_effective_prices 的三處 fail-closed 寫法):
       v_uid := auth.uid();  查 customers.tier;  查無 / 非 'store' ⇒ **RAISE**(不 fallback)
  🔵 recommend 價帶 c_recommend_band_lo/hi 維持 4000 / 13800(Sean `Q74-b` = 同一組)
```
🛑 **為什麼 fail-closed 是 RAISE 而不是退回一般價**:退回一般價 = **這支變成一般那支的複本**, 而呼叫端本來就該挑;**RAISE 讓「叫錯支」在第一次就會被看見**。

## 4. 🔴 驗收怎麼綁(**主視窗指定要進 plan 的那一格, 逐字**)
> **證明「今天有問題」不造資料;證明「修完行為對」必須造一筆 `general ≠ store`, 而且【只在拋棄式 PG / 本機】**
> —— **正式庫今天 `store` 0 人, 在那裡造一個 = 製造一個真實世界不存在的東西, 而沒有人會記得刪掉它。**

**而 §0 給了它一個可查證的理由**:
```
正式庫今天:e(有經銷價且與一般價不同)= 0 · customers.tier 15 位【全部 general】, store = 0
⇒ 📌 在正式庫上, 改對與改錯【印同一個畫面】—— 驗收在那裡沒有材料。
```
**⇒ 驗收分三段**:
1. **結構**(可在正式庫唯讀驗):`prosecdef=t` · `search_path=""` · `proacl` **無 anon** · owner=postgres · 兩道 REVOKE 生效
2. **行為**(**只在拋棄式 PG**):造 ≥1 筆 `price_store <> price_general` + 一位 `tier='store'` 的 customer
   ⇒ 比**同一組條件**下兩支 RPC 的**回傳列序與 total**:**必須不同**;🟢 而**正對照**:造一位 `tier='general'` ⇒ **兩支必須相同**
3. **上線後**(第五族):**真資料進來那天**才驗得到端到端。**本片寫完在那之前【證不到它是對的】** —— 這句要跟著片子走。

## 5. 🔴 風險與鐵則
· **鐵則 12 ①(錢:經銷價)③(DB 結構)⑥(共用元件行為 —— 目錄頁是最熱路徑)** ⇒ **codex 對抗審查不降級**, commit 前跑。
· **鐵則 8**(動 schema / 新 DB 物件)⇒ **本 plan 等主視窗批**。
· 🔴 **DEFINER 的放大面**:本支是 DEFINER 而**只授 `authenticated`**(**不授 `anon`**)⇒ 與昨天排除甲′ 的理由一致(甲′ 會產出全 repo 第一支「anon 叫得動的 DEFINER 且讀得到 `price_store`」)。
· ⚠️ **兩支要一起維護** —— 那是丙′ 的已知代價, 明寫。**判別句**:一般那支之後每次改, 要問「經銷那支要不要跟」。

## 6. 🛑 本 plan 證不到什麼
1. **我沒有讀 12 參數那支的完整 body**(17,207 字元)—— 複製時要**逐字**, 而**逐字複製本身要一道機械檢查**(比兩支剝註解後只差那兩處)。
2. **`search_path=''` 會改變函式體裡每一個沒加 schema 前綴的名字怎麼解析** —— **我沒有逐行核過那 17k 字元**。**那是 codex 那一輪要做的事。**
3. **平台會不會在這條路上帶 JWT 進來** —— 只量到範本是 DEFINER 且只授 `authenticated`, **沒驗平台行為**。
4. **成本沒量** —— 多一次 `customers` 查表, 而目錄頁是最熱路徑。
5. **前端怎麼決定叫哪一支** —— 那是 front 那半, **不在本 plan**。

---

# 7. 主視窗 A 批准 + 四件加註(2026-09-08 00:0x;**前兩件是條件不是建議**)

## 7-1 🔴【條件①】「逐字複本」要有**機械檢查**, 不是宣稱 —— **寫進驗收①**
> 📌 **「我複製的時候很小心」與「它逐字相同」在 diff 上是同一件事, 而只有前者需要相信我。**

**檢查(migration 內的事後閘, 當場跑)**:
```
取兩支的 prosrc, 各自剝掉 `--` 註解與行尾空白 ⇒
  把經銷那支的 'products_list_dealer' 全部換回 'products_list_public'
  再把【開頭那段 fail-closed 身分檢查】切掉(以一個唯一的錨字面定界)
⇒ 剩下的兩份必須【逐位元組相同】;不同 ⇒ RAISE, 整筆回滾
🟢 而這道閘要帶正對照:同一支尺去比【一般那支 vs 它自己】⇒ 必須相同(證明尺不是恆綠)
🔵 負對照:故意把換回去那一步拿掉 ⇒ 必須紅
```
🛑 **而它證不到什麼**:它比的是**剝註解後的字面**, **不比行為**;而**兩處以外的差異若剛好落在註解裡, 這道閘看不到**(昨晚那條「第二欄那把尺分不出碼與註解」的同族)。

## 7-2 🔴【條件②】`search_path=''` 那格**明確交給 codex, 而 plan 要寫出【要它看什麼】**
> 📌 **一個沒有指定看什麼的審查, 回來的是它想看的那些。**

**交給 codex 的題目逐字(不是「請審一下」)**:
> **逐行核那 17,207 字元的 body:在 `SET search_path = ''` 之下, 每一個【沒有加 schema 前綴】的名字會解析到哪裡。**
> 逐項列出:**表 / view / 函式 / 型別 / 運算子 / cast**;哪些靠 `pg_catalog`(永遠找得到)、哪些會**變成找不到**、哪些會**解析到不同的東西**。
> 🔴 **而它是 `SECURITY DEFINER`** ⇒ 順帶答:**函式體裡有沒有任何一條路徑, 在以 owner 身分跑時會做到它以 invoker 身分做不到的事。**

## 7-3 🟢【加註③】fail-closed 用 RAISE —— **主視窗背書, 而理由要留在碼裡**
> **一個「安全的 fallback」會讓這一整支存在的理由消失, 而且不會有人發現。**
⇒ 那句話**寫進函式的註解**, 不只寫在 plan。

## 7-4 🟢【加註④】驗收② 的正對照是關鍵 —— **理由補上**
> **只驗「不同」的話, 一支壞掉而總是回空的 RPC 也會通過。**
⇒ 所以 `tier='general'` **必須回到與一般那支【相同】**, 而不是「回了東西就算過」。

## 7-5 🔴 而【前端那半誰接】要在這裡明寫(主視窗:否則它會變成「交辦停在列尾」的第 N 個)
· **要做的事**:呼叫端依身分決定叫 `search_catalog_by_vehicle` 還是 `…_dealer`;**兩個呼叫點**
  `apps/storefront/src/lib/products.ts:451`(清單)· ⚠️ 而 `vehicle-facet-counts.ts:203` **不動**(它走 11 參數那支, 不吃價格)。
· **誰接**:🔴 **我沒有派任何人 —— 這一格是【待指派】。** 建議 `front`(那兩個呼叫點都在 storefront)。
· 🛑 **而在它接上之前, 這支新 RPC【零呼叫端】** ⇒ **貼上去對客人零行為改變**, 而**那不等於它是對的**。
