# 正式站上按了沒反應的東西 —— **掃完了,兩個,而其中一個沒有人記過**

2026-08-19 06:2x CST,G1。**全程唯讀。**

> 起因:總表 §⑪ 驗「查看詳情」那顆死鈕時,發現它**現在就在正式站上**。
> ⇒ 那就該問:**還有幾個?** 而這一份是**掃完的分母**,不是撿到的個案。

---

# 量法(可重跑,含負向對照)

```python
掃 apps/storefront/src/components/**/*.tsx（排 .test.）
剝掉 // 與 /* */ 與 {/* */} 註解
找所有 <button …> 開標籤（含跨行），**排除**帶 onClick / type="submit" / formAction / disabled 的
```
```
⇒ **3 處命中**
🔴 負向對照（證明尺會動）：同一批檔案裡 `onClick` 有幾百處，
   而 `FilterTop.tsx` 這一支自己就有 **18 個 onClick**（`grep -c onClick`）
   ⇒ **這支檔裡「沒接」的那一顆，不是因為我掃不到接線。**
```
⚠️ **這把尺的射程**:它只看 `<button>`。**`<a>` / `<Link>` / 可點的 `<div>` 不在分母內。**

---

# 🔴 ① `FilterTop.tsx:246-248` 自訂價格區 —— **兩個輸入框 + 一顆套用鈕,全都不接**

```jsx
<div className="ft-price-custom">
  <input placeholder="最低" /><span>—</span><input placeholder="最高" />
  <button className="ft-apply">套用</button>
</div>
```
```
· 兩個 <input>：**沒有 value、沒有 onChange、沒有 name、沒有 ref** ⇒ 沒有任何東西讀得到客人打的字
· <button>：**沒有 onClick**
· 同檔沒有 <form>、沒有 onSubmit；唯一的 addEventListener 是 :95 的 keydown（Esc 關閉，與本區無關）
⇒ **客人打兩個數字、按「套用」，什麼都不會發生。**
```

## 🔴 而這一顆比會員中心那顆毒,理由有三個
```
1. **它旁邊的東西是會動的** —— 同一個下拉裡，上方的預設價格區間（PRICE_RANGES）**每一列都有 onClick**
   ⇒ 客人沒有任何理由覺得下面這一格不一樣
2. **客人已經投入了** —— 他打了兩個數字才按下去。會員中心那顆是點一下就沒了
3. 🔴 **沒有任何註解記過它** —— 對照：會員中心那顆的正上方寫著
   「查看詳情鈕(**Q1=A**)：照 design 渲染、**無 onClick**；訂單詳情頁 = backlog #240」
   ⇒ **那一顆有人知道；這一顆沒有。**
```

## 而**成因與付款方式那條是同一個**
```
`design-reference/components/FilterTop.jsx:182` 逐字：
  <button className="ft-apply">套用</button>          ← **design 那邊本來就是不接的**
而本檔檔頭逐字：「字面從 design-reference/components/FilterTop.jsx **直接搬**」「className 字面**完全不動**」
⇒ 🔴 **鐵則 1 被正確執行了，而搬進來的是 design 的【靜態原型】。**
```
📌 這是同一族的**第三個實例**(前兩個:付款方式三選一、以及本份未列的其他)——
memory `feedback_copying-design-literally-inherits-its-bugs` 的第二面:
**搬的人做對了他被要求的事,而被要求的事沒有涵蓋「這個控制項會不會動」。**

## 🔴 而它現在就在客人眼前
```
量法：git show origin/main:apps/storefront/src/components/FilterTop.tsx | grep -c 'ft-apply' ⇒ **1**
     git diff --stat origin/main..dev -- <該檔> ⇒ **零輸出（與 dev 無差異）**
⇒ **正式站上就是這個樣子。**
```

---

