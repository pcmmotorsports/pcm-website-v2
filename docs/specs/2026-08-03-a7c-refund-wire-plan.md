# A7c 退款接線線 plan v3(2026-08-03 施工視窗②;關卡1 R1 FAIL 28 條全折 → R2 FAIL 8 未關+3 新條再折;輪數上限 2 已滿、停等 Sean)

> 目標 = 完成地圖 27 項**第 17 項「退款操作」**最後一塊「後台退款按鈕 + 讀模型」
> (`docs/specs/2026-08-01-admin-completion-map.md:70`、`:119-128`;§4 現行線、不在 §5.1 的 40 片內)。
> 上游已收:A7c 帳本已 apply(`STATUS.md:53`)/ `refund()` 已實作零呼叫端(`91c9a2f`)/
> probe 已收案(08-03 §2.3b;殘項今晚兩發)。鐵則 8+12①②③ ⇒ 全線高風險、每片關卡1+2 不降級。
> **審查紀錄**:R1=codex `gpt-5.6-sol` FAIL 22 must-fix+6 nit(親驗駁回 0、全折)→ v2 →
> R2(窄複審)FAIL:20 關、8 未關(F2/F4/F5/F12/F15/F17/F18/F24)+ N1-N3 → **本 v3 全折**。
> 兩輪上限已滿(CLAUDE.md ③),第 3 輪須換模型 ⇒ 處置=§5 Q5 給 Sean 拍。

## §0 證據與前提(同 v2,增補 R2 折入;引用=檔案:行號)

**拍板鏈**:A7c 七拍板(`STATUS.md:61`;`2026-08-01-a7c-night-run-handoff.md` §1、守門 8-12 道 `:71`)/ 08-03 早 deferred 獨立態 Q2=A + probe Q3=A(memory `project_m3-refund-adapter-gate1-0803-decisions`)/ 接線債三條(`2026-08-03-nightly-refund-adapter.md:143-152`)。

**probe 定案(§2.3b;sandbox 觀測 invariant、不外推正式帳務)**:①同鍵=`6002`(全域、先於請款檢查)②10024 消耗鍵、10051 不消耗 ⇒ rotation-always ③`6002`≠錢動過 ⇒ 恢復走 Record 差額(baseline=S2)④`refund_amount`=本次額(fail-closed 比對)⑤併發序列化 n=1 只當 signal。

**schema 現況**:欄位+CHECK(`20260725130100:80-131` 減四欄+`20260801120000:169-196`);既有守門 P7C01-P7C10+狀態機+DELETE/TRUNCATE 擋(`20260801120000:199-431`);`pcm_order_refundable_remaining` 含 processing+confirmed 不含 failed、顯示用、Portal 盲區(`:437-467`);**寫入 RPC 缺**(RF2b 從未建;ACL 註解 `20260725130100:313-315,:358-364`);先例=A6(`20260802150000:93,:322-348`)。

**admin 現況**:零退款 UI;`authorizeAdminMutation()`(`authorize.ts:24`;actor=自報 cookie 非驗證身分→Q2);token 先例=表單渲染 server 發(`proxy.ts:26-33`);admin 依賴 `@pcm/adapters`+`@pcm/domain`、無 composition;`tapPayUrlsFor` 在 storefront。🟡 admin Vercel `TAPPAY_*` 未查證(Sean;不擋 dev)。

**本 plan 定案(非決策題;理由=既有拍板的直接推論,Sean 不同意再改)**
- **D1 deferred=獨立 status 第四值**(S6):把 10024 記成 failed 會在帳本/UI 層重演「員工把『還不能做』讀成『失敗』」— 正是 Sean Q2=A 拆三態的原因;併入 failed 的方案**刪除**(R2 F2/F12:語意違拍板、非可互換選項)。
- **D2 single-flight=S5 partial unique**、advisory lock 方案刪除(R1 F9)。
- **D3 同單同時至多一筆 processing** = 業務前提。

## §1 拆片(嚴格序列;15-45 分鐘級、獨立審獨立 commit)

