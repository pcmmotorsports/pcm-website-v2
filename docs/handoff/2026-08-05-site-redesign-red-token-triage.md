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

| 位置 | 現值 | 判定 |
|---|---|---|
| `styles/tokens.css:28` `--c-red` | `#dc2626` | → `#f26722`(0c) |
| `styles/tokens.css:29` `--c-red-soft` | `#fee2e2` | → `#fdeadd`(0c;cart-page-handoff §1-1) |
| `styles/tokens.css:30` `--c-red-dark` | `#991b1b` | → `#c4470c`(0c) |
| `styles/brand-page.css:77` `--c-red` | `#f26722` | **不動** — 品牌頁已定案上線,自己 scope 了熔橘;全站切換後值相同、留著不礙事(移除是另一片的事) |

另需**補定義** `--c-accent: #c4470c`(products-list-handoff R1-1)——
`styles/pricing.css:15,35,59` 寫的是 `var(--c-accent, #c0392b)` 而 `--c-accent` 全站未定義,
現況實際渲染 fallback `#c0392b`(第三顆紅)。

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
| `pricing.css:15,35,59` | 經銷 pill / 經銷價 `--c-accent` | 補定義 `#c4470c` | R1-1 |
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

### 3-3 🔴 待裁示(已發 `D-201-Q` / `D-202-Q`,尚無回覆)

| # | 落差 | 為什麼卡住 |
|---|---|---|
| Q1 | `tier.css:33-40` `.tier-badge-premium` 吃 `--c-red` | 會員等級=**身分色**,但 OD `pcm-account.css:154` 明寫「真站是 `<TierBadge>` 元件、本稿只畫版位」⇒ **設計端未表態**。選項:A 跟著變熔橘 / B 改墨黑(會與 `tier-badge-store` 撞成同款)/ C 新增 `--c-tier-premium` 釘住現值。我傾向 C。渲染點 `account/tabs/OverviewTab.tsx:59`、`CheckoutSummaryAside.tsx:64` |
| Q2 | `product-page.css` 20 個消費點 | 商品詳情頁 `/products/<slug>` 在 `SITE-MAP.md` 明列**未設計**、派工單六批也沒有它,但改 token 會一次染色整頁。逐點語意我判過:多數該跟著變(主鈕 `:499`、收藏 `:512-513`、輪播鈕 `:1454,1462`、播放鈕 `:1672`、重點條 `:1578-1580`、項目點 `:1606`、下載 hover `:1712`、手機購買列 `:1847-1848`、不相容標記 `:1936-1937`);**唯一該另處理 = `:310 .pd-price.is-red`**(白底特價價格=文字層 → 應 `--c-red-dark`)。另有兩處寫死 `rgba(220,38,38` 在 `:1459,1674`。我傾向放行 |
| Q3 | 頁尾寬度規範落點在 `home.css:834` 等 | D-101-A 明文「C 窗關閉前不要動 `home.css`」。C 窗已於 `C-204-STOP` 收工關閉 ⇒ **這條應已自然解除**,但等主視窗明文放行再動 |

附帶(不擋工):`SITE-MAP.md` 第六節「商品詳情頁金色線 `--c-gold` 與列表頁的銜接」
是設計端**已知未解、Sean 待決**,本線不碰。

## 四、下一棒怎麼用這份

1. Q1/Q2 拿到裁示 → 直接照第三節表格套 0c,不用重新盤點。
2. 每改一處,對照該頁交接單的驗收條件逐條 yes/no。
3. 0c 落地後,`home.css:17,428`、`home.test.ts:375,378`、`brand-page.css:60`、
   `brand-page.test.ts:235` 那批**註解裡的「站台 `--c-red` = 緋紅 `#dc2626`」會全部過期**
   —— 逐條更正字面(memory `feedback_claimed-sync-but-only-patched-touched-lines`:
   這正是「只補到手碰過的行」最常復發的形狀)。
