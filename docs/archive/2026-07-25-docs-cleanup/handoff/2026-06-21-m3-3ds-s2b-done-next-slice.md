# 2026-06-21 M-3 3DS S2b 完成交接 + 下一 slice 起步（審查 session 收尾交接）

> 審查 session（寫審分離 ROLE=A）收尾交接。S1/S2/S2b 已完成 merge;本檔交下一 slice 的新 session 起步對齊用。
> 真權威 = STATUS.md「下一步」+ 設計包 `docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md` §7。

---

## 1. 已完成（M-3 3DS「授權即成立」重設計主線）

| slice | 內容 | 狀態 |
|---|---|---|
| S1 | settleCharge 成立門檻改「授權即成立」（classifyRecordStatus case 0/1→paid_candidate）+ 收緊弱識別雙扣窗 | ✅ merge dev `5693b9a` |
| S2 | callback 自動輪詢 + 處理中文案安撫（PollOrderStatus.tsx + GET payment-status 端點、default A 只讀狀態）| ✅ merge dev `e7ff4eb` |
| **S2b** | **輪詢端點主動 settleCharge（第四路 caller）+ per-order durable throttle（Sean Q1=B）** | ✅ commit `e41aa00`、Sean merge+push dev 中 |

**S2b 審查結論 = ✅ PASS（四角度收斂、0 must-fix）**:Claude 手動關卡2 + 獨立 MCP 交易模擬 9/9 + codex K2 跨模型 VERDICT=PASS 0 finding + plan 階段 5 視角探針 5/5 REFUTED。三綠 vitest 1382。完整 sign-off 見 `docs/reviews/m3-3ds-review-log.md`（審查 session working doc、未 commit）。

## 2. 🔴 forward 義務 / 待辦（下一 session 必知）

- **🔴 db-push 債務**:S2b migration `20260621120000_m3_3ds_s2b_poll_settle_throttle.sql`（last_poll_settle_at 欄 + claim_order_poll_settle RPC）**Q2=A 未 db push**、正式環境暫無此 RPC（端點 fail-closed skip→退回只讀、安全）。**留 S6 開正式結帳時與其他 3DS migration 統一推**。在那之前「幾秒無感成立」在正式環境未真生效（plan 已揭示）。
- **prod checkout 仍不可開**:3DS 結帳 flag-gated（isThreeDSEnabled、僅 sandbox/staging）;同步刷卡 status 75 必失敗（merchant 強制 3D）。正式開放 = S6 + Sean dashboard。
- **S2b cosmetic nit（非阻擋）**:STATUS S2 子條目「不呼 settleCharge 只讀狀態」採 header 層 supersede（「Sean Q1=B 已於 S2b 落地」），未如 manifest 做 inline 加註;可順手 inline 化求一致、非必要。

## 3. 下一 slice 候選（設計包 §7 草案、定序 = Sean 拍板）

| slice | 內容 | 類型 / 鐵則 |
|---|---|---|
| **S3** | 訂單列表顯示付款狀態（pending / 成立 / 失敗）| 前端 + 讀路徑（接 OrdersTab 真訂單摘要清單、memory `project_m3-orders-list-execution-session`）|
| S4 | in-flight 鎖逾時/釋放策略檢視（成立變快後 10min user_in_flight 窗應大幅縮短）| 🔴 鐵則 12 |
| S5 | 訂單成立通知（email）| 後端 |
| S6 | 部署 sweeper cron（生產 `CRON_SWEEPER_ENABLED`）+ 收斂時效實測 + 3DS migration bundle db push | 部署 |

→ §7 草案順序 S3 先,但「待正式規劃定序」= **新 session 先讀 STATUS「下一步」+ 設計包 §7、提 multi-select 給 Sean 拍下一 slice**,不自行假設。

## 4. 既有不變式 / 紅線（跨 slice 守）

- **settle-charge.ts 是對帳脊椎**:classifyRecordStatus 0/1→paid_candidate、recordMatchesOrder 識別/金額/弱識別窗、缺陷 A/C 自癒。動結算邏輯 = 鐵則 12 + codex 雙關卡;非結算 slice 不碰其內部。
- **IDOR own-only 雙軸 pattern**:讀會員自己訂單 = RLS `orders_select_own`（auth.uid()=customer_user_id）+ 應用層 `.eq('customer_user_id', userId)`（getUser 驗過）;偽造他人 orderId → 查無 → 404，任何副作用閘在 own-only 之後。
- **payment_confirmer 窄權角色**:對 payment_charge_attempts 零表/欄 grant、只 EXECUTE SECDEF RPC;新 RPC 必 REVOKE all + GRANT payment_confirmer + has_function_privilege 矩陣 assert + role-hygiene assert（全域 table/column grants=0）。
- **金流端點回應零 PII**:只 `{status}` / 零金額 / 零 displayId / 零經銷價;敏感 adapter 走 `@pcm/adapters/server` server-only subpath、不進 root barrel/client bundle。

## 5. 流程

- **寫審分離 ROLE=A**（3DS slice 慣用):執行 session worktree 實作、審查 session fresh-context 關卡2（codex K2 + 對抗 + sign-off）、Sean 橋接。S4/S5/S6 命中鐵則 12/payment/deploy → 建議續寫審分離 + codex;S3 讀路徑（payment status 顯示）亦鐵則 12-adjacent。
- **鐵則 8 重大改動**（動 schema/API/共用元件/跨 3+ 檔）先 plan + codex K1 + Sean 批才動 code。
- **不 push / 不 merge / 不替 Sean 拍板**;決策 prose multi-select。

---

*審查 session（寫審分離 ROLE=A）收尾交接／2026-06-21／S2b PASS+merge、下一 slice 待 Sean 定序*