| 片 | 內容 | 風險 |
|---|---|---|
| **RW1a** | migration:S1-S7 schema 增補 + `admin_initiate_order_refund`/`admin_finalize_order_refund` 兩支 owner RPC(A6 全套形狀)+ remaining 函式改版(N1) | 🔴 12①②③ |
| **RW1b** | verify harness 全套(from-zero+格+逐守門突變+兄弟 A→B→A+G8 交錯 barrier+rollback 實跑;安全案例無刪減) | 🔴 |
| **⛔ 硬停點** | Sean `db push` → read-back → regen types(+十處手動校正)→ typecheck;未過不得開 RW2 | Sean |
| **RW2a** | `tappay-endpoints` 搬 `packages/adapters/src/tappay/endpoints.ts` + exports + storefront 改 import + 全套回歸(測試同搬) | 🔴 12① |
| **RW2b** | admin composition + env 配對 fail-closed 斷言 | 🔴 |
| **RW2c** | `initiateRefundAction`(全額退):authorize → server 重讀訂單 → **adapter.recordQuery 取 baseline**(見 §2 G0)→ RPC initiate → `refund()` → RPC finalize;mock 單元測試含五路錯誤分派 | 🔴 12①② |
| **RW2d** | 訂單詳情「全額退款」入口(確認框=Q2-A)+ sandbox 端到端(local supabase 造 order fixture 綁 sandbox `tappay_rec_trade_id` 過 P7C03;環境配對斷言先行;真退一發 ≤6 元) | 🔴 12① |
| **RW3** | 部分退(金額欄)+ deferred/rejected 呈現 + 讀模型「帳本未登記額(不含 Portal 場外)」 | 🔴 12① |
| **RW4** | 恢復與覆核片(規格=§4-1,已可施工):異常清單頁(processing 超 30 分)+ 對帳判定(app 層,判定碼表)+ 人工結案走 finalize 復用(recovery outcomes)+ RF8 併 refundId 存在性;harness=每判定碼一正一負 | 🔴 12① |

不做:worker(拍板⑥)/ 防超退(拍板⑤)/ 品項層(拍板③)/ A8\* 取消線 / 動錢 cron。

## §2 schema 增補與守門(新增 vs 沿用分列)

