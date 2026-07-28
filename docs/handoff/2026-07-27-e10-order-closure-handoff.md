# 交接:M-4b 完整後台 — E10 訂單閉環開工前(2026-07-27 深夜)

> **本檔是下一個 session 的唯一入口。** 取代前一份 `2026-07-27-admin-full-planning-handoff.md`(該檔的施工序已被 Sean 當晚推翻)。
> **Sean 目標(逐字)**:「我目標是把完整後台做好。」員工(非工程師)能不找工程師就把一天跑完。
> 衝突仲裁:可驗證事實 > `STATUS.md` > 本檔 > 歷史 handoff / memory。
> ⚠️ **模型事實**:本 session 實際跑的是 **`claude-opus-5`**,不是前一份交接指定的 Fable(harness 環境宣告為準,已向 Sean 揭露)。

---

## §1 開工第一件事(照順序)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
git log --oneline origin/dev..HEAD && git rev-list --count origin/dev..HEAD
```

預期:branch=`dev`。**未推數當場查、不看任何寫死的數字。**

然後依序讀:
1. 本檔全文
2. 🔴 **`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`** ← **總規劃本體**(~~舊 v1 `2026-07-27-…-master-plan.md` 已作廢、24 片編號 O0-O22 全數退場~~)。第 1 批片數**一律以該檔 §5.1 表格 `awk` 當場數為準**(多輪審查逐步重拆、輪數不寫死,本檔不寫死數字),Sean 拍板在 §8
3. `STATUS.md`
4. memory:`project_m4b-e10-order-list-layout-decisions`(版面與編號定案)/ `project_admin-backend-staff-ready-goal`(北極星)/ `project_m4b-real-auth-line-decisions`(E8-B 押後狀態)

🔴 **不要重問已拍板的題**(全表在總規劃 **§4 折入表與 §8 拍板節**、本檔 §3;R6 nit 更正:舊指標 §6 是完成定義、不是拍板表)。

---

## §2 這個 session 做了什麼(2026-07-27)

### 2.1 補完前一份交接的三項未查證 —— 並挖出一個沒人知道的硬前置

| 項 | 結論 |
|---|---|
| ①報價單 B庫 production 與 repo migration 是否一致 | **認證域無漂移**(`totp_devices`/`recovery_codes`/`auth_state`/`sso_codes` 欄位與 repo 逐欄相符);⚠️ plan 寫 `totp_devices` 14 欄=**錯**,實際 **13 欄** |
| ②`auth_state.require_2fa` 現值 | **`false`**;且 `totp_devices` **0 列**、`recovery_codes` **0 列** |
| ③A庫 staff 與稽核 | ✅ 完全相符:`sean`(is_manager=true)/`staff_1`/`staff_2`;`admin_audit_log` 27 筆、distinct actor 僅 1 |

🔴🔴 **額外挖出(原 plan 完全沒提到)**:**報價單 repo 不能跑 `supabase db push`**。
本地 146 個 migration 檔 vs production ledger 160 筆,**版本號零重疊**(11 個 14 碼檔逐一查也全部落空;本地 135 個是 8 碼日期前綴、ledger 全是 14 碼)。
⇒ push 會試圖把 146 個歷史 migration 重打到正式庫。詳 memory `reference_quote-repo-migration-ledger-desync`。

### 2.2 E8-B 認證線 → **押後**,plan 判定需重寫

- codex 關卡1 **R2 = FAIL、34 must-fix**(R1 是 17 且已全折入)⇒ 依輪次紀律(plan 層上限 2 輪)**停止折衝**
- Sean 拍 **Q5=A:第一期只做 email+密碼、完全不碰 TOTP**,2FA per-user 化另立 **E8-C**
  ⇒ B2(2FA 資料模型)、B5(記住裝置)**整片刪除**,B6 降級 ⇒ 11 片 → **約 8 片**,且 34 條中約 11 條隨之消失
- Sean 拍 **Q1=A/Q6=A(二次確認)**:先做 E10,E8-B 排在它後面

### 2.3 報價單站的真實狀態(交接前的說法是錯的)

🔴 前一份交接與報價單 STATUS 寫「從未 redeploy → 新 HMAC cookie 與 2FA 尚未活化」——**前半錯**:
production **5 小時前才部署過**、`SESSION_SECRET`/`EDGE_CONFIG` 46 天前就設好 ⇒ **新 session 早就在線上生效**
(`login/route.ts:117` 逐字 `useNew = Boolean(SESSION_SECRET) && Boolean(EDGE_CONFIG)`)。
真正沒做的只有**綁手機**與**按開啟 2FA**;Edge Config `pcm-auth` 裡**只有 Vercel 預設的 `greeting: "hello world"`**,三把鑰匙一把都沒建。
結論已寫回報價單 `STATUS.md`(隨別條線的 commit `b7cc098` 一起上了 origin/main)。詳 memory `project_quote-2fa-deployed-but-dormant`。

🔴 **現在不可以開 2FA**:Sean 揭露報價單後台**已有 2 人在用、預計 3-5 人**,而防重放計數器 `auth_state.last_consumed_step` 是**全公司單格**
(`lib/twofa.ts:75-82`)⇒ 兩人在同一 30 秒 step 登入,第二人被判 replay 拒絕。必須先做 E8-C per-user 化。

### 2.4 修掉一個真實的成本外洩風險(報價單,已 commit 未推)

「傳 LINE 給客人」原本**預設帶店家價(成本)**,而收件人名單走 `?all=1`(車行與散客混列、`is_dealer` 全 repo 零命中),唯一防線是一個 `window.confirm`。
⇒ 選錯人 + 順手按確定 = 成本送到散客手機、不可回收。

Sean 拍 A:改**三層 fail-closed**(共用函式預設參數 / route 旗標解析 `!== false` → `=== true` / UI 初始值與重置)。
連帶修正:同價分組不再拿隱藏的 `price_store` 當依據;移除所有斷言收件人是車行的文案;UI 明示手動改過的文字不受開關約束。
過 codex 關卡2 兩輪、三綠、124/124 測試、突變驗證。**commit `bbb8e32`(報價單 repo)、未推。**

### 2.5 產出 E10 總規劃 + 版面定案

- 總規劃 ~~`docs/specs/2026-07-27-e10-order-closure-master-plan.md`(24 片、13 片命中鐵則 12)~~ ⚠️ **該檔已作廢**(codex 關卡1 R1 FAIL 67 條 → 重寫成 `2026-07-28-…-v2.md`;R2 又 FAIL 33 條 → 再折入)。**24 片與 13 這兩個數字當時就是錯的**(實際表裡是 15 片高風險)
- 視覺定案 artifact:`https://claude.ai/code/artifact/87d397af-8a38-44c2-99da-7f9887a0181f`(現況 13 欄 / 提案 12 欄 可切換)
- Sean 當晚拍完 **P1-P4 + E1-E4** 八題(見 §3)

