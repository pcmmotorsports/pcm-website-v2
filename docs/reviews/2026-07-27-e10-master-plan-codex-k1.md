# codex 關卡1 — E10 訂單閉環總規劃 v1(2026-07-27)

> 模型 `gpt-5.6-sol`、`-s read-only`、零留痕已驗(跑前後 git status 比對無新增變動)。
> 受審對象 = `docs/specs/2026-07-27-e10-order-closure-master-plan.md` v1(commit `c1a59cf` 版本)。
> **判定 FAIL。** 主對話抽驗三條全部成立(見下方「主對話裁定」)。

---

FAIL

- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:273`：依賴表沒有閉環，但第 1 批只含 O0–O7，卻承諾依賴 O7a、O7b、O8 的新版列表與六碼編號；該批次不可能照字面驗收。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:174-176`：文件已承認 O7b 依賴 O8，卻未真正選定 O8 前移或 O7b 後移；正式站施工序仍未閉合。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:182`：`dev` 推即正式站，但 E10 沒有總 flag、hidden route 或逐批啟用閘；schema/UI 不相容時會直接打到員工。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:110,202`：C1 同時被寫成「未定」與「已拍自動後綴」；執行者無法判斷 O9/O10 是否已解鎖。
- [must-fix] `docs/reference/hct-logistics-api-reference.md:217`：HCT 參考檔仍把後綴列為未定；plan 宣稱拍板後未同步 repo 真權威，後續片會讀到兩種答案。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:157-160`：O9 先把單號寫在訂單、O10 才引入包裹，會形成兩個正式寫入真相；應先建包裹模型，再開輸入、通知與列印。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:159-160`：O11/O12 只依賴 O9，未依賴 O10；分批出貨時可能寄錯包裹單號或列出整單而非本包品項。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:167`：O19 未依賴 O10/O13/O14/O15；可修改已裝箱、已收款、已退款或退貨中的數量，破壞帳本與包裹不變式。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:168`：O20 只依賴 O4/O13，卻要做全日待辦；缺貨、出貨、退款失敗、未認領與跟進日都尚未存在，無法達成第 1 項。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:147`：`internal_note` 加在 `orders` 會被 authenticated 客戶的整表 SELECT + own-order RLS 讀到；正式寫入第一筆內部備註即洩漏。`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:182-195`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:148`：O2 標成標準片不成立；production 的 service_role 沒有 orders UPDATE，必須新增 owner RPC、ACL、CAS 與同交易 audit。`supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql:230-240`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149`：O3 只有 enum/回填，沒有取消 RPC、按鈕、部分取消與退款分流；做完仍達不到第 19 項。`apps/admin/src/lib/orders/order-actions.ts:36-134`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149,180`：O3 把 expand、回填、雙寫、讀切換、收緊塞成一片；這是多次部署流程，不是單一 15–45 分鐘可中斷片。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149`：既有 `cancelled_reason` 是客戶可見文字，受控原因 code 與對客說明是否分欄尚未決定；直接取代會丟失舊理由或把內部 code 顯示給客戶。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:150`：O4 若先加 nullable 計數器，CHECK 對 NULL 不會證明不變式；若直接 NOT NULL，又缺 29 單回填規則與 create_order 初值，兩種做法都未形成可上線 migration。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:150`：計數器是目標真相，但 plan 未定誰原子更新、如何避免超量、如何同步訂單層 enum；只加欄與 CHECK 達不到第 4、5、7、18 項。`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:381-396`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,180`：PostgreSQL enum 加值不可逆、不能 contract；「所有 DB 片一律 expand/contract」對 O5 字面不成立。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151`：O5 漏列 domain 型別、轉移表與 storefront exhaustive 顯示；DB 出現新值時舊程式可能取不到 label 或轉移失敗。`packages/domain/src/order/types.ts:45-57`, `packages/domain/src/order/state-machine.ts:47-55`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,204`：plan 要加 `delivered`，又拍板不自動追蹤、也不手標送達；新狀態與 `delivered_at` 沒有可信 writer。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,221-227`：訂貨/出貨已拍 item 層，O5 卻擴充 order 層 fulfillment enum；混合品項如何彙總成 backorder/delivered 未定。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152`：O6 標成標準片但實際需要 schema、owner RPC、CAS、audit 與 UI，命中 DB/權限且明顯超過 45 分鐘。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152`：O6 只存供應商名、單號與 ETA，漏掉已核准的聯絡管道、送出時間、回覆狀態、異常原因與自由文字正規化。`docs/specs/2026-07-26-admin-ux-operability-review.md:33-39`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:153`：AdminDataTable 現在明載批次選取未做，且 orders 互動 cell 雙渲染會產生重複表單；O7 不是單純補 checkbox。`apps/admin/src/components/shared/admin-data-table.tsx:10-18`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:156,158`：O8 先把單號/時間放 orders，O10 才建立包裹真相；未定摘要同步、回填與 contract，會永久形成雙寫欄位。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:158`：O10 只寫「一單多包裹」，漏掉 Sean 已拍 U1 的「多單併一箱」與 shipment_items。`docs/specs/2026-07-26-admin-ux-operability-review.md:92-95`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:158,202`：`-1/-2` 的序號來源、刪包裹後是否重排、重送是否沿用皆未定；若依畫面順序重算，HCT 會把舊識別值當更正或報重複。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161`：O13 把多筆匯款、差額、催款、溢款處置與稽核塞一片，且未建付款帳本；單一 order 欄位無法表達多次付款。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161`：匯款退款去向、受款帳戶複核、轉帳參考號與防重複匯款完全缺席；取消匯款單時無法安全退錢。`docs/specs/2026-07-26-admin-ux-operability-review.md:28-31`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:162`：O14 不是「接帳本做 UI」；production 帳本只允許 service_role SELECT，RF2b 寫入 RPC 到 RF8 覆核都未完成。`supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:312-325`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:162`：因此 O14 做完仍不能執行退款，第 17 項映射不誠實；既有退款線明列 RF2b–RF8 尚待施工。`PROGRESS.md:780-787`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:163`：O15 漏掉已核准的 `order_refunds.return_id` 關聯；貨與錢無法對帳。`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:398-404`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:165`：O17 未依賴 O7a，也沒要求共用同一產號器；手動建單可能繼續產舊號或複製另一套碰撞邏輯。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:165-166`：手動單的自由品項價格、稅/折扣、客戶與地址、付款狀態、庫存影響和 dealer-price 權限都未決定，O17/O18 不可開工。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:167`：O19 未折入 U2「已裝進包裹部分鎖定」；直改全部會讓歷史出貨內容與訂單現況分裂。`docs/specs/2026-07-26-admin-ux-operability-review.md:94-96`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:169`：O21 無依賴且標準片不成立；production 的 service_role 對 audit log 無 SELECT，UI 目前讀不到。`supabase/migrations/20260712210000_m4a_admin_audit_log.sql:80-89`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:100-102,169`：第 27 項標「E8-B 前不可信」是正確的，但 O21 還缺安全讀取 RPC/ACL；現況連「不可信的 UI」也無法交付。`apps/admin/src/lib/orders/order-repository.ts:35-50`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:155`：O7b 是列表顯示片，卻映射第 8「輸入單號」與第 19「取消操作」；顯示欄位不會讓兩項變綠。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,155`：第 7「缺貨要等」只有 order enum 與二元膠囊，沒有 item 缺貨數量、異常原因、已告知客人紀錄；仍無法跑真流程。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:95-98`：宣稱 17 項全綠，但 approved UX 明定必折入的 §1–4、通知矩陣、#23/#24/#26 未進 24 片。`docs/specs/2026-07-26-admin-ux-operability-review.md:102-105`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:159`：O11 只有客戶出貨信，漏掉新付款、匯款待核、物流異常、退款失敗的 LINE 即時通知與每日 Email。`docs/specs/2026-07-26-admin-ux-operability-review.md:41-58`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:95-98`：E10 完成定義漏掉前台 #240 包裹追蹤與 RF6 部分退款顯示；後台做完客戶端仍斷鏈。`docs/specs/2026-07-26-admin-ux-operability-review.md:20-22,57-60`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:168`：已拍 U5 的負責人與下次跟進日完全沒有 schema/UI 片；「今天要處理什麼」無法避免兩人互相等待。`docs/specs/2026-07-26-admin-ux-operability-review.md:72-74,98`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:204`：P2 說不做人工送達，既有已拍 U7 卻是 Phase 1 人工查、手標已送達；「決策已全數收齊」與 repo 決策直接衝突。`docs/specs/2026-07-26-admin-ux-operability-review.md:100`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:225-227`：訂貨/出貨二元膠囊表達不了同品項 3 件中已訂 2、已出 1、退 1；目標計數器模型會被 UI 壓回錯誤布林值。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152,226`：一個品項只有一組供應商資料，表達不了同 SKU 分兩家採購或同一家分批確認；需先拍「每 line 僅一採購」或另建 procurement items。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:229-230`：把「真實下單日」覆寫成最近切換日會破壞交期、SLA 與供應商績效；audit log 不是可直接查詢的 ordered_at 替代品。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:229-230`：尚未定義 no-op 是否改日期、來回切換的合法狀態、Asia/Taipei 業務日與 server/client 時鐘；午夜附近會顯示錯天。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:281-284`：「篩選必須在資料層」不成立；真正必要的是篩完重新分組並重算 rowSpan，只有對既有 DOM 隱藏第一列才會消失。`apps/admin/src/components/orders/orders-table.tsx:64-77`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:286-288`：現行註解只證明 `!inner` 回傳不完整品項時不能用該資料算彙總，不證明所有整單彙總都錯；完整投影或 DB 聚合仍可正確顯示。`apps/admin/src/components/orders/orders-table.tsx:86-93`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:290-291`：目前分頁單位是 20 張訂單，不是品項列；若改成品項分頁會拆散 rowSpan 群組，若不改則單頁仍可能爆大量列。`apps/admin/src/lib/orders/order-list-view.ts:26-27`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:251-257`：12.6%/0.4%只對 32 字元成立；依字面從 36 個英數字移除易混淆字與母音後只剩 28，實際約為 23.0%/0.929%。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:258-260`：該百分比是「至少一次首抽碰撞」，不是建單失敗率；plan 未定重試次數、亂數來源、只捕捉哪個 unique constraint、併發與告警。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:258-260`：若 RNG 壞掉或同一 transaction 重複產同候選，有限重試仍會連撞；若捕捉所有 unique violation，會把非單號衝突誤當碰撞後重試。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:154,261`：admin 列表現在已用 `created_at DESC, id DESC` 分頁，repo 沒有用 display_id 排序；「排序改 created_at」不是待做項。`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:270-273`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:263-266`：O7a 只列 CHECK 與 RPC，漏掉 domain 驗證、format/parse、型別文件與測試；新號會被現行程式判非法。`packages/domain/src/order/display-id.ts:17-18,31-52`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:266`：舊新格式並存不是只放寬 CHECK；現有 parser 假定三段舊格式，新號的 prefix、大小寫與顯示形式又未明定，明細/測試/整合可能失敗。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:154`：現行 create_order 是大型金流 SECURITY DEFINER 函式，帶 DROP/CREATE、ACL、fingerprint 與交易防線；O7a 不可能是單一 15–45 分鐘片。`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql:15-28,211-235`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:146-151`：O0、O1/O2、O3、O4、O5 都明顯需再拆；分別包含全規格重驗、權限 RPC、跨部署 contract、回填不變式、跨 app enum 相容。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152-160`：O6、O7、O7a、O7b、O9、O10、O11、O12 都超出 45 分鐘；各自混合 schema/RPC/audit/UI、共用元件、正式寄信或多份列印文件。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161-169`：O13–O21 除極窄唯讀 UI 外皆過大；付款帳本、退款全線、退貨帳本、自由品項建單、改單事件、待辦/對帳、audit ACL 必須拆片。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:172,188`：高風險片數同檔寫成 13 與 12；依表中紅色片型實際是 15，會漏掉三片對抗審查。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:172,298`：總片數先寫 24、誠實邊界又寫 22；估時基數不一致。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:61`：實際 server action 檔為 6 個，不是 7 個；route 7 與訂單元件 11 則吻合。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:203`：「申請單送出即不可改」不符引用文件；文件寫的是要改須聯繫營業所，不是永久不可改。`docs/reference/hct-logistics-api-reference.md:47-50`
- [must-fix] `STATUS.md:5,16-20`：STATUS 仍寫 E11→E8→E10，CURRENT 也仍是舊施工序；plan 宣稱取代後尚未同步 SSoT，開工 session 會走錯線。`docs/handoff/CURRENT.md:10-11`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:212`：視覺 artifact 本輪因工具安全限制讀不到、未驗證；O7b 的列高、欄寬與定案畫面一律仍是未知，不能視為已核對。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:244-245`：以字數推論列高/欄寬不增加不足；按鈕、單號長度、手機卡片與 39 個現有品項的 wrapping 都沒有 repo 內可重現驗證。