**甲、S1-S7 schema 增補(RW1a;表 0 列=最便宜時機;全進 immutable guard)**
- S1 `kind text NOT NULL CHECK (kind IN ('full','partial'))`(身分欄、不可變)。
- S2 `record_refunded_before bigint NOT NULL CHECK (record_refunded_before >= 0)`(Record baseline;來源見 G0)。
- S3 `provider_refund_id_evidence text`(accepted 當下寫;守門=**N2 折入**:INSERT 必 NULL(併入 P7C08 家族)、write-once 僅 NULL→`^\S{1,64}$`、不得改/清空;confirmed 且 S3 非空時必須 `tappay_refund_id = S3`(同次一致);recovery 結案時 S3 可為 NULL(靠 Record 差額+Portal 真碼)。
- S4 `request_id` 全域 UNIQUE index。
- S5 `UNIQUE (order_id) WHERE status='processing'`(single-flight;RPC 內 `EXCEPTION WHEN unique_violation` → 具名碼 `REFUND_IN_FLIGHT` RAISE,action 映「已有退款處理中」— 不落成未指定錯誤)。
- S6 `status` CHECK 加 `deferred`(終態)+ 狀態機 trigger 同步(processing→confirmed|failed|deferred)+ **`pcm_order_refundable_remaining` WHERE 改 `status IN ('processing','confirmed')`**(N1;COMMENT+harness 格同步;deferred=已證零動錢,不佔額度)。
- S7 `failed_detail text CHECK (failed_detail IS NULL OR char_length(failed_detail) <= 500)`(人工/診斷文字;`failed_reason` 改承 machine code,allowlist 見 G6)。

**乙、RPC 守門(新增)**
- G0 **baseline 資料流(F4 折入)**:DB 打不了 HTTP ⇒ baseline 由 **server action** 供給:action 先 `adapter.recordQuery({recTradeId})` → 斷言 `queryStatus∈{0,2}`+恰 1 筆+`recTradeId` 相符 → 取 `refundedAmount ?? 0` 當 `p_record_refunded_before`、取 `amount` 當 full 的凍結額(G3);**Record 查失敗/查無/多筆/欄缺 → action 直接 abort、RPC 零呼叫**(fail-closed)。信任邊界=RPC 僅 service_role EXECUTE、呼叫端只有 server action;RPC 驗非負整數。
- G1 initiate 序列化錨:`orders ... FOR NO KEY UPDATE`(FOR UPDATE=FK RI 死結 40P01 實錘;鎖順序 orders→order_refunds)。
- G2 `bank_refund_id` RPC 自產(`^[A-Za-z0-9_-]{1,20}$`、拒呼叫端供鍵)⇒ rotation-always。
- G3 金額凍結公式(F5 折入):`kind='partial'` → 員工輸入正整數;`kind='full'` → **凍結額 := G0 那次 Record 回的 `amount`(TapPay 剩餘額=權威、含 Portal 場外)**;上界不設(拍板⑤;`>0` 沿用既有 CHECK)。TOCTOU(查後 Portal 又退)→ accepted 金額不符 → G7 hold。probe P4 佐證:全額退 `refund_amount`=當下剩餘額。
- G4 冪等=查驗式:以 `request_id`(S4)找列→比指紋 `(order_id, kind, refund_amount, rec_trade_id)`→符=DUPLICATE(帶列 id+status;processing→「進行中」/confirmed→「已完成」/failed·deferred→RAISE 開新請求)、不符=RAISE。
- G5 finalize CAS:`WHERE id=$1 AND status='processing'`,rowcount=0→RAISE;呼叫端斷言回傳碼。
- G6 finalize outcome allowlist(F17/N3 折入;**全部可達**):同步路徑=`accepted`(→confirmed;必帶 `tappay_refund_id`=P7C09 沿用+S3 一致)/`deferred_not_captured`(→deferred)/`rejected_out_of_range`、`not_sent`(→failed;`failed_reason`=該碼、`failed_detail` 選填)。恢復路徑(RW4 人工)=`recovered_confirmed`(必帶 Portal 真 DR 碼→P7C09 天然滿足)/`manual_failed`(必帶 `failed_detail` 含 Record 證據數字)。~~unexpected_adapter_error~~ **刪除**(unknown-state 一律不 finalize、留 processing ⇒ 該碼不可達)。
- G7 finalize 金額比對:accepted 的 `refundAmount` === 本列凍結 `refund_amount`;不符→寫 S3、留 processing、走 RW4(不重算 remaining=時序陷阱)。
- G8 payment_status 翻轉(僅 confirmed/recovered_confirmed):同交易精確順序=鎖 orders(FOR NO KEY UPDATE)→CAS 本列→**新 statement** `SUM(refund_amount) WHERE status='confirmed'`→`SUM≥total→refunded`/`0<SUM<total→partiallyRefunded`;**單調不降級**;failed/deferred/not_sent 零觸碰;開頭斷言非 RR(P2B02 同型);遵守 domain 轉移表(`state-machine.ts:15-40`)。
- G9 稽核(F15 折入;A6 形狀=after 鍵集合恰 N 鍵+同交易+失敗整筆 rollback):
  `order_refund.initiate` payload 恰 8 鍵 {order_id, refund_row_id, kind, refund_amount, rec_trade_id, bank_refund_id, record_refunded_before, request_id};
  `order_refund.finalize` 恰 6 鍵 {refund_row_id, outcome, tappay_refund_id|null, provider_refund_id_evidence|null, refund_amount_wire|null, request_id};
  恢復結案沿用 finalize action(outcome 已可辨識)。零 PII、無自由文字、body 全文不得出現。
- G10 ACL:SECURITY DEFINER+search_path 釘死+owner=表 owner+REVOKE PUBLIC/anon/authenticated+僅 service_role EXECUTE+檔內自我斷言(A6 `:322-348` 全套含 FORCE RLS 檢查)。
- G11 輸入衛生(F18 折入,實際值):`p_reason` trim 非空 ≤200 字、拒控制字元(`~ '[[:cntrl:]]'` 拒;⚠️ lc_ctype 差異=本機結論不外推正式站,harness 標註)/ `p_actor` trim 非空 ≤64 / `p_request_id` UUID v4 regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` / `p_failed_detail` ≤500 / S3 evidence `^\S{1,64}$`。

**丙、app 層(縱深,不計守門)**:authorize+server 重讀;UI 防雙擊=降噪(權威 S5);accepted 同 request 立即 finalize=縮窗(權威 S3+RW4);錯誤分派鐵律=只認 NotSentError 與三態,**其他 throw(含 6002/10050)不 finalize、留 processing、不自動重發**(`types.ts:177-179`)。

## §3 refund() 三態 × 帳本 × UI(v3)

| refund() 結果 | 帳本(RPC) | UI | 依據 |
|---|---|---|---|
| `accepted` 且金額符 | 寫 S3 → finalize(`accepted`)→confirmed+`tappay_refund_id`+G8 翻轉 | 「退款已送出(confirmed=TapPay 受理≠已入帳;入帳=F2 口徑、RF8 覆核)」 | types.ts:167-172;P7C09/10 |
| `accepted` 金額不符 | 寫 S3、留 processing → RW4 | 「狀態確認中」 | G7;probe ④ |
| `deferred`(10024) | finalize(`deferred_not_captured`)→**deferred 終態**;鍵作廢、額度釋出(S6 remaining 改版);重試=新 initiate 新列新鍵 | 「尚未請款;約當日 20:00 後重新發起」 | Q2=A 拍板;probe ②;D1 |
| `rejected`(10051) | finalize(`rejected_out_of_range`)→failed | 顯「帳本未登記額」+提示 Record/Portal 對帳 | types.ts:203-208 |
| throw `NotSentError` | finalize(`not_sent`)→failed | 表單錯誤、可改參重送(新請求) | types.ts:131-137 |
| throw 其他(unknown-state) | **不 finalize、留 processing**(S5 擋同單再發)→ RW4 | 「狀態確認中、勿重試」 | types.ts:177-179;probe ③ |

## §4 接線債三條(v3)

1. **refundId 遺失窗**:(a)S3 送回應前落 DB;(b)RW4 恢復規格(F24 折入):
   - 入口=admin 異常清單(`status='processing' AND created_at < now()-interval '30 min'`;同步流程正常=秒級,30 分=保守異常閾)。
   - 判定(app 層讀 Record,不新增 RPC):`delta := refunded_now − record_refunded_before`。
     `delta = 0` → 未退 → 人工按「標記失敗」= finalize(`manual_failed`,detail 記兩讀數);
     `delta = refund_amount` **且該單無其他非終態列** → 已退 → 人工從 Portal 取真 DR 碼 → finalize(`recovered_confirmed`)(Q3-A);
     其他任何情形(差額不等/Record 查無/多筆/欄缺/該單另有 processing)→ **停+告警、純人工**(「Portal 介入痕跡」的機械判定=delta∉{0, refund_amount})。
   - RF8 隔日覆核追加:全部 confirmed 列必有 `tappay_refund_id`;Record 總額 vs 帳本 SUM 對帳。
   - harness:每判定碼一正一負測。
2. **同單雙擊雙退**:S5(DB 權威、跨請求持久)+ G4 重播矩陣 + `REFUND_IN_FLIGHT` 具名映射;UI=降噪。R2 專項確認:同 request_id 重播不撞 S5、異 request_id 被 S5 擋=無雙退窗。
3. **probe**:✅ 收案;🟡 今晚殘項矩陣(§2.3b-6):消耗鍵=`6002`→維持結論/`0`→鍵註冊有 TTL、重估並 raise、**RW2c 前不得開工**;新鍵=`0`→正向鏈補完/非 0→逐字記錄再判。兩發未跑完前 RW2d 不開工;RW1a/1b 不受擋。

## §5 決策題(Sean;prose code block 一次批)

```text
Q1(payment_status='refunded' 的訂單能否再發起):
A. RPC+UI 硬擋(帳本已滿;場外情形本來就在 Portal 處理)(推薦)
B. 允許發起+強警示(依賴 TapPay 10051 擋超退)

Q2(退款授權級別;現況=共用 SSO+自報 actor cookie):
A. 接受現行授權+確認框(輸入訂單號末 4 碼防手滑);audit 標註 actor=自報、真身分等 E8-B
   (推薦;與儲值金 override 同級)
B. 退款 UI 等 E8-B 完成才開(第 17 項驗收繼續紅)

Q3(RW4 恢復結案形狀):
A. Record 差額判定 + 人工從 Portal 取真 DR 碼 → recovered_confirmed(P7C09 不鬆綁、零偽造;
   代價=恢復含一步人工;月 100-300 單可承受)(推薦)
B. 鬆綁 P7C09 允許無對帳碼結案(動已 apply 守門=另一支高風險 migration)

Q4(RW2c/2d 縱切範圍):
A. 全額退先行,部分退=RW3(推薦;第一刀最小、當日可肉眼驗)
B. 全額+部分一次做(審查面翻倍、片必超時)

Q5(關卡1 收斂處置;R1+R2 兩輪上限已滿、R2 的 8 條未關+3 新條已全折入本 v3):
A. 依 00-work-rules「第 3 輪換模型換角度」:派 adversarial-reviewer(model:fable)R3 審 v3,
   PASS 才開工 RW1a(推薦;錢+schema 片、上次 R3 換 Fable 抓到過穿透兩輪的 BLOCKER)
B. 你讀本檔直接拍,跳 R3 開工 RW1a(每片關卡2 照跑不降級)

另:三個定案(deferred 獨立態 / single-flight=partial unique / 同單單一 processing)
寫在 §0,是既有拍板的直接推論;有異議請一併說。
```

## §6 驗收與 rollback(同 v2 增補)

- RW1a:檔內 fail-closed 結構驗收(A6 形狀)+三綠;**不 apply 不 db push**。RW1b:harness 全綠(格+突變逐紅+兄弟零污染+G8 交錯+rollback 實跑)。
- 硬停點後才開 RW2;RW2d/RW3 各三綠+build+smoke+agent-browser;RW2d=sandbox 真退 ≤6 元(環境配對斷言先行);每片 codex 關卡2。
- rollback=逐物件 forward:停 UI→REVOKE RPC EXECUTE→DROP RPC→DROP S4/S5 index(S1-S3/S6/S7 欄與值=無害殘留另拍);**有真退款列後絕不重建表、帳本與 audit 永不刪**。

— v3 完;停等 Sean 拍 Q1-Q5 —