---

## §3 Sean 2026-07-27 拍板總表(接手不得重問)

| 題 | 拍板 |
|---|---|
| **Q1/Q6** | **A 先做 E10 訂單閉環**,E8-B 認證線押後(Sean 在得知資安顧慮後**二次確認**維持) |
| **Q2** | **B 供應商主檔 E12 這期不做** —— 🔴 前提修正:報價單 `suppliers` 表 16 列是**改裝品牌**不是下單對象 |
| **Q3** | **C 混合**:E8-B 的 migration 走 expand 先上、行為走 flag |
| **Q5** | **A E8-B 第一期只做 email+密碼**,2FA 另立 E8-C |
| **Q7/Q8/Q9** | LINE 推送預設關店家價 / 接受手打文字繞過(不加價格偵測)/ commit 不 push |
| **P1** | ~~分批出貨系統自動加後綴~~ 🔴 **Q19=A(07-28)正式作廢** —— `shipment_reference` 全表唯一即足(v2 §8.5);🔴 **Sean 申請 HCT API 時要勾「用新竹貨號查詢」** |
| **P2** | **A 只存單號 + 查詢連結** ⇒ 出貨通知可做、**送達通知不做** |
| **P2′** | 🔴 **B 送達這件事完全不做** —— **明確 override 07-26 的 U7=A**「Phase 1 人工查+手標已送達」。連動:**不加 `delivered` enum、不加 `delivered_at` 欄**;UX 審查檔 §5 第 15 條隨之失效。**接手不得照 U7=A 重做** |
| **P3** | **九個壓縮碼退場、改三軸**(取代懸置的 N8) |
| **P4** | **B 分三批驗收**,每批 Sean 肉眼驗過才進下一批 |
| **E1** | **訂單編號 6 碼亂碼** |
| **E2** | 欄位精簡**照提案**(13 → 12 欄) |
| **E3** | 配色:未做灰 / 已訂貨黃 / 已出貨綠 |
| **E4** | **A 已出貨欄只放快遞單號**、不放出貨日期 |

