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

## 3 · 要做什麼 —— **v2(2026-09-06 重寫;v1 的第 2-4 步已作廢,原文留在 §3-v1)**

> 🔴🔴 **為什麼有 v2:v1 的修法【時序假設被證偽】,而它三綠全綠、負對照也紅得漂亮。**
>
> v1 的落地檢查是**兩發 `queueMicrotask`** 之後比 `window.location.search`。
> 🛑 **證據兩行,都在 repo 裡,不是推論**:
> · `apps/storefront/src/app/products/page.tsx:41` ⇒ `export const dynamic = 'force-dynamic';`
> · `use-catalog-filter-url-sync.tsx:259-260` **既有註解逐字**:
>   「`router.replace` 是 App Router 導覽、**非同步**(**force-dynamic 要 RSC 往返才更新 window.location**)」
>
> ⇒ 🎯 微任務是**同一個 tick 內**的事;落地要等**一次真正的 RSC 網路往返**。
> ⇒ ⇒ 在正式環境,**每一次【正常的】篩選**都會在兩個微任務內被判成「沒落地」
>    ⇒ 多送 2 次 `replace`(疊在還在飛的那一發上)+ **每次篩選印一行 `console.warn`**
>    ⇒ 📌 **把一個罕見的安靜 bug 換成一個全站常態的吵 bug。**
>
> 🔴 **而它為什麼過了所有的關**:單元測試裡 `router` 是 mock 的,
> **那個世界沒有 RSC 往返** ⇒ 「兩個微任務」在裡面綽綽有餘。
> ⇒ 🛑 這與 hook 裡那句既有警語**是同一個病**:
>   「它守的是某個世界,而那個世界在 mock 掉 router 之後不存在」——
>   v1 只是從**相反的方向**踩了同一格:**假時間軸讓一個錯的修法看起來被證明了。**
> ⇒ ✅ 抓到它的是 `code-reviewer` R1(它去讀了 `page.tsx` 的 route 設定),不是三綠、不是負對照。

### 3.1 修法形狀(零計時器 —— 這一句是承重的)

**核心一句**:`router.replace` 的落地訊號**已經存在**,只是本 hook 沒有訂閱它 ——
`useSearchParams()` 的值**每變一次 = 一次 RSC 往返完成**。

```
① 新 ref  pendingUrlRef: { next: string; resent: boolean } | null
          記【我送出去的那個完整網址】, 不只是那一顆分類。
② 新 dep  useSearchParams()  加進 effect 的 deps
          ⇒ 每次 RSC 往返落地都會讓本 effect 再跑一次 = 那個缺席的【下一波】。
③ 每一波開頭(接在既有 pendingWrittenCategoryRef 那段旁邊, 早於三個病態 return):
     pending 為 null                      ⇒ 什麼都不做
     現網址 === pending.next               ⇒ 落地了 ⇒ 清 pending(既有的 committed 升級照舊)
     不等於 且 pending.resent === false    ⇒ 🔴 那一發被丟了 ⇒ 重送一次、resent = true
     不等於 且 pending.resent === true     ⇒ 放棄 ⇒ console.warn 一次 ⇒ 清 pending
④ 上限 = 1 次重送, 而它記在 pending 自己身上, 不是一個計數器
          ⇒ 使用者在 pending 期間又改了 state ⇒ **用新的 next 覆蓋整個 pending**
            (resent 歸零)⇒ 📌 **不疊送**:永遠只有一個 pending 在飛。
```

🔵 **`console.warn` 為什麼留著**:靜默放棄與修好長得一樣,而**那正是這一列的病本身**。
🛑 **而 v1 那個 warn 會【每次篩選都叫】** ⇒ v2 的 warn 只在「送了兩次、兩次都沒落地」才叫。

### 3.2 🔴 這個形狀自己帶進來的風險(明寫,不假裝沒有)

| # | 風險 | 動手前要先驗的 |
|---|---|---|
| R-a | `searchParams` 進 deps ⇒ **effect 跑的次數變多**(任何人改網址都會觸發,含 `useVehicleUrlSync`) | 既有的 `filterKey` 早退在「只有網址變、state 沒變」時要**確實早退**;不早退 ⇒ 每次網址變都可能重寫一次網址 = 迴圈 |
| R-b | pending 的比對放在**哪一行** | 必須**早於**那三個病態 `return`(`initialized` / vehicle 讓路 / restore-hold);放晚了 ⇒ 被吃掉的波仍然收不到落地訊號,等於沒修 |
| R-c | 比對用什麼 | 沿用既有 `segmentKey`(`:533-534`)比**參數集合**,不比逐字;逐字會在「其實落地了」時誤判 ⇒ 多送一次沒必要的導覽 |
| R-d | `useSearchParams()` 需要 route 是 dynamic | ✅ 已成立(`page.tsx:41`),而**這一格要寫進來**,因為它是別人日後把 route 改回 static 時唯一會撞到的字 |

### 3.3 測試怎麼寫(🔴 **fixture 要換掉,不是加一格**)

⛔ ~~v1 的三格(3 次 + warn / 2 次 / 1 次)~~ —— **它們建立在「兩個微任務」這個假時間軸上,整組作廢。**
✅ v2 的 mock 必須**模擬 RSC 往返**:
```
router.replace 被呼叫  ⇒ 不立刻改 searchParams
下一個 act()          ⇒ 才把 searchParams 換成新值(= 一次往返落地)
```
三格 + 一格正對照:
1. **落地** —— 往返後 searchParams 等於 next ⇒ 只送 1 次、零 warn、pending 清掉。
2. **被丟一次** —— 第一次往返後 searchParams **沒變** ⇒ 重送 1 次;第二次往返落地 ⇒ 零 warn。
3. **兩次都被丟** —— ⇒ 總共 2 次 `replace` + **1 次** warn + pending 清掉(不再無限重送)。
4. 🟢 **正對照:pending 期間使用者又改 state** ⇒ 新 next 覆蓋 pending ⇒ **不疊送**
   (少了這一格,「每次都多送一發」也會讓 1-3 綠)。
🔴 **負對照**:把 ② 那個 dep 拿掉 ⇒ 第 2、3 格必須紅(effect 不再被往返喚醒)。

### 3.4 驗收(v1 §3 第 4 步照舊,而下面這句是新的)

🛑 **不得拿 preview 的 20 發統計當背書** —— 上一輪那把尺**三格都印 0/20**(修前 / 修後 / 負對照)
⇒ **它沒有判別力**。commit body 只准寫「效果由機制層測試證;線上統計待基線重現」。
🔴 桌機側欄 `multi-category-sidebar.spec.ts` **必須照跑**(同一支 hook)。

---

## 3-v1 · ⛔ 作廢的原做法(原文保留,理由見 §3 開頭)

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
