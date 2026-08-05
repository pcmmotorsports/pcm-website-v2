# 站台改版第1-4批 · 舊樣式殘留終掃(唯讀報告,**未動手改**)

> 2026-08-06 · 視窗 D · 落檔自 `scratchpad/residual-scan.md`(`D-117-A` item 3)
> 方法論與逐批殘差見同目錄 `2026-08-06-site-redesign-cssdiff-batches1-4.md`
> 🔴 **③ 的 37 處半像素是 Sean「商品詳情頁要不要補一批」那題的決策輸入**(34/37 在那一頁)


掃描面 = `apps/storefront/src/styles/` 全部 26 支 CSS,**已剝註解**(第一版沒剝、命中一堆自己寫的說明)。

## ① 換色前的舊色字面(應為零)
- **#dc2626 緋紅**:1 處
    - tokens.css:33  --c-tier-premium: #dc2626;
- **#991b1b 深紅**:0 處
- **#fee2e2 紅粉底**:0 處
- **#c0392b 第三顆紅**:0 處
- **rgb(a)(220,38,38)**:0 處

## ② 字體 token typo(`--font-*` 只在 `product-page.css` 的 `.pd-page` scope 內定義)
- **var(--font-sans) 在 product-page.css 之外**:0 處
- **var(--font-mono) 在 product-page.css 之外**:0 處
- **寫死 IBM Plex Mono**:0 處

## ③ 半像素字級(§4-3「字級只用整數 px」)
- **font-size: N.Npx**:37 處
    - home.css:53  .ed-link-sm { font-size: 12.5px; gap: 10px; }
    - home.css:215  .ed-finder-hint { font-size: 12.5px; color: var(--ed-c-ink-mute); }
    - product-card.css:203  [data-font-size="sm"] .pcard-name { font-size: 12.5px; }
    - product-page.css:411  font-size: 10.5px;
    - product-page.css:537  font-size: 12.5px;
    - product-page.css:598  font-size: 13.5px;
    - product-page.css:604  .pd-fit-note { margin: 14px 0 0; font-size: 13.5px; color: var(--c-text-2); }
    - product-page.css:685  font-family: var(--f-mono); font-size: 12.5px; letter-spacing: 0.16em;
    - product-page.css:726  .pd-eyebrow .pd-eb-label { font-size: 11.5px; letter-spacing: 0.12em; }
    - product-page.css:779  font-size: 15.5px;
    - product-page.css:861  .pd-gb-mcard-t { font-size: 14.5px; font-weight: 700; margin: 5px 0 0; }
    - product-page.css:862  .pd-gb-mcard-d { font-size: 12.5px; color: var(--c-text-2); line-height: 1.6; margin: 6px 0 0; }
    - product-page.css:865  font-family: var(--f-mono); font-size: 10.5px;
    - product-page.css:951  font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.12em;
    - product-page.css:955  .pd-bona-anod-c { font-family: var(--f-mono); font-size: 10.5px; color: var(--c-text-3); }
    - product-page.css:1061  .pd-bs-mcard-t { font-size: 14.5px; font-weight: 700; margin: 5px 0 0; }
    - product-page.css:1062  .pd-bs-mcard-d { font-size: 12.5px; color: var(--c-text-2); line-height: 1.6; margin: 6px 0 0; }
    - product-page.css:1065  .pd-bs-grip-k { font-family: var(--f-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; color: var(--c-text-2); }
    - product-page.css:1072  font-family: var(--f-mono); font-size: 10.5px;
    - product-page.css:1180  font-size: 12.5px;
    - product-page.css:1195  font-size: 12.5px;
    - product-page.css:1265  font-size: 15.5px;
    - product-page.css:1272  font-size: 11.5px;
    - product-page.css:1283  .swatch-card-name { font-size: 14.5px; }
    - product-page.css:1307  .swatch-card-tag { font-size: 9.5px; padding: 3px 7px; }
    - product-page.css:1430  font-family: var(--f-mono); font-size: 10.5px; font-weight: 600;
    - product-page.css:1503  font-size: 15.5px; line-height: 1.7; color: var(--c-text); margin-bottom: 9px;
    - product-page.css:1512  .pd-list { margin: 14px 0; padding-left: 22px; font-size: 15.5px; line-height: 1.85; color: var(--c-text); }
    - product-page.css:1533  .pd-spec-row { grid-template-columns: 104px 1fr; gap: 12px; font-size: 14.5px; }
    - product-page.css:1545  .pd-install-meta strong { font-size: 14.5px; font-weight: 600; color: var(--c-text); }
    - product-page.css:1553  .pd-install-cta-desc { font-size: 13.5px; color: var(--c-text-inverse); opacity: 0.78; }
    - product-page.css:1556  border: 0; font-size: 14.5px; font-weight: 600; white-space: nowrap; cursor: pointer;
    - product-page.css:1690  font-size: 13.5px;
    - product-page.css:1725  .pd-mbb-price { font-size: 15.5px; font-weight: 700; color: var(--c-text); font-variant-numeric: tabular-nums; }
    - product-page.css:1760  font-size: 15.5px; font-weight: 600;
    - product-page.css:1775  font-size: 14.5px; line-height: 1.75; color: var(--c-text-2);
    - product-page.css:1830  .pfc-sub { font-size: 12.5px; color: var(--c-text-2); }

## ④ 宣告層寫死的容器寬(media header 不算)
- **max-width: 1xxx px 的宣告**:15 處
    - brand-page.css:51  max-width: 1440px; margin: 0 auto;
    - brand-page.css:65  max-width: 1440px; margin: 0 auto;
    - brand-page.css:117  max-width: 1440px; margin: 0 auto;
    - brand-page.css:214  max-width: 1440px; margin: 0 auto;
    - brand-page.css:232  max-width: 1440px; margin: 0 auto;
    - brand-page.css:275  max-width: 1440px; margin: 0 auto;
    - brand-page.css:307  max-width: 1440px; margin: 0 auto;
    - brand-page.css:345  max-width: 1440px; margin: 0 auto;
    - brand-page.css:377  max-width: 1440px; margin: 0 auto;
    - brand-page.css:392  max-width: 1440px; margin: 0 auto;
    - cart.css:5  max-width: 1200px;
    - cart.css:247  max-width: 1200px;
    - filter-top.css:99  max-width: 1200px;
    - filter-top.css:153  max-width: 1200px;
    - product-page.css:1526  .pd-specs-2col { display: block; columns: 2; column-gap: 56px; max-width: 1000px; border-top: 0; }