細節與依據全在總規劃 **§4(UX 決策折入表)與 §8(Sean 拍板)**(R6 nit 更正:舊指標 §6.1-§6.4 過時,v2 無 §6.4)。

---

## §4 下一個 session 要做什麼

1. **先處理 codex 關卡1 的 findings**(見 §6 未完成項)
2. ~~Sean 批准總規劃後,從 **O0** 開始~~ ⇒ **O0-O22 這套片號已全數退場**。現行 = v2 §5.1 的 A 系列片(**片數以該表當場數為準,不抄進本檔**),起點是 **A0a 資料現況重驗**,其後 **D1 前有 Sean 獨立批准閘**
3. ~~依 P4=B 第一批 = O0-O7~~ ⇒ 見 v2 §5.1

🔴 **必須補查的**(原 O0,現已拆成 **A0a / A0b / A0c** 三片):orders 現有筆數(本輪查得 **29**,會變)/ E11 積木 `<AdminDataTable>`·`<AdminForm>` 是否已被 orders/customers 兩頁實際採用 / 27 項逐項重驗(本輪沿用 07-26 的 ✅2 ⚠️6 ❌19、**未逐項重驗**)。

⚠️ ~~O7b 版面依賴 O4+O5+O7a+O8 的取捨~~ **已作廢**:O 系列片號全數退場,現行依賴圖見 v2 §5.0。

---

## §5 🔴 陷阱清單(本輪新增的,前一份沒有)

| 陷阱 | 內容 |
|---|---|
| **報價單不能 `db push`** | 本地 146 檔 vs ledger 160 筆**版本號零重疊**。PCM「正式 schema 用 db push」的鐵則**只適用 A庫**,不可套到報價單 |
| **兩個 repo 都有並行 session 在寫** | 本輪實錘:報價單工作樹一路變動、最後被別條線 commit + push(`b7cc098`)並**捲走了本 session 寫的 STATUS.md 內容**;`pcm-website-v2` 也在 session 中途冒出別人的 migration。⇒ **每次 add 用 pathspec、立即 commit,絕不 `git add .`** |
| ~~篩選必須在資料層~~ 🔴 **本條錯誤、已作廢** | codex R1 抓、主對話親讀確認:`rowSpan` 是從**手上這份 lines** 算的,資料層或畫面層篩都行。**真正的約束 = 篩完必須重新分組並重算 rowSpan;禁止對既有 DOM 用 CSS/JS 隱藏列** |
| ~~不做整單彙總徽章~~ 🔴 **過度概化、已作廢** | 註解只證明**不完整投影**不能拿來算彙總。**真正的約束 = 彙總的資料來源必須是完整品項集合** |
| **短編號要有 unique + 有界重試** | 報價單短編號候選用盡後連撞 unique,誤報成「token 連續碰撞」500、系統當機 |
| **`create_order` 不可用於手動建單** | `:284` `auth.uid` 為 NULL 直接 exception;`:356`/`:360` 品項必須是既有 catalog 變體 ⇒ 需另開 admin 專用 RPC |
| **`orders.display_position` 全為 NULL** | 欄位存在但未使用,**不可假設它能當排序鍵** |
| **Codex 說「因沙箱限制未驗證」= 未知** | 不等於「驗了會過」;**build 一律主對話自跑**(E8-A2 實錘:它報 1/2、實跑 0/2) |
| **突變測試先 grep 驗替換真的發生** | 否則把無效突變誤判成假綠 |
| **UI 禁 emoji 與驚嘆號** | `CLAUDE.md:38` / `AGENTS.md:129` 標 **[紅線]**。本輪實際犯過一次(加 `⚠`),已寫進報價單守門測試 |
| **修文案要 grep 全樹** | 本輪實際復發:只改了 grep 命中的其中兩處,`車行會收到` 漏網被 codex R2 抓到 |
| **`dev` = pcm-admin 正式站** | push 即部署;storefront 才看 `main` |

