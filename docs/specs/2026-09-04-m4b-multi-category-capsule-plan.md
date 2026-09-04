# Plan · 分類膠囊改成【可以多顆】 · ⟦search-PREFIXWRONGCAT⟧ 續片

> 寫者 = 線【前台】`-front` 2026-09-04。**本 plan 期間零改碼。**
> 🔴 **本片命中鐵則 8**(跨 3+ 檔 + 動 RPC)**與「要 Sean 貼 SQL」** ⇒ 批准才動手。

---

## 0. 為什麼有這一片(拍板來源, 逐字)

Sean 2026-09-04 下午, 原話落在 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾:

```
Q-落點① 客人打「煞車」, 要送他去哪?
兩個都給，不用客氣

Q-落點② 客人打「排氣管 油箱貼」兩個字, 哪個說了算?
都給

反正就是盡可能的兼容，模糊搜尋但是盡可能地接近
```
後續補問, 他再拍:
```
甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)
```

🎯 **他推翻的是「只能選一個」這個前提, 不是選了哪個選項。**
⇒ 📌 **【膠囊可以有多顆】這個設計從來沒有被提出來過**, 所以兩題我端的都是二選一。
⇒ 判準逐字:**「盡可能的兼容, 模糊搜尋但是盡可能地接近」= 召回優先於精度。**

---

## 1. 本片的核心不是設計, 是【抄品牌那一格】

🔬 **量到的(2026-09-04, `supabase/migrations/20260827180000_…_new_arrivals_exclude_repair_parts.sql:45-46,103-104`)**:

```sql
p_category    text     DEFAULT NULL,          -- 單值
p_brand_slugs text[]   DEFAULT NULL,          -- 🟢 多值, 而且【端到端已經通了】

:103  WHERE (p_category IS NULL OR p.category_raw = p_category
                                OR p.category_raw LIKE p_category || ' · %')
:104    AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0
                                   OR p.brand_slug = ANY(p_brand_slugs))
```

📌 **⇒ 不要發明。品牌那一條路(URL / 解析 / 畫面 / RPC)全通了, 逐格對照它。**
🔴 **而【對不上的地方】才是這一片真正的內容** —— 下面第 3 節就是那些格。

---

## 2. 要動的五層(逐層, 帶現況座標)

| # | 層 | 現況(座標) | 要變成 |
|---|---|---|---|
| ① | 解析 | `parse-search-facets.ts` `ParsedFacets.category: string \| null` | `readonly string[]` |
| ② | 寫網址 | `app/products/page.tsx:149` `next.set('category', 一個值)` | 多值(照 `?pbrands=a,b`) |
| ③ | 讀網址 | `products-url-parsers.ts:54` `parseCategoryFromUrl` 回一個物件 | 回陣列 |
| ④ | 畫面 | 一顆膠囊 | N 顆 |
| ⑤ | 🔴 **RPC** | `p_category text` | `p_categories text[]` ⇒ **一支 migration** |

⚠️ **⑤ 連帶**:`packages/adapters/src/supabase/database.types.ts:4342-4343` 是**產生的**, 貼完要重產。

---

## 3. 對不上品牌那一格的三處 —— 這才是本片的內容

### 3a 🔴 分類的述詞有【兩個分支】, 品牌只有一個
品牌是 `p.brand_slug = ANY(p_brand_slugs)` 一句話。
分類是 `= p_category` **或** `LIKE p_category || ' · %'`(因為 `category_raw` 是 `父 · 子`)。
⇒ 多值之後**每一個元素都要走那兩個分支**:
```sql
AND (p_categories IS NULL OR cardinality(p_categories) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_categories) AS c
                 WHERE p.category_raw = c OR p.category_raw LIKE c || ' · %'))
```
✅ **這是聯集**(任一元素中就算中)= Sean 拍的甲。
🛑 **不是** `p.category_raw = ANY(p_categories)` —— 那樣會漏掉「打大類要涵蓋子類」那一半。

### 3b 🔴 排序那三行依賴 `p_category IS NULL`, 而它會安靜地變
⛔ ~~🔬 同一支檔 `:145 :149 :155` 逐字**三處**~~ **⇒ 2026-09-04 實作時作廢, 那個數是錯的。**
🔬 **真正的分母是 12**(`grep -c` 於函式段):那支函式有**兩份**查詢, 每份 **6** 處。
🛑 **我當時只 grep 到一份** ⇒ 📌 **一個少報 4 倍的分母, 而它讀起來完全像量過的。**
✅ **而修法讓那個數字不再需要人去對**:新版把新舊入口收成一個 `v_cats`,
**所有分支只讀它** ⇒ 改完之後**碼裡直接讀 `p_category` 的只剩 2 處**(參數宣告 + 合流那一行),
而那是一道**事後閘在正式庫上數**的(斷言③)。
🎯 **⇒ 把「要記得改 12 處」換成「結構上只有 1 處可改」。**
⇒ 改成陣列之後, `IS NULL` **不再等於「沒有選分類」** —— 空陣列也是「沒有選」。
⇒ ✅ 三處都要改成 `(p_categories IS NULL OR cardinality(p_categories) = 0)`。
🛑 **漏掉任何一處 ⇒ 排序行為改變而【結果集不變】** ⇒ 📌 **測試若只驗「回幾筆」看不到它。**

