# M-1-13H Codex Review Packet — 2026-05-22

> **觸發**:M-1-13H slice-5 commit 完成、slice-6 跑前(對齊鐵則 12 + automode protocol §7)。
>
> **指示給 Codex**:本 Packet 為唯讀審查請求、Codex 對 GitHub repo 唯讀、無需 clone;
> Packet 自帶相關規則摘錄與 commit body 完整字面、可獨立審查不需 repo 存取。
> 請回 findings(must-fix / consider / nit 分類、附 file:line + 修正建議)、Sean 拍板處置
> (忽略 / 併 slice-6 fix / 開 fix slice)。

---

## 1. 範圍

M-1-13H 商品頁全面改版(Apple/Aritzia 現代派)、slice-2 ~ slice-5 共 4 commit
(slice-1 `a8f5a01` 已 push、slice-0 偵察報告 `4fde07c` + plan `271d22b` 不在本 Packet
範圍;本 Packet 聚焦 slice-2 ~ slice-5 未 push 累積)。

**業務目標(對應 PRD §1):**
- 視覺從 13d/e/f-2 累積的混雜風格(serif 38px 標題、紅色價格、厚 banner、4×40 方 swatch、
  56 直角 uppercase CTA、底線 tabs)→ Apple/Aritzia 現代派(sans 28px 標題、22px 黑色價格、
  併進副標、24 圓 swatch、48 pill CTA、pill tabs);新增 Highlights + Spotlight 突顯區塊。
- 不動 mobile sticky bar 紅色(Sean Q3 業務拍板轉換率考量、視覺斷層接受);
- 不動 ProductCard(Q4 既有 design 真權威已搬完);
- design-reference submodule 不動(Q6 Sean 在 Claude Design 端動)。

**PRD 拍板鎖**:`docs/specs/M-1-13H-product-page-overhaul-plan.md`(7 題 Q1-Q7 cowork 拍板、
2026-05-21);Sean 新增決策(2026-05-22):
- Q1 automode = A;Q2 try-skip browser MCP
- Q-slice-4 hasSpotlight 3 件 = A1(lightech-1 + akrapovic-6 + brembo-7)

---

## 2. Commit 序列