---

## §6 🔴 誠實邊界與未完成項

### 🔴🔴 codex 關卡1 輪次表(2026-07-28 更新;趨勢 67→33→31→32→26→24→15→17→16→7→5→4→7→10→10→6→5→7→3→**PASS**)

| 輪 | 結果 | findings 檔 |
|---|---|---|
| R1(審 v1) | FAIL **67**(去重後;must-fix 62 + nit 5。「約 60」是 62 的約數) | `docs/reviews/2026-07-27-e10-master-plan-codex-k1.md` |
| R2(審 v2) | FAIL **33 + 2** | `docs/reviews/2026-07-28-e10-k1-r2-codex.md` |
| R3 | FAIL **31 + 2** | `docs/reviews/2026-07-28-e10-k1-r3-codex.md` |
| R4 | FAIL **32 + 1**、codex 逐字**「未收斂」** | `docs/reviews/2026-07-28-e10-k1-r4-codex.md` |
| R5 | FAIL **26 + 2**、首次實質下降 + 根因診斷(唯一 DAG + 閉環矩陣) | `docs/reviews/2026-07-28-e10-k1-r5-codex.md` |
| R6 | FAIL **24 + 1**、首現「已關死類別」清單 | `docs/reviews/2026-07-28-e10-k1-r6-codex.md` |
| R7 | FAIL **15 + 1**、R6 全關死;深水區 = 金流取消語意(第 1 批取消因此 fail-closed 到無退款需求的單) | `docs/reviews/2026-07-28-e10-k1-r7-codex.md` |
| R8 | FAIL **17 + 4**、再下探跨 RPC 競態 / TapPay 退款外部冪等(`bank_refund_id` + `submitted`)/ D1 pooler 守門;兩題升為 §8.6 開批閘 | `docs/reviews/2026-07-28-e10-k1-r8-codex.md` |
| R9 | FAIL **16 + 2**、零決策題全機械合約缺口;submitted 出路 / baseline 初始化位置 / 同 rec_trade_id 序列化 / D1 12 片 + A15 adapter 片 | `docs/reviews/2026-07-28-e10-k1-r9-codex.md` |
| R10 | FAIL **7**、大幅收斂(R9 約 12 條關閉);A8c1 改鎖 `begin_charge_attempt` / rec_trade_id NOT NULL / `reconciling` 相位 / A15 port / D1t 拆二 | `docs/reviews/2026-07-28-e10-k1-r10-codex.md` |
| R11 | FAIL **5 + 1**;begin 基底改 0c / reconcile 異常不繞回送款相 / job 表卡軌專用·匯款分流 / port 實名 / D1t 三拆 | `docs/reviews/2026-07-28-e10-k1-r11-codex.md` |
| R12 | FAIL **4 + 2**;check_fail_count 入 schema / order_payments rail 權威 / A7 兩表 / **主規格舊模型原地標記取代** | `docs/reviews/2026-07-28-e10-k1-r12-codex.md` |
| R13 | FAIL **7**;v2 本體 3 條(計數器歸零+CAS / canonical rail / D1 selector)+ **相鄰規格 4 條舊字面**(主規格施工序·自由品項·N7-N9、UX §8) | `docs/reviews/2026-07-28-e10-k1-r13-codex.md` |
| R14 | FAIL **10**;v2 本體 5 條(rail writer 分離 / cash-only / 超額三路 / A0a 驗收 / 空狀態映射)+ 相鄰規格 5 條(主規格四處 + UX :65) | `docs/reviews/2026-07-28-e10-k1-r14-codex.md` |
| R15 | FAIL **10 + 1**;P3 退場補 A9w/A9v 兩片(64 片)/ mapping 明列 tappay→card / order_payments 域發布序 / 現金退還合約 / dead 告警 durable | `docs/reviews/2026-07-28-e10-k1-r15-codex.md` |
| R16 | FAIL **6 + 1**;A9v 只撤 item 支(修誤殺)/ A9w 拆三(66 片)/ dead 未結案仍序列化 / 告警結案 RPC / model-spec·UX 兩處 | `docs/reviews/2026-07-28-e10-k1-r16-codex.md` |
| R17 | FAIL **5**;DAG 循環解除 / A9w4 writer chain(67 片)/ 矩陣 P3 退場列 / job 世代式重開 / dead 結案 UI 落片 | `docs/reviews/2026-07-28-e10-k1-r17-codex.md` |
| R18 | FAIL **7 + 1**;DAG 去重 / A9w4 拆三(69 片、高風險 42)/ 撤 status-options 寫權 / resolution 分流堵超退重開 | `docs/reviews/2026-07-28-e10-k1-r18-codex.md` |
| R19 | FAIL **3 + 1**;兩閘字面 / DAG=片表統一 / 世代授權原子消耗(retry_consumed_at) | `docs/reviews/2026-07-28-e10-k1-r19-codex.md` |
| **R20** | # ✅ **PASS**(附 2 nit 已修);逐字「規格已達可施工狀態」 | `docs/reviews/2026-07-28-e10-k1-r20-codex.md` |

