# 多品牌每日同步生命週期對抗審查(2026-07-05、雙跨模型)

> 觸發:Sean 2026-07-05 深夜拍板「gbracing + bonamici 直接上架」+ 生產級要求
> 「商品內容/變體/照片/資訊/每日更新不出錯;日後穩定自行新增/下架;適用車款/內文/變體/分類變動同步校正;
> 所有商品資料修改連動到網站的任何部分都不出錯、不見、多餘、找不到」。
> 審查者:**fable 5**(adversarial-reviewer subagent、盲審)+ **codex(gpt-5.5 CLI、`codex exec -s read-only`)**,
> 互不知對方存在;皆 fresh-context、唯讀、git 前後零留痕比對通過。
> 本檔由主 session 代落檔(fable overlay 禁寫檔);findings 原文照錄、triage 見 §4。

## §1 雙審 verdict(收斂)

| | fable | codex |
|---|---|---|
| verdict(「每日同步可信任」)| **FAIL**(must-fix 3、同一根因) | **FAIL**(must-fix 4) |
| 試點首寫本身 | 安全(fresh import 無孤兒、gate 全在 upsert 前) | gate 大多在第一個 upsert 前 |

**Must-fix 全交集**(跨模型獨立收斂 = 高置信度):

1. **變體級生命週期不存在**(fable F1/F2/F3 = codex #1/#2):群(main_sku)在、群內變體 sku 從來源消失 →
   變體永久殘留 DB(`rpm-reconcile.ts` 原只做 product 級差集)、前台 selector 全收
   (`SupabaseProductAdapter` embed 全變體)、`create_order` 只擋 product 級 delisted → **殘留變體可下單、凍結舊價**。
   報價單側 #267「同碼合併」(CNC 4549→4376)證明變體消失是真實輸入、非假想。
   衍生 F3:孤兒併入 pv_spec 模擬 → 變體改名同 spec → 新 sku 恆撞死孤兒 → 該供應商同步永久 abort、無工具可解。
2. **每日排程只跑 rpm**(fable S1 = codex #3):`rpm-sync.yml:62` 無 `--supplier` → 新品牌寫入後凍結在寫入日。
3. **cncracing「僅乾跑」無 runtime 硬擋**(codex #4):只有註解、誤帶 `--confirm-write` 會真寫。

## §2 Should-fix / nit(未阻擋、列管)

- **S2 告警面弱**:gate abort 只有 GitHub 預設 email(寄上次改檔者)+ scheduled workflow 60 天無活動自動 disable →
  整家停更新可能無人發現。建議接 LINE notifier(#250 前例)+ 上次成功同步監測。→ **backlog**
- **S3(=#260 殘餘語意)**:採 Sean ①「保留現值」後,來源**清空**描述永不傳播(舊文殘留)。已在 STATUS「Sean 待決策」。
- **S4 首頁精選洗牌**:featured = `listAllProducts().order('id')`(uuid 序)前 4 → 試點寫入當天精選 4 件洗牌、無 curation(#205 正解)。→ Sean 知情項
- **S5 首頁死接線(pre-existing、#147 族)**:(a) `CategoryGrid` 寫死 8 假分類+假 count、`?category=` 參數列表頁不讀 → 點了無過濾;
  (b) `BrandIndex` 連 `/brands/${id}` 路由不存在 → 品牌牆點擊 404。多品牌上線後客人真會踩。→ Sean 拍修/藏
- **S6 cncracing 圖池混鄰色情境照**:cnc 寫入前處置(本輪 cnc 不寫、變 Phase 3 前置)。
- **無交易寫入**(codex):products upsert 成功後 variants/reconcile 失敗 → 部分更新中間態(下輪自癒、冪等)。→ backlog
- **合法大下架無乾淨放行路徑**(codex):>10% 真下架會同時撞 5% pre-write + 10% reconcile 兩 gate、bypass 旗標互斥。→ backlog
- nit:`rpm-preflight.ts` / `rpm-transform.ts` stale 註解(#260/#261「待補」字樣)— **本輪已修**。
- fable nit:N1 offset 分頁 <5% 靜默截斷殘口(已標、有 backlog)/ N2 群 title 取最低價變體、變價致標題跳動 /
  N3 sitemap 86400s 下架 URL 殘留至多 24h / N4 每日全表 `updated_at=now` 失去變更訊號 / N5 同物理商品雙供應商雙掛無去重(業務治理)。

## §3 已清安全項(兩審交叉、均實讀 file:line)

- **新增商品**:handle preflight(charset+全域唯一)、#261 null-category 硬 gate、異常價無條件 abort、未登記 slug fail-closed throw。
- **下架商品**:per-supplier scope 全鏈貫穿(fetch/delta/reconcile/preflight)→ 跑 gbracing 誤殺 RPM 路徑**查無**;
  前台真靠 RLS `delisted_at IS NULL` 隱藏 + 變體 EXISTS 連動;來源空硬 abort 不可 bypass;復架 upsert 自動 `delisted_at:null`。
- **內文(description)**:#260 分批修法正確(codex 確認);rpm 全省 key 單批 byte 等價。
- **適用車款(fitment)**:欄位**無條件**每日全量重寫 → 改動必傳播;前台 taxonomy 每請求重衍生 + force-dynamic → 即時反映。
- **分類**:category_id 無條件寫 → 移動傳播;count live exact、樹只留 >0 → 舊分類自動縮、空分類自動消;未對上 fail-closed abort。
- **照片**:images 欄無條件寫 → URL 改動傳播;缺圖 placeholder + UI fallback。
- **handle 穩定性**:external_id=main_sku 為穩定鍵、handle 僅 SEO key;SKU 改名=舊群軟下架+新群插入、無重複(舊 URL 404 為代價);任何撞 → preflight abort。
- **前台重複/空項**:重複路徑查無(複合鍵+handle 全域唯一);品牌側欄/分類樹由真商品衍生、無空項;搜尋 ilike 走 products_public 含新品;全 force-dynamic 無 cache 滯留。

## §4 Triage 與處置(2026-07-05 深夜、本 session)

| Finding | 處置 |
|---|---|
| 變體級對賬(F1/F2/F3) | ✅ **本輪修**:`rpm-reconcile.ts` `classifyVariantOrphans`(純函數、差集 scope=本次要寫的群)+ `computeVariantOrphans`(embed parent external_id)+ `applyVariantDelete`(**硬刪**;`order_items.variant_id` FK `ON DELETE SET NULL`、migration 20260604120000:143 註明「變體刪不破歷史」、order_items 自帶快照欄、cart stale variantId 已有 found:false 路徑)+ 報告(dry-run 列不刪=F2 觀測性)+ 安全 gate(源空硬 abort / >10% abort、`--allow-large-delist` 顯式放行);刪除序=products upsert 後、variants upsert **前**(F3:改名同 spec 先清舊列);`rpm-delta.ts` `simulateSpecCollisions` 排除已排刪孤兒 |
| 每日排程 matrix | ✅ **本輪修**:`rpm-sync.yml` → matrix `[rpm, gbracing, bonamici]`、`fail-fast:false`(跨供應商不耦合)、`max-parallel:1`(序列寫同一 DB);**推上 origin 前不生效 = Sean push 即批准(鐵則 8)** |
| cncracing 硬擋 | ✅ **本輪修**:`supplier-config.ts` 加 `writeAllowed` 欄(cnc=false)+ `rpm-import.ts` 最早位置 gate(`--confirm-write` 且 `writeAllowed=false` → throw) |
| stale 註解 | ✅ 本輪修 |
| S2/S4/S5/S6/無交易/大下架路徑/nits | backlog + 晨間簡報 Sean 拍板 |

驗證:三綠(typecheck 7/lint 10/build 1)+ 完整 vitest 158 檔 1729 + 三家 dry-run 重跑
(孤兒報告乾跑實證:**rpm 抓到 1 真孤兒 `YAMT07-06-G-T`**〔掛現役商品頁 rpm-yamt07-06、Twill/Glossy、
0 筆訂單引用、MCP 唯讀核實〕;gbracing/bonamici 0 孤兒、rpm 其餘零回歸)。
**codex round2(CLI、fresh)= PASS、0 must-fix**:round1 四點確認全修;consider=無交易寫入窗
(已知 should-fix、backlog);nit=本檔措辭(已修)。code-reviewer(Claude subagent)結果見 commit body。
