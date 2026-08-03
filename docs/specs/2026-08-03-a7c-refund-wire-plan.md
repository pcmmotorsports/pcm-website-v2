# A7c 退款接線線 plan v3.2(2026-08-03;✅ Sean 五拍板 a,a,a,B,a;Fable R3 換角度 FAIL 5 must-fix+8 nit **全折入本版**、R3 明示「修完即可開工、不觸五拍板」;窄確認後開工 RW1a)

> 目標 = 完成地圖 27 項**第 17 項「退款操作」**最後一塊「後台退款按鈕 + 讀模型」
> (`docs/specs/2026-08-01-admin-completion-map.md:70`、`:119-128`;§4 現行線、不在 §5.1 的 40 片內)。
> 上游已收:A7c 帳本已 apply(`STATUS.md:53`)/ `refund()` 已實作零呼叫端(`91c9a2f`)/
> probe 已收案(08-03 §2.3b;殘項今晚兩發)。鐵則 8+12①②③ ⇒ 全線高風險、每片關卡1+2 不降級。
> **審查紀錄**:R1=codex `gpt-5.6-sol` FAIL 22 must-fix+6 nit(親驗駁回 0、全折)→ v2 →
> R2(窄複審)FAIL:20 關、8 未關 + N1-N3 → v3 全折 → Sean 拍板 a,a,a,B,a(§5)→
> **R3=fable 換角度(假設/災難日/修法回歸/測試假綠)FAIL 5 must-fix+8 nit、親驗駁回 0、
> 全折入本 v3.2**;R3 明示「F1-F5 修完即可開工、不觸五拍板字面」⇒ 開工前僅剩窄確認。
> 三輪逐字=`docs/reviews/2026-08-03-a7c-wire-k1-codex.md`(R3 段同檔增補)。

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
| **RW1b** | verify harness 全套(from-zero+格+逐守門突變+兄弟 A→B→A+rollback 實跑;安全案例無刪減)。**交錯格改寫(fable F5)**:「兩 finalize 同單搶 SUM」在 S5 下**物理不可達**(同單僅一 processing 列;同列雙 finalize 由 G5 CAS 決勝)⇒ 不造假場景,改測**可構造且承重**的 `finalize G8 翻轉 × initiate G12` barrier(斷言 initiate 等到翻轉 commit 後被 G12 擋);兩 finalize 場景註明由 S5+G5 蘊含。**fixture 釘防恆真(fable N1)**:至少一格 `record_refunded_before > 0`、一格 `0 < SUM < total`(partiallyRefunded 分支)、`refund_amount ≠ orders.total`(避撞號);另補 deferred×`failed_consistency` 相容格(N6) | 🔴 |
| **⛔ 硬停點** | Sean `db push` → read-back → regen types(+十處手動校正)→ typecheck;未過不得開 RW2 | Sean |
| **RW2a** | `tappay-endpoints` 搬 `packages/adapters/src/tappay/endpoints.ts` + exports + storefront 改 import + 全套回歸(測試同搬) | 🔴 12① |
| **RW2b** | admin composition + env 配對 fail-closed 斷言 + **route `maxDuration` 顯式 ≥45s**(fable N3:adapter 30s 硬逾時 vs 平台預設漂移,被平台砍在 fetch 中=每次慢回應都變 unknown-state) | 🔴 |
| **RW2c** | `initiateRefundAction`(**全額+部分兩 kind,Q4=B**):authorize+確認碼驗證(Q2=A)→ server 重讀訂單(含 Q1=A refunded 硬擋)→ **adapter.recordQuery 取 baseline**(§2 G0)→ RPC initiate → `refund()` → RPC finalize;mock 單元測試含五路錯誤分派+deferred 分派。⚠️ Q4=B 已知代價:片超 45 分就地再拆(action 骨架/kind 分支),不砍測試 | 🔴 12①② |
| **RW2d** | 訂單詳情退款入口(**全額按鈕+部分金額欄**,Q4=B;確認框=輸入訂單號末 4 碼、server 端驗=Q2=A)+ sandbox 端到端:**全額一發必跑**(local supabase 造 order fixture 綁 sandbox `tappay_rec_trade_id` 過 P7C03;環境配對斷言先行;≤6 元);**部分一發**=需已請款交易(今晚 T2 或新建隔日補)。**🔒 入口啟用=機制不靠口頭(fable F3+F4 折入)**:退款入口由 server flag `REFUND_UI_ENABLED` 控制、預設 off;**開啟前置=RW4 收工 且 部分退 E2E 綠**(admin production 追 dev ⇒ 推 dev 即上線,「不宣告可用」不是控制;且 RW4 前卡 processing 列=值班無畫面死巷)。dev 驗證用 env 開 | 🔴 12① |
| **RW3** | deferred/rejected 結果呈現 + 讀模型「帳本未登記額(不含 Portal 場外)」+ 異常清單頁入口(RW4 前置 UI) | 🔴 12① |
| **RW4** | 恢復與覆核片(規格=§4-1,已可施工):異常清單頁(processing 超 30 分)+ 對帳判定(app 層,判定碼表)+ 人工結案走 finalize 復用(recovery outcomes)+ RF8 併 refundId 存在性;harness=每判定碼一正一負 | 🔴 12① |

