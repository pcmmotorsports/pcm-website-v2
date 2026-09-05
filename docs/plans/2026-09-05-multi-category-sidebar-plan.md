# Plan · 多顆分類下側欄選分類要生效(Sean 2026-09-05 `21`)

> **Sean 逐字**(`~/pcm-mailbox/端Sean-0905早上佇列.md:225`):
> 「**這邊我要把多顆分類修好，因為我們客人可能會多選不同分類**」
> ⇒ 🔴 **他不選甲也不選乙** —— 我端的兩個選項(甲=維持現狀 / 乙=清掉多顆換成新的)**都被推翻**。
> 他要的是**第三種**:客人多選之後, 側欄再點一下要**生效**。合理讀法 = **加進已選那組**。
> 🛑 **而板列 `⟦search-CASCADEINMULTI⟧` 寫著「第三條路技術上是死的」—— 那句是我寫的, 本 plan 第一件事就是重驗它。**

## 0. 先講結論:那句「死的」**半對**, 而它讓我少看了一條路

⛔ ~~第三條路(讓側欄的選擇也寫進多顆狀態)**技術上是死的** —— `cascade.category` 是單值的, 從它推 `categories` 結構上不可能對~~

🔬 **重驗(逐條附座標)**:
- ✅ **「單值」那半是真的**:`packages/ui/src/filters/cascadeFilterReducer.ts:87-94` 逐字 `category: CategorySelection | null`。
- 🔴 **而「所以死路」那半【不成立】** —— 我當時只想到「**從 cascade 推出整組 `categories`**」這一條,
  **而根本不需要推整組**:`apps/storefront/src/lib/catalog-query.ts:184-196` 的 `categoriesFromParams`
  **已經把 `categories` 與 `category` 兩個參數合併去重**成一組:
  ```
  [...new Set([ ...(categories ?? '').split(','), ...(legacy !== null ? [legacy] : []) ])]
  ```
  ⇒ 📌 **多顆狀態下只要把新選的那一顆寫進 `category=`, 讀取端就會把它【加進】已選那組。**
  **不必動 `cascade` 的形狀, 也不必動 `packages/ui`。**
🎯 **⇒ 我把「我想到的那一條路走不通」寫成了「這件事做不到」。**

## 1. 那為什麼現在寫不進去 —— 真正的障礙是什麼

`apps/storefront/src/components/use-catalog-filter-url-sync.tsx:251` 逐字:
```
if (!params.has(CATEGORIES_PARAM)) { …只有在【沒有多顆】時才寫 category… }
```
這個守衛是 2026-09-04 為 `⟦search-CHIPDELETEDEADURL⟧`(Sean 拍甲)加的, 它擋的是**刪膠囊的死網址**:
客人刪掉膠囊 B ⇒ 網址變 `?categories=A` ⇒ 而 `cascade` 還握著 B ⇒ 若這裡照寫, **B 會被寫回來, 刪除鍵等於沒反應。**

🔴🔴 **⇒ 真正的難題【不是能不能寫】, 是【分辨兩種「cascade 與網址不一致」】**:
```
情境甲 · 客人在側欄【新選】一個分類   cascade=C, 網址 categories=A,B   ⇒ 要寫(加進去)
情境乙 · 客人【刪掉】一顆膠囊          cascade=B, 網址 categories=A     ⇒ 不能寫(否則 B 復活)
```
🛑 **兩者在 `cascade ≠ 網址` 這個條件上【完全相同】** —— 現行的 `categoryAxisSuppressed`(`:249-250`)
分不出它們, 所以它選了「兩個都不寫」= 保住乙、犧牲甲。**那正是 Sean 現在要拿回來的那一半。**

## 2. 兩案(帶代價;推薦 A)

