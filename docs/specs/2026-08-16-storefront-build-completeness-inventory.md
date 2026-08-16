# 前台 storefront 建置完成度盤點(2026-08-16,A 窗)

> **這輪只盤點,零實作。** 產出給主視窗排優先序用。
> ⚠️ **與 E 窗的「前台資安曝露面」是兩件事**,本檔只談**建置完成度**。
> 🔴 **開工第一動已做**:`git submodule update --init design-reference`
> ⇒ 實得 **177 個檔**(`find design-reference -type f -not -path '*/.git/*' | wc -l`)。
> **沒做這一步的話 submodule 是空的,所有零命中都會被誤讀成「design 沒有這段」。**

---

## 0. 分母與分子(先講尺,再講數)

```
分母  design-reference/components/*.jsx        20 個元件
分子  apps/storefront/src/app/**/page.tsx      28 個頁面
      🔴 其中 7 個在 /dev-preview/ ⇒ 【不算已上架】，扣掉後 21 個
數法  ls design-reference/components/*.jsx | wc -l
      find apps/storefront/src/app -name 'page.tsx' | wc -l
      find apps/storefront/src/app/dev-preview -name 'page.tsx' | wc -l
```

⚠️ **「元件數 vs 頁面數」不是可以相減的兩個數** —— 一個 design 元件可能對到多頁
(`LegalPage` → `/privacy` + `/terms`),也可能對到零頁(是共用元件)。
**下表逐個對,不做算術。**

---

## 1. 🔴 真正的發現:**搜尋框是死的**(本檔最重要的一條)

```
Header.tsx 有搜尋框：aria-label="搜尋"、placeholder="搜尋商品 / 車款 / 品牌..."
點下去 → openSearch() → window.dispatchEvent(new CustomEvent('pcm-open-search', …))

🔴 誰在聽？
   grep -rn 'pcm-open-search' apps/storefront/src   ⇒ 【1 命中】
   而那 1 命中就是【發送那一行本身】 ⇒ 零監聽者
```

⇒ **員工/客人點搜尋框,什麼都不會發生。** 不報錯、不跳頁、不開面板。
📎 design 那支 `SearchOverlay.jsx` 檔頭逐字:`global fullscreen search (keyboard-first, fuzzy, inline results)`
⇒ **UI 的殼上架了,裡面那個全螢幕搜尋面板沒有。**

### ⚠️ 這是「已知未開線」還是「沒人知道」?—— **兩者都有一半**
- **搜尋功能本身是已知未開線**:memory `project_storefront-keyword-search-line` 記著
  「A = M-4b 後開線、盡量完美」⇒ **功能沒做是計畫內的。**
- 🔴 **但「殼已經上架且點下去是死的」這件事,我在 backlog 搜「搜尋」的前幾條裡沒看到**
  (命中的是 `#183 搜尋日誌蒐集`、`#185 keyword 正規化` 等**功能項**,
  不是「現況有一個無作用的入口」)。
  ⇒ **建議至少登記成一條**:要嘛把入口藏起來直到搜尋線開,要嘛讓它先導到 `/products`。
  **一個點了沒反應的搜尋框,比沒有搜尋框更傷。**

---

## 2. design 元件 → storefront 對照(逐個,不是抽樣)

