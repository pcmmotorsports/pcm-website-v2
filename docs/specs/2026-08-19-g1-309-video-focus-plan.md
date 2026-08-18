# `#309` slice plan · 品牌頁影片播放後,鍵盤焦點掉回頁面最上面

> 作者:G1 · 落檔 2026-08-18 23:5x CST(`date` 實跑)
> 🔴 **狀態:尚未批准。** 我估「單檔」,**量完是 4 檔** ⇒ 命中鐵則 8 ⇒ 停下提 plan。
> 📌 主視窗給的閘就是為這件事設的:**「我估它單檔」不是「它是單檔」** —— 閘生效了。

## ① 射程(量到的,不是估的)

**病灶只有一個地方**(這一格是好消息):
```
git grep -ln 'BrandPageMedia' -- apps/storefront/src            ⇒ 11 檔(多為別片的 smoke test)
git grep -lnE 'bp-film|poster|isPlaying|setPlaying' -- …/src    ⇒ 11 檔
逐檔開來看,真正有「封面按鈕整個換成播放器」這個切換的:**只有 BrandPageMedia.tsx**
  · AkrapovicShowcase.tsx:103  原生 <video poster=…>,沒有切換 ⇒ 不受影響
  · BrandPageCraft.tsx:41      原生 controls + poster + preload=none,沒有切換 ⇒ 不受影響
⇒ **不需要在多個呼叫端各補一次**,修一處即可。
```

**而要改的檔是 4 個**:
```
apps/storefront/src/components/brand/BrandPageMedia.tsx        焦點轉移本體
apps/storefront/src/components/brand/BrandPageMedia.test.tsx   守門(現在 291 行,零焦點格)
apps/storefront/src/styles/brand-page.css                      焦點框(理由見 ③,這格不是可選的)
apps/storefront/src/styles/brand-page.test.ts                  CSS 規則的守門(本 repo 既有慣例,見 #310)
```

## ② 病是什麼
`BrandPageMedia.tsx:1xx` 按下封面 ⇒ `setPlaying(true)` ⇒ **那顆按鈕整個從 DOM 移除**,
React 不轉移焦點 ⇒ 用鍵盤按 Enter 播放的人,**焦點當場掉回 `<body>`**,
要從整頁最上面重新 Tab 回來。
🔴 **零訊號**:純鍵盤使用者不會回報「焦點不見了」,只會放棄用鍵盤。滑鼠使用者完全沒症狀、截圖也看不出來。

## ③ 🔴 為什麼 CSS 那格不能省(這是本 plan 最重要的一段)

`brand-page.css:335-344` 已經**用註解記著兩個坑**(2026-08-04 真機截圖坐實的),
而它們對**任何**放在 `.bp-film-frame` 裡面的焦點目標**一體適用**:
```
① 位置:`.bp-film-frame` 是 overflow: hidden,而全站 tokens.css:157-160 的
        outline-offset: 2px 把整圈畫在裁切區外 ⇒ 一條線都不會出現
② 顏色:全站焦點色 var(--c-text) 近黑,而這個框裡永遠是深色影片封面 ⇒ 就算畫進來了也看不見
```
⇒ **只做 JS 那半(把焦點移到 `<video>` / `<iframe>`)= 明知故犯地重現一個已經寫在註解裡的 WCAG 2.4.7 失敗。**
那正是 Sean 2026-08-18 的「不要做一半」,也正是 memory `feedback_copying-design-literally-inherits-its-bugs`
說的**「搬字面連它的疏漏一起搬」**。
✅ 修法**照這個檔自己的語彙**,不另發明:`.bp-film-poster:focus-visible`(:345)已經是
`outline-color: var(--c-red); outline-offset: -3px` ⇒ 新規則**照抄同一組值**。

## ④ 改法(最小)

