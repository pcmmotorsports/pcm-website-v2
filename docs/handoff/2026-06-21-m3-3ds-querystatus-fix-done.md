# 2026-06-21 M-3 3DS querystatus-fix 完成 + 真刷驗證通過 交接

> 寫審分離 ROLE=A 審查側收尾交接。fix 已 sign-off PASS + Sean 真刷驗證通過;本檔交下一步。
> 真權威 = STATUS.md「下一步」+ 設計包 `docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md` §7。

---

## 1. 本輪做了什麼(critical bugfix、非設計包 §7 排程內)

**起點**:Sean 用 ngrok + prod build 真刷 sandbox 3DS(PCM-2026-0018),3DS OTP 過、TapPay 後台**已授權**,但網站訂單永遠卡「待付款」、輪詢頁永遠「處理中」不跳。

**root cause**:[settle-charge.ts:85](../../packages/use-cases/src/settle-charge.ts#L85) `record.queryStatus !== 0` 把 TapPay 查詢 API **成功態** top `status=2`(官方逐字「已無更多分頁」、查詢成功、≠交易狀態)誤殺成「查詢失敗」→ 到不了 classifyRecordStatus → **所有 3DS 授權成功單卡 pending、S1「授權即成立」實際從未生效**。bug 被 test L151-153「queryStatus=2→unverified」固化、三綠恆綠無人察覺。

**fix**(commit `22f780b`、分支 `m3-3ds-qsfix`):抽 named helper `isQuerySucceeded(s)=s===0||s===2` 白名單放行 `{0,2}`(fail-closed、非拿掉檢查);count===1 + records.length===1 + recordMatchesOrder 三重縱深全保留;**對帳脊椎(classifyRecordStatus/recordMatchesOrder/settlePaid/markFailed)零變更**;字面同步(domain types/wire/PollOrderStatus active docstring + 設計包/S2 plan supersede)+ 8 條回歸測(R1-R5b + adapter A1/A2 + 改 L151-153 移 bug 固化)+ observability console.warn 零 PII。

**流程**:plan `cb43cc3`(codex K1 r1 FAIL→fold v3→r2 安全 PASS、文書全 fold)→ 執行 session worktree `m3-3ds-qsfix` 實作 `22f780b` → 審查側 fresh-context 審 + fresh 三綠(typecheck 7 + lint 10 + **vitest 1395**)+ **codex K2 跨模型 PASS 0 finding 6 維** → sign-off `d6b5a74`(review-log)。

**驗證(Sean 真刷)**:merge + rebuild 後重刷 **PCM-2026-0019(NT$ 20,400、Auth Code 853010)→ 馬上「處理中」成立** ✅。

## 2. 🔴 重大發現(影響後續規劃)

- **S1「授權即成立」此前從未生效**:被 L85 queryStatus 閘擋在 classifyRecordStatus 之前。今天才真正生效。
- **🔴「Record 同步延遲」歸因錯誤**:PCM-2026-0019 修後 callback **首次即成立**(無需等輪詢/webhook/sweeper)→ 證明設計包 §5.1 / S2 plan 假設的「Record API 同步延遲(queryStatus=2 查無 → 等幾秒變 0)」**不存在**、真因純為 L85 bug。→ **後續可 revisit S2 輪詢 / S2b 主動 settle 的必要性(可能可簡化)**;本 fix 不動 S2/S2b、僅記觀察(fix plan §8)。

## 3. git 狀態(待 Sean 操作)

- `dev` = `d6b5a74`(plan `cb43cc3` + sign-off `d6b5a74`;領先 origin/dev=`50aa20f` 共 3:f6db42c + cb43cc3 + d6b5a74)。
- `m3-3ds-qsfix` = `22f780b`(fix、base cb43cc3)。
- **待 Sean**:① `git checkout dev && git merge --no-ff m3-3ds-qsfix`(fix 的 STATUS 隨之入 dev)② 手動 push origin/dev ③ merge 後 STATUS「當前 slice」的「未 merge」可順手 inline 為「已 merge+驗證通過」(小瑕疵、非必要、busboy/下個 slice 會重整)。

## 4. forward 義務 / 紅線(不變)

- **prod checkout 仍不可開**:3DS flag-gated 僅 sandbox;同步刷卡 status 75 必失敗。正式開放 = S6 + Sean dashboard。
- **S6 db push 債務**:S2b migration `20260621120000`(last_poll_settle_at + claim_order_poll_settle RPC)Q2=A 未 db push、留 S6 統一推。本 fix **零 migration/db push**、不影響此債務。
- **舊 pending 測試單**(PCM-2026-0018/0017/…)= fix 前遺留、TapPay 已授權但網站未回補;sandbox 測試單可忽略,或重整其 callback 輪詢頁觸發一次 settleCharge 補成立;生產由 sweeper(S6 開)自動回補。
- **對帳脊椎紅線**:settle-charge.ts 的 classifyRecordStatus / recordMatchesOrder / settlePaid 非結算 slice 不碰;IDOR own-only 雙軸;payment_confirmer 窄權 RPC;金流端點零 PII。

## 5. 下一 slice 候選(設計包 §7、定序待 Sean 拍)

| slice | 內容 | 鐵則 |
|---|---|---|
| S4 | in-flight 鎖逾時/釋放檢視(成立變快後 10min user_in_flight 窗應縮短)| 🔴 12 |
| S5 | 訂單成立通知(email)| 後端 |
| S6 | 部署 sweeper cron(生產 `CRON_SWEEPER_ENABLED`)+ 3DS migration bundle db push | 部署 |
| (新)| revisit S2/S2b 輪詢必要性(§2 發現:無 Record 延遲、callback 首次即成立)| 規劃 |

---

*審查 session(寫審分離 ROLE=A)收尾交接／2026-06-21／querystatus-fix sign-off PASS + 真刷驗證通過*