不做:worker(拍板⑥)/ 防超退(拍板⑤)/ 品項層(拍板③)/ A8\* 取消線 / 動錢 cron。

## §2 schema 增補與守門(新增 vs 沿用分列)

**甲、S1-S7 schema 增補(RW1a;表 0 列=最便宜時機;全進 immutable guard)**
- S1 `kind text NOT NULL CHECK (kind IN ('full','partial'))`(身分欄、不可變)。
- S2 `record_refunded_before bigint NOT NULL CHECK (record_refunded_before >= 0)`(Record baseline;來源見 G0)。
- S3 `provider_refund_id_evidence text`(accepted 當下寫;守門=**N2 折入**:INSERT 必 NULL(併入 P7C08 家族)、write-once 僅 NULL→`^\S{1,64}$`、不得改/清空;confirmed 且 S3 非空時必須 `tappay_refund_id = S3`(同次一致);recovery 結案時 S3 可為 NULL(靠 Record 差額+Portal 真碼)。
- S4 `request_id` 全域 UNIQUE index。
- S5 `UNIQUE (order_id) WHERE status='processing'`(single-flight;RPC 內 `EXCEPTION WHEN unique_violation` → **固定回傳碼 `REFUND_IN_FLIGHT`**,action 映「已有退款處理中」— 不落成未指定錯誤。~~具名 RAISE~~ 改回傳碼=A6 house 慣例:業務態=回傳碼、caller bug=RAISE;RW1a 關卡2 codex MF7 拍齊、兩套字面收斂為此)。
- S6 `status` CHECK 加 `deferred`(終態)+ 狀態機 trigger 同步(processing→confirmed|failed|deferred)+ **`pcm_order_refundable_remaining` WHERE 改 `status IN ('processing','confirmed')`**(codex N1;COMMENT+harness 格同步;deferred=已證零動錢,不佔額度)。**fable N8:COMMENT 必載明** allowlist 寫法讓「未來新增狀態」預設不佔額度(與原 `<> 'failed'` 方向相反=顯示面 fail-open),新增狀態時必須回訪本函式。
- S7 `failed_detail text CHECK (failed_detail IS NULL OR char_length(failed_detail) <= 500)`(人工/診斷文字;`failed_reason` 改承 machine code,allowlist 見 G6)。

**乙、RPC 守門(新增)**
- G0 **baseline 資料流(codex F4 + fable F1/F2 折入)**:DB 打不了 HTTP ⇒ baseline 由 **server action** 供給:action 先 `adapter.recordQuery({recTradeId})` → 斷言全數成立才呼 RPC:①`queryStatus∈{0,2}`+恰 1 筆+`recTradeId` 相符 ②**`record_status ∈ {0,1,2}` allowlist**(3=已退畢/4=PENDING/5=CANCEL/-1=ERROR → 具名員工可讀錯誤 `REFUND_RECORD_STATE_BAD`)③**`refundedAmount` 為 `undefined`(欄缺)= 異常、直接 abort — 嚴禁 `?? 0`**(未退款紀錄實測必帶 `refunded_amount=0`,wire.test 有格;缺欄翻 0 會永久污染 S2 → RW4 差額判定可把「從未執行的退款」判成已退)④full 時 **`amount > 0`**(=0 → `REFUND_NOTHING_LEFT`,否則凍結 0 元撞既有 `refund_amount>0` CHECK 成 23514 裸錯)。**任一不成立 → action abort、RPC 零呼叫**(fail-closed)。信任邊界=RPC 僅 service_role EXECUTE、呼叫端只有 server action;RPC 驗非負整數。
- G1 initiate 序列化錨:`orders ... FOR NO KEY UPDATE`(FOR UPDATE=FK RI 死結 40P01 實錘;鎖順序 orders→order_refunds)。
- G2 `bank_refund_id` RPC 自產(`^[A-Za-z0-9_-]{1,20}$`、拒呼叫端供鍵)⇒ rotation-always。**生成方案釘死(fable N2)**:`gen_random_bytes(16)`→base64→`+`/`/` 映射為 `a`/`b`、去 `=`、截 20 字(熵 ≥90-bit;禁日期/序號式 — sandbox 商戶已被 probe 消耗過 `pcm-*` 前綴鍵,弱方案第一發 E2E 就可能 6002)。
- G3 金額凍結公式(F5 折入):`kind='partial'` → 員工輸入正整數;`kind='full'` → **凍結額 := G0 那次 Record 回的 `amount`(TapPay 剩餘額=權威、含 Portal 場外)**;上界不設(拍板⑤;`>0` 沿用既有 CHECK)。TOCTOU(查後 Portal 又退)→ accepted 金額不符 → G7 hold。probe P4 佐證:全額退 `refund_amount`=當下剩餘額。
- G4 冪等=查驗式:以 `request_id`(S4)找列→比指紋 `(order_id, kind, refund_amount, rec_trade_id)`→符=DUPLICATE(帶列 id+status;processing→「進行中」/confirmed→「已完成」/failed·deferred→RAISE 開新請求)、不符=RAISE。**fable N7 註記**:kind=full 重播時凍結額隨 Record 漂移 → 指紋不符 RAISE 屬 fail-closed 正確行為,錯誤文案須涵蓋此情境(「金額已變動,請重新發起」)。
- G5 finalize CAS:`WHERE id=$1 AND status='processing'`,rowcount=0→RAISE;呼叫端斷言回傳碼。
- G6 finalize outcome allowlist(codex F17/N3 折入;**全部可達**):同步路徑=`accepted`(→confirmed;必帶 `tappay_refund_id`=P7C09 沿用+S3 一致)/`deferred_not_captured`(→deferred;**不寫 `failed_reason`** — 既有 `failed_consistency` CHECK 強制 deferred 列 failed_reason 必 NULL,fable N6;harness 補相容格)/`rejected_out_of_range`、`not_sent`(→failed;`failed_reason`=該碼、`failed_detail` 選填)。恢復路徑(RW4 人工)=`recovered_confirmed`(必帶 Portal 真 DR 碼→P7C09 天然滿足)/`manual_failed`(必帶 `failed_detail` 含 Record 證據數字)。~~unexpected_adapter_error~~ **刪除**(unknown-state 一律不 finalize、留 processing ⇒ 該碼不可達)。
- G7 finalize 金額比對:accepted 的 `refundAmount` === 本列凍結 `refund_amount`;不符→寫 S3、留 processing、走 RW4(不重算 remaining=時序陷阱)。
- G8 payment_status 翻轉(僅 confirmed/recovered_confirmed):同交易精確順序=鎖 orders(FOR NO KEY UPDATE)→CAS 本列→**新 statement** `SUM(refund_amount) WHERE status='confirmed'`→`SUM≥total→refunded`/`0<SUM<total→partiallyRefunded`;**單調不降級**;failed/deferred/not_sent 零觸碰;開頭斷言非 RR(P2B02 同型);遵守 domain 轉移表(`state-machine.ts:15-40`)。
- G9 稽核(F15 折入;A6 形狀=after 鍵集合恰 N 鍵+同交易+失敗整筆 rollback):
  `order_refund.initiate` payload 恰 8 鍵 {order_id, refund_row_id, kind, refund_amount, rec_trade_id, bank_refund_id, record_refunded_before, request_id};
  `order_refund.finalize` 恰 6 鍵 {refund_row_id, outcome, tappay_refund_id|null, provider_refund_id_evidence|null, refund_amount_wire|null, request_id};
  恢復結案沿用 finalize action(outcome 已可辨識)。零 PII、無自由文字、body 全文不得出現。
- G10 ACL:SECURITY DEFINER+search_path 釘死+owner=表 owner+REVOKE PUBLIC/anon/authenticated+僅 service_role EXECUTE+檔內自我斷言(A6 `:322-348` 全套含 FORCE RLS 檢查)。
- G11 輸入衛生(F18 折入,實際值):`p_reason` trim 非空 ≤200 字、拒控制字元(`~ '[[:cntrl:]]'` 拒;⚠️ lc_ctype 差異=本機結論不外推正式站,harness 標註)/ `p_actor` trim 非空 ≤64 / `p_request_id` UUID v4 regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` / `p_failed_detail` ≤500 / S3 evidence `^\S{1,64}$`。
- G12(**Q1=A 拍板**)initiate 前置:`payment_status = 'refunded'` → **固定回傳碼 `REFUND_LEDGER_FULL`**(帳本已滿、硬擋;~~RAISE~~ 改回傳碼同 S5 註記)。**檢查順序:G4 冪等查驗必須先於 G12**(否則全額退 confirmed 後同 token 重播會被 LEDGER_FULL 遮蔽、拿不到 DUPLICATE;RW1a 關卡2 codex MF4)。既有 P7C02 白名單(INSERT trigger 層)刻意放行 refunded **不動**(已 apply 守門;其註解 `:238-240` 逐字「取決於尚未存在的程式」— 本 RPC 就是那個程式,擋在 RPC 層)。UI 同步隱藏入口。

**丙、app 層(縱深,不計守門)**:authorize+server 重讀;UI 防雙擊=降噪(權威 S5);accepted 同 request 立即 finalize=縮窗(權威 S3+RW4);錯誤分派鐵律=只認 NotSentError 與三態,**其他 throw(含 6002/10050)不 finalize、留 processing、不自動重發**(`types.ts:177-179`)。

## §3 refund() 三態 × 帳本 × UI(v3)

| refund() 結果 | 帳本(RPC) | UI | 依據 |
|---|---|---|---|
| `accepted` 且金額符 | 寫 S3 → finalize(`accepted`)→confirmed+`tappay_refund_id`+G8 翻轉 | 「退款已送出(confirmed=TapPay 受理≠已入帳;入帳=F2 口徑、RF8 覆核)」 | types.ts:167-172;P7C09/10 |
| `accepted` 金額不符 | 寫 S3、留 processing → RW4 | 「狀態確認中」 | G7;probe ④ |
| `deferred`(10024) | finalize(`deferred_not_captured`)→**deferred 終態**;鍵作廢、額度釋出(S6 remaining 改版);重試=新 initiate 新列新鍵 | 「尚未請款;**請款完成後**重新發起」(fable N5:20:00 是 sandbox 批次觀測、正式商戶請款時點未證,不寫進 UI) | Q2=A 拍板;probe ②;D1 |
| `rejected`(10051) | finalize(`rejected_out_of_range`)→failed | 顯「帳本未登記額」+提示 Record/Portal 對帳 | types.ts:203-208 |
| throw `NotSentError` | finalize(`not_sent`)→failed | 表單錯誤、可改參重送(新請求) | types.ts:131-137 |
| throw 其他(unknown-state) | **不 finalize、留 processing**(S5 擋同單再發)→ RW4 | 「狀態確認中、勿重試」 | types.ts:177-179;probe ③ |

## §4 接線債三條(v3)

1. **refundId 遺失窗**:(a)S3 送回應前落 DB;(b)RW4 恢復規格(F24 折入):
   - 入口=admin 異常清單:`status='processing' AND (created_at < now()-interval '30 min' OR provider_refund_id_evidence IS NOT NULL)`(fable N4:G7-hold 列=當下已知異常、不等 30 分;同步流程正常=秒級,30 分=保守異常閾)。
   - 判定(app 層讀 Record,不新增 RPC):`delta := refunded_now − record_refunded_before`。
     `delta = 0` → 未退 → 人工按「標記失敗」= finalize(`manual_failed`,detail 記兩讀數);
     `delta = refund_amount` **且該單無其他非終態列** → 已退 → 人工從 Portal 取真 DR 碼 → finalize(`recovered_confirmed`)(Q3-A);
     其他任何情形(差額不等/Record 查無/多筆/欄缺/該單另有 processing)→ **停+告警、純人工**(「Portal 介入痕跡」的機械判定=delta∉{0, refund_amount})。
   - RF8 隔日覆核追加:全部 confirmed 列必有 `tappay_refund_id`;Record 總額 vs 帳本 SUM 對帳。
   - harness:每判定碼一正一負測。
2. **同單雙擊雙退**:S5(DB 權威、跨請求持久)+ G4 重播矩陣 + `REFUND_IN_FLIGHT` 具名映射;UI=降噪。R2 專項確認:同 request_id 重播不撞 S5、異 request_id 被 S5 擋=無雙退窗。
3. **probe**:✅ 收案;🟡 今晚殘項矩陣(§2.3b-6):消耗鍵=`6002`→維持結論/`0`→鍵註冊有 TTL、重估並 raise、**RW2c 前不得開工**;新鍵=`0`→正向鏈補完/非 0→逐字記錄再判。兩發未跑完前 RW2d 不開工;RW1a/1b 不受擋。

## §5 拍板紀錄(✅ Sean 2026-08-03 下午,逐字「a,a,a,B,a」;原五題全文見 git 前版 `53ff069`)

- **Q1=A**:`refunded` 訂單 RPC+UI 硬擋再發起(→G12)。
- **Q2=A**:接受現行授權+確認框(訂單號末 4 碼、server 端驗);audit 標 actor=自報、真身分等 E8-B(→RW2c/2d)。
- **Q3=A**:恢復=Record 差額判定+人工 Portal 取真 DR 碼 → `recovered_confirmed`;P7C09 不鬆綁(→§4-1)。
- **Q4=B**:全額+部分**一次做**(RW2c/2d 已重排;已知代價=片可能超時,超時就地再拆、不砍測試;部分退 E2E 受請款時序限制,未跑完前不宣告可用)。
- **Q5=A**:Fable(adversarial-reviewer)R3 換角度審本檔,**PASS 才開工 RW1a**。
- 三定案(deferred 獨立態 / single-flight=partial unique / 同單單一 processing)未被異議=生效。

## §6 驗收與 rollback(同 v2 增補)

- RW1a:檔內 fail-closed 結構驗收(A6 形狀)+三綠;**不 apply 不 db push**。RW1b:harness 全綠(格+突變逐紅+兄弟零污染+G8 交錯+rollback 實跑)。
- 硬停點後才開 RW2;RW2d/RW3 各三綠+build+smoke+agent-browser;RW2d=sandbox 真退 ≤6 元(環境配對斷言先行);每片 codex 關卡2。
- rollback=逐物件 forward:停 UI→REVOKE RPC EXECUTE→DROP RPC→DROP S4/S5 index(S1-S3/S6/S7 欄與值=無害殘留另拍);**有真退款列後絕不重建表、帳本與 audit 永不刪**。

— v3 完;停等 Sean 拍 Q1-Q5 —
