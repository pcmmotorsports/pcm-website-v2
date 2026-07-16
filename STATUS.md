# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4a 後台第一期**(訂單+客戶+SSO;admin.pcmmotorsports.com LIVE)進行中。
**M-4a V 線 ✅ 全收工上 production**(V-1~V-3b:購物車/PDP 選車 §7 保守適用比對 + order_items.vehicle_snapshot 持久化硬閘〔create_order RPC 相鄰〕+ admin 訂單列表車款欄直出 + taxonomy 車款節點 NFKC 統一;三模型鏈 Codex 寫→Opus 審+prod 交易模擬→Fable 終審)。連帶 **P4+S4 目錄年份卡片 + priceMax=0 修**隨本次 FF 一併上線=/products preview gate 已解除(剩 Sean 正式站肉眼驗)。前一主線 **M-3 結帳 3DS 重設計整線 ✅ 全落地**(flag 全 false、🔴 prod checkout 仍不可開=真刷卡待 sandbox 3DS E2E + Sean 驗收)。V 線逐片流水+M-3 巨段已歸 PROGRESS.md。
**下一階段=M-4a 第一期收口**:①客戶線(admin 客戶 tab + tier 編輯高風險片)②Email 通知片 ③最新商品;優先序待 Sean 拍(候選+分工模型見 `docs/handoff/2026-07-16-m4a-vline-close-next-phase-kickoff.md` §3/§5)。
**Branch:** dev

## 最後更新
2026-07-16 — M-4a V 線全收工上 production(執行 session + 值班審查台收尾):V-3a order_items.vehicle_snapshot 持久化硬閘(DB `20260716180000`+`190000` 6v 白名單逐 kind 隔離、不擋單)+ V-3b admin 列表車款欄 + create_order 車款欄型別閘強化(`20260716200000`)+ taxonomy NFKC 識別。審驗鏈=Codex 寫→Opus 審+prod 庫交易模擬 9 攻擊樣本零留痕→Fable 終審 PASS 0 must-fix→Sean db push 全 apply+真機驗→`dev:main` FF 上正式站。**dev=origin/dev=origin/main=`b6c97fd`、DB 至 `20260716200000`(全 apply)、零待推零待審**。V 線逐片原文=PROGRESS.md「2026-07-16 增補歸檔」。

## 最近 3 commit
> dev。🚀 origin/main = `b6c97fd` production(dev=main 對齊、零待推)。
| Hash | 訊息 | 時間 |
|---|---|---|
| `b6c97fd` | fix(storefront): 統一 taxonomy 車款節點 NFKC 識別 [m-4a] | 2026-07-16 |
| `cd79939` | fix(medusa): 強化 create_order 車款欄位型別閘 [m-4a] | 2026-07-16 |
| `69de8e7` | feat(admin): V-3b 訂單列表車款欄 vehicle_snapshot 直出 [m-4a] | 2026-07-16 |

