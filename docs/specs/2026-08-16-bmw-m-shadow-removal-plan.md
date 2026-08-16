# BMW M 清陰影片 — plan(✅ 已批、已完成 `a7f9b104`,2026-08-16)

> ## ✅ **已完成並已進 `dev`(commit `a7f9b104`)—— 2026-08-16 A 窗實查補記**
>
> **檔頭原本寫「未動手」,而它在 `a7f9b104` 落地的那一刻就過期了、零機械訊號。**
> 下一個接佇列的人(包括主視窗從 memory 抄清單時)會照字面把它當**待辦**再做一次 ——
> **本段就是為了擋住那一次重工。**
>
> **驗法(可重跑,用本檔 §5 驗收條件① 自己的命令)**:
> ```
> grep -rn 'shadow-' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l
> ```
> **預期 3、實得 4。⚠️ 這個 +1 不是回退** —— 多出來的那一行是
> `components/ui/button.tsx` 裡**描述本次移除的註解**(逐字「四個 variant 的 `shadow-xs` 全拿掉」),
> **不是 code**。真 code 命中恰為 3,與 §2 的分類完全對上:
> 乙類 2 處(`order-status-axes.ts` 未收款紅框 / `ui/sidebar.tsx` 的 1px 描邊)+ 丙類 1 處(`shadow-none`)。
> ⚠️ **那條描邊不要叫它 `--elev-ring`** —— 那是 **OD 的 token 名**,admin code 內零命中
> (`grep -rn 'elev-ring' apps/admin/src` 只命中 `design-tokens.test.ts` 的一行註解)。
> 我方的實際字面是 `shadow-[0_0_0_1px_var(--sidebar-border)]`。**用 OD 的名字指我方的東西,
> 下一個人會去 grep 一個不存在的 token。**(R2 審查抓到)
> 🔴 **這種「數字對不上但不是壞事」不寫下來,下一個人一定會再驚嚇一次** —— 而他的第一反應會是
> 「有人把陰影加回去了」,然後花一輪去查。
>
> **§3 那顆壞掉的描邊也已修好**:`ui/sidebar.tsx` 搜 `sidebar-border` ⇒ 現況
> `shadow-[0_0_0_1px_var(--sidebar-border)]`(`hsl()` 包裝已拿掉)⇒ 它現在**真的會渲染**。
>
> ---
>
> **狀態**:~~未動手~~ **已完成(見上方)**。本檔是 plan,不是紀錄。
> **提出**:A 窗(BMW M 外觀線),2026-08-16。工作樹 `/Users/sean_1/pcm-void-readers`,分支 `void-readers`。
> **為什麼要 plan**:跨 6 支檔 ⇒ 命中**鐵則 8「跨 3+ 檔」**。
> **為什麼【不】是決策題**:BMW M 對陰影的立場在原稿裡是明確的(見 §1)⇒ 鐵則 1 照搬,不開選項。

---

## 1. 要改什麼 —— 以及為什麼這不是我的品味

**OD 真權威** = `overview-desktop-bmw-m.html`
(sha256 `e3609fc438c8e03d417ef1dcf0f976e14d958b3516073491182c77148bff4bbb` / 40,610 bytes)。

```
宣告端      :57  --elev-flat: none
            :58  --elev-ring: 0 0 0 1px var(--border)
            :59  --elev-raised: 0 22px 56px rgba(17, 24, 39, 0.12)

用值(數法)  grep -c 'var(--elev-raised)' <OD>   →  0     🔴 唯一的投影式陰影，宣告在、用值 0
            grep -c 'box-shadow' <OD>            → 10
              其中 --elev-ring 1px 描邊  3 行（:107 :117 :309）
                   focus 環             2 行（:125 :160）
                   inset 3px 色條       4 行（:178 :179 :180 :218）
                   box-shadow:none      1 行（:219）
```

🔴 **⇒ BMW M 全稿沒有任何一處在用投影式陰影。分層靠 `--elev-ring` 的 1px 描邊。**
**這是查出來的結論,不是我覺得好看。**

---

## 2. 逐處清單(13 行 `shadow-*`,**先分類再報數**)

數法:`grep -rn 'shadow-' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l` → **13**

### 甲.要改的:10 處真陰影 → 換成 `--elev-ring` 形狀的 1px 描邊

