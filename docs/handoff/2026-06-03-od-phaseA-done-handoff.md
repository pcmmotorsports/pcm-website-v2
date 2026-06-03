# 交接:報價單↔網站整合 + OD 商品頁改造 Phase A 完成(2026-06-03)

> 本 session(寫審分離之**審查 session**)收尾。Sean push 完成、開新 session 繼續。
> 寫審分離(ROLE=A):執行 session 實作、審查 session fresh-context 重驗、Sean 橋接。

---

## 1. 現況(全綠、已上線)

- **`origin/dev = e5925db`、0/0 同步、CI = success**(含 GitHub Actions v4→v6 升級實跑綠)。
- **整合資料線 S0–S6 完成 + 已上線運轉**:rpm-sync GitHub Actions cron 每天台灣 03:00 自動把報價單 B 庫(`dllwkkfanaebrsuyuedy`)乾淨 view 同步進網站庫(`bmpnplmnldofgaohnaok`)。
  - 經銷防護零洩漏(price_store 全 NULL、anon GRANT 擋、3 public view 排除敏感欄)。
  - 3 道誤下架/異常防線:**W1 抓取完整性閘(商品維度差集 >5% abort)+ S4 下架對賬閘(>10% abort)+ 異常價硬 gate**。
  - cron 首跑驗證過(誤貼 anon key→permission denied〔= GRANT 實證〕→改 service_role→success)。
  - workflow:`.github/workflows/rpm-sync.yml`;tsx 釘 root devDep。
- **OD 商品頁改造 Phase A 完成 + 已合併 dev + 已推**:
  - OD-1~11:tokens 金色義體 / Hero 圖庫 / 右欄 / picker 2 維(12K·Kevlar 折入紋路、消光不寫死鎖)/ 服務橫條外移 / N°01 為什麼選 RPM Carbon / N°02 紋路牆+picker 預覽卡+lightbox+圖庫聚合 / tabs 碳纖維化 / N°03 相關商品 / N°04 FAQ+FAQPage JSON-LD / buybar OD §12 + 響應式 ≤1079。
  - OD-V/V2/V3/V3b 真機驗 polish:縮圖 5 格翻頁 + SwatchLightbox 抽共用 / 手機大圖 ghost-click 修 / 手機+iPad 右欄間距 ×0.5。
  - **合併後完整三綠每輪審查獨立驗綠**(末:typecheck 17/17 / build storefront 1/1 / **vitest 80 檔 538 測**)。merge 零衝突(OD 用 manifest 追蹤、未碰 STATUS)。

## 2. 審查紀錄(SSoT)

- 資料線:`docs/reviews/integration-phase1-review-log.md`(S0–S6 + 各 merge,逐 commit PASS)。
- OD 線:`docs/reviews/od-redesign-review-log.md`(OD-1~11 + OD-V* + 各 merge,逐 commit PASS;含 3 flag 結案 + OD-V* polish 串)。
- 記憶:`project_quote-website-integration-phase1`(「session-end 終態」段為最新)。

## 3. 剩餘工作(交新 session)

1. **OD-12 適用車款表**(下一片主工作):post-merge、接 S6 plumb 的 `product.fitments`(UIFitment[]、lib/products.ts toUIProduct 已映射)、**3 欄 車廠/車型/年式(D1=A、非 OD 模板 4 欄含車系)**;空狀態處理。Sean 2026-06-03 拍 A 延後至此(當時 od-redesign 無 S6 型別、現已合併取得)。OD 模板 §適用車款 的「完整見上方對照表」交叉引用 OD-8 暫省、此片補。
2. **Sean 真機驗 polish**:可能續出 OD-V* 式小修(視覺/響應式),審查照樣每片自動審 + 驗合併三綠。
3. **codex 補審**(OpenAI quota 到 **2026-07-02** 恢復):本輪 S3b-1 後全用 Claude fresh-context fallback(同模型、非跨模型 codex);quota 回對 **S5 workflow + W1 閘 + S4 下架 gate** 補正式跨模型 codex 對抗(或 Sean 貼 web Codex)。
4. **中文描述 pipeline #209**(獨立 session):`baoyu-translate` + `taiwan-traditional-chinese`(⚠️ 需先裝)→ pilot 翻幾個測品質 → 重撈 RPM 原始網站灌庫 → 大量翻。描述不在 S3b sync scope(現有 933 英文留、新 190 NULL)。
5. **backlog #210**(W1 <5% 靜默截斷持久基線根治)。