### 案 A · 用「這一波是誰發動的」分辨(**推薦**)
兩種情境的差別**不在值, 在方向**:甲是 **state 先動**(側欄 dispatch), 乙是 **URL 先動**(膠囊改網址後導頁)。
本 hook **已經有這條資訊的雛形**:`lastFilterKeyRef`(`:139,149-150`)每一波都存上一次的 filter key,
`pendingRestoreRef`(`:130,180-181`)已在區分「還原波 vs 使用者自選」。
⇒ **作法**:分類軸被壓下時, 再問一句「**這一波 `cascade.category` 有沒有變**」——
變了 = 甲(側欄新選)⇒ 寫進 `category=`;沒變 = 乙(URL 先動而 cascade 是舊的)⇒ 照舊不寫。
- **改動面**:只動 `use-catalog-filter-url-sync.tsx` 一支檔的守衛條件 + 回歸測試。**不碰 `packages/ui`、不碰 schema。**
- 🔴 **代價/風險**:①這條判別**建立在「側欄一定會讓 `cascade.category` 改變」上** —— 若客人在多顆狀態下**點了已經選過的那一顆**, cascade 不變 ⇒ 這一按仍然沒反應(**比現在好, 但不是全好**)②`categories` 與 `category` 會**同時存在**於網址, 而讀取端合併 —— **網址變長、且同一顆可能寫在兩個參數裡**(讀取端有 `new Set` 去重, 但**看起來會怪**)。
- ⚠️ **要驗的**:`⟦search-CHIPDELETEDEADURL⟧` 那條**不得回歸** —— 刪膠囊必須仍然有效。

### 案 B · 把 cascade 的分類軸改成多值
`CascadeFilterState.category` ⇒ `categories: CategorySelection[]`, 單一真相來源, 兩個網址參數都由它推。
- **改動面**:🔴 **`packages/ui/src/filters/cascadeFilterReducer.ts`(共用元件)+ 所有讀 `cascade.category` 的呼叫端 + 側欄元件 + 這支 hook**。⇒ **命中鐵則 12⑥(`packages/ui` 行為改動)= 高風險片, 要 codex 對抗審查。**
- 🟢 **好處**:兩個情境的分辨變成不必要(state 本來就是多顆);案 A 那兩個代價都消失。
- 🔴 **代價**:體積大很多、跨 3+ 檔(鐵則 8 要 plan 等批 —— 就是本檔)、而且**動的是全站共用的篩選狀態**;`⟦search-CHIPDELETEDEADURL⟧` / `#289` 還原波 / `#287` segment 碰撞那幾條回歸鎖**全部要重驗**。

## 3. 推薦與理由
**推薦 A**, 而理由不是「比較小」是**射程**:Sean 要的是「多選之後側欄還能加」, **案 A 直接答那一句**;
案 B 是把整個篩選狀態重新設計, 那是另一個題目, 而它會把 `⟦search-CHIPDELETEDEADURL⟧`(Sean 09-04 才拍的)整條重開。
⇒ 🔵 **若 A 那兩個代價 Sean 不接受, 再走 B** —— 而那時要當**獨立的高風險片**排, 不是本片加大。

## 4. rollback
案 A 只動一支檔的守衛條件 ⇒ **revert 那一顆 commit** 即回到今天的行為(多顆下側欄不生效, 而刪膠囊有效)。

## 5. 驗收(每條可 yes/no)
1. 多顆狀態(`?categories=A,B`)下, 側欄點 C ⇒ 網址出現 C **且**結果件數改變。
2. 🔵 **負對照**:同一按在**單顆世界**仍然有效(那一按本來就是活的)。
3. 🔴 **回歸**:`⟦search-CHIPDELETEDEADURL⟧` —— 多顆下刪一顆膠囊, **它不得復活**。
4. `products-url-state.hooks.test.tsx` 既有 **25 格**全綠, 新增格數與突變各自紅過。
5. 三綠 `TURBO_FORCE=1` 三發皆 `0 cached`。
6. 🔴 **真瀏覽器實走**(不是只有測試):鑽機 `scripts/storefront-probe`, 甲乙兩個世界各按一次。