| # | 檔:行 | 現況 | 改成 |
|---|---|---|---|
| 1 | `components/ui/button.tsx:13` | `shadow-xs`(default) | 移除 |
| 2 | `components/ui/button.tsx:15` | `shadow-xs`(destructive) | 移除 |
| 3 | `components/ui/button.tsx:17` | `shadow-xs`(outline) | 移除(它**已經有** `border`) |
| 4 | `components/ui/button.tsx:18` | `shadow-xs`(secondary) | 移除 |
| 5 | `components/ui/input.tsx:11` | `shadow-xs` | 移除(它**已經有** `border-input`) |
| 6 | `components/ui/sidebar.tsx:286` | `shadow-sm`(floating 變體) | 移除 |
| 7 | `components/ui/sidebar.tsx:348` | `shadow-sm`(inset 變體) | 移除 |
| 8 | `components/ui/sheet.tsx:52` | `shadow-lg` | 換 1px 描邊 |
| 9 | `components/shared/multi-check-filter.tsx:52` | `shadow-md`(下拉浮層) | 換 1px 描邊 |
| 10 | `components/orders/shipment-dialog.tsx:257` | `shadow-xl`(對話框) | 換 1px 描邊(它**已經有** `border`)|

### 乙.🔴 **不能一起掃的 2 處 —— 它們是 `ring` 不是陰影**

| # | 檔:行 | 為什麼不能掃 |
|---|---|---|
| 11 | `lib/orders/order-status-axes.ts:90` | **未收款的紅框**。`shadow-[0_0_0_1.5px_var(--destructive),0_0_0_3px_…]` —— 這是**雙層描邊**,不是投影。掃掉 = **拿走「這張單還沒收到錢」的視覺訊號**。而且它有守門(`order-status-axes.test.ts:176,242`)。**OD 自己也用 `box-shadow` 畫這類標記**(`:178-180` `:218` 的 `inset 3px`)⇒ **留著才是照 OD。** |
| 12 | `components/ui/sidebar.tsx:505` | `shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` —— **形狀上正是 OD 的 `--elev-ring`**,不是投影。但它**現在是壞的**,見 §3。 |

### 丙.已經沒有陰影的 1 處(不用動)

| # | 檔:行 | 說明 |
|---|---|---|
| 13 | `components/ui/sidebar.tsx:361` | `shadow-none` —— 本來就是關閉陰影 |

⚠️ **合報「13 處」會讓人以為 13 處同構、一次 `sed` 掃掉** ——
**而掃掉第 11 處就是拿走一個錢的訊號。** 這就是要逐行分類的理由。

---

## 3. 🔴 `sidebar.tsx:505` 那顆:**它已經無效,而【我怎麼確認的】比結論重要**

**結論**:那條 box-shadow **現在不會渲染**,而且**改版前也不會** ⇒ **既有問題,不是片1/片2 造成的。**

**怎麼確認(三步,都可重跑)**:

```
① 原始碼字面
   sed -n '505p' components/ui/sidebar.tsx
   → shadow-[0_0_0_1px_hsl(var(--sidebar-border))]

② Tailwind 有沒有把它編出來（有 —— 所以不是「沒產生規則」）
   grep -o '.\{0,90\}hsl([^)]*)' apps/admin/.next/static/chunks/*.css
   → --tw-shadow:0 0 0 1px var(--tw-shadow-color,hsl(var(--sidebar-border)))

③ 那個值合不合法 —— 用【真的 CSS 解析器】判，不是憑規格背誦
   node -e "const {JSDOM}=require('jsdom');const el=new JSDOM('').window.document.createElement('div');
            for (const v of ['hsl(210 20% 87%)','hsl(#d7dee8)','#d7dee8']) {
              el.style.color=''; el.style.color=v;
              console.log(v, '->', JSON.stringify(el.style.color)); }"
   → hsl(210 20% 87%) -> "rgb(215, 222, 229)"     合法
   → hsl(#d7dee8)     -> ""                        🔴 被丟棄
   → #d7dee8          -> "rgb(215, 222, 232)"      合法
```

**串起來**:`--sidebar-border` 現值是 `#d7dee8`(hex)⇒ `hsl(var(--sidebar-border))` 展開成
`hsl(#d7dee8)` ⇒ **不是合法顏色 ⇒ 那條 box-shadow 無效。**