### 3c ⚠️ 網址用逗號分隔, 而那安全**只是今天的事實**
🔬 量到的(2026-09-04 唯讀正式庫 117 個分類):**含逗號的 0 個** · 含分隔符 ` · ` 的 0 個 · **含括號的 4 個**
(`尾段排氣管(Slip-On)` / `煞車皮(來令片)` / `其他配件(待細分)` / `車身保護膜(犀牛皮)`)。
⇒ 🛑 **「0 個含逗號」是【現況】不是【保證】** —— 哪天有人建一個含逗號的分類, 網址就會被切錯, 而**沒有東西會叫**。
⇒ ✅ **對策二選一(要挑)**:甲 沿用逗號 + 加一道「分類名不得含逗號」的守門 · 乙 改用重複 key `?category=a&category=b`(`products-url-parsers.ts:87` 逐字說舊的 `?pbrand=a&pbrand=b` 形狀**本來就吃**)。
🔵 **我推乙** —— 它不需要新守門, 而且那個形狀在本 repo 已經有前例。

---

## 4. 🔴 部署順序(這一格寫死, 不可以憑記憶)

```
① Sean 貼 migration(RPC 加 p_categories text[])   ← 只有他貼得了
② 重產 database.types.ts + commit
③ TS 那半才能上
```
🛑 **順序反過來 ⇒ `PGRST202` 打死整條搜尋**(找不到那個簽章)。
🔴 **而「唯讀」與「apply」是兩個授權, Sean 只給了唯讀** ⇒ **本窗不得 apply, 只能把 SQL 交出去。**
✅ **貼完要驗的不是「他說成功了」** —— 是唯讀連線讀 `pg_get_functiondef` 看新簽章在不在(帶正負對照)。
### 🔴🔴 [2026-09-04 訂正 —— 我原本寫的相容做法在 Postgres 層是錯的]

⛔ ~~**相容做法(建議)**:新參數用 `DEFAULT NULL` 並保留舊的 `p_category`~~ **⇒ 作廢。**

🔬 **repo 裡今天就有人量過同一件事**(線【信】`-mail`, `supabase/migrations/20260904020000_m4b_create_order_payment_channel.sql:14-40`):
- **`CREATE OR REPLACE` 改不了參數列** —— 加一個參數是**新增一支多載**, 不是取代 ⇒ 新舊兩支並存。
- 🔴 **而新參數若給 `DEFAULT`, 兩支都吃得下同一組名字** ⇒ 實測回
  `PGRST203 Could not choose the best candidate function between: …`
- ✅ **正確形狀:新參數【刻意不給 DEFAULT】** —— 那是承重的不是風格。
  🎯 **分辨器不是參數個數(會重疊), 是【名字集合】**:舊那支沒有這個名字, 新那支它必填
  ⇒ **兩邊各自被一個必填的名字釘死。**

✅ **⇒ 本片照抄那個三步形狀**(而每一步單獨都安全):
```
A 本片的 migration:CREATE 帶 p_categories text[](🔴 不給 DEFAULT)那支 ⇒ 兩支並存
  ⇒ 線上的 TS 送的名字裡沒有 p_categories ⇒ 精準命中舊那支 ⇒ 零影響
  🔴 貼完立刻 NOTIFY pgrst, 'reload schema';  ← 少了它, B 上線後【第一筆】才炸 PGRST202
B 部署 TS:名字裡加 p_categories ⇒ 精準命中新那支 ⇒ 零影響
C 另一支 migration:DROP 舊簽章 ⇒ 此時已無人呼叫
```
🎯 **⇒ 三步之間任何一個時刻都只有一個唯一解 —— 不是祈禱, 是結構保證。**

⚠️ **而那個實測的射程要照搬, 不要洗白**(原文逐字):量的是 **PostgREST 14.16 + 本機 PG 17.10**,
而正式站是 **Supabase 的版本** ⇒ 🛑 **「正式站也一樣」是【推的】, 不是量到的。**

⚠️ **代價**:C 那一步(DROP 舊簽章)**要另一支 migration, 而那又要 Sean 貼**
⇒ **「下一片會刪」這種話最會過期** ⇒ ✅ **要開一列板**(`⟦search-DROPOLDCATSIG⟧`)。

