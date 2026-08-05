# `--c-red` 家族消費點盤點與判定(全站重設計 第0批 §3-1 硬前置)

> 視窗 D,2026-08-05。派工單 `docs/handoff/2026-08-05-site-redesign-line.md` §3-1 要求的
> 「動手前先 grep 全樹列出每一個消費點,逐一判該不該變熔橘」的結果。
> **這份是第0批最貴的產物** —— 斷線重來要整個重做一次。判定依據一律附設計端逐字出處。
>
> 盤點基準:worktree `pcm-site-redesign` @ `c058ae4`。
> 命令:`grep -rn -e '--c-red' --include='*.css' --include='*.tsx' --include='*.ts' apps/ packages/`
> ⇒ **112 筆命中**,扣掉 token 定義(4)與註解引用後 **約 60 個真消費點**。
>
> 🔴 尚未做的事:**`--c-red` 三顆的值本身還沒改**(第0批 0c)。下面「改為」欄是判定、不是現況。

## 一、Token 定義點(4 筆)

> 🔴 **本節刻意不寫行號、只寫 token 名**(0a 補審 nit #6):初版寫的 `tokens.css:28/29/30`
> 在**同一顆 commit 內**就被自己推到 40/41/42 —— 行號是這份文件裡最短命的字面。

| 位置 | 現值 | 判定 |
|---|---|---|
| `styles/tokens.css` `--c-red` | `#dc2626` | → `#f26722`(0c) |
| `styles/tokens.css` `--c-red-soft` | `#fee2e2` | → `#fdeadd`(0c;cart-page-handoff §1-1) |
| `styles/tokens.css` `--c-red-dark` | `#991b1b` | → `#c4470c`(0c) |
| `styles/brand-page.css` `--c-red`(區域 scope) | `#f26722` | **不動** — 品牌頁已定案上線,自己 scope 了熔橘;全站切換後值相同、留著不礙事(移除是另一片的事) |

另需**補定義** `--c-accent: #c4470c`(products-list-handoff R1-1 逐字:「`--c-accent`(經銷 pill 與經銷價)→ **#c4470c**」)。

### 🔴 `--c-accent` 消費點更正(0a 補審 R1 must-fix #1、#2)

初版把 `pricing.css:15,35,59` 標成「吃 `--c-accent`」——**錯的**。實查(`f8e2d2f` 樹內、本輪複驗仍相同):

| 位置 | 實際字面 | 現況渲染 | 判定 |
|---|---|---|---|
| `pricing.css:28` `.price-tag-dealer` | `background: var(--c-accent, #c0392b)` | fallback `#c0392b` | → `#c4470c`(R1-1 逐字點名「經銷 pill」) |
| `pricing.css:46` `.price-wrap.is-dealer .price-main` | `color: var(--c-accent, #c0392b)` | fallback `#c0392b` | → `#c4470c`(R1-1 逐字點名「經銷價」) |
| `pages-shipping.css:84` `.shipping-card-num` | `color: var(--c-accent)` **無 fallback** | 宣告在 computed-value time 失效 ⇒ 繼承 `--c-text` **墨黑** | **跟著變 `#c4470c`**;設計端 `pcm-content.css:8` 逐字放行:「色 `var(--c-accent)` 在新 token 已是深熔橘 `#c4470c`,**不另外改字面**」 |
| `products-page.css:142` `.pp-loading-progress > span` | `background: var(--c-accent, var(--c-text))` | fallback `--c-text` **墨黑** | → 改吃 `var(--c-red)` 亮熔橘。**設計端未表態**(OD 只有現站快照 `archive/current-site-snapshot.html` 與 `source/` 鏡像、無此元件的新稿),依 §4-1 通則判:進度條=狀態指示屬動作色,而它是**填色層** ⇒ 該吃亮熔橘不是深熔橘。🔴 **列入 0c 的 Sean 肉眼驗清單** |

⚠️ 上一列那條「填色層 ⇒ 亮熔橘」的通則**不是硬規則**:同表的 `pricing.css:28` 經銷 pill 也是 `background`,
R1-1 卻逐字指定深熔橘 `#c4470c`。⇒ 設計端有逐字時**一律以逐字為準**,通則只用在設計端未表態處,
而且用了就要列進肉眼驗清單。

⚠️ 這兩處(`pages-shipping.css:84` / `products-page.css:142`)初版**整個漏盤**。它們與 `pricing.css` 的兩處
不同:那兩處今天渲染的是 fallback `#c0392b`(第三顆紅),而這兩處今天渲染的是**墨黑**
⇒ 0c 一補定義 `--c-accent`,它們是「由黑變橘」的**可見變化**,不是「紅換橘」。

附帶(不屬 0c、屬第1批 `/info/shipping`):`pages-shipping.css:81` 的 `var(--font-mono)` 是**真站 typo**
—— 該 token 在 `:root` 沒有定義,全樹唯一定義點是 `product-page.css:18` 的 `--font-mono: var(--f-mono);`
(scope 在 `.pd-page` 系列)⇒ `/info/shipping` 落在該 scope 之外、取不到值,實際 fallback 到系統
generic monospace。設計端 `pcm-content.css:7,84` 已標明改 `var(--f-mono)`。留給第1批,不在本線改。
(同 typo 另一處 `products-page.css:212` 寫的是 `var(--font-mono, monospace)`、**有 fallback**,症狀較輕、同批處理。)

## 二、判定總則(設計端 §4-1,總交接單逐字)

1. **熔橘是動作色,不是身分色** —— 深底白字的身分標記維持墨黑。
2. **文字層深熔橘 / 填色層亮熔橘** —— 白底小字(價格、錯誤訊息)`--c-red-dark` `#c4470c`(4.9:1);
   色塊、徽章、框線 `--c-red` `#f26722`。
3. **主 CTA 一律熔橘**(Sean 2026-08-05 選 B)。

## 三、逐檔判定

### 3-1 有設計權威、已判定(不需再問)

| 檔案:行 | 選擇器 / 用途 | 判定 | 依據 |
|---|---|---|---|
| `auth.css:59` | `.auth-err` 左框線 | 留 `--c-red` 填色層 | OD `pcm-auth.css:22` |
| `auth.css:60` | `.auth-err` 文字 | → `--c-red-dark` | 同上 |
| `auth.css:95` | `.auth-field-err` | → `--c-red-dark` | OD `pcm-auth.css:28` |
| `auth.css:105` | `.auth-field > .auth-field-err` | → `--c-red-dark` | OD `pcm-auth.css:30` |
| `auth.css` `.auth-err` 底色 `#fef2f2` | 紅50 底 | → `#fdf3ec` | OD `pcm-auth.css:22` 逐字 |
| `account.css:335` | `.acc-profile .auth-field-err` | → `--c-red-dark` | OD `pcm-account.css:5,341` |
| `account.css:598` | `.acc-inline-form-inner .auth-field-err` | → `--c-red-dark` | OD `pcm-account.css:592` |
| `checkout.css:145` | `.co-inv-hint` | → `--c-red-dark` | OD `pcm-checkout.css:141` |
| `checkout.css:165` | (文字層) | → `--c-red-dark` | OD `pcm-checkout.css:162` |
| `checkout.css:235` | `.co-notification-email [aria-invalid]` 邊框 | 留 `--c-red` | OD `pcm-checkout.css:248` 明標「框線層」 |
| `checkout.css:331` | `.tpfield.tpfield-error` 邊框 | 留 `--c-red` | OD `pcm-checkout.css:353` |
| `checkout.css:332` | `.co-card-error` 文字 | → `--c-red-dark` | OD `pcm-checkout.css:354` |
| `checkout.css:472` | `.co-submit-error` 文字 | → `--c-red-dark` | OD `pcm-checkout.css:544,563` |
| `checkout.css:526,595` | (文字層) | → `--c-red-dark` | OD `pcm-checkout.css:626,697` |
| `product-card.css:21` | `.pcard::before` hover 速度線 | 留 `--c-red` | products-list-handoff §三 |
| `product-card.css:72` | `.badge-min-red` | 留 `--c-red` | 同上(徽章=填色層) |
| `product-card.css:76` | `.badge-red` | 留 `--c-red` | 同上 |
| `product-card.css:202` | `.pcard .price-main` | → **`--c-red-dark`** | products-list-handoff **R1-1** |
| `pricing.css:15` | `.price-wrap .price-main.is-sale` 特價主價 | → **`--c-red-dark`** | products-list-handoff **R1-1** 表列逐字點名 |
| `pricing.css:35` | `.price-wrap .price-tag-save` 「省 NT$」小字 | → `--c-red-dark` | §4-1 通則(白底小字=文字層);R1-1 未逐字點名、依通則判 |
| `pricing.css:59` | `.price-wrap.is-red .price-main` 紅價主價 | → `--c-red-dark` | 同上(與 `.pcard .price-main` 同一個東西的另一個渲染路徑) |
| `pricing.css:28,46` | 經銷 pill 底色 / 經銷價 `--c-accent` | 補定義 `#c4470c` | R1-1 |
| `filter-drawer.css:154` | `.fd-tab-dot` 徽章數字 | 留 `--c-red` | products-list-handoff §三 |
| `products-mobile.css:69,83,109,110,153,290,308,387,388,422` | 手機選車 CTA / 徽章 / focus 框 / 排序選中 | 留 `--c-red` | 同上 |
| `products-mobile.css:114,309,392` | 寫死 `rgba(220,38,38,…)` 陰影 | → `rgba(242,103,34,…)`,alpha 不變 | products-list-handoff §1-3 |
| `header.css:71,72` | `.pcm-nav-sale` 「特價」 | 留 `--c-red` / hover `--c-red-dark` | products-list-handoff §三(殼) |
| `header.css:143` | `.pcm-cart-dot` 購物車數字點 | 留 `--c-red` | 同上 |
| `cart-vehicle.css:49,50,51,56` | `.cvf-chip[data-fit='no-match']` | 留熔橘系,底色 → `#fdeadd` | cart-page-handoff §1-1 |
| `FilterDrawer.tsx:98`、`FilterSide.tsx:296` | `{ id:'red', name:'紅', hex:'#dc2626' }` | 🔴 **不動** | 那是「紅色商品」的顏色篩選色票,不是品牌色 |

### 3-2 已定案上線、自帶 scope,本線不動

`home.css`(首頁,自有 `--ed-c-action*`)、`brand-page.css`(自 scope `--c-red:#f26722`)、
`brand-directory.css`。三支的守門測試(`home.test.ts:372-379`、`brand-page.test.ts:235,475,529`)
**明文斷言它們不吃站台 `--c-red`** —— 全站切換後那些斷言仍成立(negative match),但註解裡
「站台 `--c-red` 是緋紅」那句會過期,0c 落地時要一併更正字面。

### 3-3 ✅ 三題已裁(`D-105-A`,2026-08-05;原 `D-201-Q` / `D-202-Q`)

| # | 落差 | 裁示 |
|---|---|---|
| Q1 | `tier.css:33-40` `.tier-badge-premium` 吃 `--c-red` | **C 案**:新增 `--c-tier-premium: #dc2626` 釘住現值 = **零視覺變更**。理由(`D-105-A` ②):A 會讓身分標記吃動作色(牴觸 §4-1);B 改墨黑會與 `tier-badge-store` 撞成同款、客人與員工分不出等級=功能性退化。落地時在 token 上方註明「暫行:設計端對 TierBadge 未表態,PREMIUM 最終色待 Sean 拍板」。渲染點 `account/tabs/OverviewTab.tsx:59`、`CheckoutSummaryAside.tsx:64` |
| Q2 | `product-page.css` 20 個消費點 | **A 案放行**,詳情頁跟著全站變。多數跟著變(主鈕 `:499`、收藏 `:512-513`、輪播鈕 `:1454,1462`、播放鈕 `:1672`、重點條 `:1578-1580`、項目點 `:1606`、下載 hover `:1712`、手機購買列 `:1847-1848`、不相容標記 `:1936-1937`);**唯一另處理 = `:310 .pd-price.is-red`** → `--c-red-dark`(白底價格=文字層);寫死 `rgba(220,38,38` 兩處 `:1459,1674` 一併改。🔴 **附帶義務**:0c 收工時把商品詳情頁的桌機+手機截圖列進「Sean 肉眼驗」清單,理由寫明「此頁無設計稿、色票是依全站規則外推」。`--c-gold` 金色線那條是 Sean 待決、不碰 |
| Q3 | 頁尾寬度規範落點在 `home.css` | **明文放行**(C 窗已關、D5g 已收割入 dev `4874216`)。⚠️ `home.css` 現在多了 D5g 的 `.js-reveal` 那組規則、`home.test.ts` 多了 7 條 D5g 守門,動頁尾段時避開、別誤刪 |

附帶(不擋工):`SITE-MAP.md` 第六節「商品詳情頁金色線 `--c-gold` 與列表頁的銜接」
是設計端**已知未解、Sean 待決**,本線不碰。

## 四、下一棒怎麼用這份

1. 三題裁示已在 3-3 落檔 → 直接照第三節表格套 0c,不用重新盤點、也不用再等。
2. 每改一處,對照該頁交接單的驗收條件逐條 yes/no。
3. 0c 落地後,`home.css:17,428`、`home.test.ts:375,378`、`brand-page.css:60`、
   `brand-page.test.ts:235` 那批**註解裡的「站台 `--c-red` = 緋紅 `#dc2626`」會全部過期**
   —— 逐條更正字面(memory `feedback_claimed-sync-but-only-patched-touched-lines`:
   這正是「只補到手碰過的行」最常復發的形狀)。
   🔴 **不要照上面那串行號硬套** —— 0b 動過 `home.css`(D7 吸收)之後行號一定漂。
   正確做法 = 動手前重跑一次 grep 建當下的清單,而且**pattern 要含 `--c-accent`**:

   ```bash
   grep -rn -e '緋紅' -e '#dc2626' -e -- '--c-accent' apps/ packages/
   ```

   🔴 為什麼要加 `--c-accent`(0a 補審複審 N-8):`checkout.css:15,143` 與 `CheckoutStep2.tsx:36`
   寫的是「design 的 `--c-accent` 在 storefront tokens **未定義**」—— 0c 一補定義那三句就變假話,
   而它們**不含「緋紅」也不含 `#dc2626`**,只掃前兩個關鍵字會整批漏掉。
   (已查證那三處**不是**漏盤的消費點:`checkout.css:145 .co-inv-hint` 已在 §3-1 表判 `--c-red-dark`、
   對齊 OD `pcm-checkout.css:141`,無視覺分歧;要改的只有註解字面。)

## 五、修訂紀錄

- 2026-08-05 初版(隨 0a `f8e2d2f`)。
- 2026-08-05 **0a 補審 R1 FAIL 折入**(`D-108-A`):§一 `--c-accent` 消費點整段更正
  (`pricing.css:15,35,59` 誤標為 `--c-accent`,實為 `--c-red`;真正的 `--c-accent` 在 `:28,:46`)、
  補上初版**整個漏盤**的 `pages-shipping.css:84` 與 `products-page.css:142` 並逐點判語意;
  §一改成只寫 token 名不寫行號(nit #6);§3-3 三題裁示落檔。
- 2026-08-05 **同片複審(fresh code-reviewer,FAIL 1 must-fix + 10 nit)再折入**:
  三個行號字面更正(`pages-shipping.css:83`→`:81`、`pcm-content.css:85`→`:84`)、
  「`--font-mono` 全站不存在」是**錯的**(`product-page.css:18` 有區域定義)已改寫、
  §四-3 的 sweep pattern 補 `--c-accent`(否則 `checkout.css:15,143` 那族整批漏掉)、
  補上「填色層通則不是硬規則、`pricing.css:28` 就是反例」的警語。
  複審同時獨立查證了「`f8e2d2f` typecheck 紅」為真(實跑 11 個 TS2532)。
