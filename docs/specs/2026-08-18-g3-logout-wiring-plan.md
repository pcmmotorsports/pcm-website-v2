# `/logout` 道別頁接線 — plan(鐵則 8)

> **狀態:主視窗代裁批准(2026-08-18)。**
> 🔴 **這是【主視窗代裁】,不是 Sean 拍的** —— 那個標記就是他推翻它的入口。
> **Sean 拍的是「要接線」本身**(2026-08-06 `Q2=A`);**代裁的只有「現在可以做」這一格**。

## 0. 為什麼現在可以做(理由要用對的那個版本)

Sean 原拍板逐字(`memory project_site-redesign-content-pages-decisions.md:17`):
> 「**Q2=A:/logout 道別頁要接線** —— 登出 redirect 由 `/login` 改 `/logout`;
>   動 `logoutAction`(auth server action)= 鐵則 12② 高風險片,**排白天+codex 對抗審查不降級**,夜間不動。」

```
✅ 代裁的理由:那個條件的【目的】是「有人看著」，而 Sean 現在明顯在線上（今晚回了多題）
   ⇒ **條件本身成立**，不是條件消失
❌ 【不是】這個理由:「新常設令說沒有階段性 ⇒ 夜間不動被溶掉了」
   —— 那會變成【用一條拍板去解除另一條拍板的附帶條件】，並在紀錄裡留下一個壞先例
```
🔴 **射程:代裁只涵蓋「Sean 在線上的這段時間」。若他離線,這一格要重新判。**
🔴 **`codex 對抗審查不降級` 是 Sean 原拍板明寫的 —— 代裁沒有動它,照跑。**

## 1. 要改什麼

**行為改動 2 處(只有這兩處會改變跑起來的結果):**
```
① apps/storefront/src/app/account/actions.ts
     redirect('/login')  →  redirect('/logout')
② apps/storefront/src/styles/coming-soon.test.ts（那格「刻意沒接線」的守門）
     翻面:從「釘住【未接線】」改成「釘住【已接線】」
```
**同步改動(不改行為,但【不跟著改就會變成假字面】):**
```
③ apps/storefront/src/app/logout/page.tsx 檔頭 —— 它逐字寫著「尚未接線」「這一頁沒接上」
     ⇒ 接線後那段話是假的。同步改寫,並在裡面標記代裁身分。
④ 本 plan 檔(新增)
```
🔴 **codex 關卡2 R1 must-fix 抓到的就是這一段**:原本寫「兩處,不多不少」,而 diff 實際動了四處
   ⇒ 那是**字面 vs 事實偏離**,且它會讓下面的 rollback 漏掉 ③。

## 2. 🔴 為什麼改守門【不是】改測試期望值來讓它過

這是本片唯一需要正面回答的問題(改測試期望值是「立即停止訊號」)。

```
那道守門的註解【自己寫著】它的用途:
  「接線 = 把 logoutAction 的 redirect 由 /login 改成 /logout。那是產品決定 + 高風險面」
  「logoutAction 的 redirect 被改了 ⇒ 動 auth server action 要先過鐵則 12② 對抗審查」
⇒ 它守的不是「redirect 必須是 /login」，而是
  **「沒有人可以在【沒過對抗審查】的情況下把它接起來」**
⇒ 那道紅【就是那張傳票】。傳票收到了、審查跑了 ⇒ 接線完成 ⇒ 它要改守新的不變式
```
**接線後它要守什麼**:①redirect 目的地是 `/logout`(回歸守門:別人改回去或改到第三個地方會紅)
②`/logout` 那一頁還在(目的地存在)。**同一格的判別力不減,只是換了守的對象。**

## 3. 預期影響面

```
客人:登出之後看到【道別頁】而不是【登入表單】
     —— 而 design 為那一頁寫了字（logout-page.html），本來就是要給他看的
不動:登入、註冊、忘記密碼、session 清除本身（logoutCustomer 一個字都不動）
不動:任何其他 redirect
```

## 4. Rollback

🔴 **要回就四處一起回,不能只回前兩處** —— 只回行為而留下 ③ 的「已接線」註解,
   下一個人會讀到一句**跟 code 相反的話**,而那比沒註解更貴(codex R1 must-fix 指出的正是這個)。
```
① actions.ts 的 redirect 改回 '/login'
② coming-soon.test.ts 那格翻回「釘住未接線」
③ logout/page.tsx 檔頭改回「做好了但沒接上」的說法
④ 本 plan 檔標記作廢（或一併刪）
⇒ 這四處在同一顆 commit 裡 ⇒ 單一 `git revert` 就能一次回全部。
（session 清除邏輯 `logoutCustomer` 全程一個字沒動 ⇒ 回滾不會留下半登出狀態）
```

## 5. 驗收
```
□ 三綠（動 .ts/.tsx ⇒ 含 build）
□ codex 關卡2 對抗審查跑過、findings 折完（Sean 原拍板明寫不降級）
□ 真瀏覽器:登入 → 按登出 → 到 /logout、且 session 真的清掉（重新整理不再是登入態）
□ 守門翻面後【對壞版本仍然會紅】（把 redirect 改回 /login ⇒ 那一格要紅）
□ 不 push
```
