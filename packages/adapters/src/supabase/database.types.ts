// database.types.ts — Supabase 生成型別(勿手改;以下命令重 gen 後此檔含中文檔頭會被沖掉、需重貼本段)。
// 🔴🔴 重 gen 後要重貼的**不只中文檔頭** —— 本體另有**十二個函式、共二十八處**手動校正
//   (2026-08-16 `#525` +1:`admin_search_customers` 整段 —— 它在正式庫還不存在〔migration 未 apply〕,
//    ⇒ **現在重 gen 不會產生它**;apply 之後重 gen 時**先比對再刪那一段**,不要因為「反正會生成」就先拿掉)
//   (🔴 本行是計數的**唯一權威**;下方各段一律寫「見檔頭計數」、不再各自複述數字 ——
//    2026-08-05 A9d2-2 實查:同一個數字散在四處,改一處漏三處是遲早的事):
//   ① `create_order.Args` 三處(p_client_ip / p_client_ua / p_notification_email 的 `| null`)
//   ② `admin_upsert_supplier.Args` 四處(p_supplier_id / p_label / p_is_active / p_note 的 `| null`)
//   ③ `admin_append_order_note.Args` **三處**(p_channel / p_occurred_at / p_corrects_note_id 的 `| null`;2026-08-02 A6 起)
//   ④ `admin_initiate_order_refund.Args` **兩處**(p_amount / p_record_amount 的 `| null`;2026-08-04 RW2c 起)
//   ⑤ `admin_finalize_order_refund.Args` **三處**(p_tappay_refund_id / p_refund_amount_wire / p_failed_detail 的 `| null`;同 RW2c)
//   ⑥ `admin_upsert_item_procurement.Args` **五處**(p_contact_channel / p_submitted_at / p_supplier_order_no /
//      p_exception_reason / p_expected_arrival_date 的 `| null`;2026-08-04 A10b 起 —— A5a 落地時刻意不補,
//      補了也沒有呼叫端會被 typecheck 守住;A10b 是第一個呼叫端,補在這一刻才有保護力)
//   ⑦ `admin_cancel_order.Args` **一處**(p_reason_detail 的 `| null`;2026-08-05 A9d2-2 起)
//      —— 🔴 `p_items` **不在校正之列**:生成型別是 `Json`,而本檔 `Json` 聯集本身已含 `null`
//      (見下方 `export type Json`)⇒ 整單取消送 null 本來就過,再加 `| null` 是重複且誤導。
//   ⑧ `admin_record_item_receipt.Args` **一處**(p_note 的 `| null`;2026-08-11 #352-b 起 ——
//      到貨備註留空是常態呼叫;理由與「其餘六個為何不補」寫在該函式區塊)
//   ⑨ `search_products_by_vehicle.Args` **兩處**(p_model / p_year 的 `| null`;2026-08-11 #415 起 ——
//      這一支與前八支的形狀**不同**:前八支是「必填但可為 null」,它是「**可省略且可為 null**」
//      (正式站實查 `p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer`);
//      生成器只寫得出 `?`,寫不出 `| null`。補這兩處的理由=呼叫端送的是**顯式 null**,
//      不補就只能改送 undefined,那是改 payload 不是整理型別)
//   ⑩ `admin_search_orders.Args` **兩處**(p_from / p_to 的 `| null`;2026-08-11 #415 起 ——
//      與 ⑨ 同形狀「可省略且可為 null」;呼叫端刻意一律帶兩個鍵、沒有值送顯式 null
//      〔#347-3b:不用 spread,才能讓「忘了帶」變編譯錯誤、也才掃得到參數名〕。
//      p_limit **不補**:呼叫端一律帶值,沒有送 null 的路徑)
//   ⑪ `admin_update_order_item_amount.Args` **一處**(p_zero_price_reason 的 `| null`;2026-08-15 #13 片1b 起 ——
//      與 ⑨⑩ 同形狀「可省略且可為 null」(`text DEFAULT NULL`,migration `20260815040000:332`);
//      呼叫端 `SupabaseOrderAdapter.updateAdminOrderItemAmount` 一律帶鍵、非 0 元送顯式 null。
//      ✅ 實測承重:未補之前 `npx tsc -p packages/adapters` 逐字 TS2322
//      `Type 'string | null' is not assignable to type 'string | undefined'`。
//      其餘六個**不補**:RPC `:350`-`:362` 皆 fail-closed 拒 NULL。
//      ✅🔴 **這一處漏貼會自己紅** —— 已實測(2026-08-15,突變複本):拿掉本處的 `| null` ⇒
//      `tsc` 逐字 `TS2322: Type 'string | null' is not assignable to type 'string'`,
//      因為呼叫端傳的就是 `string | null`。
//      ⚠️ **不得讀成「校正漏貼都會被抓到」** —— 這層保護只對「呼叫端真的會傳 null」的校正成立;
//      其餘各處的防線仍然只有「人重貼」+ 外部檢查腳本(缺口已立 backlog `#518`))
//   ⑫ `admin_search_customers` **整段**(`#525`,2026-08-16)—— 與 ①–⑩ **形狀不同**:
//      前十個是「既有函式的參數補 `| null`」,**這一個是整支函式在正式庫還不存在**
//      (migration `20260816010000_*` 未 apply)⇒ **現在重 gen 不會產生它,而不是產生錯的它。**
//      🔴 apply 之後重 gen:**先比對生成內容與本段是否一致,再刪本段** ——
//         不要因為「反正會生成」就先拿掉,那會讓中間任何一次 gen 失敗變成靜默的型別漏洞。
//   共同根因:PostgREST 的型別產生器表達不了「必填但可為 null」(⑨⑩⑪ 是「可省略且可為 null」),一律型別化為非 null。
//   漏貼 ① = 金流建單路徑型別紅;漏貼 ② = 供應商設定頁型別紅;漏貼 ③ = 備註線 A9d2-1 寫 internal note 時型別紅
//   (internal 這個型別**必須**三個都傳 NULL —— 那是 order_notes 的配對規則 CHECK);
//   漏貼 ④⑤ = 退款線 RW2c repository 型別紅(kind/outcome 互斥矩陣的「必須傳 NULL」全紅);
//   漏貼 ⑥ = A10b 採購表單只要有任一選填欄留空就型別紅(全量 payload、空欄就是送 NULL);
//   漏貼 ⑦ = 取消線 A9d2-2 repository 型別紅(七個原因碼裡有六個要送 NULL 說明;
//      嚴格說 btrim 後為空的字串也收,但 null 才是自然寫法 —— 詳見該函式區塊註解)。
//   2026-08-01 ① 已被沖掉三次(A7c、S1b、S2)、② 自 S2 起存在;2026-08-02 A6 起共十處(**當時**);
//   2026-08-04 RW2c(④⑤)+ A10b(⑥)同夜各補五處、合流後共二十處(**當時**的數字,主視窗併回時對帳;
//   現行計數一律以檔頭 :2 為準)。
// 🔴🔴 **下面那行 project ref 有【位置】約束:在它以上加文字會撞紅一道守門。詳見本段下方。**
// 🔴 重 gen 一律用 --project-id(走 Management API、不讀 .env.local):
//     supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts
//   勿用 --linked / --db-url(會 parse .env.local、踩 2026-06-17 db push session 的 .env.local 非 ASCII 變數名 parse 失敗坑)。
//   ✅ 實測 2026-08-01(三次)+ 2026-08-02(第四次):`gen types --project-id` **不受 .env.local 影響**。
// 🔴🔴 **上面那行 project ref 的位置約束(2026-08-15 實測撞過一次)**:
//   `apps/admin/src/lib/payment/composition.test.ts` 讀本檔的**前 4000 個字元**,斷言裡面含 project ref
//   —— 它守的是「`PROD_SUPABASE_HOST` 與型別檔來自同一個專案」。
//   ⇒ **在 gen 指令那行【以上】加文字會把它推出 4000 之外,那一格就紅**,
//   而紅的訊息看起來像 host 常數壞了、不像有人加了註解 ⇒ 下一個人會去查錯的地方。
//   ⚠️ 量法(落筆前自己跑,別抄下面這個數字 —— 它每加一行就過期):
//     node -e "const s=require('fs').readFileSync('packages/adapters/src/supabase/database.types.ts','utf8');console.log(s.indexOf('bmpnplmnldofgaohnaok'))"
//   🔴 注意單位:那道守門用的是 **JS 字元數**,`head -c` 數的是 **byte** —— 中文一個字 3 bytes,兩者差很多。
//   ⇒ **要加長文,一律加在本段以下。**
//     需要暫時移開 .env.local 的是 `db push` / `migration list`,不是 gen types。
//
// 🔴🔴 **而「唯一權威」的另一面:這個數字【沒有第二個來源】,任何驗它的腳本都與它同源。**
//   (2026-08-15 E 窗審 `433bcf26` 判 must-fix;A 窗實測後確認成立。)
//   ⚠️ **失敗形狀**:第 28 處校正若從來沒被寫進本行 ⇒ 本行不知道、驗證腳本也不會去找它
//   ⇒ **兩邊一起說 OK、四綠全綠**;症狀要等「呼叫端真的送 null」那天才出現。
//   ⇒ 拿掉一處會被抓到(**偵測力**有),但「該被校正的恰好是這幾處」(**分母**)沒有東西在守。
//
//   **能不能改成從 migration 推出分母?A 窗 2026-08-15 實測:不能。** 逐條量過:
//     · `DEFAULT NULL` 掃描能對上的被校正參數名 = **6 / 26**(26 = 27 處去重後的參數名,p_note 橫跨兩支函式)
//     · **掃不到 20 個** —— 因為 ①-⑧ 那族是「**必填但可為 null**」(簽章**沒有** DEFAULT),
//       要不要補取決於**函式體是不是 fail-closed 拒 NULL** ⇒ **那不是簽章的性質,掃不出來**
//     · 反向多出 **13 個**「有 DEFAULT NULL 但不該補」的誤報候選(補了會讓非法呼叫變合法)
//     · 🔴 而且掃出來的是**裸參數名**,校正的單位是 **(函式, 參數)** ⇒ **鍵就不對**
//       (`p_from`/`p_to` 的命中其實來自 `admin_today_payment_total`,不是被校正的 `admin_search_orders`)
//     · 🔴 字集也比宣稱窄:`int` vs `integer`、`timestamptz` 各漏一批(`p_year` 寫的是 `int DEFAULT NULL`)
//     · 🔴 更根本:⑨⑩ 的 DEFAULT 是**正式站實查**寫下的,**repo migrations 不是那個世界的權威**
//   ⇒ **結論:這個分母目前只能靠人維護,而上面那幾條是「為什麼」,不是藉口。**
//   ⇒ 做得到的那半已立 backlog `#523`:**不是算出正確處數,是「有新候選出現時讓某格紅」**
//     (對 (函式,參數) 鍵、只涵蓋 DEFAULT NULL 那一族 ⇒ **涵蓋不到 ①-⑧,那個限度要寫在守門旁邊**)。
//   ⚠️ **不要為了收掉這條而把本行講得更權威** —— 它已經是權威了,缺的是**第二個來源**。
// 反映 LIVE prod schema(🔴 **2026-08-11 晚重 gen(當日第二次,D 窗六代)** ——
//   E10 #15-B1(`20260811090000` 收款列表唯讀 RPC)apply 之後;
//   目的 = **拆掉 B2-a 的型別縫**(`apps/admin/src/lib/orders/payment-repository.ts`
//   原本用區域型別繞過具名 `.rpc()`,同 commit 一起改回具名呼叫)。
//   本次 diff **恰 11 行、全新增、零刪除** —— ⚠️ **這個數字有範圍前提,照抄整檔跑會對不上**:
//   它量的是**切 `^export type Json` 之後的本體**(舊版本體 vs 合併後本體),
//   等價於「合併腳本剛跑完、檔頭還沒編輯」那一刻的整檔 diff。實測三個數字都留著免得後人誤判:
//     · 本體 vs 本體 = **11**(全 `>` 側,`<` 側 0)← 這才是「校正沒被沖掉」的那個證據
//     · 整檔 舊 vs 現行 HEAD = **41**(多出來的 30 行是本段新寫的檔頭紀錄)
//     · 整檔 舊 vs **原始生成檔** = **258**(整段中文檔頭 + 22 處校正都在裡面,與校正無關)
//   六段各自對得上一支 migration(主視窗 D-501-A 條件③:多出來的段要講得出來源):
//     · `admin_list_order_payments` ← `20260811090000`(本次目的)
//     · `search_catalog_by_vehicle.p_new_since` + `products_list_public.created_at`
//       ← `20260811040000`(#269-b 新品線;MF-10 要的就是前者)
//     · `admin_compute_order_settlement` ← `20260811030000`(op6a,**已 apply**,見下方那條已作廢的註記)
//     · `payment_refunds.rec_trade_id` 三處 ← `20260811080000:239`(L5b-2 片 2c 純加法欄)
//     · `claim_stuck_unsettled_attempts.superseded_at` ← `20260811060000`(L5b-2 片 2a claim 回傳形狀)
//   🔴 **零刪除本身就是「校正沒被沖掉」的機械證據** —— 校正全是既有行,少一行必出現在 `<` 側。
//   🔴 本次八支**機械比對**(腳本比參數名集合,非肉眼)全通過:參數集合 8/8 相等、
//      重貼後 **22/22 處逐塊實查在位**(數法 = 對八個 Args 區塊 regex 數行尾 `| null`;
//      同一支腳本對**原始生成檔**數出 **0** ⇒ 那個數法看得見校正被沖掉、不是恆真)。
//   ⚠️ 寫腳本踩到的坑,留給下一個人:多區塊替換要**按檔案位置由後往前**,
//      不能按清單順序 `reversed()` —— 清單順序 ≠ 檔案順序,第一版把
//      `admin_initiate_order_refund` 插成兩份(靠「每支恰出現一次」那道檢查才抓到)。
//   ── 以下兩段都保留:上一輪(2026-08-11 當日第一次)重 gen 的紀錄,
//      以及 `:68` 起**給每一個重 gen 的人的通則**(通則不隨輪次過期) ──
//   🔴 **2026-08-11 重 gen(當日第一次)** —— #352 到貨登錄線 a1/a2/甲片
//   (`20260810230000` / `20260810233000` / `20260811010000`)+ #277 車型分類 view
//   (`20260811020000`)apply 之後。
//   本次帶進來的**不只本片的產物**,還有別線已 apply 但當時沒重 gen 的存量:
//   `admin_record_item_receipt` / `admin_delete_item_receipt`(#352 到貨登錄兩支 RPC,本片)/
//   `vehicle_taxonomy_public` view(#277)/ `admin_record_manual_payment` /
//   `admin_reverse_manual_payment` / `admin_search_orders` / `supersede_charge_attempt_for_user` 等。
//   ~~🔴 `op6a`(`20260811030000`,`compute_order_settlement`)**在 migrations 目錄裡但尚未 apply**
//      ⇒ 它的產物**不在本檔=正確**,不得手補~~ **⚠️ 本行已作廢(2026-08-11 晚)**:
//      它已 apply,`admin_compute_order_settlement` 這次由生成器帶進來了。
//      留著原文是因為那個**形狀**仍然成立(未 apply 的產物不該手補,同 2026-08-07 a9v/a9b2_m);
//      作廢的只是「op6a 未 apply」這個當時的事實。
//   🔴 那些**不是本片的產物、形狀一律照生成值原樣收下**(主視窗 `P-226-A` ③:只貼回校正、
//      不順手改別人的形狀)。
//   🔴 校正的重貼方式(留給下一個重 gen 的人;**筆數見檔頭 `:2`,此處刻意不複述**):
//      **逐函式整塊替換 + 參數名集合比對** ——
//      先確認該函式在新舊兩版的參數集合完全相同(= 只有校正被沖掉、沒有真的簽章變更),
//      才用舊版區塊蓋回去;任一函式參數有增減就停下人工判斷,不硬蓋。
//      **那一次**(08-11 regen 當下)七支**機械比對**(非肉眼)全數通過:參數集合 7/7 相等、
//      重貼後 21/21 處逐條實查在位。⚠️ 這兩個數字是**該時點的紀錄、不是現行計數** ——
//      同日稍晚 #352-b 補上第 ⑧ 支(`admin_record_item_receipt.p_note`)⇒ 現行計數見 `:2`。
//   🔴 切「檔頭 vs 本體」的分界**必用行首錨點**(`^export type Json`)—— 檔頭註解自己就提到那個字串
//      (見上方 ⑦ 的 `p_items` 說明)⇒ 用裸子字串切會在第 14 行攔腰砍掉整段檔頭。
//      2026-08-11 本次真的踩了、當場 `git checkout HEAD --` 復原重做;下一個人別再踩。
//   ── 以下為上一輪 2026-08-09 重 gen 的紀錄,保留供追溯 ──
//   (2026-08-09 重 gen —— M-4b LINE 3DS 修復片,
//   `20260809004000_m4b_line3ds_address_email`(customer_addresses.email)apply 之後;
//   帶進來的存量:`customer_addresses.email`(該片)/ `supplier_order_no_upper` /
//   `pcm_b2_shipping_idempotency` 表 / `sound_clips` / `admin_add_shipment_items` 與
//   `pcm_b2_shipping_idem_*` 等 B 線函式。)
//   ── 以下為上一輪 2026-08-07 重 gen 的紀錄,保留供追溯 ──
//   (2026-08-07 重 gen —— B2-S2a/S2b 兩支 + A9h-M 三支 apply 之後;
//   本次新增:摘要表第四軸 `shipped_quantity`、`shipments` / `shipment_items` **兩張表首次進型別**
//   (在此之前整條 B2-S1 線的表從未被重生進來)、`admin_upsert_item_procurement` 12 參。
//   🔴 `a9v`(20260807120000)/ `a9b2_m`(20260807130000)**仍 pending** ⇒ 其產物**不在本檔=正確**,不得手補。)
//   ── 以下為上一輪 2026-08-05 重 gen 的紀錄,保留供追溯 ──
//   (2026-08-05 重 gen〔A9d2-2 開工前,取消線 UI 接線〕:
//   **A8c1/A8c2/A8a1/A8a2 四片皆已 apply** ——
//   **新增** public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) → jsonb
//   = 訂單取消的**唯一寫入路徑**(SECURITY DEFINER owner RPC、search_path=''、lock_timeout=5s、
//   service_role only)。`p_items` NULL = 整單取消;`p_items` = `[{order_item_id,quantity}…]` = 品項部分取消。
//   🔴 **它不回固定碼**(與 admin_append_order_note 的 14 碼形狀根本不同):
//   成功回 jsonb `{cancelled, cancellation_id, idempotent, closed}`(migration `:334-335` 冪等重放 /
//   `:487-488` 首次 —— 全函式僅此兩處 RETURN、鍵集合相同);**失敗一律 RAISE**,
//   且 DB COMMENT 逐字「業務拒絕=通用訊息;輸入類=具體訊息」——29 處全吐同一句
//   `admin_cancel_order: 取消失敗`,刻意不讓呼叫端從文字反推規則。
//   🔴 **那 29 處不全是「業務拒絕」**(2026-08-05 關卡2 更正):它同時涵蓋 ①真正的業務拒絕
//   (已付款/已取消/有到貨/超量…)②**冪等 hash 或 actor 不符**(`:206-208`)③**帳本病理**
//   (`:342-352` 對客欄殘留 / Σci>quantity / 零明細 header)。三者訊息**逐字相同**
//   ⇒ 連記 log 都分不出來,呼叫端只能一律當「這張單現在不能取消」處理。
//   🔴 呼叫端契約債(A9d2-2):「斷言回傳碼全集」在這支上的對應物 = **斷言成功 payload 的形狀全集**
//   (鍵集合恰等 / `cancelled === true` / `cancellation_id` 為 uuid / 另兩者為 boolean),任一不符 = 呼叫端 bug。
//   🔴🔴 錯誤面**不能只靠 SQLSTATE 分乾淨**(2026-08-05 R1 must-fix 更正本段舊字面「P0001=業務拒絕」):
//   通用訊息 29 處(內容見上:業務拒絕+hash 不符+帳本病理)與**輸入類 11 處**
//   (`:117/129/138/142/149/154/159/164/170/174/178`)**都是預設的 P0001**
//   —— 全函式只有隔離閘 `:112` 顯式帶 `P8C01`。⇒ **P0001 無法由 SQLSTATE 區分「單子不能取消」與「呼叫端送了畸形參數」**。
//   本線的處置(plan §4.2/§4.3):UI 分支仍**不解析訊息文字**(不綁 migration 中文字面),
//   P0001 一律顯示通用的「請重新整理確認狀態」;**但 server 端一定要把 `error.message` 記進 log**
//   (只記 `code` + `message` 前 200 字,**不記 `details`/`hint`** —— PG 的 DETAIL 會把整列內容
//    送進 Vercel log;寫法照 `apps/admin/src/lib/orders/note-actions.ts:144-152`)
//   —— 判別器不是被丟掉,是從 UI 分支移到營運可觀測面,否則**輸入類**的呼叫端 bug 會被靜默吞成通用拒絕。
//   ⚠️ 但要認清它的上限:log 只分得出「具體訊息 vs 通用訊息」,**分不出那 29 處通用訊息彼此**
//   (hash 不符與真正的業務拒絕逐字相同)⇒ 這是本 RPC 刻意的設計,呼叫端不要假裝分得出來。
//   其餘碼:`P8C01`(隔離閘)・`42501`(權限被撤)・`PGRST202`(**簽章漂移/找不到函式**,
//   PostgREST schema cache 面、不是 42501)・`23514`(A4a 重算撞 A1 CHECK)= bug(部署/資料面,重按不會好);
//   `55P03`(lock_timeout,`:92` 設 5s)・`40P01`(死結)= 可重試。
//   (`22003` 列在 bug 桶屬防禦性列舉:`:173-174` 在任何 `::integer` 轉型前就用 P0001 擋掉超界 quantity,
//    p_items 路徑上目前看不出可達點。)
//   🔴 冪等鍵與 payload **綁定**:`v_hash` 涵蓋 order_id + reason_code + detail + canonical 品項串
//   (`:195-198`),payload_hash 不符即通用 RAISE(`:206-208`)⇒ 呼叫端**不得**照備註片
//   「失敗一律原樣帶回同一顆 token」——改值重送必撞 hash。
//   承前 2026-08-03 深夜第二次重 gen〔RW2b 開工前〕:**A4a(20260803140000)+
//   RW1a(20260803150000)+ A5a(20260803160000)三支皆已 apply** ——
//   **新增** public.admin_upsert_item_procurement(11 參數) → text(A5a 採購 upsert owner RPC)。
//   ✅ 其 Args 五處**已於 2026-08-04 A10b 開工時補上** `| null`(p_contact_channel / p_submitted_at /
//   p_supplier_order_no / p_exception_reason / p_expected_arrival_date —— migration `:228-289` 逐欄可為 NULL、
//   正規化後肉眼全空亦收斂成 NULL;其餘六參數函式內 fail-closed 拒 NULL、型別非 null 是對的)。
//   當初刻意延後的理由 = 呼叫端不存在時補了也沒有 typecheck 會守住;A10b 就是第一個呼叫端。檔頭計數見上。
//   🏁 **2026-08-07 更新:A9h-M 已 apply、本檔已重 gen** ⇒ 12 參是**生成的**,不再是手寫補丁。
//   🔴🔴 **那個手寫補丁留下一個教訓,寫在這裡免得下次再做**:它的理由逐字是「好讓 typecheck 反映真實合約」,
//     但 2026-08-07 實測(移除該參數後 `pnpm typecheck` 仍 **RC=0**)證明**它零保護力** ——
//     這條呼叫路徑今天沒有被生成型別守住。更糟的是它**掩蓋了一次正式站事故**:
//     型別檔宣稱 12 參,讓所有人以為合約已對齊,而正式站 `pronargs=11`
//     ⇒ 採購 upsert 自 A9h-1 上線起在正式站是壞的(PGRST202),直到 2026-08-07 緊急 apply 才修復。
//     ⇒ **「為了讓 typecheck 反映未 apply 的合約而手寫補型別」= 防護命名超過實際能力 + 遮蔽真實狀態,不要再做。**
//   ── 以下為當時的原文,保留供追溯 ──
//   (🔴 2026-08-06 A9h-M(`20260806200000`)**尚未 apply、本檔尚未重 gen**:該片把本函式改成
//   **12 參**(尾端 `p_preserve_optional_fields boolean DEFAULT false`)。此刻先以手寫方式補進
//   Args(照 DEFAULT 參數該有的可省略形狀)好讓 typecheck 反映真實合約;**apply 後仍須重 gen**
//   並照檔頭計數重貼校正 —— 本片沒有新增校正項,計數不變。
//   承前 RW1a ——
//   **新增** public.admin_initiate_order_refund(8 參數) → jsonb / public.admin_finalize_order_refund(7 參數) → jsonb
//   = order_refunds 的唯二 service_role 寫入路徑(SECDEF owner RPC)。initiate 回 8 固定碼、finalize 回
//   3 固定碼 + outcome 6 碼(碼全集與重播/hold 契約詳兩函式 DB COMMENT;呼叫端必斷言 ∈ 全集)。
//   order_refunds 增四欄(kind / record_refunded_before / provider_refund_id_evidence / failed_detail)
//   + status 第四值 deferred + request_id 全域 UNIQUE + single-flight partial unique;
//   pcm_order_refundable_remaining 改 allowlist(processing+confirmed 佔額)。A4a = 數量摘要重算線(trigger 網)。
//   ✅ RW2c(2026-08-04)已補兩支退款 RPC 的 Args `| null` 五處(= 上方 ④⑤;檔頭計數見上)。
//   (承前基準 2026-08-02 A6,其契約債註記保留如下 ——
//   **新增** public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text) → text
//   = 訂單備註的**唯一寫入路徑**(SECURITY DEFINER owner RPC;order_notes 對 service_role 只開 SELECT、
//   RLS on 零 policy)。唯一動作 = 單列 INSERT + 同交易 admin_audit_log(action=order_note.append)。
//   回 14 固定碼:APPENDED / ORDER_NOT_FOUND / INVALID_INPUT / INVALID_TYPE / INVALID_CHANNEL /
//   CONTACT_FIELDS_REQUIRED / INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_OUT_OF_RANGE /
//   OCCURRED_AT_IN_FUTURE / INVALID_BODY / BODY_TOO_LONG / DUPLICATE_REQUEST /
//   CORRECTS_NOT_FOUND / ALREADY_CORRECTED。
//   🔴 呼叫端契約債(A9d2-1):必須斷言回傳碼 ∈ 14 碼全集,未知碼 = 呼叫端 bug;
//   **DUPLICATE_REQUEST 要按成功處理**(它意謂該 request 已寫入過且經查驗),顯示成錯誤會誘發員工
//   換 request_id 重送 = 製造重複備註(plan v4 F3)。
//   前次基準鏈 = 2026-08-02 A6 ← 2026-08-01 晚 S2)。
// ⚠️ 2026-07-29 那次重 gen 移除了 products_public / products_list_public / product_variants_public 三個 view 的
//   Insert / Update 型別(CLI 依 view 可更新性判定)。已實查:三者的消費端全是 .select() 讀路徑,
//   寫入一律走 base products 表(SupabaseProductAdapter 註解逐字「save 走 base products 表」)⇒ 移除無影響,
//   由 typecheck 把關。若日後真要寫 view,先確認 view 可更新性再處理,勿手動補型別。
//
// ── 2026-08-14 重 gen(#484a 片 A2)——三件要知道的 ─────────────────────────────
// ① 🔴 **這次重 gen 服務的不只一條線**:除了 `admin_order_list_v`(#484a、E 線),
//    同時帶進 `order_item_procurement` 的 `void_reason` / `voided_at`(**#452 甲片、V 線**)。
//    ⇒ 看到本檔變動時不要只對照 #484a 的 diff。
//    ✅ `#489` 的兩個結案動作**本片都做了**:①`order_item_procurement.Row` 實查 **17 欄**、
//    兩欄都在(數法用 `#489` 自己寫的 awk)②`mappers/order-procurement.ts` 的兩欄已從交集側
//    **搬回 `Pick<>`**、還債註解已刪 ⇒ **這一刻起改 DB 的可空性真的會有一格轉紅**。
//    (只做①不做② = 「有 typecheck 保護」這句話是假的 —— 消費端還是手寫的。)
// ② ⚠️ **`graphql_public` schema 整段從生成輸出消失了**(舊檔 `:196-220`,CLI v2.98.1 產不出來)。
//    落筆當下實查:**TS/TSX 消費端 0 命中**(`grep -rn graphql_public --include='*.ts' --include='*.tsx'`
//    排除本檔)⇒ 移除無影響。
//    ⚠️ **不要寫成「grep 0 命中」** —— 全 repo 純文字 grep 實得 **6 命中**(`.claude/settings.json`、
//    兩份 docs、一支 migration 等散文提及)。0 的是**程式碼消費端**,不是字串出現次數;
//    寫成前者會讓下一個人以為 grep 是空的,而他一跑就看到 6 筆、然後不知道該信哪一句。
//    若日後要用 pg_graphql,重 gen 也不會把它帶回來 —— 那時要先查 CLI 的 `--schema` 旗標,別手貼。
// ④ ~~2026-08-15 `#20` 片2c:products 三處各手加 listing_set_by / source_missing_at 共 6 行~~
//    🏁 **已作廢 2026-08-15 13:3x** —— `20260815030000` 已 apply(`grep -c … APPLIED.tsv` ⇒ 1),
//    主視窗重 gen + `scripts/regen-types-merge.py` 合併,那兩欄現在是**正式庫真的有**、生成器帶回來的。
//    驗法:`diff` 舊檔 vs 合併檔 ⇒ 6 刪 6 增,而**兩組去空白排序後完全相同 ⇒ 純位置移動、零語意刪除**
//    (手加時插在自訂位置,生成器放在字母序位置)。
//    🔴 **留著這段是因為它記錄了一個真實發生過的狀態**:repo 型別宣稱的欄位正式庫還沒有,而 typecheck 全綠。
//    那段期間唯一擋得住的是 `applied-migration-pairing.test.ts`(apply 後才紅),不是三綠。
//
// ③ **上面 26 處校正這次是用腳本貼回、且有機械驗證**,不是逐處手貼:
//    把「貼回後的檔」與「原始生成檔」**各自去掉註解行再 diff**,結果**必須恰好是那 26 處 `| null`、
//    不能多也不能少**(2026-08-14 實跑:恰 26,與上方「唯一權威」計數逐字對上)。
//    🔴 這道驗證的價值在於它**分得出「貼漏了」與「簽章真的變了」** —— 腳本在貼之前先比對
//    「兩邊只差註解與 `| null`」,差到別的東西就中止;直接貼回去會讓「DB 簽章變了」變成看不見的事。
//    ⚠️ 但它**驗不到**「這 26 處本身還對不對」:那要靠呼叫端 typecheck,而檔頭只點名 ①②③④⑤
//    漏貼會紅在哪 —— ⑥⑦⑧⑨⑩ 有沒有呼叫端守著,**沒有人驗過**。
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor: string
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          reason: string | null
          request_id: string
          source_app: string
          target: string | null
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id: string
          source_app?: string
          target?: string | null
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string
          source_app?: string
          target?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          premium_extra_pct: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          premium_extra_pct?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          premium_extra_pct?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_category_id: string | null
          raw_path: string
          segments: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_category_id?: string | null
          raw_path: string
          segments: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_category_id?: string | null
          raw_path?: string
          segments?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          created_at: string
          customer_user_id: string
          email: string | null
          id: string
          invoice_carrier: string | null
          invoice_donate_code: string
          invoice_tax_id: string
          invoice_title: string
          invoice_type: Database["public"]["Enums"]["invoice_type"]
          is_default: boolean
          line: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          email?: string | null
          id?: string
          invoice_carrier?: string | null
          invoice_donate_code?: string
          invoice_tax_id?: string
          invoice_title?: string
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_default?: boolean
          line: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          email?: string | null
          id?: string
          invoice_carrier?: string | null
          invoice_donate_code?: string
          invoice_tax_id?: string
          invoice_title?: string
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_default?: boolean
          line?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customer_favorites: {
        Row: {
          created_at: string
          customer_user_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_favorites_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_customer_list_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "customer_favorites_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "customer_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_vehicles: {
        Row: {
          created_at: string
          customer_user_id: string
          dict_brand_name: string | null
          dict_model_name: string | null
          engine: string | null
          id: string
          is_primary: boolean
          km: string | null
          mods: string | null
          name: string
          service: string | null
          updated_at: string
          year: string | null
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          dict_brand_name?: string | null
          dict_model_name?: string | null
          engine?: string | null
          id?: string
          is_primary?: boolean
          km?: string | null
          mods?: string | null
          name: string
          service?: string | null
          updated_at?: string
          year?: string | null
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          dict_brand_name?: string | null
          dict_model_name?: string | null
          engine?: string | null
          id?: string
          is_primary?: boolean
          km?: string | null
          mods?: string | null
          name?: string
          service?: string | null
          updated_at?: string
          year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_vehicles_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customer_wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          customer_user_id: string
          entry_date: string
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id: string
          note: string
          related_order_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_user_id: string
          entry_date?: string
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          note?: string
          related_order_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_user_id?: string
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          note?: string
          related_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_ledger_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customers: {
        Row: {
          birthday: string | null
          created_at: string
          email: string
          name: string
          phone: string | null
          tier: Database["public"]["Enums"]["member_tier"]
          total_deposit: number
          updated_at: string
          user_id: string
          wallet_balance: number
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          email: string
          name?: string
          phone?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          total_deposit?: number
          updated_at?: string
          user_id: string
          wallet_balance?: number
        }
        Update: {
          birthday?: string | null
          created_at?: string
          email?: string
          name?: string
          phone?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          total_deposit?: number
          updated_at?: string
          user_id?: string
          wallet_balance?: number
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          dedup_key: string
          event_type: string
          id: string
          last_error_code: string | null
          max_attempts: number
          next_retry_at: string
          order_id: string
          payload: Json
          recipient_email: string
          request_id: string | null
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedup_key: string
          event_type: string
          id?: string
          last_error_code?: string | null
          max_attempts?: number
          next_retry_at?: string
          order_id: string
          payload: Json
          recipient_email: string
          request_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedup_key?: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          max_attempts?: number
          next_retry_at?: string
          order_id?: string
          payload?: Json
          recipient_email?: string
          request_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_terms_versions: {
        Row: {
          content_hash: string
          created_at: string
          effective_at: string
          version: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          effective_at: string
          version: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          effective_at?: string
          version?: string
        }
        Relationships: []
      }
      order_cancellation_items: {
        Row: {
          cancellation_id: string
          cancelled_quantity: number
          created_at: string
          id: string
          order_id: string
          order_item_id: string
        }
        Insert: {
          cancellation_id: string
          cancelled_quantity: number
          created_at?: string
          id?: string
          order_id: string
          order_item_id: string
        }
        Update: {
          cancellation_id?: string
          cancelled_quantity?: number
          created_at?: string
          id?: string
          order_id?: string
          order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellation_items_cancellation_fk"
            columns: ["cancellation_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_cancellations"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "order_cancellation_items_order_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
        ]
      }
      order_cancellations: {
        Row: {
          actor: string
          created_at: string
          id: string
          idempotency_key: string
          order_id: string
          payload_hash: string
          reason_code: string
          reason_detail: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          id?: string
          idempotency_key: string
          order_id: string
          payload_hash: string
          reason_code: string
          reason_detail?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          order_id?: string
          payload_hash?: string
          reason_code?: string
          reason_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellations_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_procurement: {
        Row: {
          allocated_quantity: number
          contact_channel: string | null
          created_at: string
          exception_reason: string | null
          expected_arrival_date: string | null
          first_ordered_at: string | null
          id: string
          order_item_id: string
          received_quantity: number
          reply_status: string
          status_changed_at: string | null
          submitted_at: string | null
          supplier_id: string
          supplier_order_no: string | null
          supplier_order_no_upper: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          allocated_quantity: number
          contact_channel?: string | null
          created_at?: string
          exception_reason?: string | null
          expected_arrival_date?: string | null
          first_ordered_at?: string | null
          id?: string
          order_item_id: string
          received_quantity?: number
          reply_status?: string
          status_changed_at?: string | null
          submitted_at?: string | null
          supplier_id: string
          supplier_order_no?: string | null
          supplier_order_no_upper?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          allocated_quantity?: number
          contact_channel?: string | null
          created_at?: string
          exception_reason?: string | null
          expected_arrival_date?: string | null
          first_ordered_at?: string | null
          id?: string
          order_item_id?: string
          received_quantity?: number
          reply_status?: string
          status_changed_at?: string | null
          submitted_at?: string | null
          supplier_id?: string
          supplier_order_no?: string | null
          supplier_order_no_upper?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_item_procurement_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_procurement_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_procurement_receipts: {
        Row: {
          created_at: string
          id: string
          note: string | null
          procurement_id: string
          quantity: number
          received_at: string
          received_by: string
          surplus_quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          procurement_id: string
          quantity: number
          received_at: string
          received_by: string
          surplus_quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          procurement_id?: string
          quantity?: number
          received_at?: string
          received_by?: string
          surplus_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_procurement_receipts_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "order_item_procurement"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_procurement_void_requests: {
        Row: {
          actor: string
          created_at: string
          procurement_id: string
          request_id: string
          void_reason: string
        }
        Insert: {
          actor: string
          created_at?: string
          procurement_id: string
          request_id: string
          void_reason: string
        }
        Update: {
          actor?: string
          created_at?: string
          procurement_id?: string
          request_id?: string
          void_reason?: string
        }
        Relationships: []
      }
      order_item_quantity_summary: {
        Row: {
          cancelled_quantity: number
          instock_quantity: number
          order_item_id: string
          ordered_quantity: number
          quantity: number
          shipped_quantity: number
        }
        Insert: {
          cancelled_quantity?: number
          instock_quantity?: number
          order_item_id: string
          ordered_quantity?: number
          quantity: number
          shipped_quantity?: number
        }
        Update: {
          cancelled_quantity?: number
          instock_quantity?: number
          order_item_id?: string
          ordered_quantity?: number
          quantity?: number
          shipped_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_quantity_summary_item_fk"
            columns: ["order_item_id", "quantity"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "quantity"]
          },
        ]
      }
      order_item_receipt_requests: {
        Row: {
          actor: string
          created_at: string
          note: string | null
          procurement_id: string
          quantity: number
          receipt_id: string
          received_at: string
          request_id: string
          surplus_quantity: number
        }
        Insert: {
          actor: string
          created_at?: string
          note?: string | null
          procurement_id: string
          quantity: number
          receipt_id: string
          received_at: string
          request_id: string
          surplus_quantity: number
        }
        Update: {
          actor?: string
          created_at?: string
          note?: string | null
          procurement_id?: string
          quantity?: number
          receipt_id?: string
          received_at?: string
          request_id?: string
          surplus_quantity?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          availability_at_checkout: string | null
          id: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          updated_at: string
          variant_id: string | null
          variant_sku: string
          vehicle_snapshot: Json | null
          version: number
          workflow_status: string | null
        }
        Insert: {
          availability_at_checkout?: string | null
          id?: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          updated_at?: string
          variant_id?: string | null
          variant_sku: string
          vehicle_snapshot?: Json | null
          version?: number
          workflow_status?: string | null
        }
        Update: {
          availability_at_checkout?: string | null
          id?: string
          line_total?: number
          order_id?: string
          product_snapshot?: Json
          quantity?: number
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
          variant_sku?: string
          vehicle_snapshot?: Json | null
          version?: number
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_legal_consents: {
        Row: {
          client_ip: string | null
          client_user_agent: string | null
          consented_at: string
          created_at: string
          order_id: string
          terms_version: string
        }
        Insert: {
          client_ip?: string | null
          client_user_agent?: string | null
          consented_at?: string
          created_at?: string
          order_id: string
          terms_version: string
        }
        Update: {
          client_ip?: string | null
          client_user_agent?: string | null
          consented_at?: string
          created_at?: string
          order_id?: string
          terms_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_legal_consents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_legal_consents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_legal_consents_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "legal_terms_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      order_notes: {
        Row: {
          author: string
          body: string
          channel: string | null
          corrects_note_id: string | null
          created_at: string
          id: string
          note_type: string
          occurred_at: string | null
          order_id: string
        }
        Insert: {
          author: string
          body: string
          channel?: string | null
          corrects_note_id?: string | null
          created_at?: string
          id?: string
          note_type: string
          occurred_at?: string | null
          order_id: string
        }
        Update: {
          author?: string
          body?: string
          channel?: string | null
          corrects_note_id?: string | null
          created_at?: string
          id?: string
          note_type?: string
          occurred_at?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_corrects_same_order_fk"
            columns: ["corrects_note_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_notes"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          actor: string
          amount: number
          bank_reference: string | null
          created_at: string
          id: string
          note: string | null
          order_id: string
          payer_note: string | null
          rail: string
          rec_trade_id: string | null
          received_at: string
          request_id: string | null
          reversal_reason: string | null
          reverses_payment_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          actor: string
          amount: number
          bank_reference?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          payer_note?: string | null
          rail: string
          rec_trade_id?: string | null
          received_at: string
          request_id?: string | null
          reversal_reason?: string | null
          reverses_payment_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          actor?: string
          amount?: number
          bank_reference?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          payer_note?: string | null
          rail?: string
          rec_trade_id?: string | null
          received_at?: string
          request_id?: string | null
          reversal_reason?: string | null
          reverses_payment_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_reverses_same_order_rail"
            columns: ["reverses_payment_id", "order_id", "rail"]
            isOneToOne: false
            referencedRelation: "order_payments"
            referencedColumns: ["id", "order_id", "rail"]
          },
          {
            foreignKeyName: "order_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refund_items: {
        Row: {
          id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          refund_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          refund_id: string
          unit_price: number
        }
        Update: {
          id?: string
          line_amount?: number
          order_id?: string
          order_item_id?: string
          quantity?: number
          refund_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_refund_items_order_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
          {
            foreignKeyName: "order_refund_items_refund_fk"
            columns: ["refund_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id", "order_id"]
          },
        ]
      }
      order_refund_job_items: {
        Row: {
          id: string
          job_id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          id?: string
          job_id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          id?: string
          job_id?: string
          line_amount?: number
          order_id?: string
          order_item_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "orji_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
          {
            foreignKeyName: "orji_job_fk"
            columns: ["job_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_refund_jobs"
            referencedColumns: ["id", "order_id"]
          },
        ]
      }
      order_refund_jobs: {
        Row: {
          actor: string
          bank_refund_id: string
          cancellation_id: string
          check_fail_count: number
          claim_expires_at: string | null
          claim_token: string | null
          claimed_at: string | null
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          dead_reason: string | null
          failed_reason: string | null
          generation: number
          id: string
          items_amount: number
          last_refund_call_at: string | null
          manual_review_required: boolean
          next_check_at: string | null
          next_retry_at: string | null
          order_id: string
          payload_hash: string
          reason: string
          rec_trade_id: string
          refund_amount: number
          refund_call_attempted_at: string | null
          refund_id: string | null
          refunded_before: number | null
          refunded_target: number | null
          request_id: string
          resolution: string | null
          retry_auth_checked_at: string | null
          retry_auth_recorded_refunded: number | null
          retry_count: number
          reviewed_at: string | null
          reviewed_by: string | null
          shipping_delta: number
          shipping_fee_after: number
          shipping_fee_before: number
          status: string
          tappay_refund_id: string | null
          updated_at: string
        }
        Insert: {
          actor: string
          bank_refund_id: string
          cancellation_id: string
          check_fail_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          dead_reason?: string | null
          failed_reason?: string | null
          generation?: number
          id?: string
          items_amount: number
          last_refund_call_at?: string | null
          manual_review_required?: boolean
          next_check_at?: string | null
          next_retry_at?: string | null
          order_id: string
          payload_hash: string
          reason: string
          rec_trade_id: string
          refund_amount: number
          refund_call_attempted_at?: string | null
          refund_id?: string | null
          refunded_before?: number | null
          refunded_target?: number | null
          request_id: string
          resolution?: string | null
          retry_auth_checked_at?: string | null
          retry_auth_recorded_refunded?: number | null
          retry_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_delta: number
          shipping_fee_after: number
          shipping_fee_before: number
          status?: string
          tappay_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          actor?: string
          bank_refund_id?: string
          cancellation_id?: string
          check_fail_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          dead_reason?: string | null
          failed_reason?: string | null
          generation?: number
          id?: string
          items_amount?: number
          last_refund_call_at?: string | null
          manual_review_required?: boolean
          next_check_at?: string | null
          next_retry_at?: string | null
          order_id?: string
          payload_hash?: string
          reason?: string
          rec_trade_id?: string
          refund_amount?: number
          refund_call_attempted_at?: string | null
          refund_id?: string | null
          refunded_before?: number | null
          refunded_target?: number | null
          request_id?: string
          resolution?: string | null
          retry_auth_checked_at?: string | null
          retry_auth_recorded_refunded?: number | null
          retry_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_delta?: number
          shipping_fee_after?: number
          shipping_fee_before?: number
          status?: string
          tappay_refund_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orj_actor_fk"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_cancellation_fk"
            columns: ["cancellation_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_cancellations"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "orj_corrected_by_fk"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_refund_fk"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_reviewed_by_fk"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refund_manual_corrections: {
        Row: {
          actor: string
          corrected_to: string
          created_at: string
          id: string
          reason: string
          refund_id: string
          request_id: string
          seq: number
        }
        Insert: {
          actor: string
          corrected_to: string
          created_at?: string
          id?: string
          reason: string
          refund_id: string
          request_id: string
          seq: number
        }
        Update: {
          actor?: string
          corrected_to?: string
          created_at?: string
          id?: string
          reason?: string
          refund_id?: string
          request_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_refund_manual_corrections_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          actor: string
          bank_refund_id: string
          confirmed_at: string | null
          created_at: string
          failed_detail: string | null
          failed_reason: string | null
          id: string
          kind: string
          order_id: string
          provider_refund_id_evidence: string | null
          reason: string
          rec_trade_id: string
          record_refunded_before: number
          refund_amount: number
          request_id: string
          status: string
          tappay_refund_id: string | null
        }
        Insert: {
          actor: string
          bank_refund_id: string
          confirmed_at?: string | null
          created_at?: string
          failed_detail?: string | null
          failed_reason?: string | null
          id?: string
          kind: string
          order_id: string
          provider_refund_id_evidence?: string | null
          reason: string
          rec_trade_id: string
          record_refunded_before: number
          refund_amount: number
          request_id: string
          status: string
          tappay_refund_id?: string | null
        }
        Update: {
          actor?: string
          bank_refund_id?: string
          confirmed_at?: string | null
          created_at?: string
          failed_detail?: string | null
          failed_reason?: string | null
          id?: string
          kind?: string
          order_id?: string
          provider_refund_id_evidence?: string | null
          reason?: string
          rec_trade_id?: string
          record_refunded_before?: number
          refund_amount?: number
          request_id?: string
          status?: string
          tappay_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_options: {
        Row: {
          code: string
          color: string
          created_at: string
          is_active: boolean
          label: string
          sort_order: number
          text_color: string
        }
        Insert: {
          code: string
          color: string
          created_at?: string
          is_active?: boolean
          label: string
          sort_order: number
          text_color?: string
        }
        Update: {
          code?: string
          color?: string
          created_at?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          text_color?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          address_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          cart_session_id: string | null
          created_at: string
          customer_user_id: string
          discount_total: number
          display_id: string
          display_position: number | null
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          id: string
          invoice: Json
          invoice_amount: number | null
          invoice_number: string | null
          invoice_status: string
          legacy_display_id: string | null
          notification_email: string | null
          order_source: string
          paid_at: string | null
          payment_channel: string
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_free_threshold: number
          shipping_home_fee: number
          shipping_method: string
          shipping_method_at_checkout: string
          subtotal: number
          tappay_rec_trade_id: string | null
          tier_at_checkout: Database["public"]["Enums"]["member_tier"]
          total: number
          updated_at: string
          version: number
          workflow_status: string | null
        }
        Insert: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id: string
          discount_total?: number
          display_id: string
          display_position?: number | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice: Json
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_free_threshold?: number
          shipping_home_fee?: number
          shipping_method: string
          shipping_method_at_checkout: string
          subtotal: number
          tappay_rec_trade_id?: string | null
          tier_at_checkout: Database["public"]["Enums"]["member_tier"]
          total: number
          updated_at?: string
          version?: number
          workflow_status?: string | null
        }
        Update: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id?: string
          discount_total?: number
          display_id?: string
          display_position?: number | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice?: Json
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot?: Json
          shipping_fee?: number
          shipping_free_threshold?: number
          shipping_home_fee?: number
          shipping_method?: string
          shipping_method_at_checkout?: string
          subtotal?: number
          tappay_rec_trade_id?: string | null
          tier_at_checkout?: Database["public"]["Enums"]["member_tier"]
          total?: number
          updated_at?: string
          version?: number
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_charge_attempts: {
        Row: {
          bank_transaction_id: string | null
          created_at: string
          customer_user_id: string
          failure_observed_at: string | null
          failure_observed_status: number | null
          fallback_token_hash: string
          id: string
          last_expired_settle_at: string | null
          last_poll_settle_at: string | null
          last_settle_error: string | null
          needs_manual_review: boolean
          next_settle_at: string | null
          order_id: string
          rec_trade_id: string | null
          released_at: string | null
          released_close_resolution: string | null
          released_closed_at: string | null
          released_closed_by: string | null
          released_manual_review_at: string | null
          settle_attempt_count: number
          status: string
          superseded_at: string | null
          superseded_by_order_id: string | null
          superseded_reason: string | null
          updated_at: string
        }
        Insert: {
          bank_transaction_id?: string | null
          created_at?: string
          customer_user_id: string
          failure_observed_at?: string | null
          failure_observed_status?: number | null
          fallback_token_hash: string
          id?: string
          last_expired_settle_at?: string | null
          last_poll_settle_at?: string | null
          last_settle_error?: string | null
          needs_manual_review?: boolean
          next_settle_at?: string | null
          order_id: string
          rec_trade_id?: string | null
          released_at?: string | null
          released_close_resolution?: string | null
          released_closed_at?: string | null
          released_closed_by?: string | null
          released_manual_review_at?: string | null
          settle_attempt_count?: number
          status?: string
          superseded_at?: string | null
          superseded_by_order_id?: string | null
          superseded_reason?: string | null
          updated_at?: string
        }
        Update: {
          bank_transaction_id?: string | null
          created_at?: string
          customer_user_id?: string
          failure_observed_at?: string | null
          failure_observed_status?: number | null
          fallback_token_hash?: string
          id?: string
          last_expired_settle_at?: string | null
          last_poll_settle_at?: string | null
          last_settle_error?: string | null
          needs_manual_review?: boolean
          next_settle_at?: string | null
          order_id?: string
          rec_trade_id?: string | null
          released_at?: string | null
          released_close_resolution?: string | null
          released_closed_at?: string | null
          released_closed_by?: string | null
          released_manual_review_at?: string | null
          settle_attempt_count?: number
          status?: string
          superseded_at?: string | null
          superseded_by_order_id?: string | null
          superseded_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_charge_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charge_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charge_attempts_superseded_by_order_id_fkey"
            columns: ["superseded_by_order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charge_attempts_superseded_by_order_id_fkey"
            columns: ["superseded_by_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_double_charge_anomalies: {
        Row: {
          amount: number
          cart_session_id: string
          charged_at: string
          created_at: string
          id: string
          old_attempt_id: string
          old_order_id: string
          rec_trade_id: string
          refund_claimed_at: string | null
          refund_claimed_by: string | null
          refund_provider_reference: string | null
          refund_target_rec_trade_id: string
          released_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          cart_session_id: string
          charged_at: string
          created_at?: string
          id?: string
          old_attempt_id: string
          old_order_id: string
          rec_trade_id: string
          refund_claimed_at?: string | null
          refund_claimed_by?: string | null
          refund_provider_reference?: string | null
          refund_target_rec_trade_id: string
          released_at: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          cart_session_id?: string
          charged_at?: string
          created_at?: string
          id?: string
          old_attempt_id?: string
          old_order_id?: string
          rec_trade_id?: string
          refund_claimed_at?: string | null
          refund_claimed_by?: string | null
          refund_provider_reference?: string | null
          refund_target_rec_trade_id?: string
          released_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_double_charge_anomalies_old_attempt_id_fkey"
            columns: ["old_attempt_id"]
            isOneToOne: true
            referencedRelation: "payment_charge_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_double_charge_anomalies_old_order_id_fkey"
            columns: ["old_order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_double_charge_anomalies_old_order_id_fkey"
            columns: ["old_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_double_charge_anomaly_events: {
        Row: {
          actor_session_role: string
          anomaly_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          note: string
          provider_reference: string | null
          to_status: string | null
        }
        Insert: {
          actor_session_role: string
          anomaly_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          note: string
          provider_reference?: string | null
          to_status?: string | null
        }
        Update: {
          actor_session_role?: string
          anomaly_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string
          provider_reference?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_double_charge_anomaly_events_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "payment_double_charge_anomalies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refund_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: string
          lease_token: number
          record_snapshot: Json | null
          refund_id: string
          reversal_reason: string | null
          reverses_event_id: string | null
          seq: number
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: string
          lease_token: number
          record_snapshot?: Json | null
          refund_id: string
          reversal_reason?: string | null
          reverses_event_id?: string | null
          seq: number
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lease_token?: number
          record_snapshot?: Json | null
          refund_id?: string
          reversal_reason?: string | null
          reverses_event_id?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_refund_events_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "payment_refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_reversal_same_refund_fk"
            columns: ["refund_id", "reverses_event_id"]
            isOneToOne: false
            referencedRelation: "payment_refund_effective_terminal"
            referencedColumns: ["refund_id", "event_id"]
          },
          {
            foreignKeyName: "pre_reversal_same_refund_fk"
            columns: ["refund_id", "reverses_event_id"]
            isOneToOne: false
            referencedRelation: "payment_refund_events"
            referencedColumns: ["refund_id", "id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount: number
          attempt_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          lease_token: number
          rec_trade_id: string | null
          strong_key: string
          supersedes_refund_id: string | null
        }
        Insert: {
          amount: number
          attempt_id: string
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          lease_token: number
          rec_trade_id?: string | null
          strong_key: string
          supersedes_refund_id?: string | null
        }
        Update: {
          amount?: number
          attempt_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          lease_token?: number
          rec_trade_id?: string | null
          strong_key?: string
          supersedes_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_charge_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pr_supersedes_same_attempt_fkey"
            columns: ["attempt_id", "supersedes_refund_id"]
            isOneToOne: false
            referencedRelation: "payment_refunds"
            referencedColumns: ["attempt_id", "id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          amount: number | null
          attempt_count: number
          bank_transaction_id: string | null
          last_error: string | null
          needs_manual_review: boolean
          next_retry_at: string | null
          order_number: string
          processed: boolean
          processed_at: string | null
          raw_hash: string
          rec_trade_id: string
          received_at: string
          reported_status: number | null
          transaction_time_millis: number | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number
          bank_transaction_id?: string | null
          last_error?: string | null
          needs_manual_review?: boolean
          next_retry_at?: string | null
          order_number: string
          processed?: boolean
          processed_at?: string | null
          raw_hash: string
          rec_trade_id: string
          received_at?: string
          reported_status?: number | null
          transaction_time_millis?: number | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number
          bank_transaction_id?: string | null
          last_error?: string | null
          needs_manual_review?: boolean
          next_retry_at?: string | null
          order_number?: string
          processed?: boolean
          processed_at?: string | null
          raw_hash?: string
          rec_trade_id?: string
          received_at?: string
          reported_status?: number | null
          transaction_time_millis?: number | null
        }
        Relationships: []
      }
      pcm_b2_shipping_idempotency: {
        Row: {
          action: string
          created_at: string
          idempotency_key: string
          payload_hash: string
          result_snapshot: Json
          shipment_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          idempotency_key: string
          payload_hash: string
          result_snapshot?: Json
          shipment_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          idempotency_key?: string
          payload_hash?: string
          result_snapshot?: Json
          shipment_id?: string | null
        }
        Relationships: []
      }
      pending_invoices: {
        Row: {
          created_at: string
          id: string
          order_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_order_list_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments: {
        Row: {
          id: number
          model_code: string
          moto_brand: string
          product_id: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          model_code: string
          moto_brand: string
          product_id: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          model_code?: string
          moto_brand?: string
          product_id?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective: {
        Row: {
          id: number
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          source_model_code: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          source_model_code: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          match_source?: string
          model_code?: string
          moto_brand?: string
          product_id?: string
          source_model_code?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective_staging: {
        Row: {
          id: number
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          run_id: string
          source_model_code: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          run_id: string
          source_model_code: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          match_source?: string
          model_code?: string
          moto_brand?: string
          product_id?: string
          run_id?: string
          source_model_code?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective_sync_log: {
        Row: {
          id: number
          new_count: number | null
          note: string | null
          old_count: number | null
          orphan_rows: number | null
          ran_at: string
          run_id: string | null
          source_rows: number | null
          staged_rows: number | null
          status: string
        }
        Insert: {
          id?: never
          new_count?: number | null
          note?: string | null
          old_count?: number | null
          orphan_rows?: number | null
          ran_at?: string
          run_id?: string | null
          source_rows?: number | null
          staged_rows?: number | null
          status: string
        }
        Update: {
          id?: never
          new_count?: number | null
          note?: string | null
          old_count?: number | null
          orphan_rows?: number | null
          ran_at?: string
          run_id?: string | null
          source_rows?: number | null
          staged_rows?: number | null
          status?: string
        }
        Relationships: []
      }
      product_image_trim: {
        Row: {
          analyzed_at: string
          bbox_height: number | null
          bbox_left: number | null
          bbox_top: number | null
          bbox_width: number | null
          natural_height: number | null
          natural_width: number | null
          status: string
          url: string
        }
        Insert: {
          analyzed_at?: string
          bbox_height?: number | null
          bbox_left?: number | null
          bbox_top?: number | null
          bbox_width?: number | null
          natural_height?: number | null
          natural_width?: number | null
          status: string
          url: string
        }
        Update: {
          analyzed_at?: string
          bbox_height?: number | null
          bbox_left?: number | null
          bbox_top?: number | null
          bbox_width?: number | null
          natural_height?: number | null
          natural_width?: number | null
          status?: string
          url?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          availability: string
          created_at: string
          id: string
          images: Json
          metadata: Json
          price_general: number | null
          price_store: number | null
          product_id: string
          sku: string
          sort_order: number
          spec: Json
          supplier_slug: string
          updated_at: string
        }
        Insert: {
          availability?: string
          created_at?: string
          id?: string
          images?: Json
          metadata?: Json
          price_general?: number | null
          price_store?: number | null
          product_id: string
          sku: string
          sort_order?: number
          spec?: Json
          supplier_slug?: string
          updated_at?: string
        }
        Update: {
          availability?: string
          created_at?: string
          id?: string
          images?: Json
          metadata?: Json
          price_general?: number | null
          price_store?: number | null
          product_id?: string
          sku?: string
          sort_order?: number
          spec?: Json
          supplier_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          availability: string
          brand_id: string
          category_id: string
          created_at: string
          delisted_at: string | null
          description: string | null
          external_id: string
          fitments: Json
          handle: string
          highlights: Json
          id: string
          images: Json
          listing_set_by: string
          manuals: Json
          metadata: Json
          price_by_tier: Json
          price_general: number | null
          price_store: number | null
          sound_clips: Json
          source_missing_at: string | null
          subtitle: string | null
          supplier_slug: string
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          availability?: string
          brand_id: string
          category_id: string
          created_at?: string
          delisted_at?: string | null
          description?: string | null
          external_id: string
          fitments?: Json
          handle: string
          highlights?: Json
          id?: string
          images?: Json
          listing_set_by?: string
          manuals?: Json
          metadata?: Json
          price_by_tier: Json
          price_general?: number | null
          price_store?: number | null
          sound_clips?: Json
          source_missing_at?: string | null
          subtitle?: string | null
          supplier_slug?: string
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          availability?: string
          brand_id?: string
          category_id?: string
          created_at?: string
          delisted_at?: string | null
          description?: string | null
          external_id?: string
          fitments?: Json
          handle?: string
          highlights?: Json
          id?: string
          images?: Json
          listing_set_by?: string
          manuals?: Json
          metadata?: Json
          price_by_tier?: Json
          price_general?: number | null
          price_store?: number | null
          sound_clips?: Json
          source_missing_at?: string | null
          subtitle?: string | null
          supplier_slug?: string
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          created_at: string
          id: string
          order_item_id: string
          shipment_id: string
          shipped_quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_item_id: string
          shipment_id: string
          shipped_quantity: number
        }
        Update: {
          created_at?: string
          id?: string
          order_item_id?: string
          shipment_id?: string
          shipped_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier_code: string
          carrier_note: string | null
          created_at: string
          customer_user_id: string
          deleted_at: string | null
          hct_raw_response: Json | null
          hct_request_id: string | null
          hct_status: string
          id: string
          recipient_snapshot: Json
          shipment_reference: string
          shipped_at: string | null
          tracking_number: string | null
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          carrier_code: string
          carrier_note?: string | null
          created_at?: string
          customer_user_id: string
          deleted_at?: string | null
          hct_raw_response?: Json | null
          hct_request_id?: string | null
          hct_status?: string
          id?: string
          recipient_snapshot: Json
          shipment_reference: string
          shipped_at?: string | null
          tracking_number?: string | null
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          carrier_code?: string
          carrier_note?: string | null
          created_at?: string
          customer_user_id?: string
          deleted_at?: string | null
          hct_raw_response?: Json | null
          hct_request_id?: string | null
          hct_status?: string
          id?: string
          recipient_snapshot?: Json
          shipment_reference?: string
          shipped_at?: string | null
          tracking_number?: string | null
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_manager: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          is_manager?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_manager?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_order_list_v: {
        Row: {
          address_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          cart_session_id: string | null
          created_at: string | null
          customer_user_id: string | null
          discount_total: number | null
          display_id: string | null
          display_position: number | null
          fulfillment_status:
            | Database["public"]["Enums"]["fulfillment_status"]
            | null
          goods_axis: string | null
          id: string | null
          invoice: Json | null
          invoice_amount: number | null
          invoice_number: string | null
          invoice_status: string | null
          legacy_display_id: string | null
          notification_email: string | null
          order_source: string | null
          paid_at: string | null
          payment_channel: string | null
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          shipping_address_snapshot: Json | null
          shipping_fee: number | null
          shipping_free_threshold: number | null
          shipping_home_fee: number | null
          shipping_method: string | null
          shipping_method_at_checkout: string | null
          subtotal: number | null
          tappay_rec_trade_id: string | null
          tier_at_checkout: Database["public"]["Enums"]["member_tier"] | null
          total: number | null
          updated_at: string | null
          version: number | null
          workflow_status: string | null
        }
        Insert: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string | null
          customer_user_id?: string | null
          discount_total?: number | null
          display_id?: string | null
          display_position?: number | null
          fulfillment_status?:
            | Database["public"]["Enums"]["fulfillment_status"]
            | null
          goods_axis?: never
          id?: string | null
          invoice?: Json | null
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string | null
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          shipping_address_snapshot?: Json | null
          shipping_fee?: number | null
          shipping_free_threshold?: number | null
          shipping_home_fee?: number | null
          shipping_method?: string | null
          shipping_method_at_checkout?: string | null
          subtotal?: number | null
          tappay_rec_trade_id?: string | null
          tier_at_checkout?: Database["public"]["Enums"]["member_tier"] | null
          total?: number | null
          updated_at?: string | null
          version?: number | null
          workflow_status?: string | null
        }
        Update: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string | null
          customer_user_id?: string | null
          discount_total?: number | null
          display_id?: string | null
          display_position?: number | null
          fulfillment_status?:
            | Database["public"]["Enums"]["fulfillment_status"]
            | null
          goods_axis?: never
          id?: string | null
          invoice?: Json | null
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string | null
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          shipping_address_snapshot?: Json | null
          shipping_fee?: number | null
          shipping_free_threshold?: number | null
          shipping_home_fee?: number | null
          shipping_method?: string | null
          shipping_method_at_checkout?: string | null
          subtotal?: number | null
          tappay_rec_trade_id?: string | null
          tier_at_checkout?: Database["public"]["Enums"]["member_tier"] | null
          total?: number | null
          updated_at?: string | null
          version?: number | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customer_wallet_balance_check: {
        Row: {
          computed_balance: number | null
          computed_total_deposit: number | null
          customer_user_id: string | null
          last_entry_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_ledger_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      order_refund_effective_verdict: {
        Row: {
          actor: string | null
          corrected_to: string | null
          correction_id: string | null
          created_at: string | null
          reason: string | null
          refund_id: string | null
          seq: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_refund_manual_corrections_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refund_effective_terminal: {
        Row: {
          created_at: string | null
          event_id: string | null
          event_type: string | null
          indicates_refund: boolean | null
          refund_id: string | null
          seq: number | null
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          event_type?: string | null
          indicates_refund?: never
          refund_id?: string | null
          seq?: number | null
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          event_type?: string | null
          indicates_refund?: never
          refund_id?: string | null
          seq?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_refund_events_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "payment_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants_public: {
        Row: {
          availability: string | null
          created_at: string | null
          id: string | null
          images: Json | null
          price_general: number | null
          product_id: string | null
          sku: string | null
          sort_order: number | null
          spec: Json | null
          supplier_slug: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: string | null
          created_at?: string | null
          id?: string | null
          images?: Json | null
          price_general?: number | null
          product_id?: string | null
          sku?: string | null
          sort_order?: number | null
          spec?: Json | null
          supplier_slug?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: string | null
          created_at?: string | null
          id?: string | null
          images?: Json | null
          price_general?: number | null
          product_id?: string | null
          sku?: string | null
          sort_order?: number | null
          spec?: Json | null
          supplier_slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products_list_public: {
        Row: {
          availability: string | null
          brand_id: string | null
          brand_name: string | null
          brand_slug: string | null
          card_image: string | null
          category_id: string | null
          category_raw: string | null
          created_at: string | null
          fitments: Json | null
          fits: string | null
          handle: string | null
          id: string | null
          price_general: number | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products_public: {
        Row: {
          availability: string | null
          brand_id: string | null
          card_image_trim: Json | null
          category_id: string | null
          created_at: string | null
          description: string | null
          external_id: string | null
          fitments: Json | null
          handle: string | null
          highlights: Json | null
          id: string | null
          images: Json | null
          manuals: Json | null
          price_general: number | null
          sound_clips: Json | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
          updated_at: string | null
          video_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_taxonomy_public: {
        Row: {
          model_code: string | null
          moto_brand: string | null
          year_end: number | null
          year_start: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_add_shipment_items: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_shipment_id: string
        }
        Returns: Json
      }
      admin_adjust_wallet: {
        Args: {
          p_actor: string
          p_amount: number
          p_customer_user_id: string
          p_entry_type: string
          p_note: string
          p_request_id: string
        }
        Returns: string
      }
      admin_append_order_note: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— internal 這個 note_type **必須**三個都傳 NULL
          //   (order_notes 的 internal_fields_absent CHECK 強制),而 PostgREST 的型別產生器
          //   表達不了「必填但可為 null」⇒ 全被型別化為非 null string,呼叫端第一次寫 internal
          //   備註就型別紅。p_actor / p_request_id **不補** —— 函式裡 fail-closed 拒收 NULL。
          //   p_order_id / p_note_type / p_body 也不補 —— 傳 NULL 只會拿到固定錯誤碼,不是合法用法。
          p_actor: string
          p_body: string
          p_channel: string | null
          p_corrects_note_id: string | null
          p_note_type: string
          p_occurred_at: string | null
          p_order_id: string
          p_request_id: string
        }
        Returns: string
      }
      admin_cancel_order: {
        // 🔴 手動校正一處(重 gen 後需重貼;A9d2-2)—— `p_reason_detail` 在**非 `other`** 的六個原因碼下
        //   要嘛送 NULL、要嘛送「btrim 後為空」的字串:migration 20260805100000:131-132 先
        //   `btrim` 再把 `''` 正規化成 NULL,`:141-142`「非 other 不得填說明」才對**仍非 NULL**的 detail RAISE
        //   (⚠️ btrim 預設只去一般空白 —— U+00A0 之類仍會留下而觸發 RAISE)。
        //   ⇒ `null` 是這六碼的自然寫法,非 null 型別會逼呼叫端改送 `''` 這種繞法。
        //   p_actor / p_order_id / p_idempotency_key / p_reason_code **不補** —— 四者函式內皆 fail-closed
        //   拒 NULL,傳 NULL 不是合法用法、拿到的只會是錯誤:`:116-118` 冪等鍵、`:128-130` 原因碼、
        //   `:355` actor(`WHERE s.id = p_actor AND s.is_active` NOT EXISTS → 通用 RAISE)、
        //   `:191-193` order_id(NOT FOUND → 通用 RAISE)。
        //   p_items **不補** —— 生成型別 `Json` 的聯集本身已含 `null`(見檔頭 `export type Json`),
        //   整單取消送 null 本來就過;再加 `| null` 是重複,還會讓後人以為 Json 不含 null。
        Args: {
          p_actor: string
          p_idempotency_key: string
          p_items?: Json
          p_order_id: string
          p_reason_code: string
          p_reason_detail: string | null
        }
        Returns: Json
      }
      admin_compute_order_settlement: {
        Args: { p_order_id: string }
        Returns: Json
      }
      admin_correct_order_refund_verdict: {
        Args: {
          p_actor: string
          p_corrected_to: string
          p_expected_correction_id: string
          p_reason: string
          p_refund_id: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_correct_refund_manual_verdict: {
        Args: {
          p_actor: string
          p_expected_event_id: string
          p_reason: string
          p_refund_id: string
          p_refunded: boolean
        }
        Returns: Json
      }
      admin_create_shipment: {
        Args: {
          p_carrier_code: string
          p_carrier_note?: string
          p_customer_user_id: string
          p_idempotency_key: string
          p_recipient_snapshot: Json
        }
        Returns: Json
      }
      admin_delete_item_receipt: {
        Args: { p_actor: string; p_receipt_id: string; p_request_id: string }
        Returns: string
      }
      admin_finalize_order_refund: {
        // 🔴 手動校正三處(重 gen 後需重貼;RW2c)—— outcome 參數矩陣**強制**互斥:
        //   accepted 必帶 tappay_refund_id + refund_amount_wire、其餘必 NULL;
        //   manual_failed 必帶 failed_detail(migration 20260803150000 步 2 逐條)⇒
        //   非 null 型別會讓合法的「必須傳 NULL」呼叫直接型別紅。
        Args: {
          p_actor: string
          p_failed_detail: string | null
          p_outcome: string
          p_refund_amount_wire: number | null
          p_refund_id: string
          p_request_id: string
          p_tappay_refund_id: string | null
        }
        Returns: Json
      }
      admin_initiate_order_refund: {
        // 🔴 手動校正兩處(重 gen 後需重貼;RW2c)—— kind/金額**強制**互斥(RPC 步 2):
        //   partial 必帶 amount、record_amount 必 NULL;full 相反。p_record_refunded_before
        //   不補 —— RPC fail-closed 拒 NULL(G0 baseline 缺值時 action 已 abort、不得傳 0 充數)。
        Args: {
          p_actor: string
          p_amount: number | null
          p_kind: string
          p_order_id: string
          p_reason: string
          p_record_amount: number | null
          p_record_refunded_before: number
          p_request_id: string
        }
        Returns: Json
      }
      admin_list_order_payments: { Args: { p_order_id: string }; Returns: Json }
      admin_mark_shipment_shipped: {
        Args: {
          p_idempotency_key: string
          p_shipment_id: string
          p_tracking_number?: string
        }
        Returns: Json
      }
      admin_record_item_receipt: {
        // 🔴 手動校正一處(重 gen 後需重貼;2026-08-11 #352-b 開工補上 —— 呼叫端到此才存在)。
        //   `p_note` 送 NULL = 沒有備註,是合法且**常態**的呼叫:RPC `20260811010000:127-136`
        //   先 `v_note := p_note`,再 `IF v_note IS NOT NULL THEN`(btrim / 長度)才動它,
        //   而且全空白備註會被**正規化回 NULL**(`:131` 逐字「不製造『看起來有、其實沒有』的假資料」)。
        //   PostgREST 的型別產生器表達不了「必填但可為 null」⇒ 不校正的話,員工不填備註就型別紅。
        //   其餘六個**不補**:p_actor / p_request_id 在 RPC 內 fail-closed RAISE(`:88-103`);
        //   p_procurement_id 送 NULL 只會拿到 `PROCUREMENT_NOT_FOUND`;
        //   p_quantity / p_surplus_quantity / p_received_at 送 NULL 只會拿到固定錯誤碼
        //   (`INVALID_QUANTITY` / `RECEIVED_AT_REQUIRED`)—— 都不是合法用法,型別非 null 是對的。
        Args: {
          p_actor: string
          p_note: string | null
          p_procurement_id: string
          p_quantity: number
          p_received_at: string
          p_request_id: string
          p_surplus_quantity: number
        }
        Returns: string
      }
      admin_record_manual_payment: {
        Args: {
          p_actor: string
          p_amount: number
          p_bank_reference?: string
          p_order_id: string
          p_payer_note?: string
          p_rail: string
          p_received_at: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_reverse_manual_payment: {
        Args: { p_actor: string; p_payment_id: string; p_reason: string }
        Returns: Json
      }
      admin_search_orders: {
        // 🔴 手動校正(見檔頭計數):p_from / p_to 在 DB 是 `DEFAULT NULL` 的**可省略且可為 null**
        // 參數(正式站實查:`p_query text, p_limit integer DEFAULT 100, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL`)。
        // 呼叫端(SupabaseOrderAdapter)**刻意一律帶兩個鍵、沒有值就送顯式 null**(理由見該處註解:
        // 不用 spread、讓「忘了帶」變成編譯錯誤)⇒ 不補 `| null` 就只能改送 undefined = 改 payload。
        // ⚠️ p_limit 不補:呼叫端一律帶值(`ADMIN_ORDER_ID_IN_CAP`),沒有送 null 的路徑。
        Args: {
          p_from?: string | null
          p_limit?: number
          p_query: string
          p_to?: string | null
        }
        Returns: Json
      }
      admin_search_customers: {
        // 🔴 **手動校正(見檔頭計數)** —— `#525` 新建的 RPC,而本檔是**從正式庫 gen 的**
        // ⇒ 在 Sean apply 那支 migration 之前,重 gen 不會產生這一段。
        // 簽章逐字對 `supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql`:
        //   `admin_search_customers(p_query text, p_limit integer DEFAULT 100) RETURNS jsonb`
        // ⚠️ `p_limit` 不補 `| null`:呼叫端一律帶值(`ADMIN_CUSTOMER_ID_IN_CAP`),沒有送 null 的路徑。
        // 🔴 **apply 之後重 gen 時,這一段應該會被自動產生** —— 屆時**先比對再刪本段**,
        //    不要因為「反正會生成」就先拿掉(那會讓中間任何一次 gen 失敗變成靜默的型別漏洞)。
        Args: {
          p_limit?: number
          p_query: string
        }
        Returns: Json
      }
      admin_set_customer_tier: {
        Args: {
          p_actor: string
          p_customer_user_id: string
          p_note: string
          p_request_id: string
          p_tier: string
        }
        Returns: string
      }
      admin_today_payment_total: {
        Args: { p_from: string; p_to: string }
        Returns: {
          row_count: number
          total: number
        }[]
      }
      admin_unvoid_shipment: {
        Args: { p_idempotency_key: string; p_shipment_id: string }
        Returns: Json
      }
      admin_update_order_item_amount: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_order_id: string
          p_order_item_id: string
          p_request_id: string
          p_unit_price: number
          // 🔴 手動校正(見檔頭計數;2026-08-15 #13 片1b 開工補上 —— 呼叫端到此才存在)。
          //   `p_zero_price_reason text DEFAULT NULL`(migration 20260815040000:332)⇒ 生成器只寫得出
          //   「可省略」(`?:`),寫不出「可為 null」。形狀同 ⑨⑩「可省略且可為 null」,
          //   不是前八支的「必填但可為 null」。
          //   🔴 呼叫端(`SupabaseOrderAdapter.updateAdminOrderItemAmount`)**一律帶這個鍵**、
          //   非 0 元時送**顯式 null**(不用 spread、讓「忘了帶」變編譯錯誤)⇒ 不補 `| null`
          //   就只能改送 undefined,那是改 payload 不是整理型別。
          //   ⚠️ 型別層只負責「讓明確送 null 寫得出來」;真正的兩道閘在 RPC 端且 fail-closed
          //   (`:366` 0 元必填原因、`:371` 非 0 元不得帶原因)—— 應用層不重複實作。
          //   ✅ 這一處是**實測承重、不是推測**:未補之前 `npx tsc -p packages/adapters` 逐字
          //   `TS2322: Type 'string | null' is not assignable to type 'string | undefined'`。
          //   其餘六個**不補** —— p_actor / p_request_id / p_order_id / p_order_item_id /
          //   p_expected_version / p_unit_price 在 RPC 內皆 fail-closed 拒 NULL(`:350`-`:362`),
          //   送 NULL 不是合法用法、型別非 null 是對的。
          p_zero_price_reason?: string | null
        }
        Returns: string
      }
      admin_update_order_item_workflow: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_item_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: string
      }
      admin_update_order_workflow: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_order_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: string
      }
      admin_upsert_item_procurement: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼;2026-08-04 A10b 開工補上 —— 呼叫端到此才存在)。
          //   本函式**在 `p_preserve_optional_fields = false`(預設)下**是全量 payload、非 patch
          //   (migration `20260803160000:19-24`):選填欄送 NULL = 該欄寫成 NULL。
          //   🔴 `true` 時(A9h 批次)語意不同 —— submitted_at / supplier_order_no / exception_reason /
          //   expected_arrival_date 的 NULL **是保留、不是清空**(A9h-M `20260806200000`)。
          //   這五個參數在函式裡逐一 `IS NOT NULL` 才驗(`:228-289`),NULL 合法。
          //   PostgREST 的型別產生器表達不了「必填但可為 null」⇒ 全被型別化為非 null,
          //   呼叫端第一次傳 null 就型別紅。校正 = 五個真的可為 NULL 的參數補 `| null`。
          //   其餘的**不補** —— p_actor / p_request_id / p_order_item_id / p_supplier_id /
          //   p_allocated_quantity / p_reply_status 在函式裡 fail-closed 拒收 NULL,型別非 null 是對的。
          //   🔴 A9h-M(`20260806200000`)起多一個 p_preserve_optional_fields:它有 DEFAULT false
          //   ⇒ 型別產生器會把它寫成**可省略**(`?:`)。這裡照抄那個形狀 ⇒ **不是**手動校正、
          //   重 gen 後無需重貼(檔頭計數不因本片變動)。
          //   「呼叫端必須明確表態」的守門不在這一層,在 `UpsertItemProcurementArgs`
          //   (該欄必填)+ repository 測試釘死具名參數恰 12 鍵 —— 漏送會紅在那兩處。
          p_actor: string
          p_allocated_quantity: number
          p_contact_channel: string | null
          p_exception_reason: string | null
          p_expected_arrival_date: string | null
          p_order_item_id: string
          p_preserve_optional_fields?: boolean
          p_reply_status: string
          p_request_id: string
          p_submitted_at: string | null
          p_supplier_id: string
          p_supplier_order_no: string | null
        }
        Returns: string
      }
      admin_upsert_supplier: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— 這支函式的**整個分流機制**就是「NULL = 該欄不動」:
          //   p_supplier_id 為 NULL = 新增;有值時 p_label / p_is_active 各自 NULL = 該欄不動。
          //   PostgREST 的型別產生器表達不了「必填但可為 null」⇒ 六個參數全被型別化為非 null,
          //   而呼叫端第一次傳 null 就會型別紅。校正 = 四個真的可為 NULL 的參數補 `| null`。
          //   p_actor / p_request_id **不補** —— 它們在函式裡 fail-closed 拒收 NULL,型別非 null 是對的。
          p_actor: string
          p_is_active: boolean | null
          p_label: string | null
          p_note: string | null
          p_request_id: string
          p_supplier_id: string | null
        }
        Returns: string
      }
      admin_void_item_procurement: {
        Args: {
          p_actor: string
          p_procurement_id: string
          p_request_id: string
          p_void_reason: string
        }
        Returns: string
      }
      admin_void_shipment: {
        Args: {
          p_idempotency_key: string
          p_shipment_id: string
          p_void_reason: string
        }
        Returns: Json
      }
      begin_charge_attempt: { Args: { p_order_id: string }; Returns: Json }
      catalog_brand_counts: {
        Args: never
        Returns: {
          name: string
          product_count: number
          slug: string
        }[]
      }
      charge_attempt_token_hash: { Args: { p_token: string }; Returns: string }
      claim_double_charge_anomaly_for_refund: {
        Args: { p_anomaly_id: string }
        Returns: Json
      }
      claim_due_webhook_events: {
        Args: { p_limit: number }
        Returns: {
          attempt_count: number
          order_number: string
          rec_trade_id: string
        }[]
      }
      claim_expired_pending_attempts: {
        Args: { p_limit: number }
        Returns: {
          attempt_id: string
          needs_manual_review: boolean
          order_id: string
        }[]
      }
      claim_order_poll_settle: {
        Args: { p_order_id: string; p_throttle_seconds: number }
        Returns: boolean
      }
      claim_stuck_unsettled_attempts: {
        Args: { p_age_seconds: number; p_limit: number }
        Returns: {
          attempt_id: string
          order_id: string
          settle_attempt_count: number
          superseded_at: string
        }[]
      }
      close_released_attempt: {
        Args: { p_attempt_id: string; p_resolution: string }
        Returns: Json
      }
      confirm_order_payment: {
        Args: { p_amount: number; p_order_id: string; p_rec_trade_id: string }
        Returns: Json
      }
      create_order: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— 2026-07-29 production 實查函式簽章逐字:
          //   create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
          //                p_cart_session_id uuid, p_terms_version text, p_client_ip text,
          //                p_client_ua text, p_notification_email text DEFAULT NULL::text)
          // 三個 text 參數在 DDL 都吃得下 NULL,但 PostgREST 的型別產生器**表達不了
          // 「必填但可為 null」**,一律型別化為非 null string ⇒ 不校正的話金流建單路徑會型別紅。
          // p_client_ip / p_client_ua = #241 best-effort PII(RPC 端 left 截斷、註解明寫可 NULL)。
          // ⚠️ 2026-08-01 被沖掉三次(A7c、S1b、S2)、2026-08-02 A6 第四次,都已重貼。
          p_address_id: string
          p_cart_session_id: string
          p_client_ip: string | null
          p_client_ua: string | null
          p_invoice: Json
          p_lines: Json
          p_notification_email?: string | null
          p_shipping_method: string
          p_terms_version: string
        }
        Returns: Json
      }
      expire_stuck_attempts_at_ceiling: { Args: never; Returns: number }
      expire_webhook_events_at_ceiling: { Args: never; Returns: number }
      find_active_sibling_own: {
        Args: { p_cart_session_id: string }
        Returns: Json
      }
      flag_non_unpaid_active_attempts: {
        Args: { p_limit: number }
        Returns: number
      }
      get_active_charge_attempt: { Args: { p_order_id: string }; Returns: Json }
      get_payment_anomaly_alert_summary: {
        Args: {
          p_pending_dc_stuck_seconds: number
          p_pending_dc_window_seconds: number
          p_refunding_stuck_seconds: number
        }
        Returns: Json
      }
      m3_jsonb_values_all_string: { Args: { j: Json }; Returns: boolean }
      mark_attempt_settle_retry: {
        Args: {
          p_attempt_id: string
          p_claimed_count: number
          p_reason_code: string
        }
        Returns: number
      }
      mark_charge_attempt_charged: {
        Args: {
          p_attempt_id: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: undefined
      }
      mark_charge_attempt_charged_fallback: {
        Args: {
          p_attempt_id: string
          p_fallback_token: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: undefined
      }
      mark_charge_attempt_failed: {
        Args: { p_attempt_id: string; p_order_id: string }
        Returns: undefined
      }
      mark_charge_attempt_released_for_user: {
        Args: {
          p_attempt_id: string
          p_cart_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      mark_webhook_processed: {
        Args: { p_claimed_count: number; p_rec_trade_id: string }
        Returns: number
      }
      mark_webhook_retry: {
        Args: {
          p_claimed_count: number
          p_reason_code: string
          p_rec_trade_id: string
        }
        Returns: number
      }
      pcm_a4a_recompute_order_item_summary: {
        Args: { p_order_item_id: string }
        Returns: undefined
      }
      pcm_b2_add_items_impl: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_shipment_id: string
        }
        Returns: Json
      }
      pcm_b2_is_blank: { Args: { t: string }; Returns: boolean }
      pcm_b2_shipping_human_error: {
        Args: { p_conname: string; p_sqlstate: string }
        Returns: string
      }
      pcm_b2_shipping_idem_bad_snapshot_cols: {
        Args: { p_snapshot: Json }
        Returns: string
      }
      pcm_b2_shipping_idem_claim: {
        Args: { p_action: string; p_hash: string; p_key: string }
        Returns: Json
      }
      pcm_b2_shipping_idem_payload_hash: {
        Args: { p_action: string; p_payload: Json }
        Returns: string
      }
      pcm_b2_shipping_idem_record: {
        Args: {
          p_action: string
          p_key: string
          p_shipment_id: string
          p_snapshot: Json
        }
        Returns: Json
      }
      pcm_b2_shipping_idem_response: {
        Args: { p_replay: boolean; p_shipment_id: string; p_snapshot: Json }
        Returns: Json
      }
      pcm_e13_assert_order_subtotal_matches: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      pcm_generate_display_id: { Args: never; Returns: string }
      pcm_order_refundable_remaining: {
        Args: { p_order_id: string }
        Returns: number
      }
      pcm_spec_text: { Args: { p: Json }; Returns: string }
      pfe_staging_reset: { Args: never; Returns: number }
      pfe_sync_commit: {
        Args: {
          p_allow_anomaly?: boolean
          p_note?: string
          p_orphan_rows: number
          p_run_id: string
          p_source_rows: number
        }
        Returns: Json
      }
      record_charge_bank_txn: {
        Args: {
          p_attempt_id: string
          p_bank_transaction_id: string
          p_order_id: string
        }
        Returns: boolean
      }
      record_charge_pending_rec: {
        Args: {
          p_attempt_id: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: boolean
      }
      record_pending_invoice: { Args: { p_order_id: string }; Returns: boolean }
      record_released_failure_observation: {
        Args: {
          p_attempt_id: string
          p_observed_status: number
          p_order_id: string
        }
        Returns: undefined
      }
      record_webhook_event: {
        Args: {
          p_amount?: number
          p_bank_transaction_id?: string
          p_order_number: string
          p_raw_hash: string
          p_rec_trade_id: string
          p_reported_status?: number
          p_transaction_time_millis?: number
        }
        Returns: boolean
      }
      resolve_double_charge_anomaly: {
        Args: {
          p_anomaly_id: string
          p_note: string
          p_provider_reference?: string
          p_resolution: string
        }
        Returns: Json
      }
      search_catalog_by_vehicle: {
        Args: {
          p_brand?: string
          p_brand_slugs?: string[]
          p_category?: string
          p_limit?: number
          p_model?: string
          p_new_since?: string
          p_offset?: number
          p_price_max?: number
          p_price_min?: number
          p_sort?: string
          p_year?: number
        }
        Returns: {
          item: Json
          total: number
        }[]
      }
      search_products_by_vehicle: {
        // 🔴 手動校正(見檔頭計數):p_model / p_year 在 DB 是 `DEFAULT NULL` 的**可省略且可為 null**
        // 參數(正式站實查:`p_brand text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer`),
        // 生成器只表達得出「可省略」。呼叫端(fitment-queries.queryProductsByVehicle)送的是**顯式 null**,
        // 不補 `| null` 就只能改送 undefined = 改變送出去的 payload,那是行為變更不是型別整理。
        Args: { p_brand: string; p_model?: string | null; p_year?: number | null }
        Returns: Json[]
      }
      supersede_charge_attempt_for_user: {
        Args: {
          p_order_id: string
          p_reason: string
          p_successor_order_id: string
          p_user_id: string
        }
        Returns: Json
      }
      sync_product_variant_group: {
        Args: {
          p_external_id: string
          p_orphan_skus?: string[]
          p_supplier_slug: string
          p_variants: Json
        }
        Returns: number
      }
    }
    Enums: {
      fulfillment_status: "notOrdered" | "ordered" | "inStock" | "shipped"
      invoice_type: "personal" | "company" | "donate"
      member_tier: "general" | "store" | "premiumStore"
      payment_status:
        | "unpaid"
        | "paid"
        | "partiallyPaid"
        | "refunded"
        | "partiallyRefunded"
      wallet_entry_type: "deposit" | "use" | "refund"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      fulfillment_status: ["notOrdered", "ordered", "inStock", "shipped"],
      invoice_type: ["personal", "company", "donate"],
      member_tier: ["general", "store", "premiumStore"],
      payment_status: [
        "unpaid",
        "paid",
        "partiallyPaid",
        "refunded",
        "partiallyRefunded",
      ],
      wallet_entry_type: ["deposit", "use", "refund"],
    },
  },
} as const