# 🟡 ② `account/tabs/OrdersTab.tsx` 的「查看詳情 →」
**已記過**,詳見 `docs/probes/2026-08-19-g1-promise-ledger.md` §⑪。
`Q1=A`(Sean 拍板照 design 渲染)、`#240` 另開 slice、**同樣在正式站上**。

---

# ✅ ③ `MobileMenu.tsx` 的關閉鈕 —— **不是死的**(排除)
它帶 `ref={closeBtnRef}` 與 `data-menu-close`,**由別處接**。
⇒ 🔴 **我的尺會把「用 ref / data-attr 接線」誤判成沒接** —— 這一格是開檔看才排掉的。
**⇒ 那也是這份分母的已知誤報方向:寧可多報,不要漏報。**

---

# 這一份沒有答到的

```
· 🔴 **只掃 `<button>`** —— `<a>` / `<Link href="#">` / 可點的 `<div>` **不在分母內**
  ⇒ 那一族要另一把尺（而它多半更大）
· 只掃 `apps/storefront/src/components` —— **`app/` 目錄下的 page/layout 沒掃**
· 沒有真的在瀏覽器上點過 —— 全部是讀 code
  ⇒ 而 ① 那格我有三重證據（無 onChange/onClick、無 form/onSubmit、同檔 18 個 onClick 當對照）
· 🔴 **「客人有沒有真的按過」查不到** —— 那要前端分析，我們沒有
```

**鐵則 8** 未命中(唯讀)。**鐵則 12** 六類逐字對過:未命中。**未 push。**

---

# ✅ 補掃 `app/`(上一版自己標的第二個缺口)—— **零新增客人面命中,分母到此完整**

上一版的射程寫著「只掃 `components/` —— **`app/` 目錄下的 page/layout 沒掃**」。**補掃完了。**

```
掃 apps/storefront/src/app/**/*.tsx（排 .test.）⇒ **38 支檔**
沒接線的 <button> ⇒ **9 處，而 9 處【全部】在 `dev-preview/mobile-catalog-ux/`**
🔴 負向對照：`app/` 底下 `<button` 總數 = **46** ⇒ 尺看得到 button，只是多數有接線
```

## 而那 9 處**客人到不了** —— 我去驗了,沒有假設它是 dev 就跳過
```
`apps/storefront/src/app/dev-preview/layout.tsx`（backlog `#385`）:
  🔴 逐字「正式站把整個 `/dev-preview/*` 關成 404，dev / preview 環境照常可用」
  🔴 逐字「**判準是 fail-closed 的：預設關，只有「明確認得出是非正式環境」才開**」
  它列了一張五行的環境表，而**兩條可能的機制路徑（build 期 / request 期讀 env）
  它都算過，並寫著「兩條路的正式站結果【都是 404】」**
另外各頁帶 `robots: { index: false }`。
```
✅ **而那支守門自己申報了一個未確認**(逐字):
> 「⚠️ **preview 會不會也變 404 = 未確認**(誠實申報,別讓下一個人以為壞了)」
📌 **那是今晚第四個「做對的例子」** —— 它把**目標達成**與**副作用未確認**分開寫,
而不是讓「正式站 404」這個好消息把後面那句蓋掉。

---

# ⇒ 這份的最終分母(`<button>` 這一族,**掃完了**)

```
apps/storefront/src/components  ⇒ 3 處 ⇒ **客人面 2**（FilterTop 新 / OrdersTab 已知）+ 誤報 1
apps/storefront/src/app         ⇒ 9 處 ⇒ **客人面 0**（全在正式站 404 的 dev-preview 底下）
────────────────────────────────────────────────────────
🔴 **客人現在按得到、而按了沒反應的 `<button>`：2 個。**
```
⚠️ 而**這句話只涵蓋 `<button>`** —— `<a>` / `<Link>` / 可點的 `<div>` **仍不在分母內**,
而主視窗 2026-08-19 裁定**那一族等 Sean 答完處置原則再掃**(理由:三條路都要他點頭,
**而一個他還沒答的問題的第二個實例,不會讓他更快答第一個**)。
