# SESSION HANDOFF — 2026-07-11 報價單源頭變體建模(ebc/eazigrip/materya 撞鍵治本)

> 一句話結果:**乾淨 5 家品牌已匯入 prod(7,861 商品/22,921 變體)並 deploy live 驗證;剩 ebc/eazigrip/materya 撞鍵 = 報價單源頭 `spec` 欄未填、須在報價單 repo 治本(Q2=A 拍板),開此新 session 做。** 未 push 1 支(origin/dev 落後 e25377c)。
> 環境:repo `pcm-website-v2`(dev branch)+ 報價單 repo `PCM_Quote`(源頭修在這)· 網站 DB `bmpnplmnldofgaohnaok` · 報價單 DB `dllwkkfanaebrsuyuedy` · mode=engineering/website。HEAD=`e25377c`。
> 接手先讀:本檔 §2「核心診斷」+ memory `project_brand-rollout-8plus1-overnight`(07-11 串接段)+ `project_variant-model-unification-267` + plan `docs/specs/2026-07-04-variant-model-unification-plan.md`。

---

## 0. 核心診斷(下個 session 的立足點,務必先懂)

**現象**:ebc/eazigrip/materya 匯入時撞 `pv_spec_unique`(同商品內兩變體規格重複)→ 匯入 preflight 整家 abort、零寫入(fail-safe、非覆寫)。

