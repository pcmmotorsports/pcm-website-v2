# 手機抽屜分類「按了查看什麼都沒變」— 查因與修法 plan

> 線 `-f3` · 2026-09-05 · **plan 階段, 一行 source 都沒動**
> 主視窗裁「乙:你修」。鐵則 8:預計跨 3 支 source(`FilterDrawerCategoryTab` / `use-catalog-filter-url-sync` / `ProductsPage`)⇒ **先出這份**。
> 板列 ⟦search-CASCADEINMULTI⟧ 缺口②。**不碰 `packages/ui`。**

---

## 0 · 一句白話

> **在手機上選了分類、按了「查看 N 件」,畫面什麼都沒變 —— 而慢慢點就不會。**

---

## 1 · 我量到什麼(每一格都是對正式站真瀏覽器實走)

🔴 **前置先釘住:那四支檔在 `origin/main` 與我這棵樹【逐字相同】**(`git diff --stat` 空)
⇒ **我對正式站量到的,就是我要修的那份碼。**

### 1.1 正常流程(偵察出來的,不是照碼猜的)
```
按 button.pmc-tool「類別」 ⇒ .fd-drawer 開, 17 顆 button.fd-row(大分類)
點大分類 ⇒ 不套用, 往下鑽(.fd-back + 5 顆細項)· dispatch(selectCategoryMain)
點細項   ⇒ 不套用 · dispatch(selectCategoryMain) + dispatch(selectCategorySub) 兩發
按「查看 N 件商品」 ⇒ 套用
```
🔵 **而那顆鈕的 `onClick` 逐字就是 `onClose`**(`FilterDrawer.tsx:411`)
⇒ **「套用」不是那顆鈕做的 —— 它只是關抽屜,而網址是【關掉之後】才被寫的。**

### 1.2 三組對照 —— **它們把嫌疑縮到「細項那一步」**
| 走法 | 結果 |
|---|---|
| 🟢 **只點大分類** → 查看 | 網址 `?category=大分類` **成功** |
| 🟢 **大分類 → 返回 → 查看**(完全不碰細項) | 網址 `?category=大分類` **成功** |
| 🔴 **大分類 → 細項(零延遲)→ 查看** | **6 發全部【網址完全空的】** |

### 1.3 而「開著抽屜時網址不動」是**正常的**,不是病
只點大分類、**不按查看**,等 1/2/3 秒 ⇒ 網址一直是空的;**按了查看才寫**。
⇒ 📌 **寫入是掛在【關閉】上的** —— 所以「開著時沒反應」不是線索。

### 1.4 🔴 而失敗那一格,**選取是有落地的**
零延遲那 6 發,點完細項那一列的 class 都是 **`fd-row is-active`**
⇒ `cascade.category.subId` **已經進了 state**。
⇒ 🎯 **所以不是「沒選到」,是【選到了而網址沒寫出來】,而且連大分類那一半也一起不見。**

### 1.5 ⚠️ **一個我要自己訂正的宣稱**
板列上我寫「`0ms 空 · 300ms 空 · 800ms 有 · 1500ms 空 · 2500ms 有` ⇒ 非單調 ⇒ **競態**」——
🛑 **那五格【每格只跑一發】**。今天補跑 `0ms` **6 發全紅** ⇒ 0ms 那格是**穩定失敗**,不是抖。
⇒ **`1500ms` 那一發是不是雜訊, 我沒有再量** ⇒ 📌 **「非單調」目前是【一次觀察】,不是結論。**
**本 plan 不靠它。** 修法要靠的是 §1.2 那張表(6/6 + 兩個成功對照)。

---

## 2 · 兩個候選機制(**都還沒證實 —— 這一節是假設,不是發現**)

### 甲 · 兩發 `dispatch` 之間有一次會讓同步 effect 早退的東西
`FilterDrawerCategoryTab.tsx` 細項那顆鈕:
```ts
dispatch(selectCategoryMain(catMain.id, catMain.name));
dispatch(selectCategorySub(s.id, s.name));
```
而**大分類那顆只 dispatch 一發**(那一路是綠的)⇒ **兩者的差別就在這裡**。

### 乙 · 細項那一步觸發了 facet 件數重撈,而同步 effect 撞進「還原窗口 / 讓路」那幾道 `return`
`use-catalog-filter-url-sync.tsx` 有**至少三處會整段 `return`**:
`hold` 守衛 · vehicle 讓路(`if (cascade.vehicle && !params.has('vehicle') …) return`)· 還原窗口(`pendingRestoreRef`)。
🔵 而細項的件數是**伺服器算的**(`countOf(...)`)⇒ 選細項會讓 props identity 換一輪。

🛑 **甲乙都解釋得了「慢一點就好」,而【只有量到才算】** —— 見 §3 第 1 步。

---

## 3 · 要做什麼(順序本身是判準的一部分)

1. 🔬 **先把成因量出來,再改任何一行。** 在本機 storefront 探針(`scripts/storefront-probe/up.sh`)上,
   對那支 effect 的**每一個 `return` 點各加一行暫時 log**(標 `// TEMP-PROBE`),
   真瀏覽器走一次失敗路徑 ⇒ **看它從哪一個 `return` 出去的**。
   ✅ 這一步的產出是**一個行號**,不是一個猜測。
   🛑 **那些 log 不進 commit** —— 照 `docs/patterns/mutation-harness-restore.md` 的還原流程。
2. 修根。**不准加 `setTimeout` / `await sleep` / 「多送一次 replace」** —— 那三個都是把病藏起來。
3. `HOLD` 那支 spec(`scratchpad/mobile-drawer-category.spec.ts.HOLD`, 84 行)落地當守門。
4. **驗收 = 那張延遲表全綠**:`0 / 300 / 800 / 1500 / 2500ms` 各跑 **3 發**(不是 1 發 —— §1.5 就是這樣被騙的)。
   🔴 **加一格負對照**:把修法拿掉 ⇒ `0ms` 那格必須**紅**。不會紅 ⇒ 那個修法沒有作用。

---

## 4 · 預期影響面 / rollback

| 面 | 影響 |
|---|---|
| 手機 `/products` 分類 | 目標行為 |
| **桌機側欄** | 🔴 **同一支 hook** ⇒ `multi-category-sidebar.spec.ts` 必須照跑,不得只跑手機那支 |
| `packages/ui` | **不碰** |
| rollback | 單顆 `git revert`;**無 DB、無 env、無對外副作用** ⇒ 退得乾淨 |

---

## 5 · 這份 plan 沒有回答什麼

- **成因** —— §2 是兩個候選,**一個都還沒證實**。§3 第 1 步就是去把它變成行號。
- **`1500ms` 那一發是不是真的抖** —— 沒複量(§1.5)。
- **底部鈕件數不隨選取更新**(選完仍印 `查看 24765 件`,套用後實際 833)—— 主視窗已裁**另開列**,不在本片。