### 🔬 而【正式庫現在跑哪一代】我量了, 不是查帳本
`latest-definition-of.sh` 說 repo 最後兩代 `20260827150000` / `20260827180000` **帳本都未記** ——
🛑 而今天證過**帳本無紀錄 ≠ 沒貼**(`⟦01-LEDGERFALSENEG⟧`)⇒ **不能拿它推**。
✅ **唯讀正式庫實測**(`pg_get_functiondef`):`c_recommend_band_lo` ⇒ **t**(150000 的特徵)·
`維修零件` ⇒ **t**(180000 的特徵)· 正對照 `p_brand_slugs` ⇒ **t** · 負對照現造字面 ⇒ **f**。
🎯 **⇒ 正式庫跑的就是 `20260827180000`(repo 最新那一代), 帳本只是沒記。**
📌 **⇒ 所以本片的 `CREATE` 要以 `20260827180000` 的內容為底。** 而**這一格若沒量,
我會在一個不確定的底上疊東西, 而三綠不會叫。**

**今天的簽章(唯讀實測, 11 個參數)**:
`p_brand text, p_model text, p_year integer, p_offset integer, p_limit integer, p_sort text,
 p_category text, p_brand_slugs text[], p_price_min integer, p_price_max integer,
 p_new_since timestamp with time zone`

---

## 5. 🛑 Sean **沒有答**的兩格 —— plan 裡標未答, 不自己填

```
· 多顆膠囊怎麼【排序】?誰在前面?
· 【上限】幾顆?(打一個字命中 5 個分類 ⇒ 全出?)
```
⚠️ **而實作上不得不有一個預設** ⇒ 明寫**這是實作預設, 不是拍板**:
- **排序** = 命中順序(詞在句子裡的先後 → 每個詞的候選依涵蓋件數遞減)
- **上限** = 每個詞取 1 顆, 全句最多 = 詞數 ⇒ 🔵 這讓「打一個字命中 5 個分類」不會爆
- 🔴 **而這兩個預設會改變畫面, 撞到就停下來端他**, 不要靜靜地做完。

📌 **`蓋` 那個實測值得帶進這一題問他**:單一個字 `蓋` 今天命中 `引擎護蓋與護桿`(688 件),
而 `splitWords` **沒有最短詞長** ⇒ 多顆之後單字詞會產生更多膠囊。**要不要設最短詞長也是他的。**

---

## 6. 回滾

- **TS 那半**:`git revert` 即可(純前端, 無資料異動)。
- 🔴 **RPC 那半**:新參數若走**第 4 節的相容做法**(`DEFAULT NULL` + 保留 `p_category`)⇒ **回滾 = 只 revert TS, 不必動 DB**。
- ⚠️ **若走「直接改簽章」** ⇒ 回滾要**再貼一支 migration 把舊簽章加回來**, 而那又要 Sean ⇒ 📌 **回滾成本從「一個 revert」變成「等一個人」。**
- ✅ **⇒ 這是選相容做法的主要理由, 不是為了優雅。**

---

## 7. 驗收(每條可 yes/no)

- [ ] 打 `煞車` ⇒ **兩顆**膠囊:`煞車系統` 與 `拉桿與把手 · 煞車離合器拉桿`
- [ ] 打 `排氣管 油箱貼` ⇒ **兩顆**, 而**不是**誰壓過誰;`leftover` 為空
- [ ] 那 16 個(`⟦search-PREFIXWRONGCAT⟧` 板列)**沒有一個變差**
- [ ] 空陣列 / `undefined` ⇒ 行為與「沒有選分類」逐字相同(**含 `recommend` 排序那三處**)
- [ ] 🔴 **負對照**:一個誰都不含的詞 ⇒ 0 顆膠囊 + 那個字留在 `leftover`
- [ ] 🔴 **突變**:把述詞從 `EXISTS(unnest…)` 改成 `= ANY` ⇒ **必須紅**(那會漏掉子類涵蓋)
- [ ] 🔴 **突變**:排序那三處只改兩處 ⇒ **必須紅**(見 3b;要一格**驗排序**不只驗筆數的測試)
- [ ] 貼完 RPC ⇒ 唯讀連線讀 `pg_get_functiondef` 確認新簽章(帶正負對照)

---

## 8. ⚠️ 本 plan 沒有涵蓋什麼

- **排序與上限的畫面設計** —— 那兩格他沒答, 而我也還沒動到畫面層。
- **`⟦search-NOSEARCHLOG⟧`** —— 這一片仍然**沒有任何真實客人打過的字**;
  🎯 **所以「兩顆比一顆好」這件事本身也是推的, 不是量到的。**
- **`大燈` 那一格** —— 它是**庫存漂移**不是規則錯(見 `parse-search-facets.test.ts` 那格註解)。
  多顆之後它會拿到兩顆, 而**那不代表漂移那個問題被解決了**:`count` 仍然是排序的依據。
