# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4a 後台第一期**(訂單+客戶+SSO;admin.pcmmotorsports.com LIVE)進行中。
**M-4a V 線 ✅ 全收工上 production**(V-1~V-3b:購物車/PDP 選車 §7 保守適用比對 + order_items.vehicle_snapshot 持久化硬閘〔create_order RPC 相鄰〕+ admin 訂單列表車款欄直出 + taxonomy 車款節點 NFKC 統一;三模型鏈 Codex 寫→Opus 審+prod 交易模擬→Fable 終審)。連帶 **P4+S4 目錄年份卡片 + priceMax=0 修**隨本次 FF 一併上線=/products preview gate 已解除(剩 Sean 正式站肉眼驗)。前一主線 **M-3 結帳 3DS 重設計整線 ✅ 全落地**(flag 全 false、🔴 prod checkout 仍不可開=真刷卡待 sandbox 3DS E2E + Sean 驗收)。V 線逐片流水+M-3 巨段已歸 PROGRESS.md。
**下一階段=M-4a 第一期收口(Sean 07-16 拍優先序:①客戶線→②Email→③最新商品、④小件穿插)**。**客戶線前四片 ✅ 全收工上 production**:列表 → 明細-a `30659b8` → 明細-b `675b949` → 儲值金編輯 `afea2b7`(🔴 動錢硬閘全程走完:關卡1 PASS→codex 兩輪→Sean 拍 D1=A island 保留/D2=A 上界 1000 萬→Sean db push `20260716210000`→值班台 prod 交易模擬全 PASS〔ACL allowlist/26 攻擊樣本零寫入/零留痕〕→代推→`dev:main` FF)。**剩最後一片=tier 編輯**(🔴 高風險件#3、先 plan 過關卡1);交接=`docs/handoff/2026-07-16-m4a-wallet-close-production-push-kickoff.md`。
**Branch:** dev

## 最後更新
2026-07-16 — 值班審查台收尾(**客戶線四片審畢代推+正式站 FF**):明細-a/b 快掃 PASS(scoping `.eq('customer_user_id')` 親讀 adapter 本體驗實;#278 unpaid 揭示);儲值金編輯硬閘全程=Sean db push `20260716210000` 後 prod 交易模擬全 PASS(合成 auth.users→trigger 建 customers、快樂路 3 筆 audit before/after 精確、5c `vip客戶v` 首尾保留、**26 樣本拒收矩陣全 RAISE 零寫入**〔Unicode 空白 6 種〕、NOT_FOUND、ROLLBACK 零留痕);D1 撞板解=Sean 重拍 A(island 保留、DB 去重進 backlog);Sean 明說授權 `dev:main` FF 上 production。慣例確立=**代推一律乾淨 worktree**(live 樹施工汙染 husky 誤殺)+跨視窗拍板走 directive 單。
2026-07-16 — Claude Code session(**M-4a 儲值金編輯**〔客戶線第 4 片、🔴 高風險動錢〕:plan 過值班台關卡1(R1 PASS 0 must-fix、3 note 折入)→ 實作=①migration `20260716210000` 新 `admin_adjust_wallet` owner RPC(鏡像 20260714130000;SECURITY DEFINER+REVOKE→GRANT service_role only+fail-closed DO 斷言;deposit>0/use<0 符號閘、refund 拒收、備註必填〔Unicode 空白集 v_ws 擋 NBSP/全形/零寬繞過〕、單筆上限 1000 萬、`FOR UPDATE` 鎖列 before/after 快照、ledger INSERT+audit INSERT 同交易、**函式體零 UPDATE customers**=餘額只走既有 trigger、允許負餘額=Q1 拍板)②admin 端 `wallet-form.ts` 解析層(21+ 測)+`wallet-actions.ts` PRG action(log 不記金額備註)+明細頁儲值金卡表單(submit 鈕 client island pending disable)③`authorizeAdminMutation` 原封抽至 `session/authorize.ts` 供兩域共用④`getAdminWalletRepository` write 槽毒化(寫入唯一路=RPC、防繞 audit 直插;apps/admin addEntry 0 呼叫點、全 repo 1 處=未接線 use-case)。審鏈=code-reviewer R1 PASS(4 Minor:2 揭示進 commit body、2 known-issue)→ codex 關卡2 R1 FAIL 2 findings(F1 double-submit 無 DB 去重→前端 disable 落地+DB 級=D1 決策題;F2 Unicode 空白→全修)→ R2 FAIL 2 findings(`E'\v'`=PG 不支援、會誤刪備註首尾字母 v→改 `\013`;D1 落 STATUS=本 commit)→ 硬上限不跑 R3、v_ws 正確性斷言入交易模擬清單 5c 由值班台覆核。三綠+build admin+full vitest 217 檔 2322 綠。**migration 未 apply=硬閘:D1 拍→Sean db push→值班台驗(ACL+交易模擬清單=migration L186 起)→才放行推**。)
2026-07-16 — Claude Code session(**M-4a 客戶明細-b**〔客戶線第 3 片、唯讀〕:明細頁補齊訂單歷史+收件地址+車庫三 section=Sean「全放」後半。訂單歷史復用既有 `listSummariesByCustomer`(OrderListItem 摘要投影、型別層零經銷價欄、單號連 `/orders/[id]`);地址(發票三型條件顯示)/車庫(V-1d dict 欄唯讀 badge、成對 guard)復用 `SupabaseAddressAdapter/SupabaseVehicleAdapter.listByCustomer`(admin 注 service_role、scoping=顯式 eq 親驗);page 擴 5 源 allSettled+settle helper 各區分開容錯。⚠️ 已知限制揭示=**#278 新開**:訂單歷史沿用 #249 隱含濾 unpaid(該客待付款單本頁查無、admin /orders 篩選看得到;admin 專用含 unpaid 查法另片)。+1 測(ADDRESS_INVOICE_LABEL);三綠+full vitest 216 檔 2312 綠+build admin;code-reviewer R1 FAIL〔2 must-fix=unpaid 濾單未揭示+order-repository docstring 過期〕→修〔揭示註解+#278+docstring 三 method 校正〕→R2 fresh PASS〔R1 4 findings 逐條核+scoping 實核〕+R2 Minor〔company 發票單欄殘尾〕已順手修。未 push、無 migration。)
2026-07-16 — Claude Code session(**M-4a 客戶明細-a**〔客戶線第 2 片、唯讀〕:新 `/customers/[id]` 明細頁=基本資料(email/電話/生日/tier/註冊日)+儲值金(餘額/累積+流水表);組合既有 service_role adapter(`findById`+`SupabaseWalletAdapter.listEntries` 雙槽注 service_role、零 domain/port/adapter 改動);鏡像 orders/[id] 慣例=UUID 守門不打 DB/allSettled 分開容錯/loadFailed 200/查無 404/流水失敗誠實錯誤態;列表姓名連結明細。🔴 儲值金顯示=Sean 07-16 拍板 admin 後台可顯(override 05-31 前台 hold、範圍僅 admin、memory `project_wallet-deposit-taiwan-legal-hold` 已記 override;本片唯讀零寫入、addEntry 零呼叫點 grep 驗);鐵則 12 不觸發理由=唯讀顯示、零 schema/RPC/GRANT、無 pricing 運算、customers/ledger 表無成本欄。+7 測(UUID 守門/類型標籤/金額格式);三綠+full vitest 216 檔 2311 綠+build admin;code-reviewer R1 FAIL〔1 must-fix=repository docstring 字面失效〕→修→R2 PASS。未 push〔done 單丟 review-inbox 等值班台代推〕、無 migration。)

## 最近 3 commit
> dev。本 commit 見「最後更新」;下表列 3 個已可達前序 commit。🚀 origin/main = 本 commit(dev:main FF、production)。
| Hash | 訊息 | 時間 |
|---|---|---|
| `afea2b7` | feat(admin): 儲值金編輯 加值扣款 owner RPC+明細表單 [m-4a] | 2026-07-16 |
| `675b949` | feat(admin): 客戶明細-b 訂單歷史+地址+車庫 [m-4a] | 2026-07-16 |
| `30659b8` | feat(admin): 客戶明細-a 基本資料+儲值金顯示 [m-4a] | 2026-07-16 |

## 下一步
**M-4a 第一期收口(Sean 07-16 拍:①客戶線→②Email→③最新商品、④小件穿插)**:①**客戶線**剩最後一片=**tier 編輯**(🔴 高風險件#3=service_role 寫 customers.tier+audit+**step-up**、鐵則 8;新執行視窗首件=偵察 pass→plan 丟 review-inbox 過關卡1 才動工;偵察已知=audit_log 已 apply 在用/actor 現為過渡 cookie 待接真 SSO session/step-up 門檻 plan 時給 Sean 拍;tier 後台寫不需 #215 前置=07-13 分析。順手欠帳三件=儲值金 DB 去重 backlog 條目/OrderAdapter docstring 一行/詳交接 §3)。②**Email 通知片**(plan=`docs/handoff/2026-07-13-email-notification-slice-plan.md`;🔴 動工前先給 Sean 決策題「觸發點碰不碰金流 RPC」)。③**最新商品**(storefront 例行 UI)。④小件穿插=Q3d 佔位圖/Q3a 佔位頁/Q3e 結帳內嵌地址。獨立線(未排):搜尋 S2 lightech #275→S3 MVP;M-3 真刷卡 gate。M-4a 收尾後開 Sean 交代「流程再優化」正式題。

## Sean 待決策
①**Email 片觸發點碰不碰金流 RPC**(plan 內建議=outbox 不進訂單交易、不碰 create_order;動 Email 片前拍)。②(到 tier 編輯 plan 時拍)step-up 二次驗證門檻(auth_time 多久算近期+過期 re-auth 動線)。③(非阻擋)車款搜尋繼承件卡片是否併 inherited 年份=R3、日後另議。(儲值金 D1=A island 保留+DB 去重進 backlog/D2=A 上界 1000 萬——07-16 已拍、銷案,詳 memory。)

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