tokens used
399,147
FAIL

- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:273`：依賴表沒有閉環，但第 1 批只含 O0–O7，卻承諾依賴 O7a、O7b、O8 的新版列表與六碼編號；該批次不可能照字面驗收。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:174-176`：文件已承認 O7b 依賴 O8，卻未真正選定 O8 前移或 O7b 後移；正式站施工序仍未閉合。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:182`：`dev` 推即正式站，但 E10 沒有總 flag、hidden route 或逐批啟用閘；schema/UI 不相容時會直接打到員工。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:110,202`：C1 同時被寫成「未定」與「已拍自動後綴」；執行者無法判斷 O9/O10 是否已解鎖。
- [must-fix] `docs/reference/hct-logistics-api-reference.md:217`：HCT 參考檔仍把後綴列為未定；plan 宣稱拍板後未同步 repo 真權威，後續片會讀到兩種答案。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:157-160`：O9 先把單號寫在訂單、O10 才引入包裹，會形成兩個正式寫入真相；應先建包裹模型，再開輸入、通知與列印。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:159-160`：O11/O12 只依賴 O9，未依賴 O10；分批出貨時可能寄錯包裹單號或列出整單而非本包品項。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:167`：O19 未依賴 O10/O13/O14/O15；可修改已裝箱、已收款、已退款或退貨中的數量，破壞帳本與包裹不變式。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:168`：O20 只依賴 O4/O13，卻要做全日待辦；缺貨、出貨、退款失敗、未認領與跟進日都尚未存在，無法達成第 1 項。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:147`：`internal_note` 加在 `orders` 會被 authenticated 客戶的整表 SELECT + own-order RLS 讀到；正式寫入第一筆內部備註即洩漏。`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:182-195`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:148`：O2 標成標準片不成立；production 的 service_role 沒有 orders UPDATE，必須新增 owner RPC、ACL、CAS 與同交易 audit。`supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql:230-240`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149`：O3 只有 enum/回填，沒有取消 RPC、按鈕、部分取消與退款分流；做完仍達不到第 19 項。`apps/admin/src/lib/orders/order-actions.ts:36-134`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149,180`：O3 把 expand、回填、雙寫、讀切換、收緊塞成一片；這是多次部署流程，不是單一 15–45 分鐘可中斷片。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:149`：既有 `cancelled_reason` 是客戶可見文字，受控原因 code 與對客說明是否分欄尚未決定；直接取代會丟失舊理由或把內部 code 顯示給客戶。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:150`：O4 若先加 nullable 計數器，CHECK 對 NULL 不會證明不變式；若直接 NOT NULL，又缺 29 單回填規則與 create_order 初值，兩種做法都未形成可上線 migration。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:150`：計數器是目標真相，但 plan 未定誰原子更新、如何避免超量、如何同步訂單層 enum；只加欄與 CHECK 達不到第 4、5、7、18 項。`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:381-396`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,180`：PostgreSQL enum 加值不可逆、不能 contract；「所有 DB 片一律 expand/contract」對 O5 字面不成立。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151`：O5 漏列 domain 型別、轉移表與 storefront exhaustive 顯示；DB 出現新值時舊程式可能取不到 label 或轉移失敗。`packages/domain/src/order/types.ts:45-57`, `packages/domain/src/order/state-machine.ts:47-55`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,204`：plan 要加 `delivered`，又拍板不自動追蹤、也不手標送達；新狀態與 `delivered_at` 沒有可信 writer。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,221-227`：訂貨/出貨已拍 item 層，O5 卻擴充 order 層 fulfillment enum；混合品項如何彙總成 backorder/delivered 未定。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152`：O6 標成標準片但實際需要 schema、owner RPC、CAS、audit 與 UI，命中 DB/權限且明顯超過 45 分鐘。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152`：O6 只存供應商名、單號與 ETA，漏掉已核准的聯絡管道、送出時間、回覆狀態、異常原因與自由文字正規化。`docs/specs/2026-07-26-admin-ux-operability-review.md:33-39`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:153`：AdminDataTable 現在明載批次選取未做，且 orders 互動 cell 雙渲染會產生重複表單；O7 不是單純補 checkbox。`apps/admin/src/components/shared/admin-data-table.tsx:10-18`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:156,158`：O8 先把單號/時間放 orders，O10 才建立包裹真相；未定摘要同步、回填與 contract，會永久形成雙寫欄位。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:158`：O10 只寫「一單多包裹」，漏掉 Sean 已拍 U1 的「多單併一箱」與 shipment_items。`docs/specs/2026-07-26-admin-ux-operability-review.md:92-95`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:158,202`：`-1/-2` 的序號來源、刪包裹後是否重排、重送是否沿用皆未定；若依畫面順序重算，HCT 會把舊識別值當更正或報重複。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161`：O13 把多筆匯款、差額、催款、溢款處置與稽核塞一片，且未建付款帳本；單一 order 欄位無法表達多次付款。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161`：匯款退款去向、受款帳戶複核、轉帳參考號與防重複匯款完全缺席；取消匯款單時無法安全退錢。`docs/specs/2026-07-26-admin-ux-operability-review.md:28-31`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:162`：O14 不是「接帳本做 UI」；production 帳本只允許 service_role SELECT，RF2b 寫入 RPC 到 RF8 覆核都未完成。`supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:312-325`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:162`：因此 O14 做完仍不能執行退款，第 17 項映射不誠實；既有退款線明列 RF2b–RF8 尚待施工。`PROGRESS.md:780-787`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:163`：O15 漏掉已核准的 `order_refunds.return_id` 關聯；貨與錢無法對帳。`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:398-404`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:165`：O17 未依賴 O7a，也沒要求共用同一產號器；手動建單可能繼續產舊號或複製另一套碰撞邏輯。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:165-166`：手動單的自由品項價格、稅/折扣、客戶與地址、付款狀態、庫存影響和 dealer-price 權限都未決定，O17/O18 不可開工。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:167`：O19 未折入 U2「已裝進包裹部分鎖定」；直改全部會讓歷史出貨內容與訂單現況分裂。`docs/specs/2026-07-26-admin-ux-operability-review.md:94-96`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:169`：O21 無依賴且標準片不成立；production 的 service_role 對 audit log 無 SELECT，UI 目前讀不到。`supabase/migrations/20260712210000_m4a_admin_audit_log.sql:80-89`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:100-102,169`：第 27 項標「E8-B 前不可信」是正確的，但 O21 還缺安全讀取 RPC/ACL；現況連「不可信的 UI」也無法交付。`apps/admin/src/lib/orders/order-repository.ts:35-50`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:155`：O7b 是列表顯示片，卻映射第 8「輸入單號」與第 19「取消操作」；顯示欄位不會讓兩項變綠。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:151,155`：第 7「缺貨要等」只有 order enum 與二元膠囊，沒有 item 缺貨數量、異常原因、已告知客人紀錄；仍無法跑真流程。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:95-98`：宣稱 17 項全綠，但 approved UX 明定必折入的 §1–4、通知矩陣、#23/#24/#26 未進 24 片。`docs/specs/2026-07-26-admin-ux-operability-review.md:102-105`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:159`：O11 只有客戶出貨信，漏掉新付款、匯款待核、物流異常、退款失敗的 LINE 即時通知與每日 Email。`docs/specs/2026-07-26-admin-ux-operability-review.md:41-58`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:95-98`：E10 完成定義漏掉前台 #240 包裹追蹤與 RF6 部分退款顯示；後台做完客戶端仍斷鏈。`docs/specs/2026-07-26-admin-ux-operability-review.md:20-22,57-60`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:168`：已拍 U5 的負責人與下次跟進日完全沒有 schema/UI 片；「今天要處理什麼」無法避免兩人互相等待。`docs/specs/2026-07-26-admin-ux-operability-review.md:72-74,98`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:204`：P2 說不做人工送達，既有已拍 U7 卻是 Phase 1 人工查、手標已送達；「決策已全數收齊」與 repo 決策直接衝突。`docs/specs/2026-07-26-admin-ux-operability-review.md:100`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:225-227`：訂貨/出貨二元膠囊表達不了同品項 3 件中已訂 2、已出 1、退 1；目標計數器模型會被 UI 壓回錯誤布林值。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152,226`：一個品項只有一組供應商資料，表達不了同 SKU 分兩家採購或同一家分批確認；需先拍「每 line 僅一採購」或另建 procurement items。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:229-230`：把「真實下單日」覆寫成最近切換日會破壞交期、SLA 與供應商績效；audit log 不是可直接查詢的 ordered_at 替代品。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:229-230`：尚未定義 no-op 是否改日期、來回切換的合法狀態、Asia/Taipei 業務日與 server/client 時鐘；午夜附近會顯示錯天。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:281-284`：「篩選必須在資料層」不成立；真正必要的是篩完重新分組並重算 rowSpan，只有對既有 DOM 隱藏第一列才會消失。`apps/admin/src/components/orders/orders-table.tsx:64-77`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:286-288`：現行註解只證明 `!inner` 回傳不完整品項時不能用該資料算彙總，不證明所有整單彙總都錯；完整投影或 DB 聚合仍可正確顯示。`apps/admin/src/components/orders/orders-table.tsx:86-93`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:290-291`：目前分頁單位是 20 張訂單，不是品項列；若改成品項分頁會拆散 rowSpan 群組，若不改則單頁仍可能爆大量列。`apps/admin/src/lib/orders/order-list-view.ts:26-27`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:251-257`：12.6%/0.4%只對 32 字元成立；依字面從 36 個英數字移除易混淆字與母音後只剩 28，實際約為 23.0%/0.929%。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:258-260`：該百分比是「至少一次首抽碰撞」，不是建單失敗率；plan 未定重試次數、亂數來源、只捕捉哪個 unique constraint、併發與告警。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:258-260`：若 RNG 壞掉或同一 transaction 重複產同候選，有限重試仍會連撞；若捕捉所有 unique violation，會把非單號衝突誤當碰撞後重試。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:154,261`：admin 列表現在已用 `created_at DESC, id DESC` 分頁，repo 沒有用 display_id 排序；「排序改 created_at」不是待做項。`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:270-273`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:263-266`：O7a 只列 CHECK 與 RPC，漏掉 domain 驗證、format/parse、型別文件與測試；新號會被現行程式判非法。`packages/domain/src/order/display-id.ts:17-18,31-52`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:266`：舊新格式並存不是只放寬 CHECK；現有 parser 假定三段舊格式，新號的 prefix、大小寫與顯示形式又未明定，明細/測試/整合可能失敗。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:154`：現行 create_order 是大型金流 SECURITY DEFINER 函式，帶 DROP/CREATE、ACL、fingerprint 與交易防線；O7a 不可能是單一 15–45 分鐘片。`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql:15-28,211-235`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:146-151`：O0、O1/O2、O3、O4、O5 都明顯需再拆；分別包含全規格重驗、權限 RPC、跨部署 contract、回填不變式、跨 app enum 相容。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:152-160`：O6、O7、O7a、O7b、O9、O10、O11、O12 都超出 45 分鐘；各自混合 schema/RPC/audit/UI、共用元件、正式寄信或多份列印文件。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:161-169`：O13–O21 除極窄唯讀 UI 外皆過大；付款帳本、退款全線、退貨帳本、自由品項建單、改單事件、待辦/對帳、audit ACL 必須拆片。
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:172,188`：高風險片數同檔寫成 13 與 12；依表中紅色片型實際是 15，會漏掉三片對抗審查。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:172,298`：總片數先寫 24、誠實邊界又寫 22；估時基數不一致。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:61`：實際 server action 檔為 6 個，不是 7 個；route 7 與訂單元件 11 則吻合。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:203`：「申請單送出即不可改」不符引用文件；文件寫的是要改須聯繫營業所，不是永久不可改。`docs/reference/hct-logistics-api-reference.md:47-50`
- [must-fix] `STATUS.md:5,16-20`：STATUS 仍寫 E11→E8→E10，CURRENT 也仍是舊施工序；plan 宣稱取代後尚未同步 SSoT，開工 session 會走錯線。`docs/handoff/CURRENT.md:10-11`
- [must-fix] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:212`：視覺 artifact 本輪因工具安全限制讀不到、未驗證；O7b 的列高、欄寬與定案畫面一律仍是未知，不能視為已核對。
- [nit] `docs/specs/2026-07-27-e10-order-closure-master-plan.md:244-245`：以字數推論列高/欄寬不增加不足；按鈕、單號長度、手機卡片與 39 個現有品項的 wrapping 都沒有 repo 內可重現驗證。