✅ **R1-R20 全部已折入、關卡1 通過**(R1 逐條裁定 triage 檔,駁回 0 條)。
🔴 **下一步:①Fable 四線復盤(Sean 已指示、ultracode)②復盤過後送 Sean 最終批准(鐵則 8;閘序 = 關卡1 先、Sean 批准後)③批准後從 A0a 動工**。
✅ **全貌視覺已交付、Sean 批准方向**(artifact `ed7a6276-70fc-44f3-b09c-61c8991b5294`)。

**R1 的三條抽驗備查(當時全部成立)**:

**主對話抽驗三條,全部成立(不是 codex 過度嚴格)**:

| 抽驗項 | 裁定 | 證據 |
|---|---|---|
| `internal_note` 加在 `orders` 會洩漏給客人 | ✅ **成立、資安面** | `20260604120000_m3_s2a_orders_order_items.sql:190` 逐字 `GRANT SELECT ON TABLE orders TO authenticated` = **整表欄位級全開** + `orders_select_own` RLS ⇒ 登入客人讀得到自己訂單的**所有欄位**。內部備註必須另立表或走 column-level 控制 |
| **P2 與已拍板的 U7 直接衝突** | ✅ **成立、是我的流程錯誤**;**已重問並解決** | `2026-07-26-admin-ux-operability-review.md` U7 原為「A Phase 1 人工查+手標已送達」。主對話在 P2 建議「送達通知不做」= **提了與既有拍板相反的方案而沒發現**,Sean 據此答了 P2=A。⇒ **2026-07-27 重問,Sean 明確選 B「送達完全不做」= override U7=A**(見 §3 P2′)。三份檔已同步:UX 審查 §7 U7 列與 §5 第 15 條、總規劃 §6 與 O5/O8 |
| 6 碼碰撞機率算錯 | ✅ **成立、我給 Sean 的數字是錯的** | 我寫「32 字母表」但同段又指定「排除易混淆字元 **+ 母音**」⇒ 36−(0,O,1,I,L)−(A,E,U)= **28 字**。實算:**5 碼 23.0%、6 碼 0.929%**(我報的是 12.6% / 0.4%)。**結論「用 6 碼」仍成立**(0.9% 且有重試 = 可接受),但數字要更正 |