## 6. 本 plan 證不到什麼
- ⛔ ~~① 「側欄一定讓 `cascade.category` 改變」我【還沒實測】~~ ⇒ ✅ **[2026-09-05 12:0x 量了, 前提成立]**
  鑽機 `storefront-probe`(樹 `65db83b53`;那支 hook 與側欄之後沒動過), 真瀏覽器 1280×900:
  ```
                          網址                        側欄 is-active   件數     膠囊
  點之前   ?categories=操控部品,車架                  【空】           共 6 件   2 顆
  點「碳纖維部品」之後  ← 一個字沒變                   碳纖維部品 ✅    仍 6 件   仍 2 顆
  ```
  🔵 **尺先接上再量**:單顆世界 `?category=操控部品` ⇒ `is-active` **1 顆命中**(那一顆就是它)⇒ 這把尺會動。
  ⇒ ✅ **`cascade.category` 確實變了**(側欄是從 cascade 畫的), **案 A 的前提成立。**
- 🔴🔴 **而同一發量到一件比 plan 原本寫的【更糟一格】的事 —— 現況不是「沒反應」, 是「半個反應」**
  客人看到的是:**側欄那一列亮起來了, 而網址、件數、膠囊三個都沒變。**
  📌 **那比完全沒反應更糟** —— 完全沒反應會讓人再按一次或放棄;**亮起來會讓人以為生效了**, 然後去看一份沒有被篩選的結果。
  ⇒ 🔵 **板列與本 plan 先前都寫「按了沒反應」, 那個字面要訂正。**
  ⇒ 🛑 **而它也改變了驗收條件 1 的形狀**:不能只驗「網址出現 C」, 要**同時**驗件數變了 —— 因為**側欄亮起來這件事今天就已經會發生**, 它在「修好」與「沒修」兩個世界印同一個東西。
- ② `categoriesFromParams` 的合併我**讀了碼、還沒實跑**;它有白名單過濾(`isSafeCategoryValue`), **一顆不合格會被丟掉而不出聲**。
- ③ Sean 那句「加進已選那組」是**我的合理讀法**, 不是他的字面 —— **若他要的是別的(例如取代), 案 A 的行為會是錯的。** ⚠️ 這一格建議在動手前用一句話跟他確認。

## 7. 🔴 關卡 1(codex 對抗審查)**沒有跑成** —— 這是缺口, 不是 PASS

**兩輪都沒有產出任何判決**, 照 `codex-adversary` skill「第 2 輪仍逾時或零 findings = 認列缺口回報主視窗, 不跑第 3 輪」停手。

```
第 1 輪  prompt 8,509 bytes(plan 全文 + 4 支白名單)
         ⇒ log 91,869 bytes / 1,810 行, 而【停在逐行讀檔的第 260 行, 零判決】
         ⇒ 被 watchdog 12 分砍掉。它【守住了白名單】(只讀那 4 支), 時間全花在整支檔逐行讀。
第 2 輪  prompt 13,953 bytes(把那 4 支的關鍵段【直接貼進 prompt】, 明文禁開任何檔)
         ⇒ log 14,605 bytes ⇒ codex 自己只加了 652 bytes, 零判決。
```
🔬 **第 2 輪的成因是量到的, 不是推的** —— log 第一行逐字:
```
Reading additional input from stdin...
```
⇒ 📌 **它把 prompt 當參數收下之後【還在等 stdin】**, 而 skill 要求的 `< /dev/null` 給了 EOF ⇒ **它當場結束**。
🛑 **而這個失敗【看起來像成功】**:rc=0、log 非空、`grep -c must-fix` 回 **0** ——
**「零 findings」與「它根本沒回答」在這三個訊號上完全相同。**
✅ 分得出來的是**第四個數**:`log bytes − prompt bytes = 652` ⇒ **codex 幾乎沒說話。**
🔵 建議把這一格加進 `codex-adversary` skill 的驗收(現行只驗「非空 + 含 findings 段」, 對本例是瞎的)。

