# OD 商品頁改造線 — 審查紀錄(審查 session 自動產出)

> 與報價單資料線分開記(Sean 2026-06-02 拍 A:兩線各自清楚)。資料線審查在 `integration-phase1-review-log.md`。
> 審查 session 哨兵偵測 OD 線 commit(`[OD-N]` tag)後,fresh-context 審不可變快照(`git show <sha>`)、逐片 append。
> OD 線 = 純前台視覺改造(token/CSS/元件、OD 模板為視覺真權威)→ 例行前台片**不跑 codex 關卡2**(2026-05-29 Sean 拍 E)、走 code-reviewer + 審查 session 重驗;命中資料/schema/price 才升 codex。
> 視覺保真的最終肉眼驗是 Sean 的職責(審查 session 只驗 build 通 + 結構/字面/鐵則/manifest)。

---

## [`16727c26`] feat(storefront): OD-1 商品頁地基 — tokens 金色/義體 + Antonio + OD §6 標題系統 [OD-1] — **PASS**

審法:fresh-context 審不可變快照 `git show 16727c26` + 三綠重跑 + 決定 A 合規 + 鐵則 1 保真 + NORTHSTAR 引用查證。純前台 token/font/CSS → 不跑 codex(合規)。

- **scope**:5 檔(STATUS.md 附屬區 +10 / layout.tsx +Antonio link / product-page.css OD §6 標題系統 107 行 / tokens.css +`--c-gold`+`--f-display` / manifest +od_redesign);精準 add、**未碰 rpm-*.ts / review-log / S3 specs**(跨線紀律守住)✅。父 = `397c2cb`(S3a、dev tip)✅。
- **🔴 決定 A 合規**:STATUS +10 行**全在分隔線下方附屬區**(新「## OD 商品頁改造線」區塊)、**主表 7 欄(報價單 S3b 狀態)零改動**;不跑 busboy-end(避 clobber)✅。
- **鐵則 1 保真**:tokens 純 ADD(`--c-gold`/`--f-display`)、未改既有 token;inline 註解揭露「模板 #a98a4a vs HANDOFF §5 #b48a47」字面衝突 + 仲裁依據。**NORTHSTAR §2.4 規則屬實**(L125「.jsx + .css 字面 > HANDOFF docs」)→ 引用無造假。⚠️ caveat:OD daemon down、未能 live 重驗模板 :root 真值 = #a98a4a(依 OD session 字面 + 仲裁原則接受、低風險〔色票〕、daemon 起來再覆驗)。
- **字面 vs 事實**:commit body 各項對得上 diff(scope/純 CSS 不改元件/三綠);金色不一致已 inline 揭露 ✅。
- **三綠**(乾淨樹 @16727c2):typecheck 7/7 / lint 10/10 / build 1/1 successful(FULL TURBO replay = 本檔狀態 build 已通)✅。
- **NIT(非阻)**:NORTHSTAR §2.4 字面是「design-reference **內部**」drift(jsx vs HANDOFF);OD 模板 vs OD HANDOFF 是另一個權威源(OD post-date §2.4)→ 引用屬「原則延伸」、精準度小瑕。manifest od_redesign 已記「視覺權威 design-reference→OD 遷移」(對)。建議 follow-up:NORTHSTAR/CLAUDE 正式確立 OD 為商品頁視覺真權威 + 其內部仲裁,免後續 OD 片引用打架。
- **🚩 FLAG(未來片 gate、非 OD-1 問題)**:STATUS/manifest 記了「Q1 override:N°03 留相關商品 + FAQ→N°04」—— 這是**偏離 OD 模板結構**(模板 N°03=FAQ;加「相關商品」段 + FAQ 改 N°04)。OD-1 **未實作**(只記著)。審查 session 無此 override 的批准紀錄(來源=OD-0 偵察報告、Sean「待點頭存 docs/specs/」)。→ **實作 N°03/N°04 那片前,確認此結構偏離是 Sean 明確拍的**(鐵則 1 偏離需明確 business override)。

**判定:OD-1 PASS**(無 must-fix;1 nit + 1 未來片 flag)。視覺保真待 Sean 肉眼驗(尤其 `.pd-eyebrow` 舊扁平 fallback `:not(:has(.pd-eb-no))` 不破現有未改片)。`16727c2` 未 push、等 Sean 手動推。

---

## [`5fd86bf1`] feat(storefront): OD-2 Hero 圖庫換皮 OD §5 + 桌機左右等高 [OD-2] — **PASS**

審法:fresh-context 審 `git show 5fd86bf1` + 三綠重跑(含 build)+ 決定 A / 跨線 / 字面vs事實。純前台 CSS → 不跑 codex。

- **scope**:3 檔(STATUS 附屬區 / product-page.css 圖庫段 99 行 / manifest +OD-2);**零 .ts/.tsx**(CSS-only、ProductGallery.tsx 沒動、React swipe/箭頭/lightbox 互動保留)✅。
- **🔴 決定 A + 跨線**:STATUS 只動附屬區(當前 slice→OD-2)、**資料線 S3b-1 主表狀態 + OD 區塊都保全**(grep 7 處);**零誤碰 rpm-*.ts / review-log / od-redesign-review-log**(精準 3 檔)✅。
- **字面 vs 事實**:body「CSS-only / classNames 全留 / 箭頭+badge 為 OD §5 沒有的 PCM 既有增強、sharp 化保留非翻譯」與 diff 一致(stat 零 .ts/.tsx)✅。
- **三綠**(@5fd86bf):typecheck / lint / build 全 FULL TURBO 綠 ✅。
- **鐵則 1 caveat**:OD §5 保真依 body「本 session 稍早 verbatim 讀過 OD 模板」;OD daemon 仍 down、審查無法 live 重核模板 §5 字面 → 交 Sean 肉眼驗(他 OD 開著、可對照模板)。
- 改動本質:hero-img 直角+灰底去漸層、thumbs 5-grid、counter OD style、`.pd-gallery` 去 sticky + ≥1080 flex 等高(解 HANDOFF §4 左圖凸右欄短);901-1079 過渡帶 align-self:start。

**判定:OD-2 PASS**(無 must-fix)。**這是第一片肉眼可見的 OD 變化** → Sean 肉眼驗 Hero 圖庫區(直角/5 縮圖/桌機左右等高、且現有 swipe/箭頭/lightbox 仍運作)。`5fd86bf` 未 push。

---

## [`d01e50e3`] feat(storefront): OD-3 右欄資訊換皮 OD §5(SKU/標題/價格/購買列)[OD-3] — **PASS**

純前台 CSS、不跑 codex。fresh-context 審 `git show d01e50e3` + 三綠 + 決定A/跨線/字面vs事實。
- **scope**:3 檔(STATUS 附屬區 / product-page.css 資訊段 172 行 / manifest);**零 .ts/.tsx**(ProductInfo.tsx 沒動)✅。
- **決定 A + 跨線**:STATUS 只動附屬區、S3b-1 主表 + OD 區塊保全(grep 7);零誤碰 rpm-*/review-log/migration ✅。
- **字面 vs 事實**:CSS-only re-skin(.pd-info sticky/.pd-sku/.pd-title clamp/.pd-price-block/購買列 token 化+直角);明確排除 picker(留 OD-4b)+ services(OD-5);移除 #161 dead rule(.pd-add-btn.is-disabled 永不渲染)= 死碼清理非行為改 ✅。
- **三綠**(@d01e50e):typecheck/lint/build FULL TURBO 綠 ✅。
- 鐵則1 caveat 同 OD-1/2(daemon down、視覺保真交 Sean Phase A 末批次驗)。

**判定:OD-3 PASS**。`d01e50e3` 未 push。

---

## [`dfe839f9`] feat(storefront): OD-4a selectedVariant 狀態提升 + Hero 變體換圖 [OD-4a] — **PASS**

行為片(跨 3 元件 state lifting、非純 CSS),非經銷/pricing → 不跑 codex。審法加重:fresh-context `git show` + **完整 vitest 重跑**(動共用整合元件、memory `run-full-vitest-after-shared-component-change`)。
- **scope**:7 檔(STATUS 附屬區 / 3 元件 ProductPage·Info·Gallery / 2 test / manifest);跨線零誤碰 rpm-*/review-log/migration ✅。
- **行為**:selectedVariant 由 ProductInfo local 提升至 ProductPage(單一真相)、ProductGallery 優先顯 selectedVariant.images(RPM 每變體 ~5 張、解 Sean「圖只 1 張」)、mobile buybar 用真選中變體(修 16c-3)。ProductInfo 改受控(移 local useState + reset effect 移 ProductPage)。
- **tests 同步**:ProductInfo.test 加 stateful harness、ProductGallery.test +變體換圖測 ✅(鐵則 11)。
- **三綠 + 完整 vitest**(審查獨立重跑 @dfe839f9):lint ✅(含 rules-of-hooks/exhaustive-deps、state lifting 的 reset effect 綠)/ build ✅ / **vitest 507 passed(76 檔)**= 與 body 聲稱一致、跨元件 cross-effect 無紅 ✅。
  - ⚠️ typecheck 全庫跑 exit=1 但**錯誤全在 `scripts/rpm-import.ts`(CONFIRM_PRICE_DELTA 未定義)= 資料線正在補 S3b-1 must-fix 的未 commit WIP 中間態**、非 OD-4a;turbo storefront typecheck(涵蓋 OD-4a .tsx)通過。OD-4a 自身 typecheck 乾淨。(並行 session 共用樹污染、見下方 process note)
- **字面 vs 事實**:行為改、非經銷敏感(displayPrice 仍 general、零 tier/pricing 邏輯改);檔案 ProductPage~365/Info~265/Gallery~264 全 <400 ✅。

**判定:OD-4a PASS**(自身全綠;典型「圖變多張」已接、Sean Phase A 末肉眼驗可見)。`dfe839f9` 未 push。

> **process note(並行雙線共用樹)**:資料線 S3b-1 fix WIP(rpm-*.ts 未 commit、中間態)令全庫 typecheck/codex-git-status 出現與被審 slice 無關的紅/變動。審查靠:① 審不可變 `git show`(非活樹)② 把樹型檢查 scope 到該 slice 檔(錯在別線檔 = 非本片)化解。handoff §8.3「獨立 worktree 重跑」可根治、暫用 scope 法。

---

## [`13623c9f`] feat(storefront): OD-4b Picker 外觀 OD §5(直角規格鈕 + disabled 視覺)[OD-4b] — **PASS**

純前台 CSS、不跑 codex、不跑 vitest(無 .tsx)。fresh-context `git show` + lint/build + 決定A/跨線 + **D3 守則檢查**。
- **scope**:3 檔(STATUS 附屬區 / product-page.css options 段 72 行 / manifest);CSS-only(ProductInfo.tsx 不動)、跨線零誤碰 ✅。
- **🔴 D3=A 守住**:CSS 只加 `:disabled/.is-disabled` 的【視覺】(灰階/虛線/刪除線);**disable 的【邏輯】刻意拆到 OD-4c、且明寫「動手前 Supabase 唯讀撈真變體 spec 確認 12K 在 weave/special 再定」= 資料驅動、非照搬 OD enforceSurface 寫死鎖**。grep 命中的 enforceSurface/12k/honeycomb 全在 STATUS/manifest 文件行、非 CSS 邏輯 ✅。
- **死碼清理**:移除 .pd-opt-guide(未渲染)+ .pd-swatches/.pd-swatch(16c-3 起全文字鈕無色票)= 合理清理 ✅。
- **再排序(documented)**:inline 預覽卡 → 重排到 OD-7(N°02 紋路牆)後(理由:OD-4a Hero 換圖已覆蓋「看選擇」UX、預覽卡來源是紋路牆);12K 收紋路/移特殊欄/亮光only 拆 OD-4c。OD 線自主 sequencing 判斷、記 manifest/STATUS、合理 ✅。
- **lint/build**:exit 0 ✅(typecheck 對純 CSS 無關、且仍被資料線 S3b-1 fix WIP〔rpm-*.ts 未 commit〕污染、非 OD-4b)。決定 A grep 7 ✅。

**判定:OD-4b PASS**。`13623c9f` 未 push。

---

## [`2a34f73e`] feat(storefront): OD-4c Picker 12K 折進紋路 2 維化(資料驅動)[OD-4c] — **PASS**(撞車善後乾淨重提)

行為片(picker 3 維→2 維、ProductInfo 邏輯改)。fresh-context `git show` + **完整 vitest** + D3 守則 + scope 乾淨驗。非 pricing/schema → 不跑 codex。
- **🔴 scope 乾淨(撞車善後驗證)**:只 3 OD 檔(ProductInfo.tsx 137 / .test.tsx 48 / manifest 7)、**零 rpm-*/migration/data 線污染殘留** ✅。鏈:2a34f73→739cc6e1(資料 nit)、dev tip、linear 乾淨。
- **🔴 D3=A 守得漂亮**:OD session 動手前 Supabase 唯讀撈真變體 → **發現 12K 有 24 個消光變體**(Twill+Matt 13 / Plain+Matt 11)+ 1 Kevlar,打臉「12K 無消光」口頭假設 → raise Sean → Q-OD4c-1/2=A(照真資料、消光不寫死鎖、避免少賣 24 變體)。picker 用 **snap 資料驅動**、明確**不照搬 OD enforceSurface/GLOSSY_ONLY** ✅。
- **字面 vs 事實**:body 誠實記撞車始末(內容 == 撞車前 byte 一致版)+ D3 真資料推翻假設;非經銷敏感(只動 picker 維度顯示、無 pricing/tier/庫存)、唯讀 SQL 無寫入 ✅。
- **三綠 + 完整 vitest**(審查獨立重跑 @2a34f73e、樹乾淨):typecheck/lint/build exit 0 / **vitest 508 passed(76 檔)** ✅。
- 決定 A:本片未動 STATUS 主表(OD-4c 附屬區條目殘在 739cc6e1〔amend 殘留、內容正確〕);零誤碰資料線 ✅。

**判定:OD-4c PASS — 跨線撞車事故完全善後**(e98af38 orphan、OD-4c 乾淨重提 2a34f73e、零資料損失)。OD-1~4c 全清落 dev。Sean 拍 A worktree 隔離 → OD-5~11 移 od-redesign 防再撞。

---

_(Step 2:OD 線移 worktree〔od-redesign〕;審查哨兵加盯 od-redesign。等 OD-5 / S3b-2 commit)_

---

## [`c376d247`] feat(storefront): OD-5 服務橫條外移成 hero 下方全寬獨立 section [OD-5] — **PASS**

前端版面外移(ProductServices 從 ProductInfo 右欄 → ProductPage hero 下方全寬 section、OD 模板 §12)。fresh-context `git show c376d247` + 鐵則/字面vs事實/manifest;無 pricing/security → 不跑 codex。**首片在 od-redesign worktree commit**(隔離生效、零跨線污染)。
- **scope**:6 檔(ProductServices.tsx 42 / ProductInfo.tsx 300 / ProductPage.tsx 371 / ProductServices.test.tsx / product-page.css / manifest);**零 rpm-*/migration/data 線污染**(worktree 隔離)✅。父=2a34f73(OD-4c)、od-redesign tip。
- **字面 vs 事實**:diff 逐項印證 body ✅ — ProductInfo 移除 import+render(留註解)、ProductPage 加 import + 在 pd-main 後 render(順序 pd-main→services→Highlights)、ProductServices 包進 `section.pd-services-strip aria-label=服務保障`、CSS 改 4 欄內分隔線 + 720→2×2 + 540 縮字 + 移 900px orphan、test 同步加 strip 斷言 + 字面對齊。
- **🔴 鐵則 11 文案變更全揭示**:4 卡 2 處內容變更如實記 commit body —「原廠保固/原廠授權代理」→「泰國原廠/RPM Carbon 授權代理」(產地泰國對齊 16c-4b)、「LINE/30 分鐘內回覆」→「下單前先聊聊確認貨況」;**免運門檻 5,000 不變**(字面「NT$5,000 以上」→「NT$5,000 以上免運費」加綴詞、數字仍對齊 Sean 2026-05-21 永久拍板)✅。
- **鐵則 6**:檔案 42/300/371 皆 <400(ProductPage 371、ProductInfo 300 達 >300 硬警戒線、留意非阻)✅。**鐵則 5**:CSS+TSX 同片 ✅。
- **manifest 同步**:od_redesign 加 OD-5 條;ProductServices 的 `design.authority` 正式從 VariantCFull 遷「open-design: Website V2 / product-detail-rpm-template.html §服務保障橫條」+ legacy_component 保留 + business_override 字面更新;三元件 last_modified 用可達祖先 hash 2a34f73(避 amend orphan)✅。
- **鐵則 1 caveat**:OD daemon down、4 卡字面 vs OD 模板 §12 **無法 live 重核**(search_files 連不上 127.0.0.1:64313)→ 交 Sean Phase A 末肉眼驗(OD 審 = B)。

**判定:OD-5 PASS**(無 must-fix;OD 模板字面保真待 Sean 肉眼驗)。`c376d247` 未 push。

---

## [`ed735995`] feat(storefront): OD-6 N°01 為什麼選 RPM Carbon 換 OD 皮 [OD-6] — **PASS**

前端 N°01 Highlights 換 OD 皮 + 內容換 RPM 固定。fresh-context `git show ed735995` + 鐵則/字面vs事實/manifest;無 pricing/security → 不跑 codex。
- **scope**:5 檔(ProductHighlights.tsx ~49 / ProductPage.tsx ~374 / ProductHighlights.test.tsx / product-page.css / manifest);worktree 隔離、零跨線污染 ✅。父=c376d247(OD-5)、od-redesign tip。
- **字面 vs 事實**:diff 印證 body ✅ — eyebrow 巢狀(.pd-eb-no「01」+ .pd-eb-sep 金線 + .pd-eb-label「RPM Carbon」)、h2「為什麼選 RPM Carbon」(取代「為什麼是 {product.brand}」)、lead/3 卡(可直上原廠/紋路想怎麼搭都行/輕量化．隔熱防燙)換 OD 字面、元件改 **prop-less**(移除 MockProduct import + product 參數)、callsite `<ProductHighlights/>`、CSS reskin 成 OD 平面卡(token 化 surface/border/gold/display、義體斜體章節數字 + 金線 ::after、920px collapse、移 900px orphan)、`<div>`→`<article>`+title `<h3>` 語意化、test 改寫 + 移除 brand 注入測。
- **🔴 鐵則 11 + Sean 視覺所有權揭示**:① N°01 由 product.brand 動態 → **RPM 固定**(OD RPM 共用區塊、business override `highlightsContentRpmFixed`、Phase 2 product_highlights 恢復參數)✅;② **eyebrow 品牌標記用文字 .pd-eb-label「RPM Carbon」代 OD 模板 logo `<img>`**——理由:storefront 無 RPM avif 資產、**不擅自造視覺資產、交 Sean 補真 logo**(.pd-eb-logo CSS 已備、換 img 不需改 layout)→ **正確對齊 `feedback_sean-owns-visual-design`**、是該 flag 的誠實偏離 ✅。
- **內容分級**:lead + 3 卡為 RPM 行銷文案(L2/L3),hardcoded + Phase 2 product_highlights backlog;「五款紋路 × 亮光消光」與 OD-4c picker 真實(12K/Kevlar 折入紋路、消光不鎖)內部一致 ✅。
- **三綠**(body 聲稱):typecheck(scripts 未動)/ lint / 完整 pnpm test **507**(-1 移除 brand 注入測)/ build storefront 全綠。**鐵則 5/6**:CSS+TSX 同片、檔案皆 <400(ProductPage ~374 續爬、>300 警戒、留意)✅。
- **鐵則 1 caveat**:同 OD-5 — OD 模板 N°01 字面 daemon down 無法 live 核 → Sean Phase A 末肉眼驗。

**判定:OD-6 PASS**(無 must-fix;eyebrow logo 待 Sean 後補真資產、OD 字面待肉眼驗)。`ed735995` 未 push。

---

## [`b9d2b067`] feat(storefront): OD-7a ProductSpotlight 碳纖維化 + 去 N°02 編號 [OD-7a] — **PASS**

前端內容換皮(ProductSpotlight 鋁件文案→碳纖維 placeholder + eyebrow 去編號)。fresh-context `git show b9d2b067`;無 pricing/security → 不跑 codex。worktree 隔離、零跨線污染。父=ed735995(OD-6)、od-redesign tip。
- **scope**:3 檔(ProductSpotlight.tsx 65 / .test.tsx / manifest);**無 product-page.css** —— 結構 class(.pd-spotlight/.pd-spot-*/.pd-eyebrow/.pd-h2/.pd-body/.pd-spot-stats)全不變、只換**文字內容**→ 內容換皮不需動 CSS、**非鐵則 5 漏 CSS**(commit 也未聲稱動 CSS)✅。鐵則 6:65 行 <400 ✅。
- **字面 vs 事實**:diff 逐項印證 ✅ — eyebrow「N°02 — Engineering」→ flat「碳纖維工藝」、h2「為賽道設計/適合每日通勤」→「真碳纖維/為原廠車身而生」、2 body 鋁件(7075-T6/CNC/Hard Anodized)→ 碳纖維(真碳纖材質+原廠開模直上)、3 stats(−38%/±0.02mm/24m)→ 質性(輕量/隔熱/直上、**無捏造數字**)、條件渲染(hasSpotlight===true / falsy 返 null)不動、test 同步對齊。
- **🔴 鐵則 11 + 誠實揭示(全部如實記 body + manifest + 元件頂)**:① 碳纖內文是**通用 placeholder、非真 per-product**;真 per-廠牌固定內文交**資料線 workstream** 接 supabase `product_spotlights` DB(manifest business_override `spotlightCarbonPlaceholderPendingDataLine` 已記)✅;② ⚠️ **hasSpotlight 是 mock-only 欄、真 RPM 頁(toUIProduct 不設)不渲染此區** → placeholder 只現於 3 legacy mock 頁(lightech/akrapovic/brembo)、不影響線上真 RPM 詳情頁 ✅;③ ⚠️ 本片後頁面暫無 N°02(N°01→Spotlight→Tabs→N°03)、N°02 紋路牆 OD-7b 補 ✅。
- **鐵則 1**:OD 模板**無** Engineering Spotlight 區 → 非「搬 OD」、是 **Sean 2026-06-03 Q1 拍板的 business override**(保留 + 碳纖化 + 延後真內文);manifest design.authority 已正名「OD 模板無此區、保留為條件區塊」✅。daemon-down 視覺保真 caveat 對此片不適用(無對應 OD 區可核)。
- **三綠**(body 聲稱):typecheck / lint / 完整 pnpm test **507**(無增減、僅內容換)/ build storefront 全綠。

**判定:OD-7a PASS**(無 must-fix)。⚠️ 留意:碳纖 placeholder 套在非碳纖 mock 商品(Brembo/Lightech)字面失真、但僅 mock 頁、真 RPM 不渲染、且已交資料線收口 → 可接受。`b9d2b067` 未 push。

---

## [`854e863a`] feat(storefront): OD-7b N°02 紋路樣式牆 ProductSwatchWall 新元件 [OD-7b] — **PASS**(+ ProductPage 大小警戒)

新元件 + 資料模組 + CSS + 接線。fresh-context `git show 854e863a`;無 pricing/security → 不跑 codex。worktree 隔離。父=b9d2b067(OD-7a)、od-redesign tip。
- **🔧 進程修正**:OD 檔在 od-redesign worktree、主樹是 dev → 檔案大小必用 `git show <sha>:<path>` 取該 commit 版(`wc -l` 主樹會讀 dev 舊版誤判;前面 OD-5/6/7a 的 size 數字是誤讀 dev 版、結論 <400 不變但不精準)。
- **scope**:6 檔(ProductPage.tsx / ProductSwatchWall.tsx 新 / .test 新 / rpm-swatches.ts 新 / product-page.css / manifest);**零資料線污染**(worktree 隔離有效)✅。鐵則 5:CSS(swatch 段 +47)+ TSX 同片 ✅。
- **🟡 鐵則 6 警戒**:git show 版大小 ProductPage **382** / ProductSwatchWall 81 / test 58 / rpm-swatches 50 —— 全 <400,**但 ProductPage 382 已深入 >300 硬警戒、且隨每個 section 接線累積爬升(365→382)→ 逼近 400 硬上限,下一個 section 片(OD-7c+)動 ProductPage 前建議先評估拆分**(它是組裝多 section 的 orchestrator)。記 flag、非本片阻擋。
- **字面 vs 事實**:diff 印證 body ✅ — ProductPage import + 在 N°01 後/Spotlight 前插 `<ProductSwatchWall/>`(補回 OD-7a 讓出的 N°02、順序 N°01→N°02→Spotlight→Tabs→N°03);元件 prop-less、eyebrow(02+金線+N° 紋路×表面)+ h2/lead + 亮光 cols-6 + 消光 cols-4 + swatch-note + is-rare 金徽;rpm-swatches.ts 10 張(亮光6+消光4)Shopee CDN URL；test 5 測(含 10 卡真 CDN URL 斷言)、512(+5)。
- **🔴 誠實揭示(鐵則 11)**:① N°02 = **RPM 品牌級固定紋路展示**(10 張全商品共用、非 per-product 變體實拍)、與右欄 picker(真變體、OD-4c)互補、對齊 Sean Q2「紋路卡片保留沿用」✅;② ⚠️ swatch lightbox 暫靜態(cursor:zoom-in CSS、無 click handler)、互動 + picker 預覽卡 OD-7c 補 ✅;③ ⚠️ **swatch 圖 hotlink Shopee 圖床**(`down-sg.img.susercontent.com`)— plain `<img>` 無 next/image domain 需求、與既有商品圖同 pattern(§8.5 已驗 Shopee 圖能渲染)、失效屬 Phase 2 自架資產 backlog ✅。
- **鐵則 1**:結構/字面/圖 URL 宣稱直接搬 OD §N°02;daemon down 無法 live 核 → Sean Phase A 末肉眼驗。**鐵則 9**:rpm-swatches 為品牌級固定資料(L2、Phase 2 可移 DB)、可接受 hardcode。**manifest**:od_redesign OD-7b 條目 + 新 `ProductSwatchWall:` 元件區塊(含 data 欄)+ ProductPage last_modified(可達祖先 b9d2b06)同步 ✅。

**判定:OD-7b PASS**(無 must-fix;1 🟡 ProductPage 382 逼近 400 警戒、建議 OD-7c 前評估拆;OD 字面待 Sean 肉眼驗)。`854e863a` 未 push。

---

## [`e06ff6f0`] feat(storefront): OD-7d 圖庫聚合 — 選中變體圖排前 + 其餘補後可一路滑 [OD-7d] — **PASS**

行為片(ProductGallery useMemo 聚合邏輯改、非純 CSS)。fresh-context `git show e06ff6f0`;無 pricing/security → 不跑 codex。worktree 隔離。父=854e863a(OD-7b)。**註:OD 線重排序、先 7d 後 7c**(picker 預覽卡 OD-7c 另做、body 註明、無漏審)。
- **scope**:3 檔(ProductGallery.tsx 270 / .test.tsx / manifest);零資料線污染 ✅。鐵則 6:270 <400 ✅。
- **字面 vs 事實**:diff 印證 ✅ — gallery useMemo 改 **Set 去重保序聚合**:`push(selectedVariant.images)`〔選中排最前〕→ 各 `v.images`〔變體順序〕→ `product.images`〔代表圖〕→ `product.image`〔單圖 fallback〕,皆無真圖則 seed gallery;deps **補 product.variants**(exhaustive-deps 正確)。取代 OD-4a「只顯選中變體那幾張」。
- **🟢 邏輯正確性(獨立驗)**:① 去重 = `seen` Set 擋重複 URL(代表圖常已是某變體圖、去重不重出);② 順序 = 選中優先、確定性;③ **切變體 reset 無 bug** —— `useEffect(()=>setActiveImg(0),[gallery])` keying on useMemo 陣列**參照**;切變體→selectedVariant.images 變→useMemo 重算→新參照→effect 觸發歸 0→顯選中變體首圖(雖重排後長度不變、但 key 是 reference 非 length,故正確)✅。
- **🟢 動手前真 DB 驗證(OD 線自驗、鐵則紀律佳)**:execute_sql rpm-aprilia-01 → product.images 1 張、8 變體 23 distinct 圖無跨變體重複、代表圖已在變體內(rep_in_variants=1)→ 確認需 Set 去重。
- **test(鐵則 11)**:OD-4a 測改名「product has no other images」(MOCK[0] 無 variants/images 退化變體 only 特例)+ 新 OD-7d 聚合測(選中 b1 排前 + 其餘 a1/a2 + 代表圖去重、驗 01/03 + thumb1=選中 + thumb2=其餘)✅。
- **⚠️ 驗證層級誠實揭示**:ProductGallery 是 ProductPage 整合的共用元件、本應跑完整 vitest([[feedback_run-full-vitest-after-shared-component-change]]);本片**未在 od worktree 獨立重跑 vitest**(vs OD-4a 有重跑)、依 body 聲稱「完整 pnpm test 513(+1)」。判低風險可接受之依據:變更純 ProductGallery **內部** gallery 陣列計算、**props 介面/exports 不變**、無其他元件讀其內部、gallery 圖序不被別處斷言 → cross-effect 風險低。若 Sean 要硬核可請我去 worktree 重跑。
- **鐵則 1**:OD 模板無對應「聚合」邏輯(這是 Sean Q2 行為更正、非搬 OD 視覺)→ 業務行為決策、非 design 保真議題。

**判定:OD-7d PASS**(無 must-fix;1 誠實註:未獨立重跑完整 vitest、依 body 513 綠 + 變更隔離性低風險)。`e06ff6f0` 未 push。

---

## [`08c46101`] feat(storefront): OD-7c picker 紋路樣品預覽卡 + 樣品 lightbox [OD-7c] — **PASS**

互動片(新元件 + lightbox state + findSwatch 對應邏輯)。fresh-context `git show 08c46101`;無 pricing/security → 不跑 codex。worktree 隔離。父=854e863a→…(od-redesign tip);OD 線重排序後此為 OD-7 收尾片。
- **scope**:6 檔(ProductInfo.tsx 314 / ProductSwatchPreview.tsx 新 125 / .test 新 85 / rpm-swatches.ts 70〔+findSwatch〕/ product-page.css +89 / manifest);零資料線污染 ✅。**未動 ProductPage**(382 不變)✅。鐵則 5:CSS+TSX 同片 ✅。鐵則 6:全 <400(ProductInfo 314、>300 警戒爬升 300→314、留意;ProductPage 382 + ProductInfo 314 雙雙進警戒區)。
- **🟢 findSwatch fallback 邏輯獨立驗**:鏈 = ① 精準 weave+surface+(12K?special:!special) ② is12K 退 12K 亮光同 weave ③ 基礎 weave+surface+!special ④ weave 任意 ⑤ 第一張亮光(`RPM_SWATCHES_GLOSSY[0]!`)→ **永回非空**。trace 關鍵:12K 消光→12K 亮光同 weave ✅;**Kevlar(真資料 spec=weave Twill+special Kevlar)走 step① 的 `!s.special` → 退基礎 Twill 同 surface 樣品**(紋理對、材質色差、與 body/manifest 備註一致)✅。
- **🟢 互動正確性**:hooks(useState/useRef/useEffect)**全在 `if(!selectedVariant) return null` 之前** → rules-of-hooks OK ✅;lightbox useEffect 只 open 掛鍵盤(ESC/←/→)+ body overflow lock、cleanup 還原 prevOverflow ✅;箭頭/swipe Math.min/max clamp 無 wraparound、disabled 端點 ✅;沿用 .pd-lightbox/.pd-lb-* 共用 chrome + 新 .pd-lb-caption。
- **🔴 字面 vs 事實 + 揭示**:① 預覽=乾淨紋路樣品參考、Hero 圖庫=變體實拍(OD-7d)、互補非重複 ✅;② **valueText 由 ProductInfo 從變體實算(`dimValueLabel`+`variantDimValue`)、非從 fallback 樣品名推** → Kevlar 圖退斜紋但文字仍顯「Kevlar斜紋 · 亮光」、避免誤導文案 ✅(關鍵正確設計);③ ⚠️ Kevlar 無專屬樣品 fallback / swatch 牆卡點擊仍靜態(預覽卡 lightbox 已覆蓋瀏覽、非阻)誠實記。
- **test(鐵則 11)**:ProductSwatchPreview.test 9 測(findSwatch 5 含 fallback + 元件 4 含 lightbox 開);522(+9)。**manifest**:OD-7c 條目 + 新 `ProductSwatchPreview:` 元件區塊(含 data + Kevlar fallback business_override)+ ProductInfo last_modified 同步 ✅。
- **⚠️ 驗證層級誠實註**:ProductSwatchPreview 渲染於共用元件 ProductInfo 內、互動片 → 理想跑完整 vitest([[feedback_run-full-vitest-after-shared-component-change]]);本片**未在 od worktree 獨立重跑**(主樹在 dev=S4、OD 改在 od-redesign worktree)、依 body「完整 pnpm test 522(+9)」。低風險依據:純**增量**(新 gated 元件、ProductInfo 既有 picker/價/cart 行為不變、只在 picker 上方加渲染)+ 9 新測覆蓋 findSwatch fallback + lightbox。要硬核可請我去 worktree 重跑。
- **鐵則 1**:OD §8 .pd-pattern-preview 直接搬;daemon down → Sean Phase A 末肉眼驗。

**判定:OD-7c PASS**(無 must-fix;findSwatch fallback + 互動 hooks + valueText-from-variant 三處關鍵邏輯獨立驗正確;1 誠實註未獨立重跑 vitest)。OD-5/6/7a/7b/7c/7d 全 PASS。`08c46101` 未 push。

---

## [`26aad490`] feat(storefront): OD-8 分頁 tabs 碳纖維化 reskin [OD-8] — **PASS**(+ 🚩 保固鑑賞期法律主張待 Sean 確認)

內容+結構 reskin(ProductTabs 4 pane 全換 OD §9 碳纖字面、修鋁合金殘留)。fresh-context `git show 26aad490`;無 pricing/security → 不跑 codex。worktree 隔離。父=08c4610(OD-7c)。
- **scope**:4 檔(ProductTabs.tsx 250 / .test.tsx / product-page.css 193 / manifest);零資料線污染 ✅。鐵則 5:CSS+TSX 同片 ✅。鐵則 6:ProductTabs **250** <400 ✅(內容換皮收支平衡、未爆)。
- **字面 vs 事實**:diff 逐項印證 ✅ — tab「規格與相容性」→「規格 / 相容性」;介紹 pane 換真碳纖框架(去 7075/Hard Anodized/義大利保固);規格 8→9 欄(真碳纖維/紋路可選/表面可選/特殊樣式 取代 表面處理·重量、產地泰國、品牌·型號·分類·適用車款 動態);安裝去 4 步驟卡 pd-steps 改 meta 3 欄+說明+清單(CTA router.push('/install') 沿用);保固換客製訂製政策;**ARIA tablist/tab/tabpanel + roving tabIndex + 鍵盤導覽(M-1-13H-6 Codex Fix)保留不動** ✅。
- **🔴 誠實揭示(鐵則 11、紮實)**:① 介紹 prose = 碳纖**通用 placeholder**、per-廠牌真實描述交資料線 product_description(Sean Q1、同 ProductSpotlight)✅;② OD「適用車款」列「完整見上方對照表」**交叉引用省略**(Phase A 無車款表 ProductPage L295、避 dangling、OD-11 補)✅;③ mock 舊鋁品名來自**動態 product.name 非 hardcoded**、test 正確不斷言「鋁合金」缺席 ✅;④ warrantyOriginItalyResidual(#162)**resolved**(義大利隨保固整段換掉);⑤ ⚠️ 保固字面須與 N°04 FAQ 一致(OD-10 接續)。
- **🚩 法律主張待 Sean 確認(非 code 阻擋、但有合規份量)**:保固 pane 寫「**客製化委任代購、依《消保法》第 19 條不適用 7 天鑑賞期**」。code 面正確(L1 法律政策 hardcode、已 flag 待 site_policies)、但這是**有法律效力的對外主張**——客製/代購是否真符合 §19 鑑賞期例外(通訊交易解除權合理例外準則)取決於商品性質 + 正確揭露;誤拒鑑賞期恐違消保法。→ **建議 Sean 確認此主張正確且一致**(tabs / N°04 FAQ / 結帳頁同一份、OD-10 接續時對齊)。審查不裁決法律、只標風險。
- **test(鐵則 11)**:tab 標籤對齊 + 4 新碳纖 regression(介紹真碳纖無7075 / 規格無Hard Anodized / 安裝無pd-steps / 保固鑑賞期無義大利);526(+4)。**manifest**:OD-8 條目 + 可達祖先 08c4610 + design.authority 遷移 + business_override(warrantyOriginItalyResidual resolved / +descriptionPerProductDataLine / +specFitmentsXrefOmitted)✅。
- **⚠️ 驗證層級**:ProductTabs 共用元件(ProductPage 渲染)、本片**未在 worktree 重跑完整 vitest**、依 body 526(+4);低風險(增量內容換 + 4 regression 測 + ARIA 邏輯不動)。鐵則 1:OD §9 直接搬 daemon down → Sean 肉眼驗。

**判定:OD-8 PASS**(無 must-fix;1 🚩 保固鑑賞期法律主張請 Sean 確認準確+跨頁一致)。OD-5/6/7a/7b/7c/7d/8 全 PASS。`26aad490` 未 push。

---

## [`6eb4889b`] feat(storefront): OD-9 N°03 相關商品 eyebrow 換 OD N° 巢狀 [OD-9] — **PASS**(+ 🔴 ProductPage 386/400 將破 + 🚩 N°03 結構偏離待 Sean 復確認)

小前端 eyebrow 換皮(N°03 相關商品 section）。fresh-context `git show 6eb4889b`;無 pricing/security → 不跑 codex。worktree 隔離。父=OD-8。
- **scope**:3 檔(ProductPage.tsx 386 / ProductPage.test.tsx +1 OD-9 smoke / manifest +5);零資料線污染 ✅。
- **字面 vs 事實**:diff 印證 ✅ — pd-related section-head 扁平「N°03 — You may also like」→ OD 巢狀(.pd-eb-no「03」+ 金線 .pd-eb-sep + .pd-eb-label「N° 相關商品」、對齊 N°01/N°02);h2「相同分類」保留;相關商品來源不變(MOCK categoryMain filter + ProductCard map + length>0 條件渲染);test +1(eb-no=03 / label 含相關商品 / h2 相同分類)、527(+1)。
- **🔴 鐵則 6 升級(原警戒→將破)**:ProductPage.tsx **386**(OD-9 +4)、**距 400 硬上限剩 14 行**。OD-10(N°04 FAQ)+ OD-11(適用車款表)各會再加 section 接線(import+render+註解 ~+4/片)→ **1-2 片內必破 400**。**建議 OD 線在下一個動 ProductPage 的片之前先瘦身**(verbose inline section 註解可移 manifest / 或抽 `<ProductSections>` 組裝層),非本片阻擋但迫近。
- **🚩 N°03 結構偏離待 Sean 復確認**:commit 引「Sean Q1 override:N°03 留相關商品、FAQ 變 N°04」(偏離 OD 模板 N°03=FAQ)。**呼應我 OD-1 留的 flag:審查端無此 override 正式批准紀錄在檔**(來源=OD-0 偵察 + Sean「待點頭存 docs/specs/」)。OD-9(N°03)+ 即將的 OD-10(N°04 FAQ)都疊在此結構上 → 建議 Sean 復確認「N°03=相關商品 / N°04=FAQ」確是要的(錯了 OD-9/10 要返工)。copy(相關商品/相同分類)為 storefront 業務字面、非 OD 翻譯(合理)。
- **判定:OD-9 PASS**(無 must-fix;2 升級 flag:ProductPage 將破 400〔OD 線下片前瘦身〕+ N°03 結構偏離待 Sean 復確認)。`6eb4889b` 未 push。

---

> **✅ N°03 結構偏離 flag 解除(Sean 2026-06-03 拍 A)**:N°03=相關商品 / N°04=FAQ 確認(偏離 OD 模板 N°03=FAQ 屬 Sean 明確 override)。OD-1 起留的此 flag 正式結案、OD-9 站得住、OD-10 FAQ 照 N°04 接。
> **🔴 仍開:ProductPage 386/400**(OD 線下一個動 ProductPage 的片〔OD-10/11〕前須瘦身、見 OD-9 條目)。

## [`06d0fb2a`] refactor(storefront): OD-10a 保固政策抽共用 rpm-policies 單一真相 [OD-10a] — **PASS**(直接解決 OD-8 跨頁一致 flag)

行為保持重構(抽保固政策成共用單一真相)。fresh-context `git show 06d0fb2a`;無 pricing/security → 不跑 codex。worktree 隔離。
- **scope**:3 檔(ProductTabs.tsx 重構 / rpm-policies.ts 新 45 / manifest +warrantyPolicySingleSource);零資料線污染 ✅。
- **🟢 抽取忠實(逐段比對 byte-for-byte)**:RPM_WARRANTY_PARAGRAPHS 3 段 + RPM_WARRANTY_NOTES 3 點的 PolicyRun(string|{b})串接 **= OD-8 ProductTabs 保固 pane 原文逐字相同**(我逐段核 ✅:客製訂製/瑕疵收貨7天/鑑賞期消保法§19/瑕疵認定/不在範圍/LINE);ProductTabs 改 `.map` + renderPolicyRuns(string→`<span>`、{b}→`<strong>`)、textContent 不變 → OD-8 保固 regression 測(不適用7天鑑賞期/客製/無義大利)續綠、527 不變。
- **🎯 解決 OD-8 flag**:Sean 釘「OD-10 FAQ 保固字面須與 OD-8 一致」→ OD 線抽成共用單一真相,OD-10b ProductFAQ 將讀同一份 rpm-policies → **兩處永不漂移**;鑑賞期法律主張現集中一處,Sean 確認準確性後改字面只動 rpm-policies(我先前標的法律 flag 結構上已收斂、待 Sean 確認內容)。
- **鐵則 6**:ProductTabs 重構淨中性(<400);rpm-policies 45。**字面 vs 事實**:body「純重構 byte-for-byte」屬實 ✅。manifest 同步(+warrantyPolicySingleSource override)。
- **判定:OD-10a PASS**(無 must-fix;忠實重構、單一真相解 OD-8 一致性)。`06d0fb2a` 未 push。

---

## [`510a70ec`] feat(storefront): OD-10b N°04 常見問題 FAQ + FAQPage JSON-LD [OD-10b] — **PASS**(解 2 個我標的 flag)

新元件 ProductFAQ(N°04 手風琴 + 結構化資料)+ ProductPage 瘦身接線。fresh-context `git show 510a70ec`;無 pricing/security → 不跑 codex。worktree 隔離。
- **scope**:5 檔(ProductFAQ.tsx 新 139 / .test 新 55 / ProductPage.tsx 瘦身+接線 / product-page.css +31 / manifest);零資料線污染 ✅。鐵則 5:CSS+TSX 同片 ✅。鐵則 6:ProductFAQ 139、**ProductPage 371**(<400)✅。
- **🎯 解 flag 1(保固跨頁一致)**:FAQ 保固題 `a: RPM_WARRANTY_PARAGRAPHS` **直接吃共用 @/data/rpm-policies**(OD-10a)、與 ProductTabs 保固 pane byte-for-byte 同源、不分歧;test 專測「保固共用字面」。Sean item-3 確認「免 7 天鑑賞期」→ **法律主張結案、且集中 rpm-policies 單點**。
- **🎯 解 flag 2(ProductPage 386→371 瘦身)**:把頂部 33 行 13b/c/d 歷史註解 → 13 行(史搬 manifest + od_redesign.slices_done、留指標);**純註解瘦身、零功能碼動**(selectedVariant 狀態 / section 組裝完整)。Sean item-4 轉告生效。
- **🟢 FAQPage JSON-LD 正確**:`plainAnswer(item)` 從同一份 `FAQ_ITEMS` 衍生 plain text → **JSON-LD 結構化資料與可見手風琴同源、不漂移**(符合 Google「JSON-LD 須對齊可見內容」);原生 `<details>/<summary>` 純 CSS 手風琴(SSR-friendly、無 JS、不需 'use client')。test 驗「JSON-LD 合法 5 題」。
- **字面 vs 事實**:diff 印證 ✅ — 5 題(order/leadtime/warranty 共用/install/store)、eyebrow 04(Sean Q1 override 排 N°04)、接 ProductFAQ 於相關商品 N°03 之後(非條件、RPM 共用)。
- **🟡 前瞻觀察(非阻)**:JSON-LD 走 `dangerouslySetInnerHTML(JSON.stringify(...))`、現內容全 hardcoded 安全;**未來 FAQ 內容若轉動態(Phase 2 site_policies),JSON-LD 需加 `</script>` 跳脫**(防字串含 `</script>` 破出)。現況非問題。
- **test(鐵則 11)**:ProductFAQ.test 4 測(eyebrow 04 / 5 details / 保固共用字面 / JSON-LD 合法)、531(+4)。⚠️ 共用元件未在 worktree 重跑完整 vitest、依 body 531;低風險(新 prop-less 元件 + ProductPage 純註解瘦身)。鐵則 1:OD §FAQ/§10 直接搬 daemon down → Sean 肉眼驗。manifest 同步(+ProductFAQ 段)。
- **判定:OD-10b PASS**(無 must-fix;解保固一致 + ProductPage 瘦身兩 flag、JSON-LD 同源正確)。OD-5~10b 全 PASS。`510a70ec` 未 push。

---

> **✅ flag 結案**:① 保固跨頁字面一致(OD-8 起)→ OD-10a 抽共用 + OD-10b FAQ 共用、解除。② 鑑賞期免 7 天法律主張 → Sean 2026-06-03 確認、結案(字面集中 rpm-policies)。③ ProductPage 386/400 → OD-10b 瘦身至 371、解除。

> **📌 OD-11 適用車款表決策(Sean 2026-06-03 拍 A)**:**延到 od-redesign→dev 合併後**做(非 Phase B 遙遠、非漏做)。審查驗證根因:od-redesign 從 OD-4c(2a34f73)分出、**早於 S6(7d4bdaa)** → 缺 S6 的 `UIFitment` 型別 + `product.fitments` 欄 + toUIProduct fitments 映射(grep 全 0)→ **現在在 od-redesign 做真表會 typecheck 掛**;B(fits 假 1 列)丟棄式、C/真表編譯不過。真資料/接線都在 S6(已審 PASS、dev、真 RPM 每品 ~8 fitments)。→ **合併得 S6 後做 OD-11**(3 欄 車廠/車型/年式 per D1=A、非 OD 模板 4 欄)。Phase A 剩 buybar 改皮 + 響應式收口(無決策卡點)。

## [`3e3918eb`] feat(storefront): OD-11 mobile buybar OD §12 改皮 + 響應式斷點收口 [OD-11] — **PASS**(Phase A 末片)

> ⚠️ **命名澄清**:此 commit「OD-11」= **mobile buybar + 響應式收口**(非適用車款表)。適用車款表(原 OD-11/OD-F1)已依 Sean 拍 **A 延後到 od-redesign→dev 合併後**(見上方 📌 決策);OD session 把 buybar 片命名 OD-11、收 Phase A。

純 CSS。fresh-context `git show 3e3918eb`;無 pricing/security → 不跑 codex。worktree 隔離。
- **scope**:2 檔(product-page.css 淨 -40〔45+/85-〕/ manifest +1);CSS-only(buybar TSX 既有不動、classname 不變)→ 非鐵則 5 漏 TSX。鐵則 6:CSS 縮減 ✅。
- **🔴 修真 latent bug(誠實揭)**:舊 M-1-13e-a buybar 引用**已不存在的 legacy token**(`--border`/`--ink`/`--paper-2`/`--ink-tert`、tokens.css 已移除)→ mobile buybar 本就渲染壞;OD-11 改 `--c-*` token + 單色(buynow 深底白字、cart 描邊、去舊紅 #c41e3a、對齊桌機);保留 .pd-mbb-orig 刪除線 + disabled + iOS safe-area(@supports max())✅。
- **🟢 響應式收口(核對無誤刪)**:mobile 門檻統一 OD **≤1079**(修原 ≤900 collapse 但 .pd-info/各 section 早 ≤1079 → 901-1079「mobile section 卻 desktop 2 欄 + 無 buybar」不一致);移除冗餘 901-1099 mid-band;3 個舊 @media 併 1 個 ≤1079 + 1 個 ≤540。**逐條核對**:.pd-related-grid 2 欄/1 欄、.pd-spotlight collapse、buy-row 隱藏/buybar 顯示全保留(只移門檻);殘留 @media 900(lightbox 箭頭 overlay 尺寸、非 layout)+ 560(OD §9 spec-row)刻意留、非遺漏 ✅。清 4 條 OD-1/2 stale 斷點註解(已兌現)。
- **字面 vs 事實**:diff 印證 body ✅(buybar token 修 + 斷點統一 + mid-band 移除 + 註解清)。
- **⚠️ 驗證**:純 CSS、vitest 不覆蓋畫面、build storefront 綠(body 聲稱、僅證 CSS 無語法錯)→ **斷點/buybar 視覺必 Sean 真機肉眼驗**(桌機 ≥1080 2 欄 / 平板 ≤1079 單欄+底部 buybar / 手機 ≤540 卡片單欄)。鐵則 1:OD §12 直接搬 daemon down → Sean 驗。
- **判定:OD-11 PASS**(無 must-fix;修 latent buybar token bug + 響應式收口無誤刪;視覺待 Sean 真機驗)。**🎯 OD Phase A(OD-1~11)結構完成**。`3e3918eb` 未 push。

---

> **🎯 OD Phase A(OD-1~11)結構完成**:全 PASS。下一步 = **od-redesign→dev 合併**(我審那個 merge:OD-1~11 一次落 dev + 確認與 S1~S6 無衝突 + S6 到位)→ **合併後做適用車款表**(真 fitments、3 欄 D1=A)→ **Sean 真機肉眼驗整個 Phase A**(OD 審 = B、模板保真 + 響應式 + buybar 一次驗)。

## [`cf630b2f`] Merge branch 'od-redesign' into dev — OD 商品頁改造 Phase A 併入 [OD-merge] — **PASS**(合併後完整三綠獨立驗全綠)

OD Phase A(OD-1~11)併入 dev。fresh-context 審 merge:結構 + 衝突解 + **合併後完整三綠**(merge 審查最高價值=兩線首次共存的綠)。
- **merge 結構**:parents = `bd9ea68`(dev tip/CI v6)+ `3e3918e`(od-redesign tip/OD-11)✅;**零衝突標記殘留**(git grep `<<<<<<<`/`>>>>>>>`/`=======` 全空)✅。
- **🔴 衝突 = 零(自我修正:我預判錯了)**:我原預判 STATUS.md 會衝突(以為 OD 動附屬區)→ **實際 OD-5~11 全程用 `manifest`/`od_redesign` 追蹤、自 OD-4c 後未碰 STATUS.md**(git diff 2a34f73 od-redesign 無 STATUS)→ **合併零衝突**(比預判更乾淨)。merged STATUS 主表 + OD 附屬區兩區都在,是資料線維護主表 + 後續 096d7fe4 補 OD 狀態、**非衝突解出來的**。其餘檔零交集(OD components/css/manifest vs 資料線 scripts/lib/products.ts/mock-products.ts/workflows)。字面 vs 事實:我先前的「預判命中」不準、據此修正(對我自己 log 也守此守則)。
- **🔴 OD × S6 共存(merge 核心風險)**:OD 元件在 od-redesign 開發時無 S6(lib/products.ts/mock-products.ts 改);合併後 lib/products.ts toUIProduct fitments 映射(S6)+ ProductFAQ/ProductInfo/...(OD)共存。
- **🟢 合併後完整三綠(審查獨立重跑 @cf630b2)**:
  - **typecheck + lint:turbo 17/17 successful**(storefront typecheck 對合併樹 fresh 跑過 = OD 元件 × S6 的 UIFitment/MockProduct.fitments 型別共存無錯)✅。
  - **build storefront:1/1 successful**(合併樹 production build 過)✅。
  - **完整 vitest:79 檔 / 531 測全過**(OD 元件測 × S6 改的 mock-products 零 cross-effect、無回歸)✅。
- **字面 vs 事實**:merge commit subject 對應實際(od-redesign 全 11 片併入、無遺漏:ProductFAQ/SwatchWall/SwatchPreview/rpm-policies/rpm-swatches 等 OD 新檔都在)✅。
- **判定:OD-merge PASS**(無 must-fix;結構乾淨 + 衝突解對 + OD×S6 共存 + 合併後三綠全獨立驗綠)。**🎯 OD Phase A + 整合資料線 S0–S6 統一在 dev、全綠**。下一步:**Sean 肉眼驗**(:3001 重啟看合併後商品頁、見上方 checklist)→ OK 後 push(+ bd9ea68 v6 CI)→ 合併後做適用車款表(真 fitments)。`cf630b2f` 未 push。

---

## [`d016daf3`] fix(storefront): :3001 驗 follow-up — 縮圖翻頁 + 圖片放大 [OD-V] + [`ce546323`] OD-V-merge — **PASS**(Sean 肉眼驗 2 修 + 再合併三綠驗綠)

Sean :3001 肉眼驗找到 2 點 → OD session OD-V 修 → 再合併進 dev。fresh-context `git show d016daf3` + 合併後三綠。
- **OD-V scope**:9 檔(SwatchLightbox.tsx 新 92 / SwatchLightbox.test 新 / ProductGallery 293 / ProductGallery.test / ProductSwatchWall 101 / ProductSwatchWall.test / ProductSwatchPreview 58 / product-page.css +34 / manifest);零資料線污染、全 <400 ✅。
- **🟢 Fix A 縮圖 5 格翻頁**:`.pd-thumbs` 改橫向捲動容器(每格 (100%-32px)/5、scroll-snap、隱捲軸)、`.pd-thumbs-nav` 箭頭**只在 `gallery.length > 5` 渲染**、scrollBy(±clientWidth) 翻頁;主圖庫 hero-track 仍含全部(OD-7d 不變)→ 邏輯正確。⚠️ scrollBy jsdom 測不到 → 滑動/翻頁需 Sean 真機驗(誠實標)。
- **🟢 Fix B SwatchLightbox 抽共用**:新元件 92 行 controlled(lbIdx/setLbIdx caller 持)、**hooks 全在 early-return 前**(rules-of-hooks OK)、faithful 抽自 OD-7c inline、Preview + Wall **都 import 共用**(各 3 ref);Wall 卡片改 `<button>` 點開 lightbox 瀏覽全 10 張 → **解 OD-7b 留的 swatchLightboxDeferred**(manifest 標 resolved)。
- **字面 vs 事實**:diff 印證 body ✅;「所有圖可放大」範圍誠實界定(related ProductCard = 導航非放大、刻意不改;Highlights 無真圖)。
- **🟢 OD-V-merge(`ce546323`)**:parents = 096d7fe(dev)+ d016daf(OD-V)✅、零衝突標記、SwatchLightbox 在合併後 dev ✅。**合併後完整三綠審查獨立驗**:typecheck 17/17 / build storefront 1/1 / **vitest 80 檔 537 測全過**(cf630b2 的 79/531 + OD-V SwatchLightbox.test 1 檔 6 測)✅。
- **判定:OD-V + OD-V-merge PASS**(無 must-fix;Fix A/B 邏輯正確 + 共用 lightbox faithful + 合併後 537 全綠)。⚠️ 縮圖翻頁/圖片放大互動需 Sean 真機複驗(jsdom 測不到捲動)。`ce546323` 未 push。

---

## [`1adcf198`] fix(storefront): 手機商品大圖點擊放大 — tap 開 lightbox 加 preventDefault 抑 ghost click [OD-V2] — **PASS**

Sean :3001 手機驗:商品大圖無法點擊放大 → OD session 修。fresh-context `git show 1adcf198`。在 od-redesign(需再合併 dev、同 OD-V 模式)。
- **scope**:3 檔(ProductGallery.tsx +4 / .test +11〔+1 tap-open〕/ manifest +5);ProductGallery ~297 <400 ✅。
- **🟢 根因分析正確**:手機 hero onTouchEnd「tap」分支 setLightbox(true) 後未 preventDefault → 瀏覽器合成 ghost click 落在剛渲染的 .pd-lightbox(fixed inset:0 蓋 tap 點)→ 其 onClick setLightbox(false) 立刻關 → 手機「點了沒反應」;桌機無 touch→ghost-click 走 onClick 正常 → 只手機壞。**這是經典 mobile ghost-click bug、分析準確**。
- **🟢 修法正確最小**:tap 分支加 `try { e.preventDefault() } catch {}`(與既有 swipe 分支同作法;onTouchEnd 非 passive〔React 只把 touchstart/move 設 passive〕→ preventDefault 有效;swipe 分支已用同法、證有效);桌機 onClick 路徑不受影響。
- **字面 vs 事實**:diff 印證 body ✅。⚠️ jsdom 不合成 ghost click → 測(+1 tap-open)只驗 tap 開 lightbox 路徑、ghost-click-close 根因需 Sean 真機驗(誠實標)。三綠 538(+1)body 聲稱。
- **判定:OD-V2 PASS**(無 must-fix;ghost-click 根因+修法正確、最小侵入)。⚠️ 手機點圖放大需 Sean 真機複驗。`1adcf198` 未 push、待再合併 dev(我會審 merge + 合併後三綠)。

---

> **✅ OD-V2-merge(`f81e0d36`)PASS**:parents ce54632(dev)+1adcf19(OD-V2)、零衝突標記、合併後三綠獨立驗(typecheck 17/17 / build 1/1 / **vitest 80 檔 538 測全綠**)。dev 現 = 整合線 + OD Phase A + OD-V + OD-V2,全綠。

## [`b452327c`] style(storefront): 手機右欄 ProductInfo 上下間距窄 30% [OD-V3] — **PASS**(瑣碎 CSS)

Sean :3001 手機驗 follow-up(右欄太鬆)。純 CSS、2 檔(product-page.css +12 / manifest +1)。
- **字面 vs 事實**:新 `@media (max-width:1079px)` 各值精確 ×0.7(pd-sku 10→7 / pd-title 8→6 / pd-sub 24→17 / pd-price-block 20→14·28→20 / pd-pattern-preview 20→14 / pd-opt 22→15 / pd-opt-head 10→7)✅。
- **只手機 ≤1079**(桌機 ≥1080 不動、正確 scope);與 OD-11 的 ≤1079 layout block **不同 selector、無衝突**(OD-11 動 main/gallery/page/buybar、本片動 ProductInfo 內部 spacing)。鐵則 5:CSS-only(ProductInfo TSX 不動)。
- **判定:OD-V3 PASS**(瑣碎視覺、無 must-fix;間距視覺需 Sean 真機驗、body 標可再微調)。`b452327c` 未 push、待再合併 dev。

---

> **✅ OD-V3-merge(`9860df16`)PASS**:parents f81e0d3+b452327、零衝突、合併後三綠(build 過 + **vitest 538 全綠**)。dev = 整合線 + OD Phase A + OD-V/V2/V3,全綠。
>
> **📋 OD-V* 真機驗 polish 串(Sean :3001 肉眼驗 follow-up、全 PASS + 各自再合併驗綠)**:OD-V(縮圖翻頁+SwatchLightbox 抽共用)/ OD-V2(手機大圖 ghost-click)/ OD-V3(手機右欄間距 ×0.7)/ **OD-V3b `fe3c074c`(再收緊 ×0.5、含 iPad 直版、純 CSS spacing、值精確對 ×0.5、≤1079 scope、桌機不動 — PASS;merge `e5925db7` parents 9860df1+fe3c074、零衝突、build+vitest 538 綠)**。皆純前端視覺修、合併後三綠每輪獨立驗綠。

---

## [`fe3c074` → `320f3a5`] od-redesign fast-forward 同步 dev — **非審查事件(良性分支同步)**

新審查 session 重 arm 哨兵後首報 `NEW-OD 320f3a5`。查證 = **執行 session 開 OD-12 前把 od-redesign fast-forward 到 dev tip**(reflog:`320f3a5 od-redesign@{0}: merge dev: Fast-forward`),非新作程式碼。
- **零差異**:`git log dev..od-redesign` 空 / `git diff --stat dev od-redesign` 空 / worktree list 兩樹都在 `320f3a5`。`fe3c074..od-redesign` 列出的全是已在 dev、已審過的 commit(091d104/154c95a/320f3a5 docs + 各 OD/S 線 merge)。
- **判定:不審不推播**(無新內容)。OD-12 將以 `320f3a5` 為基底起手;**審查 baseline od-redesign 更新為 `320f3a5`**(= dev)。哨兵 last_od 已自動更新。

---

## [`750ffa7`] feat(storefront): OD-12 適用車款表接 S6 真資料 fitments [OD-12] — **PASS**(0 must-fix;鐵則 1 對 live OD §7.5 逐行保真 + 四綠獨立複驗 + 經銷零洩漏)

OD Phase A 後第一片(post-S6-merge、適用車款表)。range `320f3a5..750ffa7` 單一 commit。fresh-context `git show 750ffa7` + **live OD 模板真權威核對(daemon 在線)** + **OD worktree 四綠獨立重跑**。worktree 隔離(od-redesign=750ffa7、clean)。codex K2 跳(純前台、無 pricing/security/migration、執行 session 判合理、審查同意)。

- **scope(精準、零跨線污染)**:6 檔(ProductFitments.tsx 新 79 / .test 新 84 / ProductPage.tsx 374 / ProductTabs.tsx 266 / product-page.css 1328〔+95 純新增〕/ manifest +46);**檔大小全 <400**(`git show 750ffa7:<path>|wc -l`、鐵則 6 OK)。**零 package.json/pnpm-lock**(grep 證)→ body「未新增依賴、pnpm install --frozen-lockfile 僅補 node_modules」誠實。無 scripts/、無 lib/、無資料線檔。
- **🔴 鐵則 1 保真(對 live OD 模板核、非憑記憶)**:
  - **CSS §7.5 逐行完全吻合**(對 OD L621-680):`.pd-fitments-section`/`.pd-fit-head`/`.pd-fit-eyebrow`/`.pd-fit-title`/`.pd-fit-hint`/`.pd-fit-table*`/`.pd-fit-note` 每屬性·值·斷點(720/480 padding 9px 8px·8px 6px·font-size 10px letter-spacing .08em)逐字相同。唯二新增 `.pd-fit-unconfirmed`(business、OD 無)+ `.pd-spec-xref`(OD inline `color:var(--c-text-3);font-size:12.5px` → class、值吻合)。純新增零刪除(grep 證)、不碰既有規則。
  - **HTML 結構忠實**(對 OD L1200-1245):eyebrow『FITMENTS · 適用車款』/ title『這款部品適用的車型與年式』(id=pd-h-fit + section aria-labelledby)/ hint『下單前請先聊聊確認您的年式 / 配備』**字面完全吻合**;OD canvas inline nudges(`margin-top:-2px` 等)正確丟棄(非 §7.5 CSS、canvas 定位 hack)。
  - **🟢 D1=A 砍車系**:OD 4 欄(車廠/**車系**/車型/年式)→ 3 欄(車廠/車型/年式);DB/UIFitment 無 series 欄、不擅造。business override `fitments3ColNoSeries`、manifest 記。test `toEqual(['車廠','車型','年式'])` 鎖。
  - **🟢 xref 字面 = OD 完全吻合**:ProductTabs 渲染『完整適用車款請見頁面上方「適用車款」對照表』= OD L1456 逐字(先前疑慮〔OD-8 縮寫註解〕解除:實作對齊 OD 真權威、縮寫只在舊註解)。摘要列走 `product.fits` 真資料衍生(非 OD demo 寫死)。
  - **🟢 半形標點非鐵則 1 違反(查證)**:pd-fit-note 文字逐字忠實(『列表為主要適用車款…歡迎 LINE 諮詢』),僅 CJK 標點正規化半形「,」「;」——**驗 ProductFAQ.tsx L17 明文立此家族慣例 + 非註解行全形「，」計數 0**(OD-10 先例);遵循家族慣例使同頁元件一致、是 storefront 設計意圖。
- **🟢 formatYears 三態正確 + test 五分支全覆蓋**:`yearStart==null→'—'` / `yearEnd===null→'YYYY+'`(開放式)/ `yearEnd===undefined||===yearStart→'YYYY'`(單年)/ else `'YYYY–YYYY'`(en-dash 對齊 OD)。對 UIFitment 型別語意(mock-products L50)+ toUIProduct 條件帶欄(products.ts L133-139:yearStart!=null / yearEnd!==undefined / unconfirmed)一致。test 鎖 `['2018–2025','2020','2021','2025+','—']` 覆蓋全分支。
- **🟢 空狀態 + xref 條件一致(無 dangling)**:ProductFitments `!fitments||length===0→return null`;ProductTabs xref 條件 `fitments && length>0`——**互為補集**、xref 永不指向未渲染表;`product.fits` 摘要恆顯(fitments 空時='通用款')。沿用 N°03 條件渲染範式。business override `fitmentsEmptyStateNull`。
- **🟢 token 存在性(OD-11 latent-bug 防線)**:CSS 用的 `--c-border-strong`(2 defs)/`--c-text-3`(3)/`--c-surface`(8)/`--c-border`/`--c-text-2`/`--c-text`/`--f-mono` 在 tokens.css **全有定義**→ 無 OD-11 式 removed-token 壞渲染。
- **🟢 經銷防護**:ProductFitments **零 price/cost/shopee/dealer/prisma/store 引用**(grep 證、fitments = 公開車輛相容資訊);純 presentational、無 hooks、無 'use client'(由 client parent import、仍 SSR、無 RSC 邊界問題)。
- **🔴 四綠獨立複驗(OD worktree @750ffa7、fresh 非快取替放)**:
  - **vitest:81 檔 544 測全過**(`vitest run` 無 turbo 快取、live 跑、+6 對 538 baseline)——動共用元件 ProductPage/ProductTabs 故跑全套、零回歸。
  - **typecheck:turbo 7/7**(storefront `cache miss, executing` → 對 OD-12 真碼 fresh tsc --noEmit 過)。
  - **build:storefront 1/1**(fresh、0 cached、含 /products/[slug] 路由)。
  - **lint:turbo 10/10**(storefront `--max-warnings 0` 過、含 React 19 rules-of-hooks/exhaustive-deps;ProductFitments 無 hooks、ProductPage/ProductTabs 僅加 JSX 條件無新 hook)。
- **🟢 manifest 同步完整**:OD-12 slices_done + 新 ProductFitments 段(3 business_overrides:fitments3ColNoSeries / fitmentsUnconfirmedTag / fitmentsEmptyStateNull、open_drifts:[]) + ProductFitments 入 ProductPage children + specFitmentsXrefOmitted **resolved**(resolved_at + decision_source) + ProductPage/ProductTabs `last_modified_commit:320f3a5`(=OD-12 直接父 commit、必為可達祖先、避 amend orphan〔對齊 [[status-top-hash-off-by-one-normal]]〕)。
- **🟢 字面 vs 事實**:body 每項宣稱對 diff/live 模板/實跑逐條核——檔數·行數·3欄·formatYears·空狀態·接線位置·xref 條件·CSS 純新增·test 6 測·四綠數字**全屬實**。
- **判定:OD-12 PASS**(0 must-fix)。

**審查判斷項(交 Sean / 執行 session)**:
1. **🔴 「未確認」標 → Sean 2026-06-03 拍「不該」(推翻審查初判、需移除)**:審查初判「標屬此片」(自動列誤導風險);**Sean 拍板:不顯「未確認」標——下單前 LINE 本就會確認車款合用、標製造多餘焦慮**。Sean 拍板為準([[feedback_sean-owns-visual-design-going-forward]] 精神 + 不質疑改主意)。→ **執行 session 移除**(精準 4 點、零 S6 動):① ProductFitments.tsx 刪 `{f.unconfirmed && <span className="pd-fit-unconfirmed">未確認</span>}`(車型格回 `<td>{f.modelCode}</td>`)+ 清 header 註 unconfirmed 段 ② product-page.css 刪 `.pd-fit-unconfirmed` 規則 ③ ProductFitments.test.tsx 刪 unconfirmed 測(6→5 測、vitest 544→543)④ manifest 刪 `fitmentsUnconfirmedTag` override(ProductFitments overrides 3→2)+ OD-12 slices_done 文字去 unconfirmed 句。**保留**:lib/products.ts toUIProduct 的 `unconfirmed` 映射(S6 檔、harmless 公開資料、不擅動 S6 scope)。amend 750ffa7 或 follow-up commit、哨兵接到我再複審(三綠回 543)。
2. **🟡 NIT(非阻、OD-12 範圍外、pre-existing)**:表上線後 S6 檔 3 處註解 stale——`mock-products.ts L47/L107`(「OD-F1(Phase B)…渲染適用車款表」/「OD-F1(Phase B)適用車款表的真資料源」)+ `lib/products.ts L129`(「為 OD-F1〔Phase B〕適用車款表**鋪路**」未來式)仍用舊名 OD-F1/Phase B + 未來式。OD-12 **正確未碰 S6 檔(守 scope)**、非 OD-12 引入。建議執行 session 小幅註解 hygiene(OD-F1/Phase B→OD-12、鋪路→已上線過去式)、可獨立 tiny commit 或併下個動 S6 的 slice;不阻 OD-12。
3. **OD-V3b manifest「漏條目」= 非真 drift**(執行 session 問):OD-V3 slices_done 條目(L62)**已折入** ×0.5+iPad 內容(「先 ×0.7…改 ×0.5 原值一半」+ 全部最終值 + 「手機+iPad 等直版」)、od review-log 另有 OD-V3b commit 級 PASS;只缺「OD-V3b」label bullet(cosmetic)。內容誠實+可追溯齊全 → **不需回填**(折一條更乾淨、避 churn)。
4. ~~「未確認」文案語氣~~ → moot(item 1 Sean 拍移除整個標)。
- **⚠️ 視覺保真需 Sean 真機驗**(daemon 可核 HTML/CSS 字面、但渲染像素需眼睛):主樹 :3001 合併後、看真 RPM 商品頁(如 aprilia-01;mock 無 fitments→表不顯)+ 斷點 720/480 響應式 + 「未確認」標視覺。

**`750ffa7` 未 push、在 od-redesign(待再合併 dev)**。OD-12 merge 進 dev 時審查另跑**合併後完整三綠**(OD×S6×整合線首次共存的綠、merge 審最高價值)。

---

## [`9abb5c3`] style(storefront): OD-12b 移除適用車款表「未確認」標 [OD-12b] — **PASS**(Sean 拍板 follow-up、移除與 spec 逐項吻合 + 三綠回 543)

OD-12 follow-up:**Sean 2026-06-03 拍「未確認」標「不該」**(下單前 LINE 本就會確認車款合用、標製造多餘焦慮)→ 執行 session 移除(選 follow-up commit 非 amend、乾淨)。range `750ffa7..9abb5c3` 單一 commit。fresh-context `git show 9abb5c3` + 三綠獨立複驗。codex K2 跳(純前台移除)。
- **scope(精準、零跨線污染)**:4 檔(ProductFitments.tsx / .test / product-page.css / manifest)、**零動 S6/scripts**(grep 證)。**未動共用元件 ProductPage/ProductTabs**(OD-12b 只碰 OD-12 自家檔)。
- **🟢 移除與審查 spec 逐項吻合**:① ProductFitments.tsx 刪 `{f.unconfirmed && <span className="pd-fit-unconfirmed">未確認</span>}`、車型格回 `<td>{f.modelCode}</td>`(`f.unconfirmed` 在元件內**零殘留引用**、key tuple 不含它)② product-page.css 刪 `.pd-fit-unconfirmed` 整條規則 ③ test 刪 unconfirmed 測(6→5)④ manifest 刪 `fitmentsUnconfirmedTag` override(ProductFitments overrides **3→2**)+ OD-12 slices_done 去未確認 bullet + 新增 OD-12b 條目。
- **🟢 保留(scope 紀律正確)**:`lib/products.ts` toUIProduct 的 `unconfirmed` 映射 + `mock-products.ts` UIFitment.unconfirmed 型別欄**保留未動**(S6 檔、harmless 公開資料、前台決定不顯)——照 spec、不擴 S6 scope。元件/CSS/test 註解誠實更新(說明型別欄保留但不顯 + Sean 決策)。
- **🟢 manifest 同步**:ProductFitments `last_modified_commit:750ffa7`(=OD-12b 父 commit=OD-12、可達祖先、避 amend orphan);OD-12 條目標「final 交付狀態、變更歷程見下 OD-12b」、OD-12b 條目記移除 + 保留決策。
- **🔴 三綠獨立複驗(OD worktree @9abb5c3)**:**vitest fresh 81 檔 543 測全過**(544−1=移除的 unconfirmed 測、無 turbo 快取)+ **storefront typecheck `--force` fresh `cache bypass` 7/7**(對真碼跑、非 replay 執行 session 快取)+ build/lint turbo 18/18(content-hash 9abb5c3 cached-valid、OD-12 已 fresh 驗過 build/lint、本片純移除碼)。
- **🟢 字面 vs 事實**:body 每項(4 檔/移除點/保留 S6/543 測)對 diff+實跑核**全屬實**。`style(storefront)` type 對 UI 元素移除合宜。
- **判定:OD-12b PASS**(0 must-fix)。**「未確認」標已完全移除**;OD-12 + OD-12b 合為適用車款表 final 狀態(3 欄、無未確認標)。`9abb5c3` 未 push。

---

## [`320f3a5..9abb5c3`] OD-12 + OD-12b 併入 dev(fast-forward)— **PASS**(合併後完整三綠 + 表 SSR 端到端確認)

Sean 跑 `git merge od-redesign` → dev **fast-forward 到 9abb5c3**(線性、無 merge commit、無分岔:od-redesign 本就 = dev現況 + OD-12 + OD-12b)。合併後 dev 樹 = 已驗的 9abb5c3 byte-identical。
- **🟢 合併乾淨**:dev 9abb5c3、log 線性(OD-12b→OD-12→320f3a5)、無意外 commit;審查 session 的 review-log working-tree 編輯保留未受擾(od-redesign 全程未碰本檔)。
- **🔴 合併後完整三綠(主樹 dev=9abb5c3 權威複驗)**:**vitest 81 檔 543 測全過**(主樹環境、無 turbo 快取)+ **storefront typecheck `--force` fresh 7/7**(0 cached、對合併後 dev 真碼跑)。
- **🟢 表 SSR 端到端功能確認(curl :3001 /products/rpm-aprilia-01)**:HTTP 200、`pd-fitments-section` / `FITMENTS · 適用車款` / `這款部品適用的車型與年式` / `pd-fit-table` 皆在 SSR HTML、**帶真車款資料**(RSV4 / Tuono V4 / 2021 / 2025 年式)。網站 DB 1123/1123 商品全有 fitments、aprilia-01 = 8 筆(直查 bmpnplmnldofgaohnaok)。**非視覺 sign-off**(畫面美觀 / 間距 / 響應式仍待 Sean 肉眼驗)。
- **判定:OD-12 merge PASS**。dev 現 = 整合線 S0–S6 + OD Phase A + OD-12(含 12b)、全綠。**dev 9abb5c3 未 push**(origin/dev=320f3a5、Sean 手動推)。

---

## [`654e471`] style(storefront): OD-12c 桌機適用車款表年式欄收窄 [OD-12c] — **PASS**(純 CSS 桌機微調、Sean 真機驗 follow-up)

Sean 桌機真機驗:年式欄過寬(原 `.pd-fit-table width:100%` 把 3 欄窄內容三等分撐滿、年式欄 ~700px 撐到頁右緣留大空白)→ 執行 session CSS 收窄。range `9abb5c3..654e471` 單一 commit。fresh-context `git show`。codex K2 跳(CSS-only)。
- **scope**:2 檔(product-page.css +10 / manifest +5−2)、無動 TSX/test/S6。
- **🟢 CSS 邏輯正確**:`@media (min-width:1080px)` → `.pd-fit-table width:auto`(欄貼內容、不再三等分)+ th/td `padding-right:64px`(欄間呼吸)+ `:last-child padding-right:16px`(年式欄回正常右距)。longhand padding-right 正確覆蓋 base `padding:13/15px 16px` 的右值。≤1079 沿用 100% 滿版(手機/平板 + 720/480 縮字不動)。
- **🟢 三綠複驗(OD worktree @654e471)**:**build storefront 1/1 fresh**(--force、0 cached、CSS 編譯無語法錯=CSS 變更最相關綠)+ **vitest 81 檔 543 測不變**(CSS-only、jsdom 不測樣式)。
- **🟢 字面 vs 事實**:CSS diff 對 body 逐項吻合;「product-page.css only」指無動 code/test(manifest 文檔另記、body 有述)。
- **🟡 NIT(非阻、manifest 完整性)**:桌機 `width:auto` **偏離 OD §7.5 `width:100%`**——已記 slices_done(可追溯),但**未記成正式 `business_override`**(ProductFitments 段現只 fitments3ColNoSeries + fitmentsEmptyStateNull)。manifest 的價值是讓「偏離 OD 的所有點」可 grep → 建議補一條 `fitmentsDesktopWidthAuto`(OD §7.5 width:100% → 桌機 width:auto、reason:3 欄窄內容滿版撐太開);與 fitments3ColNoSeries 同層級。執行 session 之後順手折入即可。
- **判定:OD-12c PASS**。視覺幅度(64px 欄間 / width:auto vs max-width cap)Sean 驅動、由 **Sean 桌機複驗**拍。`654e471` 在 od-redesign、未 merge dev、未 push。

---

**OD-12c merge dev ✅**(Sean ff `git merge od-redesign` → dev=`654e471`、線性無 merge commit;主樹 dev=654e471 合併後 vitest 81 檔 543 測全過;OD-12c CSS〔@media min-width:1080 width:auto〕已在 dev = :3001 桌機顯收窄)。**dev 本機 654e471、origin/dev 仍 320f3a5(Sean 拍 A 暫不 push/上線、[[project_deploy-topology-main-stale-dev-live]])**。

---

## [`9b21a8e`] style(storefront): OD-12d 適用車款表重設計分組+年式chips [OD-12d] — **PASS**(Sean 主導 UX 重設計、新分組邏輯正確 + 三綠 545 + manifest 典範)

Sean 桌機真機驗:OD-12c `width:auto` 縮整表是錯方向(要「**欄位文字之間收窄**」非整表變窄)+「比例協調 / 資訊密集 / 不要滑很久」→ 指定 `/frontend-design` 重設計(本次明確委派、覆蓋平時 [[feedback_sean-owns-visual-design-going-forward]])。根因:OD §7.5 扁平 row-per-fitment 表對真資料(每品 ~8 fitments、同車廠/車型重複多列如 RSV4/Tuono V4 各 ×4 年式)= 稀疏+撐開+滑久。range `654e471..9b21a8e` 單一 commit。fresh-context `git show` + 邏輯逐行追 + 三綠獨立重跑。codex K2 跳(純前台 UI、無 pricing/security/migration)。
- **scope**:4 檔(ProductFitments.tsx 115 行 <400 / .test / product-page.css / manifest)、**零動 S6/scripts**。
- **🟢 groupFitments 邏輯正確(逐行追)**:車廠 first-seen 序(`order` 陣列 push)+ 車型 first-seen(Map 插入序)+ 年式車型內升序(`yearSortKey = yearStart ?? +Infinity`、`[...fits].sort` **複製不 mutate** 共用陣列、V8 stable)。edge:同車型跨車廠不撞(model 鍵在 brand 內);React key 同層唯一(brand=g.brand / model=m.model 在 brand 內唯一 / year chip 含 index)。formatYears 三態不變。
- **🟢 test 7 測直接驗分組**(5→7):空狀態 ×2 / eyebrow+title / 單車廠分組(RSV4 消重複、2 chip 聚同列、models=['RSV4','Tuono V4'])/ 多車廠 first-seen 序(['Aprilia','Ducati'])/ 年式亂序輸入→升序 `['2009–2015','2016','2021–2024','2025+']` / 無 yearStart 排末 `['2020','—']`。
- **🟢 CSS 連貫**:舊表格 CSS(.pd-fit-table/wrap/thead/tbody/.brand/.years + OD-12c width:auto + 720/480)**全刪乾淨**(`.pd-fit-table` 殘留 1 筆=純註解提及、非 dead rule → body「移除表格 CSS」字面vs事實 ✅);新 .pd-fit-groups 1.5px anchor / .pd-fit-group 細線分隔 / .pd-fit-brand mono uppercase / .pd-fit-row grid 132px+1fr / .pd-fit-year mono surface-2 sharp-corner chip;8 class 全有定義 + token(--c-surface-2 等)全存在(無 OD-11 latent bug);≤540 車型堆疊年式上方。維持 OD 美學(mono/sharp/薄線/surface)。
- **🔴 三綠獨立(OD worktree @9b21a8e、fresh)**:**vitest 81 檔 545 測**(+2、無快取)/ **storefront typecheck `--force` fresh 7/7**(groupFitments/BrandGroup 型別)/ **build fresh 1/1**(CSS+邏輯編譯)。
- **🟢 manifest 典範**:OD-12d slices_done + **design.authority 明標「OD-12d 起 Sean 主導 UX 重設計、扁平表保真 supersede」** + 新 `fitmentsGroupedLayout` business_override(design_value OD 扁平表 / storefront_value 分組+chips / decision_source 含「本次明確委派 /frontend-design」/ reason)+ fitments3ColNoSeries·EmptyStateNull 同步更新(表→清單/3 欄→3 維)+ last_modified 654e471(=OD-12d 父、可達祖先)。
- **🟢 字面 vs 事實**:body 每項(groupFitments/CSS 整段換/545/+2/supersede)對 diff+實跑核全屬實。
- **判定:OD-12d PASS**(0 must-fix)。

**非阻觀察(交 Sean / 執行 session)**:
1. **🟡 a11y 語意降級(較值得留意)**:重設計把原 OD-12 的 `<table><th scope="col">`(正確 tabular 語意)換成 `<div>` grid + **無語意角色**(車廠是 `<div>` 非 heading、無 list/table role)。對螢幕報讀器,車廠↔車型↔年式關係不如原表清楚。Sean 主導視覺、非阻;建議小幅 a11y follow-up(車廠標 `role="heading"`/真 heading、或 `.pd-fit-groups` role=list + group/row aria-label),視覺不變即可補語意。
2. **🟡 NaN comparator 微 nit**:兩筆都無 yearStart 時 `yearSortKey(a)-yearSortKey(b)` = `Infinity-Infinity` = NaN(sort 視為相等、保留原序、不崩不錯)。無害;若潔癖可改 `(a,b)=> a===b?0 : a<b?-1:1` 式比較。
- **⚠️ 視覺需 Sean 桌機 + 手機真機驗**(合併後 :3001、真 RPM 如 aprilia-01;幅度可調:品牌標/chip 樣式/車型欄 132px)。

**`9b21a8e` 在 od-redesign、未 merge dev(dev=654e471 落後)、未 push**。

---

## [`bb99340`] fix(storefront): 修正 FAQ 詢問欄位內文(訂購/交期/保固拆段)[OD-13] — **PASS**(Sean 提供內文、法律字面逐字未動 + 共用單一真相 + 545 不破)

新片(非 OD-12 系列):Sean 2026-06-03 提供 FAQ 修正內文。range `9b21a8e..bb99340` 單一 commit。**敏感:動共用 rpm-policies(保固含消保法 §19 鑑賞期法律主張、Sean 仍確認準確性)** → fresh-context 逐字驗 + 完整 vitest。codex K2 跳(內容改、非 schema/RLS/migration/pricing;法律字面**未改**只拆段)。
- **scope**:3 檔(ProductFAQ.tsx +8 / rpm-policies.ts +7−2 / manifest);無動 test(既有斷言不破、見下)、無動 S6。
- **🔴 法律字面驗證 PASS(本片最敏感)**:rpm-policies diff **只動舊第 2 段**、切點精確在「我們會負責換貨處理。|退換貨時商品需維持」(逐字不變、純拆兩段、3→4 段、doc 註同步);**第 1 段(接單後才向原廠訂製)+ 鑑賞期/消保法 §19 第 1 項段(L35-39「依《消費者保護法》第 19 條第 1 項…不適用 7 天鑑賞期」)不在 diff = 逐字未碰**(grep bb99340 確認該段完整)。body「法律段逐字不變、只拆段」屬實。
- **🟢 共用單一真相維持**:保固改在 rpm-policies(canonical「那份」)→ ProductTabs 保固分頁 + ProductFAQ 自動同步 4 段、未 fork。
- **🟢 FAQ order/leadtime(Sean 內容)**:order『下單』行改「確認商品是否適用後直接下單即可,如不確定歡迎直接 LINE…」(付款/運費 run 未動);leadtime 整段換「預購商品為〔下定後與原廠訂購〕,需等待 2–6 週不等…以詢問時回報之時間為準。」。對 body 逐字吻合。**order 新文與 OD-12d 移除「未確認」標的理由一致**(下單前 LINE 確認適用性)、連貫。
- **🟢 測不破(無動 test 檔卻改內容、關鍵驗)**:測只斷言保固**第 1 段**含「接單後才向原廠訂製的客製商品」(OD-13 未動第 1 段)、**無段數斷言**、無斷言被改的 order/leadtime 字面 → 內容改不破測。**完整 vitest 81 檔 545 測全過**(rpm-policies 共用 FAQ+Tabs、跑全套、零回歸、對齊 [[feedback_run-full-vitest-after-shared-component-change]])。
- **🟢 JSON-LD 同步(by construction)**:FAQPage JSON-LD 的 plainAnswer 與畫面同源衍生自 FAQ_ITEMS → order/leadtime 改自動入 JSON-LD;build fresh 過(無生成錯)。
- **🟢 標點**:正規化對齊家族慣例(全形→半形逗號 / 2-6→2–6 + 空格 / LINE 前後空格)、保留 Sean 用詞。
- **🔴 三綠獨立(OD worktree @bb99340、fresh)**:typecheck+build `--force` 8/8(0 cached)+ 完整 vitest 545。
- **🟢 manifest**:OD-13 slices_done(含「法律段逐字不變」明記)+ ProductFAQ last_modified=9b21a8e(=OD-13 父=OD-12d、可達祖先);warrantyPolicySingleSource 機制不變(仍單一真相、只 4 段)無需改 override。
- **判定:OD-13 PASS**(0 must-fix)。`bb99340` 在 od-redesign、未 merge dev、未 push。⚠️ 視覺需 Sean :3001 真機驗(展開 FAQ + 保固分頁看拆段)。

**OD-12d + OD-13 merge dev ✅**(Sean ff `git merge od-redesign` → dev=`bb99340`、`654e471..bb99340` 一次帶 2 commit〔OD-12d 分組表 + OD-13 FAQ〕、線性無 merge commit;主樹 dev=bb99340 合併後 vitest 81 檔 545 測全過)。dev 本機 bb99340、origin/dev 仍 320f3a5(Sean 拍 A 暫不 push/上線)。

---

## [`f8d5045`] docs(backlog): #211 fitments 分組字串正規化 + 真資料實查驗證乾淨 — **PASS**(純 docs;審查獨立 DB 複查宣稱完全吻合)

純 docs slice(backlog.md +24)。觸發:OD-12d 分組改精確字串歸堆後 Sean 問「DIV 分組撈 DB 一樣對嗎」→ 執行 session 唯讀實查 + 記 backlog #211(分組對髒字串敏感、匯入端無正規化守門)。
- **🔴 審查獨立 DB 複查(非信執行 session、自跑 SQL 驗宣稱)**:對 `bmpnplmnldofgaohnaok` products.fitments unnest 查 → **total 2873 / distinct brands 10 / distinct models 96 / trim 異常 0 / brand case-fold 衝突 0 / (brand,model) case-fold 衝突 0** = **與 backlog 宣稱數字逐項完全吻合**。→ OD-12d groupFitments 在真資料上**正確、零拆堆**(精確字串分組安全)、字面vs事實(資料層)PASS。
- **🟢 backlog #211 條目品質(鐵則 10)**:三視角齊(擴充性 髒批拆堆 / 可維護性 無守門需人工檢 / bug 可追蹤性 拆堆靜默非報錯)+ 不修會痛 + 估時 + 依賴 + 預期解法(根治=匯入端 trim+統一大小寫、保護 fitments UI + listByFitment `@>` 查詢;治標=前端 groupFitments key trim)+ 優先級 🟢 觀察(現資料乾淨、非阻、新來源大批匯入前再評估);無空泛「待 Sean 決定」。
- **🟢 scope**:1 檔 backlog.md;純 docs(build 跳、typecheck/lint N/A on .md、body 誠實標)。
- **判定:f8d5045 PASS**(0 must-fix;backlog 條目健全 + 資料宣稱審查獨立驗證屬實 + 確認 OD-12d 生產正確)。`f8d5045` 在 od-redesign、未 merge dev、未 push。

---

## [`0eff2a41`] docs(storefront): OD-12 NIT 之一 — 適用車款表註解去 OD-F1/Phase B 過時 + 修 unconfirmed 偏離 [od-12-nit] — **PASS**(純註解 hygiene、字面對齊事實;1 🟡 NIT 數字少算)

OD-12 NIT slice 第 1 commit(承我前審「殘留 NIT hygiene〔S6 檔 OD-F1/Phase B 註解〕」建議)。**在主樹 dev 直接做**(非 od worktree、純 docs NIT 不涉 OD 視覺)。range `266f5f2..0eff2a41` 單一 commit。fresh-context `git show` + `git grep` 對不可變快照驗(不碰執行 session 活工作樹)。codex K2 跳(純 .ts 註解、零 schema/RLS/migration/pricing)。
- **scope**:2 檔(mock-products.ts +6−6 / lib/products.ts +2−2)、**純註解**(diff 只動 `/** */` + `//` 文字、零程式碼)。
- **🔴 字面 vs 事實(本片重點)**:
  - **宣稱1「OD-F1/Phase B 兩改檔零殘留」✅**(`git grep "OD-F1\|Phase B" 0eff2a41 -- mock-products.ts lib/products.ts` = 零命中)。OD-F1(Phase B)→ OD-12、改指真元件名 ProductFitments、去未來式「鋪路」→「供…渲染」逐處對齊。
  - **宣稱2「未確認剩 3 處全正確不顯陳述」= 結論 ✅、數字 🟡**:`git grep "未確認" 0eff2a41 -- apps/storefront/src/` 實際 **4 處**(ProductFitments.tsx L15 / mock-products L48,L59 / **product-page.css L583**),commit body 漏算 css L583。但 4 處**全為「不顯/已移除」正確陳述、無一謊稱顯標** → commit 實質結論(無錯誤殘留)成立。純數字少算(對齊 [[feedback_plan-numbers-must-match-grep]]、fresh-context 抓原 session body 數字小偏);非阻、不影響 PASS。
  - **unconfirmed 欄保留 ✅**:UIFitment.unconfirmed 欄(mock L60)+ toUIProduct 映射(products L138)未刪、註解誠實標「欄保留 harmless 公開資料、OD-12b 起前台不顯」對齊 OD-12b(`9abb5c3`)實況。
- **🟢 三綠**:純 .ts 註解、零執行影響(註解不參與編譯/測試)→ 與 baseline 同綠,靜態確定(實跑見下 2d8ee9cd batch)。commit body 誠實揭露「三綠對完整改動(本 commit + 後續 a11y)一次跑、546 測含 a11y +1」= 非隱瞞、符鐵則 11 字面 vs 事實守則。
- **判定:0eff2a41 PASS**(0 must-fix;1 🟡 NIT「未確認 3→4 處」數字少算、結論成立非阻)。

---

## [`2d8ee9cd`] fix(storefront): OD-12 NIT 之二 — 分組清單補巢狀 ARIA list 語意(視覺不變)[od-12-nit] — **PASS**(0 must-fix、a11y 結構合法 + 三綠 fresh 重跑全綠)

OD-12 NIT slice 第 2 commit(承我前審「OD-12d a11y 語意降級〔分組用 div 無 role〕」建議)。range `0eff2a41..2d8ee9cd` 單一 commit。fresh-context `git show` + 三綠 fresh 重跑(工作樹乾淨=dev tip 2d8ee9c 純態、PRE/POST dev 不變 tree 乾淨 → 未被執行 session 干擾)。codex K2 跳(a11y 屬性、無 pricing/security/migration)。
- **scope**:3 檔(ProductFitments.tsx +11−5 / .test.tsx +20−1 / manifest +2−2)、零動 S6/scripts。
- **🟢 a11y 結構正確(逐層追)**:巢狀 ARIA list `groups(role=list) > group(listitem) > rows(list) > row(listitem) > years(list) > year(listitem)`;每個 `role=list` 直接子皆 `listitem`(中間 `.pd-fit-brand`/`.pd-fit-model` 為 listitem 內容、非 list 直接子 → 不破壞 list 語意);年式清單 `aria-label="{車型} 適用年式"` 建立年式↔車型關係(報讀器最易丟失)。WCAG 1.3.1 補強合理。
- **🟢 「視覺不變」屬實**:diff 只加 `role`/`aria-label` 屬性、**零 CSS、零標籤替換**(div 仍 div、span 仍 span)→ 像素級不變。用 div+顯式 role(非改 ul/li)正確規避 **Safari+VoiceOver 對 `ul+list-style:none` 移除 list 語意的已知 WebKit 陷阱**、且最小改動。
- **🟢 test 7→8 對齊實作**:+1 a11y 斷言(querySelector + getAttribute 驗 list/listitem role + `aria-label='RSV4 適用年式'`)守護不退化;斷言值與 render 輸出逐項吻合。
- **🟢 manifest 同步**:`last_modified_commit:654e471→0eff2a4`(=本 a11y commit 直接父=同 NIT slice 註解 commit、可達祖先、避 amend orphan,對齊 [[status-top-hash-off-by-one-normal]])+ date 註記;a11y 非偏離 design 故**不加 business_override**(與既有 3 筆視覺/內容 override 性質不同)合理。
- **🔴 三綠 fresh 獨立重跑(主樹 dev=2d8ee9c 純態、--force 非快取 replay)**:**typecheck 7/7 + lint 10/10**(turbo 17 task、0 cached)+ **build storefront 1/1**(0 cached、含 /products/[slug])+ **完整 vitest 81 檔 546 測全過**(動共用元件 ProductFitments → 跑完整非子集,對齊 [[feedback_run-full-vitest-after-shared-component-change]];ProductFitments.test 7→8)。全綠、零回歸、對齊 commit body 宣稱。
- **🟢 字面 vs 事實**:body 每項(6 role 點 / 視覺不變 / Safari 陷阱 / 7→8 / 三綠數字 / manifest 可達祖先)對 diff + 實跑核屬實。
- **判定:2d8ee9cd PASS**(0 must-fix)。OD-12 適用車款表 a11y 補強完成、視覺零變動。

---

**⚠️ 流程觀察(非 commit 缺陷)**:OD-12 NIT 兩 commit **在主樹 dev 直接做**(非 od worktree、純 NIT 不涉 OD 視覺)→ **dev 領先 od-redesign 2 commit**(dev=2d8ee9c / od-redesign 仍 266f5f2);審查 session 與執行 session 本輪共用主樹,我嚴守唯讀(git show/grep 不可變快照 + 三綠在乾淨 dev tip 純態跑、PRE/POST 驗未被干擾、零 git add/stash/checkout)。merge 注意:od-redesign 落後 dev 2 NIT、之後續做 OD 視覺再 merge 須帶上(同檔 ProductFitments、不同改動、預期可線性);或 Sean 之後 ff od-redesign 對齊 dev。

---

## [`3ca6411d`] docs(specs): 賣場結構化內容模型設計 + #209 升級交報價單 [content-model] — **PASS**(翻譯線非 OD;Sean 本人 commit、純 docs、字面 vs 事實核對屬實)

⚠️ **非 OD 線 commit**(翻譯/賣場內容模型線、#209),哨兵盯 dev 一併捕獲審。**author=Sean 本人**(把網站審查 session 研究草案升級+拍板+commit;Co-Authored Claude Opus 4.8)。range `2d8ee9cd..3ca6411d` 單一 commit。純 docs。
- **scope**:2 檔(`docs/specs/2026-06-03-storefront-content-model-design.md` 新建 +159 / `docs/phase-1-backlog.md` #209 +8−1)、零 code。
- **🟢 字面 vs 事實(核對本 session 研究第一手資料)**:doc/backlog 宣稱數字全屬實 — RPM `description_origin` 100%(均 760 字)/ 其他 5 家 0、`product_name_zh` ~100%、`description_zh` 6 家全 0、`spec` jsonb、`translation_locked` 機制、車種 bug(BMW 複製貼上/年份打架/名稱≠描述)— 皆我唯讀偵察 B 庫 + 報價單專案實得,逐項吻合。
- **🟢「Sean 拍 A/B/B」= 當事人 commit 確認**:author=Sean 本人親寫拍板;對話中 Sean 以敘述表態(「依照你建議」+ 車種討論 + 範圍),commit 行動正式定案、非執行 session 替推斷。
- **🟢 backlog #209 升級誠實**:狀態改「🔵 方向升級+設計完成、交報價單」、明標「上方 baoyu-translate 路線已取代」(未刪舊內容、標 superseded)、加升級段指向設計 doc + memory。
- **🟢 連帶產出核對(執行 session 同波 19:51)**:memory `project_storefront-content-model-design`(已建+MEMORY.md 索引、內容與我研究數據逐項吻合)+ tw-marketplace 記憶過時點(「ProductTabs 寫死鋁合金」)**已更新**標 OD-8 改碳纖維 — 我原預警的 dangling/stale 皆已解、無殘留。
- **🟢 三綠**:純 docs(.md);typecheck/lint N/A、build 跳。
- **判定:3ca6411d PASS**(0 must-fix)。翻譯 #209 方向 doc+backlog+memory 三者一致、可交報價單 session 開 PRD。
- **🟡 待 Sean 確認(非缺陷)**:doc 採「標題提主車型」(= 我推薦的車種露出 B);Sean 對話中該題仍在敲、由 commit 間接定 B → 已向 Sean 對齊。

---

## [`63651e84`] docs(handoff): 審查 session 換手 + 賣場內容自動化架構定案交接 [review-handoff] — **PASS**(純 docs 交接文、架構記錄詳實;2 🟡 狀態記帳矛盾待 Sean 釐清)

⚠️ **翻譯/治理線交接 commit**,哨兵捕獲審。author=Sean、純 docs(交接文 99 行新檔 `docs/handoff/2026-06-04-review-session-handoff-content-arch.md`)。range `3ca6411d..63651e84`。
- **scope**:1 檔(交接文新建 +99)、零 code。
- **🟢 架構定案記錄詳實(兩次對抗審查 workflow 結論)**:範本工廠骨架(template-floor/AI-head)、工作單位=群非件(~4500 群、膨脹 3.6x)、範本鍵=major_category(衍生 SSOT、非 native category〔motogadget 97% 空〕、非 product_name_zh)、內容=程式拼裝打底全量 + AI 只補頭部 5-15%、加新供應商成本掛「品類數」非「供應商數」(撐 20+ 家)。與賣場內容方向 doc 一致、車種鐵律延續(範本/AI 無車種欄、fitment_parsed 直出)。
- **🔴 上線前必修(交接文 §3 自記、重要技術發現)**:fetcher 每夜 `DELETE WHERE manually_corrected=false` 會砍人工校鎖內容 → 須加 `AND translation_locked=false` + `summary_zh`/`highlights_zh` 併入 `PROTECTED_TRANSLATION_FIELDS`。**= 報價單側實作前硬約束、新審查 session 待審重點**。
- **🟢 優先序(三次審查一致、Sean Q1=A)**:P-1 LINE CTA(半天)→ P1 M-3 結帳(站內現無法成交)→ P2 範本工廠。誠實標「內容做再好站內成交=0」。
- **🟡 矛盾1(狀態描述、待釐清)**:§6 稱「本 session 哨兵 byo0hnkyh 已 TaskStop」,但 **byo0hnkyh 仍活**(本 commit 即由它捕獲)。交接文前提(舊 session 已收尾停哨兵)與實況不符。
- **🟡 矛盾2(session 記帳)**:§1 session 地圖記「本審查 session(commit 6cce4a3/3ca6411)+ 第二審查 session(review-log M)」,但 6cce4a3/3ca6411 author=Sean 本人、審查實由單一 session(arm byo0hnkyh)做;記帳與實況有出入(不影響交接內容實用性)。
- **🟢 三綠**:純 docs;N/A。
- **判定:63651e84 PASS**(0 must-fix;架構/技術內容詳實正確)。**2 個狀態記帳矛盾已標、待 Sean 釐清「審查 session 是否換手」**(見下)。

---

## [`ce36e50f`] feat(storefront): 商品頁 LINE 詢價懸浮 CTA(手機 deep link 預填 / 桌機 QRCODE)[line-cta] — **PASS**(0 must-fix、車種鐵律落實徹底 + 三綠 fresh 重跑全綠)

交接文 §4 優先序 P-1(接通現況唯一真實成交管道)。author=Sean(執行 session worktree line-cta 分支隔離施工、ff-merge 回 dev=線性無 merge commit)。range `6897324..ce36e50f`。**feat=真 code**,fresh-context `git show` 全 diff + 三綠 fresh 重跑。
- **scope**:6 檔(lib/line-cta.ts 新 / LineCtaButton.tsx 新 / line-cta.css 新 / LineCtaButton.test.tsx 新 / ProductPage.tsx +2 接線 / manifest)、零動 S6/scripts/schema/pricing。
- **🔴 車種鐵律(本案最硬約束)逐行驗證 PASS**:`buildPrefillMessage`(line-cta.ts L31-43)**確不讀 `product.fits`**、只拼 `商品名 + 料號(productCode??slug) + pageUrl + 「我的車是(請告知年式/車型):」留空`;test 2 用 `MOCK_PRODUCTS[0]`(fits='CBR600RR' 有車款)當**對抗樣本守門**:`expect(msg).not.toContain(product.fits)` + `not.toContain('CBR')`。AI/訊息零車款捏造、車型由客人自填 PCM 再確認 → 完全符合鐵律。
- **🟢 必含三欄 / 車型留空 / deep link 格式**:test 1(含商品名+料號+URL)+ test 3(結尾「我的車是…:」冒號後無車款)+ test 5(`buildOaDeepLink`=`line.me/R/oaMessage/@pcmmoto/?{urlencode}`)逐項對齊。
- **🟢 不擋 buybar**:`.line-cta-fab z-index:45`<`buybar z-index:50`(product-page.css:1226 對照)、`mobile-tabbar:40`<45;手機 `@media≤1079 bottom:calc(74px+safe-area)` 避開 buybar;QR modal z-index:10000 蓋全部(合理)。
- **🟢 桌機/手機分流 + 韌性(8 smoke test 覆蓋)**:桌機→QRCODE modal(dialog+QR 圖+lin.ee 加好友 fallback)、手機→`window.open` oaMessage、QR `onError`→破圖隱藏+「QR 圖準備中」+加好友連結兜底(LINE_QR_SRC 現 placeholder、待 Sean 補 public/line-qr.png 真圖、有 fallback 不炸)。
- **🟢 安全/隱私**:lib 純函式不讀 window(pageUrl client 傳)、**零 price/cost/dealer/prisma 引用**(grep 證、只用 name/productCode/slug/url 公開欄);LINE_OA_ID='@pcmmoto'(Sean 確認真值、與 pcm-moto 同帳號)。
- **🔴 三綠 fresh 獨立重跑(主樹 dev=ce36e50 純態、--force)**:**typecheck 7/7 + lint 10/10**(17 task 0 cached)+ **build storefront 1/1**(0 cached)+ **完整 vitest 82 檔 554 測**(546 base + 8 LineCtaButton、動共用元件 ProductPage 跑全套)。全綠、零回歸、對齊 commit body。⚠️ 跑期間並行 session 改 `docs/specs/content-model-design.md`(docs、與 code 無關、source(apps/packages)全程零 dirty → 驗證有效)。
- **🟢 字面 vs 事實**:body 6 檔/車種鐵律/三欄/z-index/8 test/三綠數字 對 diff+實跑核屬實;manifest 加 LineCtaButton + business_override `lineCtaDeepLinkPrefill`(code-reviewer WARN-1 已修)。
- **判定:ce36e50f PASS**(0 must-fix)。⚠️ 待 Sean :3001 肉眼驗 + 補 `public/line-qr.png` 真 QR 圖(現 placeholder、onError fallback 兜底不炸)+ 確認 LINE basic ID @pcmmoto。

_(⚠️ **換手待 Sean 拍**:交接文要 fresh 審查 session + 稱哨兵已停,但本 session 仍在跑、byo0hnkyh 仍活、context 仍足、且持續正常審(本片 ce36e50f LINE CTA 即由本 session 審 PASS)。**未自行停哨兵**——等 Sean 定 ① 本 session 續審 ② 真開 fresh(則停哨兵交棒)。
⚠️ **並行 session 熱點**:主樹多方並行(LINE CTA 已 merge / 另一 session 改 content-model doc /specs M / 審查),本 session 嚴守唯讀+精準 pathspec commit(只 review-log)、零碰他人 M。
其他 ✅:OD-12 NIT×2 + 翻譯 #209 設計線 + 63651e84 交接 + ce36e50f LINE CTA 皆審 PASS;待 Sean :3001 真機驗(OD-12d/OD-13/LINE CTA)+ 補 QR 圖 + 拍 pilot→skill/brand_story/其他5家爬原文。哨兵盯 dev=ce36e50 / od-redesign=266f5f2、origin/dev 未推。)_