**其餘 must-fix 的主要類型**(⚠️ **歷史紀錄,R7 nit 標註**:這是 R1 當時的摘要;R1-R7 已全數逐條折入,片號 O 系列已退場,現況一律以總規劃 v2 為準):
①**片型與大小**:多數片混了 schema+RPC+audit+UI,遠超鐵則 4 的 15-45 分鐘,必須再拆
②**依賴不閉合**:第 1 批寫 O0-O7 卻含依賴 O8 的 O7a/O7b;O11/O12 未依賴包裹片 O10;O19 未依賴帳本片
③**27 項映射不誠實**:O14「接帳本做 UI」不成立 —— `order_refunds` 只給 service_role SELECT,且退款線 RF2b-RF8 本就未施工 ⇒ 第 17 項做完仍不能退款
④**U 系列拍板未折入**:U1 多單併一箱 / U2 已裝箱鎖定 / U5 負責人與跟進日 / U4 通知矩陣 / U6 缺貨告知
⑤**enum 不可 contract**:「所有 DB 片一律 expand/contract」對 O5 字面不成立
⑥**數字自相矛盾**:片數 24 vs 22、高風險片 13 vs 12、server action 7(實際 6)
⑦**C1 同檔既寫「未定」又寫「已拍板」**,且 `docs/reference/hct-logistics-api-reference.md:217` 仍記未定案 —— **repo 真權威未同步**

🔴 依鐵則 8/12,**Sean 批准 + 關卡1 通過前不得動第一片 code**。
~~依輪次紀律 plan 層上限 2 輪~~ 🔴 **Sean 07-28 拍 Q8=B 解除上限**(逐字「就算有第四輪第五輪都沒差」);輪數與趨勢**以上方輪次表為準、此行不再寫死**。
- ~~24 片的「2-4 週」~~(⚠️ 歷史數字;現行片數**只看 v2 §5.1 `awk` 當場數、本檔不寫死**)整體工期**未逐片估算**,不是承諾。
- 27 項現況(✅2/⚠️6/❌19)沿用 2026-07-26 read-back,**本輪未逐項重驗**(重驗 = v2 的 A0a-A0c 片;~~O0~~ 編號已退場)。
- E8-B plan v3 的 **34 條 must-fix 尚未重寫折入**;本輪只記錄狀態。
- **graphify 地圖本輪未刷** —— 本 session 在 `pcm-website-v2` **零 code 變更**(只新增一份 docs),依 handoff skill 步驟 2 跳過。
  ⚠️ 地圖仍含 E8-A1 之前的舊節點(`STAFF [staff.ts:15]`),下次要用地圖判連動面前**先刷**(必 `dedup=False`、刷前備份)。
- 報價單那 4 項「順便確認」:手機版卡片 ✅ 已上線;**LINE 推變體外洩(已修)**;Model B LINE 綁定 ❌ 未做(Phase 2);dealer included 持久化 ❌ 未做。

---

## §7 Git 狀態(當場查、不信本檔數字)

> ⚠️ **以下為 2026-07-27 交接當下的歷史快照(R8 抓與現況矛盾,標歷史、不刪)**。
> 現況一律當場跑 `git log --oneline -4` / `git rev-list --count origin/dev..HEAD` 查,
> 07-28 之後 dev 已累積多筆審查輪次 commit、工作樹以凍結紀律維持乾淨。

**`pcm-website-v2`**(07-27 快照)
- branch `dev`、~~未推 0 筆、零 code 變更~~
- ~~未 commit:v1 總規劃(untracked)+ 本檔~~(v1 已作廢、皆已 commit)
- 🔴 session 中途出現**別條線**的 `scripts/rpm-delta.ts` 等 4 檔改動,**不是本 session 的**,不要一起 commit

**`/Users/sean_1/API大量上架/PCM報價單-V2`**(07-27 快照)
- branch `main`(= 正式站,推即部署)
- ~~未推 1 筆:`bbb8e32`~~(07-28 已由另一 session 連同 `36cf77c` 推上)
- 工作樹另有別條線的 translation workbench 檔案,**不要碰**

🔴 **不自動 push、不主動提議 push。**

— END —