🟢 **零留痕有跑**:452 個檔逐一 `md5` 比對, 跑前跑後**逐字相同**;負對照(改一個位元組)**證過這把尺會動**。
   ⚠️ 而准許句照 skill:**只能寫「codex 對【我的檔】零留痕」**, 不得寫「零留痕 ✅」。
   🔵 `git stash list` = 11(共用資源, 不可歸因, 只當線索);HEAD 前後同為 `4b850e7f2`。

⇒ **這份 plan 目前【只有我一個人看過】。** 端上去之前請主視窗決定:①換 Fable / adversarial-reviewer 補這道 ②接受缺口直接端 Sean ③先做動手第一件事(量「側欄有沒有讓 cascade.category 改變」)再回頭審。

---

# 🔴🔴 §8 · 對抗審查判 **FAIL** —— 而它擊破的是本案的**核心**, 不是邊角

`adversarial-reviewer`(opus, fresh, 唯讀, 白名單 5 支)⇒ **9 條 must-fix + 2 nit**。
**我自己複驗了三條最承重的, 逐字全部成立**(不是採信轉述):

```
① params.set('category', category)  ← use-catalog-filter-url-sync.tsx:252  單一槽
② if (!state.category) return state; ← cascadeFilterReducer.ts:253「未先選大分類 → no-op」
③ lastFilterKeyRef.current = filterKey ← :150, 而三個提早 return 在 :154 / :177 / :186【之後】
```

## 8-1 🛑 **案 A 答不了 Sean 那句話** —— 這是整案要重寫的理由

`category=` **只有一個槽**。多顆下點 C ⇒ 寫 `category=C`;**再點 D ⇒ 覆蓋成 `category=D`, C 連膠囊一起消失。**
⇒ 📌 **Sean 逐字要的是「客人可能會多選不同分類」, 而案 A 在 n≥2 就做不到。**
✅ **修法(審查者給的, 我同意)**:寫的時候直接 `categories = union(現有, 新選)` 並 `set(CATEGORIES_PARAM)`,
**不要拿 legacy 的單一 `category=` 當累加器。**
⇒ 🔵 **而這也讓 §0 那個「靠讀取端合併」的巧勁【不再需要】** —— 我原本高興的那一格, 其實是繞路。

## 8-2 🔴 **我 §6① 的實測是【點一顆大分類】, 而結論寫成全稱句**

`select-sub` 在 `state.category === null` 時**是 no-op**(逐字 `if (!state.category) return state;`)。
⇒ **多顆世界剛刪過膠囊之後**(`ActiveChips.tsx:90` 已 `clearCategory`)**直接點細項 ⇒ cascade 不變 ⇒ 案 A 整條不生效。**
📌 **我點的那一顆(「碳纖維部品」)是大分類, 而它剛好走 `select-main` 那條路。**
🎯 **一次量測 + 一個全稱句 = 我今天第三次犯同一個錯**(前兩次:分頁標題 4→6、`it.skip` 23/12/13/14)。
⇒ **動手前要補量**:「cascade 為空時直接點細項」那一格。

## 8-3 其餘 must-fix(逐條收下, 不逐條複驗 —— 動手時各自要驗)

