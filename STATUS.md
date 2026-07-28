# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史. 🧹 **2026-07-27 主表精簡(Sean 拍板 A)**:主表 357 → 30 行;移出的內容**逐字保存**於 `PROGRESS.md` §「2026-07-27 STATUS 主表精簡存檔」、**零刪除零改寫**,7 欄結構完整保留。

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4b 後台重建「員工上工」線**(2026-07-26 換軌)/ **Branch:** dev。北極星(Sean 逐字)=「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」;驗收=`docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項;🔴 **施工序 2026-07-27 深夜改為「E10 訂單閉環 → E8-B 認證(email+密碼)→ E8-C 2FA」**(Sean Q1=A、二次確認 Q6=A;E11 積木改為隨 E10 按需長出、不獨立成階段)。~~舊序 E11→E8→E10~~。
✅ **本線已完成**:全後台畫面預覽 artifact(46 畫面、Sean 驗收畢、U1-U7 全拍板)/ E11-1 `<AdminDataTable>` / E11-2 `<AdminForm>` / #296 儲值金按 Enter 誤扣款 / E8-A1 staff 名單進 DB(migration 已 apply production)/ E8-A2 `/settings/staff` 員工管理頁。📌 **暫緩非作廢**(細節在 PROGRESS 存檔區):M-3 TapPay 正式化線 S3 起 / 退刷線 RF2b 起 / M-4a 通知線 B-4。
🔴 **E8 未完成**:操作者身分仍是使用者**自己下拉挑的、系統未驗證**(`apps/admin/src/lib/session/actor.ts:6` 自陳非授權邊界);後台唯一入口是報價單站的**共用密碼**登入(`ADMIN_PASSWORD` 單一 env;🔴 **TOTP 實查為關閉狀態**——`auth_state.require_2fa=false`、`totp_devices` 0 列、`recovery_codes` 0 列,詳 memory `project_quote-2fa-deployed-but-dormant`)再 SSO 過來,SSO payload **不帶是誰**(`apps/admin/src/lib/session/session.ts:11` 逐字)⇒ **目前沒有「每個員工的帳號密碼」這個東西**。真認證=報價單端跨 repo 線、尚未開工。

## 最後更新
2026-07-27(**Eazi-Grip 每日同步修復已正式上線**)=根因為同商品群 spec 換位在 bulk upsert 中途撞 `pv_spec_unique`、非爬蟲漏抓;已分流 transition hazard 到單群 atomic RPC(鎖定→重驗→sentinel→孤兒刪除→完整 upsert→終態 assert),保留唯一鍵並鎖 service_role。✅ migration `20260727084801` 已 apply production + ACL/signature 驗證全綠,修復 commit `246fedd` 已推 `origin/dev`,正式單家同步成功:1686 群/5283 變體、atomic HOSEYAM005 3/3、0 孤兒/0 下架/0 價格異常;DB 終態=base 黑/BL 藍/RED 紅、sentinel 0。獨立唯讀複查 PASS。**同日較早規劃/文件 session**=①STATUS 主表 **357→30 行**(`dc46f14`;全文存 `PROGRESS.md`)②E8-B plan v3③完整後台規劃交接。
🆕 **2026-07-27 深夜 E10 規劃 session**(零 code、僅新增總規劃與交接兩份 docs):施工序改「先 E10」、Sean **P1-P4+E1-E4 八題全拍板**(訂單編號改 6 碼亂碼 / 九個壓縮碼退場改三軸 / 分三批驗收)、修掉報價單 LINE 推送**預設外洩成本價**(`bbb8e32` 未推)、查出**報價單不能跑 `db push`**(本地 146 檔 vs ledger 160 筆版本號零重疊)。E8-B plan **R2 FAIL 34 must-fix、兩輪上限用盡需重寫**。
🔴 **同日後台規劃 session 最重要發現**:報價單站的**整套 2FA 是「全公司一組」不是「每人一份」**(`totp_devices` **13 欄**(原記 14 欄=錯、07-27 production 實查更正)與 `recovery_codes` 7 欄皆無 `user_id`;`auth_state.last_consumed_step:28` 逐字「全域 TOTP 防重放」⇒ **員工 A 用掉某 30 秒窗,員工 B 同窗的合法碼會被判重放、登不進去**;2FA 管理六路由全域;「記住裝置」零實作;`login/route.ts:127-131` legacy cookie fail-open)⇒ **「動 4 處」是低估,重拆為 B0-B10 十一片**。**codex 關卡1 R1 = FAIL 17 must-fix、逐條核對全數成立、駁回 0 條**(對帳表 plan §9);主對話 v1 自己寫錯三處已更正(詳 plan §1.4/D2/D3)。**Sean 六題全拍板**(Q6=A 一路做完才上線 / Q1=A 備援唯讀 / Q5=A 只有 sean 管 2FA / Q2=A 舊裝置歸 sean / **Q3=C 帳號用 email** / **Q4 先答 B 聽完風險後改 A 強制改密碼**)。**更早的逐片紀錄 → `PROGRESS.md` 存檔區。**

## 最近 3 commit
> dev。🏁 **2026-07-25 Sean 拍板 A:不寫死 hash 與未推數**(寫死的自指數字每多一個 commit 或每次 push 就當場變假、同款前科已 10 次)→ 一律當場執行取得:`git log --oneline -4`(第 1 行=本 commit,其後 3 行=前序)/ `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD` / `git merge-base --is-ancestor <hash> HEAD`(驗可達、防 busboy off-by-one orphan)。⚠️ `dev` = pcm-admin 的 **production** 分支,push 即部署;`origin/main` 同理不寫死。

## 下一步
🔴🔴 **施工序已於 2026-07-27 深夜改為「先 E10 訂單閉環、E8-B 認證線押後」(Sean Q1=A、二次確認 Q6=A)。唯一入口 = `docs/handoff/2026-07-27-e10-order-closure-handoff.md`**;總規劃本體 = **`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`**(Sean 拍板在 §8/§4;**第 1 批片數一律以該檔 §5.1 表格 `awk` 當場數為準、本檔不寫死**,第 2/3 批開批才拆片 —— v1 就是靠寫死數字寫出 24/22 與 13/12/15 三組互相矛盾)。~~v1 `2026-07-27-…-master-plan.md` 已作廢~~;~~舊入口 `2026-07-27-admin-full-planning-handoff.md` 的施工序已被推翻~~。
- ✅ **2026-07-28:findings 已全數處理、總規劃已重寫** → **`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`**(v1 作廢)。逐條裁定 = `docs/reviews/2026-07-28-e10-k1-findings-triage.md`:去重後**唯一 findings 67 條(must-fix 62 + nit 5;原始檔把同一份清單印了兩次,「約 60」= 62 的約數)**,**駁回 0 條**,其中 3 條是「codex 對、v1 主對話技術斷言寫錯」(篩選/彙總徽章/排序)、1 條部分成立(STATUS 已同步、CURRENT 未同步→已修)。🔴 **另補 2 條 codex 沒抓到的**:①`order_items` 與 `orders` 一樣對客整表開放 SELECT ⇒ 供應商資料放品項層會把上游洩漏給客人 ②Sean 拍板「訂貨/出貨可隨時來回改」與既有 `FULFILLMENT_TRANSITIONS` 禁倒退狀態機衝突。✅ **Sean 07-28 四題全拍板、已折入 v2**:**Q1=B** 訂單層彙總狀態不維護(`orders.fulfillment_status` 凍結、不加 `backorder`、不做計數器→enum trigger ⇒ v1 的 O5 整片取消,4 條 findings 隨之消失;🔴 推翻主規格 §3.1「必須維持實體 enum 欄 + trigger 同步」)/ **Q2=A** 砍 26 張無金流單 + 3 張有金流的改號(⇒ 新增 **D1 片**、雙格式支援整片取消,編號線 3→2 片)/ **Q3=A** E10 吃下退款寫入線 RF2b-RF8(第 3 批因此變大=知情選擇)/ **Q4=A** 報價單文案已修(`36cf77c`、未推)。🔴🔴 **關卡1 已跑四輪、codex 判定「未收斂」**:R1 **67** → R2 **33** → R3 **31** → R4 **32**(findings 各存 `docs/reviews/2026-07-28-e10-k1-r{2,3,4}-codex.md`)。R4 逐字:「**未收斂**:R4 仍重複出現 R2/R3 的 D1 安全、取消閉環、計數器真相、片大小與文件同步問題」。Sean 拍 Q15=D 續折。**R5 = FAIL 26 條但性質轉變**(從文件自相矛盾 → 對 production 實查會失敗的規格)且**首次實質下降**;codex 診斷 = 主因規格深度、另 **4 項真未定需求集中在 v2 §8.6 待 Sean**(已到貨取消 / 取消原因映射 / P1 後綴下場 / HCT 允許字元)。**R5 已折入(唯一 DAG + 閉環矩陣建立)、下一步 R6**(Sean 指示:R6 之後才問 §8.6)。✅ **全貌視覺已交付並經 Sean 批准方向**(artifact `ed7a6276-70fc-44f3-b09c-61c8991b5294`;Q8=B 的動工前置之一已滿足)。🔴 **R4 抓到兩個「第 1 批設計實際不成立」的硬傷**:①取消片在包裹模型不存在時無法證明未出貨 ⇒ 照現行寫法**一件都取消不了**,卻宣稱第 19 項變綠 ②`instock_quantity` 在採購表裡**沒有到貨數量欄可推導**(R3 已提、未修)。🔴 **第 1 批現為 40 片**(片號與片數**一律以 v2 §5.1 表格 `awk` 當場數為準**,本檔不再複製清單;14→26→31→34→40 = 五輪審查逐步重拆;~~O0-O7~~ 作廢)。🔴 **D1 是唯一不可逆片**:前有 Sean 獨立批准閘;`payment_charge_attempts` 待刪 24 / 留存 3,**`pending_invoices` 3 筆全屬留存單、一筆都不能動**(~~舊寫法「必須先清才可 DELETE」是錯的~~);待刪組含 **3 筆 `pending` 刷卡紀錄**(0064/0090/0101,合計 NT$51,100)—— **Sean 07-28 確認「都沒扣到錢」拍 Q7=C 照刪**,證據等級=Sean 查 TapPay、非系統 read-back。v1 原始抽驗三條備查:①`internal_note` 放 `orders` 會洩漏給客人(`20260604120000…:190` 逐字 `GRANT SELECT ON TABLE orders TO authenticated` 整表全開)②**P2 建議與已拍板的 U7「Phase 1 人工查+手標已送達」直接衝突**(主對話流程錯誤;**已重問→Sean 拍 B「送達完全不做」= override U7=A**,連動不加 `delivered` enum 與 `delivered_at` 欄,三份檔已同步)③6 碼碰撞機率報錯(實為 5 碼 23.0% / 6 碼 0.929%,非 12.6%/0.4%;結論用 6 碼仍成立)。依鐵則 8/12,**Sean 批准 + 關卡1 通過 + 視覺全貌過目(已完成)三閘全過才動第一片 code**;輪次上限已由 Q8=B 解除。
- **E10 第 1 批片數以 v2 §5.1 為準**(P4=B 分三批、每批 Sean 肉眼驗;~~舊 O0-O7 片號全數退場~~)。起點 = **A0a/A0b/A0c 現況重驗**(orders 筆數、E11 積木採用度、27 項逐項重驗),其後 **D1 前有 Sean 獨立批准閘**。🔴 **R3 = FAIL 31 must-fix + 2 nit**(`docs/reviews/2026-07-28-e10-k1-r3-codex.md`),Sean 07-28 再拍 **Q10=A 包裹獨立編號**(解 P1 與 U1 衝突:併箱時沒有唯一基底訂單號)/ **Q11=C 文件二分**(施工規格給 AI 深寫、全貌給 Sean 走視覺)/ **Q12=B 前台改顯示「處理中」**(Q1=B 後 `fulfillment_status` 停止維護,但**全樹 8 處仍在讀、其中 2 處在客人前台** `OrdersTab.tsx:45`·`OverviewTab.tsx:108`)。
- **E8-B 押後**:Q5=A 第一期只做 email+密碼(2FA 另立 E8-C)⇒ 11 片縮為約 8 片;🔴 plan v3 經 codex 關卡1 **R2 FAIL 34 must-fix**、兩輪上限用盡,**判定需重寫**。🔴 新增硬前置:**報價單不能跑 `db push`**(本地 146 檔 vs ledger 160 筆版本號零重疊)。
- **E12 供應商主檔 Q2=B 這期不做**(報價單 `suppliers` 16 列實為改裝品牌、非下單對象)。

## Sean 待決策
🔴 **需 Sean 親自做**:①向新竹站所電腦負責人申請物流 API 帳號(**查貨與出貨是兩張不同的申請表**;`docs/reference/hct-logistics-api-reference.md` §1)②**1 元商品真刷 smoke**(驗 RF2a-0 新 trigger 沒把結帳弄壞 —— 模擬與 apply 後驗證用的**都是合成單**)。🆕 **需 Sean 批准才動 code**:E10 施工規格 **v2**(`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`;~~v1 已作廢~~)—— 關卡1 通過後送批;另有 **v2 §8.6 四題待 Sean 拍板**(R6 之後一次問)。🔴 **申請 HCT API 時要勾「用新竹貨號查詢」、不要勾訂單編號**(官方文件:只能擇一、申請時即選定、要改須聯繫營業所)。~~07-27 三題(施工序 / N9 / E8-B 承載方式)~~ **已於當晚全數拍板**(Q1=A 先 E10 / Q2=B E12 不做 / Q3=C 混合),連同 P1-P4+E1-E4 八題,全表見交接檔 §3。**非阻擋舊題**:是否加 CI 擋 migration 版本漂移(**A=加 / B=靠人記得**;🔴 本輪查出報價單已嚴重漂移、`db push` 不可用,此題價值上升)。已答畢拍板 → memory `project_m4b-real-auth-line-decisions` / `project_m4b-*` / PROGRESS 存檔區。

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