## 下一步
**M-4a 第一期收口(優先序待 Sean 拍;值班台推薦 1→2→3,4 穿插)**:①**客戶線**=admin 客戶 tab + tier 編輯(🔴 高風險件#3=service_role 寫 customers.tier+稽核+step-up、鐵則 8→先偵察 pass 再提 plan 過值班台關卡1;tier 後台寫不需 #215 前置=07-13 分析);拆片 客戶列表〔唯讀〕→客戶明細→tier 編輯〔硬閘單獨一片〕。②**Email 通知片**=下單成功+出貨(outbox 表+sweep cron+Resend 復用;plan=`docs/handoff/2026-07-13-email-notification-slice-plan.md`;🔴 動工前先給 Sean 決策題「觸發點碰不碰金流 RPC」)。③**最新商品**(storefront 例行 UI)。④小件穿插=Q3d 佔位圖/Q3a 佔位頁/Q3e 結帳內嵌地址。獨立線(未排):搜尋 S2 lightech #275→S3 MVP;M-3 真刷卡 gate。M-4a 收尾後開 Sean 交代「流程再優化」正式題。

## Sean 待決策
①**下一階段優先序**(kickoff §3 標號 1-6;值班台推薦 1→2→3 收 M-4a 第一期、4 穿插)。②**Email 片觸發點碰不碰金流 RPC**(plan 內建議=outbox 不進訂單交易、不碰 create_order;動 Email 片前拍)。③(非阻擋)車款搜尋繼承件卡片是否併 inherited 年份=R3、日後另議。

## Blocker
**🔴 0072 雙扣待 Sean W1 退款**(open):PCM-2026-0072 舊+0073 新各 17,300、W1 報表已偵測為 open anomaly→Sean 依 runbook(claim→TapPay Dashboard 退舊→resolve);非程式 blocker。
**🟡 M-3 prod checkout 仍不可開**:3DS flag 全 false、真刷卡待 sandbox 3DS E2E + Sean 驗收(非硬 blocker、獨立線)。
**🟡 M-3 階段⓪(經銷價同步/店家價 checkout)**:硬 gate 待報價單側三件就緒(合約 bump v2 + protected dealer view + least-privilege 憑證;非硬 blocker、訂單地基先行)。
**🟡 #215 tier server 認證**:defer,真死線=M-2-08 接真經銷價前(07-13 分析:現況零洩漏)。

## 緊急 backlog
無(不擋線 backlog:Fable F1 表級 CHECK / F2 哨兵 md5 / create_order p_invoice 自由欄型別 / admin 明細頁未顯 vehicle_snapshot / V-2g 雙擊縮放刻意未做,詳 kickoff §4)

---

## OD 商品頁改造線(並行 workstream、Claude-Code 自驅、不入主表)

> 與報價單資料線(S3a/S3b)並行的另一條線。**主表 7 欄由報價單線擁有**、OD 線狀態記此附屬區 + manifest `od_redesign`(Sean 2026-06-02 拍 A)。寫審分離 ROLE=A(施工 session 實作、審查 session 哨兵盯 dev 自動 fresh-context 複驗)、**不跑 busboy-end**(避 clobber 報價單線)、Sean 手動推。

- **視覺真權威:** OD 模板 `product-detail-rpm-template.html`(open-design "Website V2")+ `HANDOFF-rpm-template.md`。鎖定決策見 manifest `od_redesign.decisions`(決定一=A OD=視覺真權威 / D1=A 適用車款表全車種 3 欄無車系 / D3=A 12K 收進紋路無消光、由真資料 disable / Q1 override:N°03 留相關商品 + FAQ→N°04)。
- **當前 slice:** **Phase A 完成 ✅ + 已合併進 dev(merge cf630b2)**。OD-5 服務橫條 / OD-6 N°01 / OD-7 N°02 紋路牆+預覽卡+圖庫聚合 / OD-8 分頁碳纖維化 / OD-9 N°03 相關商品 / OD-10 N°04 FAQ+JSON-LD(保固共用 rpm-policies 單一真相)/ OD-11 buybar OD §12+響應式≤1079,共 11 片(OD-5~11)+ 先前 OD-1~4 全完。合併後三綠 + 完整 pnpm test 531 全綠,OD 元件 × S6 fitments 共存確認。
- **下一步:** ✅ **OD 線已收尾**(2026-06-16 查核更新):OD-12 適用車款表 + OD-12b/c/d 桌機重設計 + OD-13 FAQ + OD-V~V3b 手機/iPad 真機驗收修正**全部完成、併入 dev、已推 origin/dev**(`dev..od-redesign` 空、od-redesign tip `266f5f2` 在 origin/dev、審查 PASS `9cc5bbd` + 交接 `f3d6a42`)。此附屬區先前「OD-12 待做」字面為過時殘留、已更正。後續 OD 強化由 Sean 主導視覺(memory sean-owns-visual-design)。
- **Phase A 連續做(Sean 拍 B):** OD-3~OD-11 全速連續 commit、Sean Phase A 全完肉眼驗一次、哨兵每片自動審 FAIL 即通知。
- **分片清單:** Phase A(現做、不等 S3)OD-1→OD-11(地基/Hero/右欄/Picker+預覽/服務橫條/N°01/N°02紋路牆/分頁/N°03相關/N°04 FAQ/buybar+響應式);Phase B(等 S3b)OD-F1 適用車款表(接 fitments[])/ OD-F2 真資料收口。完整 OD區塊↔元件對照 + 計畫見對話 OD-0 偵察報告(待 Sean 點頭存 docs/specs/)。
- **⚠️ 跨線紀律:** OD 線不碰 `scripts/rpm-*.ts`(報價單線 WIP)、`docs/reviews/integration-phase1-review-log.md`(審查 session)、`docs/specs/*S3*`(報價單線)。

## 速查 / 歷史(已外移、降低本檔讀取成本)

- **速查**(Phase 1 範圍 / 技術棧 / 關鍵路徑)→ `docs/quick-reference.md`
- **變更紀錄**(slice 逐筆歷史)→ `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段

## 文件交叉引用

每次新對話依此順序對齊上下文:

1. **`STATUS.md`** ← 本檔(每次先讀)
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `CLAUDE.md` — Claude Code 工作規則
5. `docs/PHASE-1-MILESTONES.md` — milestone 排程
6. `docs/decisions/` — 重大決策記錄
7. `docs/patterns/` — 通用 + PCM 專屬規矩
8. `docs/phase-1-backlog.md` — 未決事項
9. `docs/features/*.md` — PRD
10. `design-reference/` — 視覺真權威字面(submodule)
11. `PROGRESS.md` — 歷史紀錄
12. `docs/quick-reference.md` — 速查(Phase 1 範圍 / 技術棧 / 關鍵路徑)

衝突仲裁順序:
- STATUS.md 與其他 md 衝突 → STATUS.md 為準
- 其他 md 與對話歷史衝突 → md 為準
- 視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
- 業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準

## Busboy 機制(沿用第一輪)

- **busboy-start.js:** Sean 在 Terminal 跑、輸出貼新 Claude Code session 第一則訊息
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 5 個欄位(最後更新 / Phase Milestone slice Branch / 最近 3 commit / 下一步 / Sean 待決策)、commit、不 push(Sean 手動推當 review checkpoint)
- ⚠️ WO-6 後「變更紀錄」已移 `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段、不再寫本檔;busboy-end.js 若仍寫 STATUS 變更紀錄表需同步改寫(pcm-tools 外部 repo、待 Sean 處理)
- repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit。

— END —