| # | 缺陷 | 位置 |
|---|---|---|
| a | `CatalogQuery` **另有一個只讀 `category` 的槽**(`:227-228`)且與 `categories`(`:233`)並存進 `unstable_cache` 鍵 ⇒ 案 A 讓多顆世界**第一次**出現 `category !== undefined`, 若 `products.ts` 把它當另一個 RPC 參數 ⇒ **交集或 0 件** | `catalog-query.ts:227-228,233,268,59-60` |
| b | **字面形狀沒驗過**:RPC 比對是 `category_raw LIKE vc \| \| ' · %'`, 側欄寫的是全路徑「主 · 子」, 而既有多顆值是**主分類裸名** ⇒ 新那顆可能 **0 件** | `catalog-query.ts:181-182` |
| c | 判別法底座 `lastFilterKeyRef` 在**三個提早 return 之前**無條件更新 ⇒ 那些波把「變動」吃掉, **且不自癒** | `:149-151` vs `:154/:177/:186` |
| d | **深連結還原波會被判成「甲」** ⇒ 新規則在還原波寫入 ⇒ `page` 被刪(⑩⑯㉕ 那一族)。plan 引的是**舊守衛**的理由, 新判別法在同一波是 true | `:185-187` |
| e | plan 沒說案 A 是「只 set」還是「連 `delete('category')` 也解禁」—— 而那決定**「清除全部」壞不壞** | `ActiveChips.tsx:140-155` · `:254` · `:361` |
| f | **代價①的字面是錯的**:再點同一顆細項是 **toggle 成 null**, 不是「cascade 不變」 | `cascadeFilterReducer.ts:256-257` vs `:239-245` |
| g | **驗收③零判別力**:刪膠囊時 `ActiveChips.tsx:90` 已 `clearCategory` ⇒ cascade 已 null ⇒ **不管守衛在不在都寫不回去** ⇒ 兩個世界同一個綠 | 改成突變格:判別法寫死 `true` 那一發**必須紅** |
| h | rollback **不是安全退路** —— revert 回去的是本 plan 自己量到的**半反應**(側欄亮起而三個都不動), 而我自己判定它「比完全沒反應更糟」⇒ **revert 這個動作本身需 Sean 拍板** | plan §4 |

**nit 兩條**:⑤(`0 cached`)量的是快取不是行為, 兩個世界同一個輸出;⑥ 沒寫「兩個世界會不同的那個值」(件數 / 膠囊數)。

## 8-4 ⇒ 本 plan **不端上去**, 要重寫

🛑 **8-1 不是補一段就好** —— 它換掉了案 A 的寫入目標(`category=` ⇒ `categories=` union)。
⇒ **下一步**:①先補量 8-2 那一格 ②開檔讀 `products.ts` 的 `query.category` 消費端(a)③量「主 · 子」那顆單獨的件數(b)—— **三格都是唯讀, 做完再改寫本 plan**。
🔵 **主視窗已同意的「方向 A(單檔、不碰 `packages/ui`)」大致還成立** —— 改的仍只有那支 hook;變的是**寫進哪個參數**。而 (a) 若成立, 可能被迫碰第二支檔。

## 8-5 🔬 **我複驗了審查者的 Q5, 而它【在 UI 這條路上不成立】**

審查者說:`select-sub` 在 `state.category === null` 時 no-op ⇒ 剛刪過膠囊之後點細項, 案 A 整條不生效。
✅ **reducer 那個分支是真的**(`cascadeFilterReducer.ts:253` 逐字 `if (!state.category) return state;`)。
🔴 **而我照他的情境實走一遍, cascade【有變】**:
```
階段                       網址                      側欄 is-active   件數
① 展開「碳纖維部品」        ?categories=操控部品,車架  碳纖維部品        共 6 件
② 刪掉「操控部品」那顆膠囊  ?categories=車架          【空】←cascade 清了 共 2 件
③ 直接點細項「尾殼與單座蓋」 ← 一個字沒變              尾殼與單座蓋 ✅   仍 2 件
```
🔵 **而樹在刪膠囊之後【仍然展開】**(`l2數` 三個階段都是 3)⇒ 那條路**走得到**, 而它**不是 no-op**。
⚠️ **我只量到「有變」, 沒有讀側欄元件去確認機制** —— 合理推測是那一列的點擊**不只 dispatch `select-sub`**(否則會撞到那個分支), 而**我沒證實**。
📌 **⇒ Q5 的 must-fix 降級為 nit**:那個 reducer 分支存在, 而**目前的 UI 到不了它**;
   🛑 **而它仍值得留一行** —— 哪天有人改側欄的 dispatch, 那個分支就會活過來, 而**今天沒有任何測試釘住這件事**。
🔵 **另外這一發也第三次重現了「半反應」**:③ 那一步側欄亮了而網址/件數都沒動。

