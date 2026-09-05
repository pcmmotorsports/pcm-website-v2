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
- ① **「側欄一定讓 `cascade.category` 改變」我【還沒實測】** —— 案 A 整個建立在它上面。**動手第一件事就是量它**(鑽機按一次, 印 dispatch 前後的 `cascade.category`)。
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
