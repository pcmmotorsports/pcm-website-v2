# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史. 🧹 **2026-07-27 主表精簡(Sean 拍板 A)**:主表 357 → 30 行;移出的內容**逐字保存**於 `PROGRESS.md` §「2026-07-27 STATUS 主表精簡存檔」、**零刪除零改寫**,7 欄結構完整保留。

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4b 後台重建「員工上工」線**(2026-07-26 換軌)/ **Branch:** dev。北極星(Sean 逐字)=「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」;驗收=`docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項;施工序 **E11 積木 → E8 員工權限 → E10 訂單閉環**。
✅ **本線已完成**:全後台畫面預覽 artifact(46 畫面、Sean 驗收畢、U1-U7 全拍板)/ E11-1 `<AdminDataTable>` / E11-2 `<AdminForm>` / #296 儲值金按 Enter 誤扣款 / E8-A1 staff 名單進 DB(migration 已 apply production)/ E8-A2 `/settings/staff` 員工管理頁。📌 **暫緩非作廢**(細節在 PROGRESS 存檔區):M-3 TapPay 正式化線 S3 起 / 退刷線 RF2b 起 / M-4a 通知線 B-4。
🔴 **E8 未完成**:操作者身分仍是使用者**自己下拉挑的、系統未驗證**(`apps/admin/src/lib/session/actor.ts:6` 自陳非授權邊界);後台唯一入口是報價單站的**共用密碼**登入(`ADMIN_PASSWORD` 單一 env + TOTP)再 SSO 過來,SSO payload **不帶是誰**(`apps/admin/src/lib/session/session.ts:11` 逐字)⇒ **目前沒有「每個員工的帳號密碼」這個東西**。真認證=報價單端跨 repo 線、尚未開工。

## 最後更新
2026-07-27 `0ab3897` **E8-A2 後台員工管理頁**(高風險片、鐵則 12 ②權限;已 push、零 migration、零 DB、零 flag、未動 `.env*`)+ `a8efa53` / `d2a17ad` docs。
**產出**=`/settings/staff` 新增/改顯示名/改管理者標記/停用啟用,`sean`=break-glass 永不可停用(後台自鎖的唯一結構性防線)。**分工**=Codex `gpt-5.6-sol` xhigh 寫、主對話寫規格+審 diff+自跑驗證;🔴 **Codex 用「沙箱限制」遮住一個真 build break** ⇒ 它說「因環境限制未驗證」一律當「未知」、build 必主對話自跑。**審查**=codex-adversary xhigh FAIL **7 must-fix**、逐條核對全數成立且已全修(F1 自鎖競態→break-glass / F2 stale write 復活→拆兩支 action / F3 稽核失敗謊稱成功 / F4 `is_manager` 假安全語意 / F5 手機不能操作 / F6 `database.types.ts` 缺 staff / F7 SSoT)。**驗證(主對話自跑、不採信 Codex 自述)**=三綠 8/8·10/10·2/2、full test **261 檔 3018 passed + 1 todo**、突變 4/4 全紅;🔴 突變測試必須先 `grep` 驗「替換真的發生」(本片一度把無效突變誤判成假綠)。**更早的逐片紀錄(M-3 U 線 / RF 退刷線 / M-4a 通知線 / trim 線全部)→ `PROGRESS.md` 存檔區。**

## 最近 3 commit
> dev。🏁 **2026-07-25 Sean 拍板 A:不寫死 hash 與未推數**(寫死的自指數字每多一個 commit 或每次 push 就當場變假、同款前科已 10 次)→ 一律當場執行取得:`git log --oneline -4`(第 1 行=本 commit,其後 3 行=前序)/ `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD` / `git merge-base --is-ancestor <hash> HEAD`(驗可達、防 busboy off-by-one orphan)。⚠️ `dev` = pcm-admin 的 **production** 分支,push 即部署;`origin/main` 同理不寫死。

## 下一步
🔧 **兩條路等 Sean 選**(完整交接=`docs/handoff/CURRENT.md`):
- **A. E10 訂單閉環** — 🔴 動工前必清三項:①**C1 同日分批出貨的訂單編號後綴規則未定**(新竹物流同日訂單編號不可重複、分批出貨會撞)②**`create_order` 已實證不可用於手動建單**(`:284` `auth.uid` 為 NULL 直接 exception、`:356`/`:360` 品項必須是既有 catalog 變體)⇒ 需另開 admin 專用 RPC ③schema 要吃 U1 包裹表 / U2 改單改全部 / U3 多筆匯款。
- **B. 報價單端真認證線**(跨 repo `/Users/sean_1/API大量上架/PCM報價單-V2`)— Sean 已拍 **Q1=B** 身分來自報價單 / **Q7=A** 帳號+密碼登入(TOTP 只在未記住的新裝置才要)/ **Q8=A** Sean 指定初始密碼;「TOTP 裝置=身分」方案已作廢(Q5=B 裝置有共用)。要動 4 處:users 表+登入認人 / session payload 帶身分 / SSO authorize 記錄帶身分 / exchange 回傳。**尚未開工、需另寫規格。**
- 排隊:**E11-3** 給 `<AdminDataTable>` 補 rowSpan + 互動槽(=接 `orders-table.tsx` 的硬前置;現況直接接會撞雙渲染天花板、產出重複 `<form>`)。

## Sean 待決策
🔴 **需 Sean 親自做**:①向新竹站所電腦負責人申請物流 API 帳號(**查貨與出貨是兩張不同的申請表**;`docs/reference/hct-logistics-api-reference.md` §1)②**1 元商品真刷 smoke**(驗 RF2a-0 新 trigger 沒把結帳弄壞 —— 模擬與 apply 後驗證用的**都是合成單**、整支 migration 從未被真實 `create_order` 走過)。🆕 **一題待答(非阻擋)**:是否加 CI 檢查擋 migration 版本漂移(比對本地檔名 vs remote `schema_migrations`,對不上即紅)?**A=加(機制優先律)/ B=先不加、靠人記得**。已答畢的歷史拍板 → PROGRESS 存檔區 + memory `project_m4b-*` / `project_m3-*`。

## Blocker
🟡 **M-3 prod checkout 仍不可開**(3DS flag 全 false、非硬 blocker、獨立線)/ 🟡 **M-3 階段⓪** 經銷價同步待報價單側三件就緒(合約 bump v2 + protected dealer view + least-privilege 憑證)/ 🟡 **#215** tier server 認證 defer、真死線=M-2-08 接真經銷價前。✅ **已解除**:#291 正式法律頁全鏈上線(剩 Sean 肉眼驗渲染後 payload)、0072 雙扣(經 Sean 核對為其本人開發測試單、已砍除)。

## 緊急 backlog
**#297**(破壞性金錢動作缺二次確認=#296 的完整解;🔴 建議與 E11 `<AdminModal>` 積木同片做、儲值金扣款當第一個真實消費端)/ **#293**(真機驗收缺 HTTPS 通道)/ **#291**(正式法律頁人工 release checkpoint、非開發阻擋)/ **#292**(SSoT 事實收斂單一來源)。不擋線:**#281-#286**(outbox 保留政策 / cron 清理 / bounce webhook / 文案分級 / retry hint / 死信重送)、**#295**(免運門檻與運費後台管理)。~~#296~~ ✅ 已收案。

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