| design 元件 | storefront 對應 | 狀態 |
|---|---|---|
| `HomePage` | `/` | ⚠️ **有實作,但 design 那支是【過期假稿】** —— `CLAUDE.md` 鐵則 1 例外逐字「submodule `components/HomePage.jsx` 為過期假稿、不得引用」,真權威在 OD `pcm-home-redesign` |
| `ProductsPage` | `/products` | ✅ |
| `ProductPage` | `/products/[slug]` | ✅ |
| `CheckoutPage` | `/checkout` | ✅ |
| `OrderCompletePage` | `/checkout/callback` | ✅ **對到了,只是檔名不同**(`訂單已成立` 2 檔命中)。⚠️ design 的 `已複製訂單編號` **0 命中** ⇒ 複製單號那個互動未做 |
| `AccountPages` | `/account` | ✅ |
| `LegalPage` | `/privacy` `/terms` | ⚠️ **頁在、內容是 blocker**(`#291`:正式條款來源未定,AI 不自撰) |
| `Header` | `components/Header.tsx` | ⚠️ 見 §1(搜尋框死的) |
| `SearchOverlay` | **無** | 🔴 **見 §1** |
| `FilterDrawer` / `FilterSide` / `FilterTop` | `components/Filter*.tsx` | ⚠️ **實作在,但 `/dev-preview/` 底下各有一頁** ⇒ 要確認正式路由有沒有接(見 §4 缺口) |
| `StorePickerModal` | 5 檔命中(`/stores` 等) | ✅ |
| `TierComponents` | 23 檔命中 | ✅ |
| `WalletTab` | 6 檔命中 | ⚠️ 儲值金屬 Phase 2 藍圖,**不該列進 Phase 1 待做** |
| `ProductCard` | 16 檔命中 | ✅ |
| `Pricing` | 2 檔命中 | ⚠️ 未細查 |
| `ErrorPage` | 3 檔命中 | ✅ |
| `App` / `Pages` | — | 殼,不對應單一頁 |

**數法**:每列都是
`grep -rlE '<關鍵字>' apps/storefront/src --include='*.tsx' | grep -v '\.test\.' | wc -l`,
**並附正向對照**:`購物車` ⇒ **30 檔**(確定存在的東西)⇒ 尺是活的。

---

## 3. 🔴🔴 我這輪自己踩的兩個假量測(留痕,因為它們影響了中間結論)

**① `grep -E` 裡寫 `\|`** —— ERE 的交替是 `|`,`\|` 是字面反斜線加豎線
⇒ `StorePickerModal` / `TierComponents` / `WalletTab` / `ErrorPage` / `OrderCompletePage`
**五個全報 0 命中**,而正確答案是 5 / 23 / 6 / 3 / 0。
**四個是假的、一個碰巧是真的** —— 🔴 **而它們長得一模一樣。**

**② `sed 's/.*/固定字串/'`**(在另一份查證裡)—— 對每一行無條件替換
⇒ 六個表全印同一句,**六行整齊、格式對、零錯誤訊息**。

⇒ **共同修法:每一組「零命中」的掃描都要配一個【確定存在】的正向對照。**
本檔的正向對照是 `購物車 ⇒ 30`。**沒有它,§2 那張表會有四列是錯的。**

---

## 4. 我**沒有**查的(誠實缺口,不要當成「已確認沒問題」)

- **`/dev-preview/` 那 7 頁對應的正式路由接了沒** —— 我只確認元件檔存在,
  **沒有追它們在正式頁面上有沒有被渲染**。這是 §2 裡三個 `Filter*` 列標 ⚠️ 的原因。
- **半成品掃描(TODO / 假資料 / 「待補」)我沒跑** —— 主視窗要的第 ② 項未完成。
- **已被推翻/作廢的 design 我沒有交叉比對** —— 主視窗說 R 窗在挖,
  ⇒ **本檔的「還沒做」清單可能含已作廢項**,要與 R 窗的清單對過才算數。
- **`Pricing` 那 2 個命中我沒開檔看**。
- **我沒有在瀏覽器裡開過 storefront** —— 全部是靜態讀碼。

---

## 5. 建議的優先序(給主視窗排,不是我決定)

```
① 搜尋框死掉        最便宜、最傷客人觀感。兩個修法都是小片：
                    藏起來 / 先導到 /products。⚠️ 但「藏起來」要 Sean 拍（那是他的門面）
② dev-preview 三個 Filter 的正式路由接了沒   ← 先查清楚，可能根本不是缺口
③ 半成品掃描（TODO/假資料）                  ← 我沒跑完，接手的人從這裡開始
```
⚠️ **`#291`(法律頁內容)不列進來** —— 它的 blocker 是**內容來源**,不是建置。