```
BrandPageMedia.tsx
  · .bp-film-frame 那個 <div> 加 ref + tabIndex={-1}
  · useEffect：playing 由 false → true 時 frameRef.current?.focus()
  ⇒ 為什麼焦點放【外框】不放播放器本體:外框在三種狀態(封面 / 播放器 / blocked 退路面板)
    底下**都存在**;放播放器上的話,blocked 面板一換上來焦點又掉一次
    —— 那正是條目裡「一併評估:blocked 面板出現時焦點也在同一個位置消失」那一格。
brand-page.css
  · .bp-film-frame:focus-visible { outline-color: var(--c-red, #f26722); outline-offset: -3px; }
    （與 :345 同值同語彙，一行）
```
零新檔、零新依賴、零新抽象。

## ⑤ 🔴 鐵則 1:我主張這**不是**偏離 design,而我把理由攤開讓人推翻

條目原文寫「兩種都是**新增設計稿沒有的行為**,依鐵則 1 要走拍板路徑」。**我不同意這個分類**,理由:
```
設計稿 brand-page.html:1926 的 poster.remove() 對焦點【沒有主張】—— 它是【沉默】,不是【反對】。
memory feedback_copying-design-literally-inherits-its-bugs（2026-08-18 立）逐字:
  「鐵則 1 講的是不要重新詮釋,**不是連疏漏也照抄**」。
⇒ 設計稿沒做過 a11y 稽核(條目自己寫的),它的沉默不構成一個決定。
```
**而我把它標成【代裁】,不當成已經解決**(memory `feedback_mark-a-proxy-ruling-so-sean-can-overturn-it`):
- **代裁人:MAIN(主視窗,2026-08-18 深夜)。可推翻。**(~~原寫 G1~~ —— 主視窗接手裁定,見 §⑨)
- **佐證一(同族先例)**:`#310` 同一天同一個品牌頁的 a11y/視覺偏離,**Sean 拍 A = 程式側直接修、不等設計側回寫**。
- **佐證二(常設授權)**:Sean 2026-08-18 對純 UX 慣例題整包授權「**正常的網站該怎麼做就怎麼做**」,
  並交代**同類題不要再送他**(memory `project_0818-sean-delegates-favorites-ux`)。
  移除焦點元素後要接管焦點 = WCAG 2.4.3,教科書級慣例。
- 🔴 **而佐證不等於拍板**:上面兩條都是**別的題目**的裁定。要不要套到這題,**是主視窗的判斷,不是我的**。
  ⚠️ 我也**沒有查過** design-reference / OD 有沒有針對這個播放器的 a11y 明文 —— 這是「我沒查」不是「查無」。

## ⑥ 驗收條件(每條可 yes/no)
1. `playing` 轉 true 之後,`document.activeElement` **是 `.bp-film-frame`**,不是 `<body>`。
2. **負向對照**:把 `focus()` 那行拿掉 ⇒ **那一格要紅**。不紅 ⇒ 我量的是另一個世界,findings 作廢。
3. `blocked` 面板換上來之後,`document.activeElement` **仍然**是 `.bp-film-frame`(沒有第二次掉焦點)。
4. CSS 守門:`.bp-film-frame:focus-visible` 的 `outline-offset` **必須是負值**
   (正值 = 被 overflow:hidden 裁掉 = 恆隱形),且 `outline-color` 不得是 `var(--c-text)`。
   **這兩條各配一個突變**(改成 `2px` / 改成 `--c-text`)證明它們會紅。
5. 四綠(`TURBO_FORCE=1`,動 .tsx/.css ⇒ 含 build)全 rc=0。

## ⑦ 影響面 / rollback
- **影響面**:12 家有影片的品牌頁(條目寫 11,**我當場數 `BrandPageMedia.tsx` 檔頭註解寫 12**
  —— 兩個數字不一致,我沒有重數真資料,**標未確認**)。零 schema、零 API、零後端。
- **rollback**:單一 commit,`git revert`。無資料面副作用。
- **鐵則 12**:六類逐字對過 **零命中**(不碰 packages/ui —— 這幾個檔都在 `apps/storefront` 底下)。

## ⑧ 我沒做的事
- **沒開真瀏覽器量過**。上面「焦點框會被裁掉」是**讀 `brand-page.css:335-344` 的既有註解**得來的,
  那是 2026-08-04 別人的真機量測,**我沒有複驗**。⇒ 批准後我會用 storefront probe 真的量一次再收工。