## 8-6 ⚠️ **而我【沒有】複驗其餘七條** —— 它們是收下的, 不是驗過的
`a`(`CatalogQuery` 雙槽)`b`(字面形狀 / LIKE)`c`(`lastFilterKeyRef` 提早 return)`d`(還原波)`e`(清除全部)`f`(toggle 字面)`g`(驗收③零判別力)`h`(rollback)——
**這七條我照收進 §8-3 的表, 而【沒有一條是我自己量過的】。** 動手時每一條各自要驗, **不得因為它寫得具體就當成已驗**。
🔵 我複驗的是三條:①單一槽(逐字成立)②`select-sub` no-op(reducer 成立、UI 不成立, 見 8-5)③`lastFilterKeyRef` 位置(逐字成立)。

---

# §9 · 三格唯讀量測做完 —— **審查者的 a 與 b 兩條被推翻, 而是量出來的**

## 9-1 🟢 **格 a(`CatalogQuery` 雙槽會不會變交集/0 件)⇒ 推翻。是【聯集】。**
`apps/storefront/src/lib/products.ts:458,461` **兩個都送進同一支 RPC** `search_catalog_by_vehicle`,
而該處註解逐字:「舊的 `p_category` **一起送、不拿掉** —— 新那支自己會把兩邊**併成聯集**」。
🔴 **而那是註解的宣稱, 我去 SQL 驗了** —— `supabase/migrations/20260904260000_m4b_recommend_sort_with_category.sql:254-261`:
```
v_cats := (SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
             FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                         || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
            WHERE btrim(x) <> '')
```
⇒ **`||` 是陣列串接 + `DISTINCT` 去重 = 聯集。**

## 9-2 🟢 **格 b(全路徑「主 · 子」會不會 0 件)⇒ 推翻。**
過濾條件逐字(同檔 `:286`):`WHERE p.category_raw = vc **OR** p.category_raw LIKE vc || ' · %'`
⇒ 🔵 **有 `=` 那一半** ⇒ 全路徑走等號那條, **不需要第三層**。審查者只看到 `LIKE` 那一半。

## 9-3 🔬 **而上面兩條我沒有停在讀碼 —— 實測三發(鑽機, 真瀏覽器)**
```
?categories=車架                                      ⇒ 共 2 件 · 膠囊 1 顆
?category=碳纖維部品 · 尾殼與單座蓋                    ⇒ 共 4 件 · 膠囊 1 顆   ← 不是 0
?categories=車架&category=碳纖維部品 · 尾殼與單座蓋     ⇒ 共 6 件 · 膠囊 2 顆   ← 2+4 聯集
```
🎯 **`2 + 4 = 6` ⇒ 聯集成立;若是交集或覆寫, 這一格會是 0 或 4 或 2。**
🔵 **而膠囊兩顆都畫出來了** ⇒ 畫面那一側也認得這個組合。
⚠️ **射程**:本機探針(合成 108 件種子, 樹 `65db83b53`)。**正式站的 `category_raw` 形狀我沒量** ——
   而這三發要答的是「**兩個參數怎麼組合**」, 那是**函式的行為**不是資料的形狀 ⇒ 種子夠用。

## 9-4 ⚠️ **量的過程中我的尺壞了一次, 而它印的是「全部撈不到」**
我先用 `curl | grep '共 N 件'` 量四發 ⇒ **四發全空, 連對照組也空** ⇒ 那是**尺沒接上**
(件數是 client 端渲染的, `curl` 拿到的是 SSR 前的殼), **不是「查無」**。
📌 **抓到它的是【對照組也空】** —— 若我只打那三發沒打對照, 我會得到「全路徑那顆 0 件」這個**與審查者一致而錯誤**的結論。

## 9-5 ⇒ **主案改成:union 進 `CATEGORIES_PARAM`**(主視窗已定)
🔵 而 9-1/9-2 讓一件事變清楚:**寫進 `category=` 其實也會被聯集** ——
   **但那不能當主案**, 因為 §8-1:`category=` 只有一個槽, **第二顆會蓋掉第一顆**。
   ⇒ 📌 **「它會被正確合併」與「它裝得下多顆」是兩件事, 而我先前把前者當成了後者的證據。**

