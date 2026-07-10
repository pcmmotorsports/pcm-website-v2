# 文件債候選清單(2026-07-03 CLAUDE.md 瘦身時盤出)

> 性質:**標記不代刪**。每條都是 Sean 決策題;建議下次動到該檔的 slice 順手提 multi-select。
> 來源:CLAUDE.md 瘦身前對三個舊 @import 檔的全文結構掃描(subagent 實讀,非印象)。

| # | 檔案:位置 | 問題 | 若不處理會痛在哪 |
|---|---|---|---|
| 1 | `docs/working-style.md` §6.1(約 L206) | 寫「四件套」,與現行「六件套」規範不一致 | 新 session 讀到舊格式,寫出缺件的 slice 指令 |
| 2 | `docs/lessons-learned.md` §12 全部 + `docs/working-style.md` §6.3 | 大量條目以「Claude.ai(Cowork)寫指令、Claude Code 執行」雙角色框架書寫;現行預設是 Claude Code 自驅 SOP,執行者身分已合併但文字前提未更新 | 新 session 誤以為 Cowork 是必經角色、等待不存在的指令 |
| 3 | `docs/working-style.md` §8(L576-616) | 分工邊界只列四方,缺 Codex,與 CLAUDE.md/AGENTS.md 現行五方分工不一致 | 判斷「這事該誰做」時漏掉 Codex 審查環節 |
| 4 | `docs/PHASE-1-NORTHSTAR.md` §6(L266-317) | 「新 Claude Code 第一天的工作」bootstrap 步驟(design 偵察→PRD→milestones)早已完成,仍以待執行語氣存在 | 新 session 誤跑 bootstrap、重寫已存在的 milestones |
| 5 | `docs/PHASE-1-NORTHSTAR.md` §1.2(約 L61) | 「自訂網域綁定(Phase 1 跑 Vercel preview URL 即可)」與 2026-07-02 已拍板的 shop.pcmmotorsports.com 副網域上線方向矛盾 | 範圍判斷引用過時邊界 |
| 6 | `docs/PHASE-1-NORTHSTAR.md` §5(約 L255) | 「checklist 詳見舊 repo docs/phase-1-backlog.md #33(新 repo 啟動時搬進來)」——2026-07-03 對抗審查實查:現 repo `docs/phase-1-backlog.md` 的 #33 指向不相關條目,引用已斷鏈 | 上線判斷時照引用找到錯的條目而不自知 |
| 7 | `docs/lessons-learned.md` §12-23(L840-863) | 校正 skill 名寫「requesting-code-review + accessibility-review」雙跑;現行 SOP 已改 code-reviewer subagent,字面可能二度漂移 | 收尾流程照舊字面跑錯 skill |
| 8 | `docs/working-style.md` §6.3 末 | lessons §12-37 明寫「working-style §6.3 對應條(待新增)」但從未補——已知缺口 | 兩檔對照時以為漏抄,浪費查證時間 |
| 9 | `CLAUDE.md` 鐵則 8/12 觸發語 | 弱模型誤讀模擬(Sonnet 實測)指出兩處語意觸發易漏判:①鐵則 12「動 schema·API」字面寬、SOP 步⑦ 執行清單窄(security/RLS/migration/pricing/order/payment/tier/經銷價),已加分流澄清句但寬窄差異本身待 Sean 拍板統一;②鐵則 8「共用元件」與鐵則 12「進度單元收尾」靠語意判斷,建議外部訊號化(例:grep import 命中 ≥2 個頁面 = 共用元件) | 弱模型漏產 Packet 或漏提 plan,審查網出現系統性漏洞 |
| 10 | `AGENTS.md` L44-54 六件套段 | 六件套全文現存兩份(AGENTS.md + `docs/patterns/slice-instruction-six-piece.md`),違反本檔「不維持雙份全文」原則;且 AGENTS.md 六件套段的依賴方註記仍列「CLAUDE.md」(本體已不含全文、只剩摘要+路由) | 兩份各自演化再度漂移;依賴註記誤導查證 |

處理原則(承 `~/.claude/rules/00-work-rules.md` §4「同一教訓不寫兩處全文」;原 40-maintenance.md 已於 2026-07-10 併入該檔):修復時一處保全文、他處改單行指標,不再維持雙份全文。