| # | hash | subject | 動到的檔(精準 add) |
|---|---|---|---|
| 1 | `79f89bc` | feat(storefront): ProductInfo 上半 SKU/title/副標 Apple/Aritzia 改版 [M-1-13H-2] | ProductInfo.tsx / ProductInfo.test.tsx / product-page.css / phase-1-backlog.md(#162 新立)/ STATUS.md |
| 2 | `eb1e90f` | feat(storefront): buy block + services Apple/Aritzia 改版 + 免運門檻業務拍板 [M-1-13H-3] | ProductInfo.tsx / ProductServices.tsx / product-page.css / phase-1-backlog.md(#161 反轉 4 處偏離)/ STATUS.md |
| 3 | `56ccb5c` | feat(storefront): 新增 ProductHighlights + ProductSpotlight 子元件 [M-1-13H-4] | mock-products.ts / ProductHighlights.tsx + .test.tsx(新)/ ProductSpotlight.tsx + .test.tsx(新)/ ProductPage.tsx / ProductPage.test.tsx(補修 slice-2 漏)/ product-page.css / STATUS.md |
| 4 | `0d5cb99` | refactor(storefront): ProductTabs pill 改造 + 4 panel 內容微調 [M-1-13H-5] | ProductTabs.tsx / product-page.css / STATUS.md |

**檔案 count**:13 個獨立檔(其中 4 個新增、9 個修改);無 schema migration、無 env 變更、
無 design-reference submodule 動;`CLAUDE.md` Sean 端手動加「Claude Code 工具索引」段(`/slice-checkpoint`
+ `context7` MCP)未含在 slice commit 內(Sean 自行處理範圍外)。

**累計三綠**:每 slice typecheck ✅ + lint ✅(no warning)+ build ✅;每 slice sub-agent
Explore code review PASS、無 must-fix;vitest 37/37 全綠(6 個 product 相關 test 檔)。

**Browser MCP**:跟 Sean Q2 try-skip 拍板、5 slice 都跳過、slice-6 收尾 / Sean 肉眼驗統一驗。

---

## 3. 字面 vs 事實揭示彙整(鐵則 11 對沖點)

### 3.1 命名空間遷入(slice-2~5 共通)

| 偏離點 | 字面 vs 事實 | 仲裁 |
|---|---|---|
| `.vc-*` / `.vcf-*` CSS class 遷入 storefront | design 用 `.vc-` / `.vcf-`、storefront 改 `.pd-` 命名空間 | NORTHSTAR §2.4 + HANDOFF L24 命名空間規矩、屬合理遷移、不算偏離 |
| `font-family` 用 `var(--font-sans/mono/serif)` | design 寫 `"Inter", "Noto Sans TC", sans-serif` 字面、storefront 用 CSS var | storefront 既有慣例(M-1-13b 起、L16-18 token bridge)、實質字體相同、不算偏離 |

### 3.2 業務拍板偏離 design 字面(鐵則 1 例外、業務邏輯走 docs/decisions/)

| Slice | 偏離點 | 字面 vs 事實 | 仲裁 |
|---|---|---|---|
| 2 | `.pd-sub` brandCountry「義大利」hardcoded | design L83 字面、MOCK_PRODUCTS 20 件約 60% 義大利(Lightech/CNC/Brembo/Rizoma/Termignoni);其餘 Akrapovič(斯洛維尼亞)/ Öhlins(瑞典)/ GB Racing(英國)字面誤導 | L2 hardcoded、backlog #162 新立(Phase 2 接 brand 表 country 欄位)|
| 3 | 免運門檻 NT$ 5,000 | design VariantCFull L85「4,000」+ L97「3,000」(同檔內已不一致)/ ProductPage L302「4,000」L358「3,000」;storefront 統一 5,000 | Sean 2026-05-21 M-1-13H plan Q1 業務拍板永久化、屬鐵則 1 例外(價格 = 業務邏輯);backlog #161 第 4 處偏離已加、方向反轉(design 待 Claude Design 補對齊 5,000)|
| 3 | qty 結構不移到 swatches 同行 | HANDOFF L190-209 字面「qty 放 swatches 同行右側」;storefront 保留 `.pd-buy-row` 內 qty+add-btn+like 同行 | design VariantCFull L84-95 無 qty 樣板;storefront size opt 並存複雜度;commit body 揭示;Phase 2 評估 |
| 3 | ProductServices 保固字面「原廠授權代理」 | design L99 字面「24 個月」 | 13f-1 Sean 業務拍板「代理多品牌不同保固期」、用「原廠授權代理」更貼合 PCM 業務;L2 業務差異、本 slice 保留 |
| 4 | Spotlight `.pd-spot-media` 純 CSS gradient placeholder | design L133-135 字面用 unsplash `<img src={gallery[1]}>` | 避免 PRODUCT_IMG_POOL 第 3 處撞觸發 backlog #155(ProductCard + ProductGallery 已 2 處);Phase 2 接 supabase `product_spotlights.image_url` 欄;commit body 揭示 |
| 4 | hasSpotlight 用欄位、不採 `product.id % 3 === 0` | HANDOFF L291 字面「暫時用 id % 3 模擬、前 3 件商品看得到 Spotlight」 | PRD Q2=B 拍板 hasSpotlight 欄位;Phase 2 接 supabase `product_spotlights` 表;Sean 2026-05-22 A1 指定 lightech-1 + akrapovic-6 + brembo-7 |
| 5 | description lead 字體 15px(非 19px) | PRD §4 slice-5 預期 commit body「lead 19px」+ HANDOFF L266「19px Inter sans」;design CSS `.vcf-body` L1105 字面 15px | NORTHSTAR §2.4「.jsx + .css > HANDOFF docs」+ 衝突仲裁順序「PRD 字面 > 其他 md」(但 PRD 字面源是 design jsx+css、PRD 此處屬 cowork 解讀 HANDOFF、非真權威字面);採 design 真權威 15px、commit body 揭示 |
| 5 | install-cta 段 storefront 延伸 | design VariantCFull L186-202 無對應字面、只有 meta + steps | 13f-2 既有「預約安裝」CTA + router.push('/install')storefront 延伸功能、本 slice 保留 + CSS 對齊新 Apple/Aritzia 黑底圓角卡(HANDOFF L295);commit body 揭示「storefront 延伸不在 design 字面」 |
| 5 | description pane 移除 `<em>` / `<strong>` 強調 | 13f-2 既有 `<em>{name}</em>` + `<strong>{fits}</strong>` 結構 | 對齊 design L166 字面 plain text、簡化結構;commit body 揭示「semantic HTML emphasis 移除可能影響 SEO、但 design 字面如此、優先對齊真權威」 |

### 3.3 L3 內容對沖(鐵則 9、業務拍板 Phase 2 LOG)

| 範圍 | 內容 | Phase 2 接表(STATUS LOG 待加) |
|---|---|---|
| Highlights 3 卡 (slice-4) | 01 航太級材質 / 02 CNC 一體成型 / 03 原廠保固;lead「義大利賽道工藝 28 年」;字面對齊 Lightech 故事、套到 Akrapovič/Brembo/Öhlins/GB Racing 等誤導 | `product_highlights` |
| Spotlight 4 段 + 3 stats (slice-4) | 4 段 SBK 賽事 / Hard Anodized / Plug & Play;3 stats −38% / ±0.02mm / 24m;純 Lightech 專屬 | `product_spotlights` |
| Specs 8 欄 (slice-5) | 4 dynamic(brand/id/category/fits)+ 4 hardcoded(材質「7075-T6 鋁合金 / CNC」/ 表面處理「Hard Anodized 硬陽極」/ 重量「約 320g (單件)」/ 產地「義大利」)、套各 SKU 不同 | `product_specs` |
| Install 4 steps + meta (slice-5) | meta 難度/工時/工具 hardcoded、4 steps 字面對應 Lightech 22 N·m 扭力 T25 4mm/5mm、套各 SKU 不同 | `product_installs` |
| Services 4 條 (slice-3 既有) | 滿額免運 5,000 / 專業安裝 全台合作店家 / 原廠保固 原廠授權代理 / LINE 諮詢 30 分鐘內回覆 | `site_services` |
| Warranty 3 段 (slice-5) | 24 個月保固 + 7 日內退換 + LINE 客服字面 | `site_policies`(或 `product_warranties`)|

### 3.4 slice 內互相影響(漏修補修)

| Slice | 補修點 | 字面 vs 事實 |
|---|---|---|
| 4 | ProductPage.test.tsx L119-122 改 `${brand} · PCM-${id}` 字面 | slice-2 commit body 字面「vitest 全綠」但僅跑 ProductInfo.test.tsx、未跑 ProductPage.test.tsx cross-effect、slice-4 順手修;屬鐵則 11 違規(slice-2)+ slice-4 補救 |

---

## 4. 風險殘餘

| # | 風險點 | 對應 slice / 子元件 | 處置 |
|---|---|---|---|
| α | `.pd-price-tag-dealer` span 無 CSS rule(13e-a/b 漏) | slice-3 ProductInfo.tsx | 本 5 slice 不擴張範圍補、tier='store'/'premiumStore' 顯「經銷價」tag 用 span default 樣式視覺降級接受;若 Codex review 認為需修、可開 #163 或併 slice-6 fix |
| β | hasSpotlight 套用 Akrapovič / Brembo 時、Highlights + Spotlight 字面誤導 | slice-4 ProductHighlights / ProductSpotlight | L3 hardcoded 對沖、Phase 2 接 supabase `product_highlights` + `product_spotlights` 真區分 |
| γ | qty 結構未移到 swatches 同行 | slice-3 ProductInfo.tsx | HANDOFF intent 偏離、design VariantCFull 無對應字面、Phase 2 評估 |
| δ | description / specs / install / warranty 4 panel L3 內容套各 SKU 不準 | slice-5 ProductTabs.tsx | Phase 2 接 supabase ≥5 張表(見 §3.3);M-1-16 200 SKU 種子前完整 audit |
| ε | mobile sticky bar 紅色保留 vs 商品頁全黑/灰 Apple/Aritzia 風格 | 全 slice、不動 | Sean Q3 業務拍板轉換率考量、視覺斷層接受 |
| ζ | next-env.d.ts pnpm build 自動切 prod 路徑 | 全 slice、不入 commit | Next.js auto-generated、下個 slice 跑 dev 自動切回、不影響 |
| η | CLAUDE.md Sean 端手動加工具索引段未入 slice commit | slice-2~5 全程未 add | Sean 自行 commit、範圍外 |

---

## 5. Rollback 方式

按反序 revert 4 commit、保留 slice-1 `a8f5a01`(已 push、不動)+ chore-protocol
`e4895be`(automode protocol、不動):

```bash
git revert --no-edit 0d5cb99 56ccb5c eb1e90f 79f89bc
```

或 hard reset(本 4 commit 未 push、安全):
```bash
git reset --hard e4895be
```
(對應 reflog 完整、可救回到任一 amend hash:5648424/af49ddb/1d16d99 等 slice-2;
2e79ae0/b848bf1 slice-3 amend 1/stash;70ef47d/10d2026 slice-4 amend 1/stash;
9c4285e/70dc00c slice-5 amend 1/stash)

---

## 6. 相關規則摘錄(Codex 無 repo 存取、自帶上下文)

### 6.1 NORTHSTAR §2.4(衝突仲裁優先級)

> 設計檔內部衝突優先級:`.jsx + .css` 字面 > HANDOFF docs

**應用**:slice-5 PRD/HANDOFF 字面「lead 19px」與 design CSS `.vcf-body` 15px 衝突、
採 design 真權威 15px;HANDOFF L24 命名空間規矩 `.vc-` / `.vcf-` → `.pd-` 合理遷移、
不算偏離。

### 6.2 lessons §12-37(Cowork 引偵察報告字面寫拍板題前必交叉檢查雙端)

> 寫拍板題引偵察報告字面前必雙端 cross-check design-reference 既有實作 + storefront
> 既有實作雙端字面;不憑單一報告字面下拍板題。

**應用**:slice-4 Q-Q2=B 拍板「不採 HANDOFF L291 `product.id % 3`、改 hasSpotlight 欄位」、
PRD §6 風險點 β 預警「Code raise 給 Sean 拍板選 3 件」、slice-4 自治跑時 raise multi-select、
Sean 2026-05-22 A1 拍。

### 6.3 鐵則 8(重大改動先 plan 等批准)

> 重大定義:跨 3 個以上檔案 / 動 schema / API / 共用元件 / 動 next.config / vercel.json /
> Medusa config / Prisma schema / 影響部署或資料遷移。

**應用**:M-1-13H 全程 5 slice、PRD 已 2026-05-21 cowork 寫完 7 題拍板鎖、本 Packet
4 commit 為 plan 下的執行、不另開 plan;但 slice-4 動 MockProduct schema(加
`hasSpotlight?: boolean` 欄位)屬「動 schema」、PRD §3.3 已預先 logged 為 schema 動作、
非首次發現需另立 plan。

### 6.4 鐵則 11(三綠 + 字面 vs 事實守則)

> 每個 slice 結束 commit 前、強制跑 typecheck + lint(動 .ts/.tsx 加 build)、任一紅停下修紅
> 再 commit、不繞道、不 disable / skip / ignore。commit 訊息對應實際內容、不假裝完成沒做的事、
> 有偏離寫 commit body 註明。

**應用**:每 slice 用 `/slice-checkpoint` skill + sub-agent Explore code review + vitest;
字面 vs 事實偏離點 §3 已彙整 12 項;slice-2 commit body 漏跑 ProductPage.test.tsx cross-effect
屬鐵則 11 違規、slice-4 順手補修 + commit body 揭示。

### 6.5 鐵則 12(重大改動 / 進度結束產 Codex Review Packet)

> 觸發情境(任一):鐵則 8 定義的重大改動 / 動 security / RLS / GRANT / migration / schema /
> API / 動會員 tier / 經銷價 / pricing / order / payment / 一個完整進度單元結束(slice 群 /
> milestone 收尾)/ commit 前自評有風險 / Sean 說「Ready for review」。

**應用**:本 M-1-13H 為「進度單元結束(slice-2~5 完整收尾、slice-6 收尾前停)」+
「動共用元件 ProductGallery / ProductInfo / ProductServices / ProductTabs / ProductPage +
新增 2 子元件」+「動會員 tier 條件渲染 buy block」+「業務拍板影響營運(Q1 免運門檻、
Q-slice-4 hasSpotlight 3 件)」、命中觸發。

### 6.6 衝突仲裁總順序

```
STATUS.md > NORTHSTAR > CLAUDE.md > automode protocol > PRD > 其他 md > 對話歷史
```

設計層面例外:
```
視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準
```

---

## 7. 預計 slice-6 範圍

對應 HANDOFF #16 Related grid + #17 Mobile sticky bar(行為 + 色系保留)+ Q4 既有 ProductCard +
Q6 explorations 檔刪除(slice-6 後 Sean 在 Claude Design 端動)+ 收尾 13g 殘餘評估
(Toast + Responsive、Sean multi-select 拍)+ STATUS Phase 2 LOG ≥5 表 + 鐵則 12
Codex Review findings fix。

**預估範圍:**

| 項 | 動作 | 對應檔 |
|---|---|---|
| Related section | 新增 `<section className="pd-related">`、用既有 `<ProductCard>` 元件 map(不複製 demo `.vcf-related-card` hardcoded、對應 PRD Q4 糾正 + lessons §12-37);容器標題 Inter 22px semibold + eyebrow「N°03 — You may also like」+ h2「相同分類」 | ProductPage.tsx + product-page.css(.pd-related 段、可能共用 slice-4 `.pd-section-head`) |
| 13g 殘餘 | Toast + Responsive 收口(Code raise multi-select 給 Sean 拍「推延 / 本 slice 收」) | TBD |
| STATUS Phase 2 LOG | L23 Sean 待決策段追加「Phase 2 supabase ≥5 張表 LOG 條目」(product_highlights / product_spotlights / product_specs / product_installs / site_services / site_policies) | STATUS.md |
| Codex findings fix | 本 Packet 回 Sean 拍板處置(忽略 / 併本 slice fix / 開 fix slice) | TBD |

**預估時長**:35-50 分(對齊 PRD §4 slice-6)+ Codex findings fix 視範圍。

---

## 8. Codex 預期 findings 分類(請參考)

請按以下 3 級分類回:

- **🔴 must-fix**:必須修才能 commit slice-6(例:鐵則違規、security / RLS 漏洞、tier 邏輯錯、
  test 漏跑、字面與真權威源衝突未揭示)
- **🟠 consider**:建議修但不阻塞(例:命名 / 結構改進、可讀性、未來 Phase 2 接表時阻力)
- **🟡 nit**:錦上添花(例:註解補強、commit body 字面修飾)

附 file:line + 修正建議。

---

— END —
