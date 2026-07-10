# 🔌 品牌商品串接上網站 — 下個 session kickoff handoff(2026-07-11)

> 一句話:**版面(9 家品牌形象區)已做完並上 dev;下一步是把「品牌商品」真正寫進網站型錄,版面才會出現在真實商品頁上。**
> SSoT 前情:`docs/handoff/2026-07-10-brand-rollout-morning-report.md`(過夜晨報、Q1-Q6 決策題)。

---

## 0. 目標

把 9 家品牌(evotech/lightech/cnc-racing/eazi-grip/samco/motogadget/front3d/materya/ebc)的商品從**報價單 view** 匯入網站型錄,讓每個品牌商品頁都掛上 `BrandShowcase`(N°01/N°02 交錯版面)。

## 1. 為什麼現在站上看不到(現狀)

- **版面掛載機制**:`apps/storefront/src/components/BrandShowcase.tsx` 依 `product.brandSlug` `switch` 派發各家 `*Showcase`;**沒有該品牌商品 = 沒有商品頁 = 版面不出現**。
- **商品未進站**:8 家 + cncracing 在 `scripts/supplier-config.ts` 全 `writeAllowed: false`(runtime throw + 測試鎖),過夜只跑 `--dry-run`,**零 prod 寫入**。所以站上還沒有這些品牌的商品。
- **能看的地方**:僅 `/dev-preview/brands`(fixture demo harness,非真商品頁)。
- **部署層**:本次 premium content 在 **dev**(commit `b1a7eb0`),production=main、尚未 deploy。

## 2. 本次(2026-07-11)已完成、影響串接的部分

- **版面 premium content 全上 dev**(`b1a7eb0`):9 家 Bonamici 風格交錯段、Front3D 照片、Motogadget/EBC YouTube 影片、N° 編號一致、Materya 創辦人封面、EBC 對齊 Motogadget 版型。
- **Logo(晨報 Q4 部分解決)**:eazi-grip / front3d / motogadget 已換上官方 logo(白 logo `brightness(0)` 黑化)、cnc 徽章放大。→ 晨報 Q4「補圖」對這 4 家已不需要;evotech/materya 仍用既有 logo。
- **商品圖全本地化**:33 張 hotlink → `/brands/`(這是「版面卡片圖」;**與 DB 寫入的商品變體圖是兩回事**,見下 §3 關卡 #275)。

## 3. 串接前要先解的關卡(晨報 Q1-Q6,尚未執行)

| 關卡 | 內容 | 影響 |
|---|---|---|
| **#274** | eazi-grip / materya 撞鍵(handle/spec 重複列)triage | 不解 → 這 2 家不能寫;其餘 7 家不受影響(晨報 Q2) |
| **ebc seed migration** | `supabase/migrations/20260710120000_seed_ebc_brand.sql` 未 db push(品牌表缺列) | 不 push → ebc 寫入 fail-closed(晨報 Q3;db push=Sean 手動 SQL/terminal) |
| **#275** | lightech 寫入 DB 的 4,566 群變體圖是 http(非版面卡片,那個已修) | 部分瀏覽器破圖;報價單 fetcher 側改 https 鏡像治本(晨報 Q5) |
| **上線順序** | 小→大:front3d→motogadget→samco→eazi-grip*→cnc→evotech→lightech*→materya*→ebc*(*=待上關卡) | 晨報 Q6 |

## 4. 串接執行步驟(關卡拍板後)

1. **拍板晨報 Q2/Q3/Q5**(或決定撞鍵 2 家延後、先上乾淨 7 家)。
2. 逐家把 `scripts/supplier-config.ts` 的 `writeAllowed` `false → true`(一次一家、diff 回核)。
3. 逐家 `--confirm-write` 匯入(**寫 prod = Sean 跑 terminal**,Claude 被 `.env*` deny 擋;順序見 §3 上線順序)。
4. 匯入後:`push dev` → Sean `push dev:main`(FF)→ deploy → shop.pcmmotorsports.com。
5. **肉眼驗**:開任一品牌真商品頁(如某 lightech 料號),確認 N°01/N°02 交錯版面出現、圖不破。

## 5. 相關檔案

- 版面派發:`apps/storefront/src/components/BrandShowcase.tsx`
- 匯入設定/腳本:`scripts/supplier-config.ts`、`scripts/rpm-import.ts`(同源腳本模式)
- 前情:`docs/handoff/2026-07-10-brand-rollout-morning-report.md`(Q1-Q6)、`docs/handoff/2026-07-10-brand-rollout-kickoff.md`、`docs/specs/2026-07-04-catalog-category-brand-frontend-wiring-plan.md`
- 全供應商匯入方向:memory `project_quote-full-import-11-suppliers`、`project_brand-rollout-8plus1-overnight`

## 6. 收尾提醒(晨報 §5 誠實註記)

- `/graphify --update` 與 `/pcm-roadmap` 過夜未跑 → 下個 session 開工時補跑。
- 附件(PDF/影片)來源部分品牌今晚仍 0,晚到自動補、不阻擋串接。

— END —