---

## ⑨ 🔴 鐵則 1 兩道查證:**跑完了**(2026-08-18 23:5x,主視窗要求)

主視窗裁:兩道都跑、查無就把「查無 + 掃過的分母」寫進來,然後它裁定不算偏離、不必送 Sean 拍這一格。
**兩道都跑了,而結果比「查無」更有話講。**

### 道一 · `design-reference` 字面 grep(分母寫出來)
```
分母:find design-reference -type f \( -name '*.html' -o -name '*.css' -o -name '*.jsx' -o -name '*.js' \) ⇒ **49 檔**
字集(多變體):focus\(|\.focus|focus-visible|tabindex|tabIndex|aria-live|autofocus|role="dialog"  ⇒ 8 行
影片/播放器:grep -rlniE 'poster|player|<video|iframe' ⇒ **0 檔**
```
🔴 **`design-reference` 裡根本沒有這個播放器** —— 它整個不在那份真權威裡。
(與元件檔頭一致:`BrandPageMedia.tsx:3-5` 逐字「字面搬自 Open Design `pcm-home-redesign/brand-page.html`;
鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B,**本線真權威在 OD**」。)
📎 而 `design-reference` **本身會做焦點管理**:`components/SearchOverlay.jsx:16` `inputRef.current?.focus()`、
`:94` 清除後 refocus、`AccountPages.jsx:208` `autoFocus`。⇒ **焦點管理在 design 的語彙裡,不是外來品。**

### 道二 · OD `list_projects` 當場列全部(分母寫出來)
```
list_projects ⇒ **9 個專案**(pcm-home-redesign / -opus5 / -codex / pcm-print-docs /
  pcm-admin-order-ui / pcm-product-edit-screen / pcm-product-admin-4dir / 報價單-V2 LINE / 二手車網站)
本線真權威 = pcm-home-redesign（Sean 2026-08-03 Q1=B）
```
在 `pcm-home-redesign/brand-page.html`(**totalLines 2260**)裡:
```
search '.focus('  ⇒ 全專案 13 命中;brand-page.html 佔 3:  :1927  :1933  :1940
search 'poster.remove' ⇒ 全專案 **1 命中**:brand-page.html:**2029**
```
**逐行開檔核過(不是只看命中數)**:
- `:1927 / :1933 / :1940` 是**車輛選配 modal**(`vf-` 前綴)的焦點管理 ——
  開啟時 `VF.lastFocus = document.activeElement` + `$('vf-brand').focus()`,
  關閉時 `VF.lastFocus.focus()` **完整的焦點借還**。
- `:2029` 的 `poster.remove()`,前後 50 行(:2005-2064 全讀過)**零焦點處理**。

### ⇒ 這一格的結論(而它比原本的論證更強)
```
不是「design 沒想過焦點」——**同一個檔案裡它做了完整的焦點借還**,只是【沒做在播放器這一段】。
⇒ 沉默 ≠ 反對,而且這裡的沉默有旁證:作者會這一招,在別處用了,在這裡沒用。
⇒ 而修法要照它自己的語彙（借還 lastFocus 那套），不是另發明。
```
✅ **主視窗據此裁定:不算偏離鐵則 1,這一格不必送 Sean。**(鐵則 8 的批准仍要,見 §①。)

### 🔴 順帶抓到一個過期座標(這條要回寫 backlog)
```
`#309` 條目與 `BrandPageMedia.tsx:1xx` 註解都寫「設計稿 :1926 的 poster.remove()」
實查:**:2029**。漂移 ~103 行。
⇒ 與派工池點名的 `#386`(引的 migration 座標過期)同一個形狀。
⚠️ 我**沒有**查 2026-08-04 當時是不是真的在 :1926 —— 可能是當時就寫錯,也可能是檔案後來長高了。
   **兩種我都沒證據**,所以只寫「今天實查是 :2029」,不寫「有人寫錯了」。
```
