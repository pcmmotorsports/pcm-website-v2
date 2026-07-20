# Day-2 kickoff — D-2 硬閘 + V 線 + UX 拍板落地(2026-07-16 晨,給新實作視窗)

> ✅ **歷史施工依據，相關工作已落地，不是目前開工入口。** 本檔因已套用 migration 的檔頭直接引用而保留原路徑；
> 當前進度請讀 `STATUS.md` 與 `docs/handoff/CURRENT.md`。

> 前置:昨夜 4 commit(D-1a/D-3a/b/c)已雙審 PASS;Sean 晨間拍板如下。溝通照舊走 `pcm-tools/review-inbox/`(Fable 值班台在線)。硬護欄不變:**不 push、不 apply、不 deploy、不動 .env**。

## Sean 拍板(2026-07-16 晨,逐字)
- **Q1=A 下拉多勾選**(Sean 玩過三版 demo 後拍;07-16 晨補):訂單狀態欄=下拉內 checkbox 多勾選+已勾數 badge、選了即時生效免按鈕;次要軸(來源/管道)同款。→ **D-1b 解鎖**,排 D-2 之後做。
- **Q2=A**:訂單列表**加回「日期」欄**(created_at 已在投影、一行 UI)。
- **Q3a=A**:三個 404 入口(品牌/安裝預約/合作店家)做**極簡佔位頁**(「即將推出+LINE 諮詢」)。
- **Q3b=A**:**開放訪客結帳**(下單後引導建帳號)——大題,先出 plan 不直接動工(動 checkout+create_order=金流硬閘)。
- **Q3c=B**:忘記密碼**直接做 email 重設流程**(Supabase resetPasswordForEmail;auth 面、獨立 slice、Fable 審)。
- **Q3d=B**:缺圖商品換**純色佔位圖+「圖片更新中」文字**(拿掉 unsplash 隨機圖)。
- **Q3e=A**:結帳頁**內嵌新增地址表單**(首購不再卡死離頁)。

## 施工順序(高風險優先、新鮮腦做)
1. **D-2 per-item 狀態(最高優先、硬閘)**:migration(order_items +workflow_status +version〔+updated_at 若 RPC set〕+backfill 繼承所屬訂單)+ `admin_update_order_item_workflow` owner RPC(鏡像 Slice C:key 白名單/FOR UPDATE/version 樂觀鎖/同交易 audit target='order_item:<id>';🔴 SET 字面絕不含 quantity/unit_price/line_total/variant_*)+ UI 切 item 層+整單彙總顯示。**交易模擬+Fable 對抗審+Codex 盲審;不 apply。**
2. **V-1 VehicleSelect 統一元件**(可打字三層+愛車快選;落型錄+首頁;含 Sean 三痛點=URL 狀態保留/膠囊拆三顆/篩選鏡像=驗收條件,見 overnight-kickoff 追加節;鐵則 1 先 grep design-reference)。
3. **V-2 購物車車款欄+商品頁適用比對**(§7 保守匹配紅線)。
4. **小件穿插(審查等待空檔)**:Q2 日期欄(一行)/ Q3d 佔位圖 / Q3a 三佔位頁(文案「即將推出,歡迎先加 LINE 詢問」+官方 LINE 連結,取自 design-reference/現站 footer 既有值;查無=BLOCKED 單問 Fable)/ W 批次 8 條。
5. **Q3e 結帳內嵌地址**(M;動 checkout=commit 前丟 Fable 抽查)。
6. **V-3 vehicle_snapshot+create_order 擴充(硬閘)**。
7. **plan only(不動工,寫 plan 進 inbox 給 Fable 審後留 Sean 批)**:Q3b 訪客結帳(散客單 customer_user_id NULL 已有 schema 底、但動結帳流+金流 RPC=完整 plan)/ Q3c 忘記密碼(auth 流程+email;可先 plan 後小步做)。
- **D-1b**:等 Sean 從 demo 回字母才建。

## 審查協議
同 overnight-kickoff(片單進 inbox、高風險雙審、輪上限 5、字面 vs 事實=磁碟 grep 後才自報)。