⚠️ **機制上的精確講法(不要寫成「解析時報錯」)**:
自訂屬性(`--tw-shadow`)**不驗證內容**,所以它照樣存得下去;
**失效發生在它被代入 `box-shadow` 的那一刻**(computed-value time)⇒ **不會有任何 build 警告。**

⚠️ **改版前一樣壞**:片1 之前 `--sidebar-border` 是 `oklch(0.94 0 0)`,
展開成 `hsl(oklch(0.94 0 0))` —— **同樣不是合法顏色。**
🔴 **⇒ 不要把它記成「片1 弄壞的」。** 它從 fork 進來就是壞的。

**本片的處置(建議)**:改成 `shadow-[0_0_0_1px_var(--sidebar-border)]`(拿掉 `hsl()` 包裝)
⇒ 它就變成一個**真的會渲染的 `--elev-ring`**,而那正是 OD 要的形狀。
⚠️ **這會讓一條「本來看不見的線」出現** —— 那是**修好**,但畫面**會變**,要讓 Sean 知道。

---

## 4. 預期影響面

- **看得到的**:全站按鈕、輸入框的浮起感消失(變平);出貨對話框、下拉浮層、側拉面板改用 1px 描邊分層。
- **看不到但要注意的**:`sheet` / `multi-check-filter` 是**浮在內容之上**的東西 ——
  陰影拿掉之後,**它們與底下內容的分界只剩那條 1px 線**。
  🔴 **`--border` 對卡片只有 1.36 對比** ⇒ **這是本片唯一有實際風險的地方**,
  交件必須附這三個浮層的截圖給 Sean 看「分不分得出來」。

  > ## ✅ **已驗,通過(2026-08-16)。Sean 肉眼驗逐字:「浮在上面」。**
  > **問法是收窄過的**:不問「分不分得出來」(太抽象),問「**這個框浮在上面,還是跟後面的東西糊在一起?**」。
  > ⇒ **1.36 這個數字在實際畫面上夠用** —— **數字回答不了的那一半,由他回答了。**
  > 🔴 **本風險點關閉,不需要改吃 `--input`。**

  ⚠️ **下面這個備案【已驗證不需要】,但【刻意保留】** ——
  若分不出來,**正解是那幾個浮層改吃 `--input`(3.50),而不是把 `--border` 整個調深**
  (調深 `--border` 會動到全站每一條線)。
  🔴 **為什麼不刪掉它**:**它的前提是「`--border` 維持現在這麼淡」** ——
  哪天有人把 `--border` 調得更淺,這個備案就是**現成的答案,而理由已經寫好了**。
  **刪掉它等於把「已驗過的結論」與「當初為什麼這樣選」一起丟掉。**
- **不影響**:未收款紅框、已取消膠囊虛線框、focus 環(都不在甲類)。

## 5. 驗收條件(每條可 yes/no)

1. `grep -rn 'shadow-' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l` → **3**
   (只剩乙類 2 處 + 丙類 1 處)
2. 編譯產物裡 `--tw-shadow` 的殘留數下降,且 `grep 'hsl('` → **0**(那兩個無效的沒了)
3. `order-status-axes.test.ts` 全綠(未收款紅框沒被掃到)
4. 新增一格守門:**甲類那 10 處不得復發**(掃 `shadow-(xs|sm|md|lg|xl)`),
   且**乙類 2 處要在白名單裡並附理由**(不是靜默豁免)
5. 三綠 `--force` 且 `0 cached`;vitest 全綠
6. 附三個浮層(sheet / 下拉 / 出貨對話框)的真瀏覽器截圖

## 6. Rollback

單一 commit、純樣式、無 schema/API/資料改動 ⇒ `git revert <sha>` 即可完全復原。
**風險等級低**,唯一的不可逆風險是「Sean 看了覺得太平」——那是視覺取捨,revert 成本一顆 commit。

## 7. 我需要的批准

**只需要一句「可以做」。** 本片不含任何決策題:
OD 立場已定案(§1)、逐處分類已完成(§2)、那顆壞掉的已查清楚(§3)。
⚠️ **與 `Q-A2` / `Q-A4` / `Q-A5` 無關**,不必等那三題。