## 4. 流程/治理(新 session 必讀)

- **寫審分離**:執行 session 在 **OD worktree `/Users/sean_1/pcm-website-v2-od`(od-redesign 分支)** 做 OD;審查 session 在主樹 `/Users/sean_1/pcm-website-v2`(dev)fresh-context 重驗。Sean 橋接決策(prose multi-select、白話)。
- **worktree 隔離**(解原跨 session git index 撞車):OD 在 od worktree、資料線/審查在主樹;⚠️ **od worktree 無 `.env.local`**(gitignored)→ 起 dev server 需 Sean 設、或在主樹 `:3001` 驗(主樹 :3001 dev server 有 env、hot-reload 合併後內容)。
- **哨兵自動審 pipeline**(見 `reference_sentinel-auto-review-pipeline`):審查 session 用 Monitor 盯分支、每 commit fresh-context `git show` 審不可變快照、findings 寫對應 review-log、只 FAIL 才推播。**⚠️ 哨兵隨 session 結束而死、新審查 session 須重 arm**。
- **每片審查項**:字面 vs 事實(commit body↔diff)/ 鐵則 1-12 / scope 乾淨(精準 add、跨線零污染)/ manifest 同步 / 經銷防護 grep(動 pricing)/ 三綠(動 .ts/.tsx 重跑;**動共用元件跑完整 vitest**;merge 跑合併後完整三綠)/ codex 關卡2(命中 schema/RLS/migration/pricing 才跑、現 quota 掛走 Claude fallback)。
- **檔案大小用 `git show <sha>:<path> | wc -l`**(OD 在 worktree、主樹 `wc -l` 讀的是 dev 版會誤判)。
- **STATUS**:資料線主表(分隔線上)/ OD 線附屬區(分隔線下)+ manifest;merge 零衝突靠 OD 用 manifest 不碰 STATUS。

## 5. 新 session 起手

- 兩個新 session(審查 + 執行)各自第一則讀本檔 + 對應 review-log + 記憶。
- **審查 session**:重 arm dev + od-redesign 兩哨兵;讀兩 review-log 尾 + 記憶 session-end 段。
- **執行 session**:在 OD worktree 接 OD-12;讀 od review-log + OD 模板真權威(open-design「Website V2」product-detail-rpm-template.html、daemon 若起得來)。

## 6. 本交接後續更新(2026-06-03 晚)

- **CLAUDE.md / AGENTS.md 精簡完成**(commit `154c95a`):621→174 / 544→149 行(字元 -38%);砍 SOFT 背景/列舉/重複→指標、標 Cowork-era vs 自驅 default、補「寫審分離 + worktree」實況。**鐵則 1-12 編號 + 六件套 + 「— 禁止清單結束 —」+ codex K1/K2 + 自驅 SOP 9 步結構依賴全保留**(6 個 fresh-context agent 對抗審查:結構依賴 PASS ALL、修 1 矛盾)。雙生檔同步(Codex 視角)。**新 session 自動吃精簡版;改共用規則須兩檔同步。**
- **進度地圖更新**:`docs/progress-roadmap.html` M-1 商品上架→100% done(M-1-16 完成、整合+OD 疊其上)、meta.updated 2026-06-03。⚠️ **roadmap M-2「會員系統」vs STATUS「M-1-14 會員後端」編號/範圍漂移**(地圖 M-2 是會員*功能*片〔三級價格/經銷申請〕、STATUS M-1-14 是*後端*資料層)→ 依 pcm-roadmap skill 保守未灌水、**待 Sean 對齊哪些會員功能算 done**。roadmap-data.json 在 `~/.claude/skills/pcm-roadmap/`(不入 repo)。
- **graphify 結構地圖**:本機 `graphify-out/` 停 5/31、未刷;**新執行 session 首個 code slice 跑 `/graphify --update`**。
- **push 狀態**:Sean 2026-06-03 授權 push,docs commit(`091d104` 審查 log+交接 / `154c95a` CLAUDE 精簡 / 本交接更新)上 origin/dev。整合資料線 + OD Phase A 程式碼先前已在 origin/dev=e5925db。

— END —