**根因(已實查證實)**:
- 網站端 [rpm-transform.ts:398](../../scripts/rpm-transform.ts#L398) 只有 `spec: v.spec ?? {}` — **直接照抄報價單 view `storefront_catalog_v` 的 `spec` 欄、網站自己零推導**。
- samco(能上):源頭 `spec = {"color":"經典-經典黑"}`,每變體有顏色 → 不撞。
- ebc/eazigrip/materya(撞鍵):源頭 `spec = null` → 全部退化成 `{}` → 同群多 SKU 撞同一空規格。

**修法(Q2=A、Sean 2026-07-11 明示「跟其他家一樣做法、不要多加變數/複雜度」)**:
**在報價單 repo(PCM_Quote)源頭把 `spec` 填好**,跟 samco 顏色一模一樣的機制;**網站端一行都不改、不加 EBC 專用 parser**(那是 Sean 明確拒絕的複雜度)。這是 #267 變體合併同一條線、同一個地方。

---

## 1. 做了什麼(按時序)

1. **乾淨 5 家開寫閘 + 匯入 prod** — `scripts/supplier-config.ts` cncracing/evotech/samco/motogadget/front3d `writeAllowed false→true`(晨報 Q1=A);Sean 終端逐家 `--confirm-write` 寫 prod;唯讀 MCP 實查落地 **7,861 商品/22,921 變體、零 abort、數字全對上乾跑**。commit `2969a86`。
2. **deploy live 驗證** — push `dev` + `dev:main` FF(`e8a3c15..2969a86`)→ Vercel production deploy;5 家 showcase 全 live 驗證(curl shop.pcmmotorsports.com、N°01/N°02 marker 42-53 命中)。「視覺沒上」根因=部署落差非 bug(BrandShowcase dispatcher 早已含 9 家 case、只是 main 舊版)。commit `02f8dd1`(STATUS 字面校正、dev only 不需 deploy)。
3. **ebc seed db push + 撞鍵發現** — Sean `supabase db push` seed `20260710120000`(EBC BRAKES brand 列已在 prod);但乾跑往下走揭露 **35/68 群 pv_spec 撞鍵**(過夜因 brand 缺列在 resolveId 先 throw、沒跑到這關)。ebc `writeAllowed` 維持 false、併入撞鍵桶。commit `e25377c`。
4. **Q2=A 拍板落檔** — 建變體軸治本、報價單源頭填 spec(見 §0)。桶=eazigrip/materya/ebc。

---

## 2. Commit 序列(push 狀態)

| commit | 內容 | push |
|---|---|---|
| `2969a86` | 品牌串接開寫閘 5 家 + 匯入 prod [#212] | ✅ 已 push dev+main(production live) |
| `02f8dd1` | 5 家 deploy live + STATUS 字面校正 [#212] | ✅ 已 push dev(main 不需、docs) |
| `e25377c` | ebc seed 已 push 但揭露 35 群撞鍵 + Q2=A [#274] | 🔴 **未 push**(origin/dev 落後 1 支) |

多 session 共用 dir → 開工先 `git fetch`。

## 3. DB / 部署 / 外部足跡(git 看不到)

- **網站 DB 寫入(prod、Sean --confirm-write)**:5 家品牌商品+變體 = 7,861/22,921 列,唯讀 MCP 已驗;可回溯(每家獨立、delisted 機制在)。
- **網站 DB schema(prod、Sean db push)**:`20260710120000_seed_ebc_brand` 已套用 = brands 表 +1 列(EBC BRAKES, slug=ebc, premium 0);idempotent、rollback=DELETE(ebc 尚無 products 指向、安全)。
- **部署**:main=`2969a86` → Vercel production READY、shop.pcmmotorsports.com live 驗證過。
- **報價單 DB**:本 session 只唯讀查證(samco/ebc spec 欄對照),零寫入。

## 4. graphify 地圖增量

**地圖未動 + 原因**:本 session 只動 `scripts/supplier-config.ts`(config 布林+註解)+ STATUS/docs,無結構性 code 變更;且 `/graphify --update` 依 07-10 拍板走 milestone/每日、非每 slice。**待補**:`/graphify --update` + `/pcm-roadmap`(晨報 §5 過夜即未跑)→ 下個 milestone 收尾或每日收工補跑。

## 5. 開放項(待辦)

- 🔴 **報價單源頭變體建模(本 session 主題、#267/#268/#274、報價單 repo `PCM_Quote`)** — 進入點三步:
  1. 撈 **ebc 全後綴詞彙**(HH/V/R/TT/EP/GP/SFA/EPFA/GPFAX…共幾種)+ **查證 EBC 官方每種材質正式名稱**(信任狀紀律、不自編)→ 做「後綴→材質」對照表。
  2. 撈 **eazigrip CENTREPAD 41 群 + 尾 hyphen TANKBMW006 + materya 2 群**實際撞鍵資料,確認變體軸。
  3. 三家「源頭 `spec` 填法」寫成規格 → 報價單 repo parser 實作(**跨 repo、先給 Sean 過提案**,同 lightech Q5 協作方式)。source 填好後網站零改、撞鍵自動消失。
- ⏳ **lightech #275**(獨立、非本桶):報價單 fetcher 改 lightech.it https 重抓 → 重抓進 view 後 `writeAllowed→true` + `--confirm-write`。
- ⏳ **收尾補跑** `/graphify --update` + `/pcm-roadmap`。
- carry-over:Q4 品牌補圖(文字 lockup 可上、次要);未追蹤檔 `docs/handoff/2026-07-10-brand-showcase-premium-content-handoff.md`(session 起就在、非本 session 產、留給 Sean 決定)。

## 6. push 狀態與收尾自檢

- **push 狀態**:production(main=`2969a86`)已含 5 家串接 code + live;**origin/dev 落後 1 支 docs commit `e25377c`**(ebc 撞鍵發現+Q2 落檔)、等 Sean 推。
- **下個 session 進入點**:①`git fetch` + 讀本檔 §0 核心診斷 ②撈 ebc 後綴詞彙 + 查 EBC 官方材質正名(信任狀)③撈 eazigrip/materya 撞鍵實料 → 寫源頭 spec 規格 → 報價單 repo 提案。
- **自檢**:git status 僅 1 未追蹤檔(非本 session、見上);secret 0 洩漏(全程唯讀 MCP、無 key/連線字串進 diff/handoff);驗證留痕=prod 唯讀 MCP 7,861/22,921 對上乾跑 + curl showcase live 42-53 marker + gate 測 52 綠。

## 相關 plan / 記憶 / 文件

- memory:`project_brand-rollout-8plus1-overnight`(07-11 串接段全紀錄)、`project_variant-model-unification-267`、`project_quote-full-import-11-suppliers`、`project_product-page-template-multibrand`
- plan:`docs/specs/2026-07-04-variant-model-unification-plan.md`(#267 變體統一真權威)
- 前情 handoff:`docs/handoff/2026-07-11-brand-catalog-wiring-kickoff-handoff.md`、`docs/handoff/2026-07-10-brand-rollout-morning-report.md`(晨報 Q1-Q6)
- 檔:`scripts/supplier-config.ts`(writeAllowed gate)、`scripts/rpm-transform.ts:398`(spec 直抄源頭)、`scripts/rpm-import.ts:276-281`(pv_spec preflight abort)

— END —
