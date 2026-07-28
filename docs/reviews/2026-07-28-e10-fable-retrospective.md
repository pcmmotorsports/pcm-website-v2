# E10 Fable 四線全面復盤(2026-07-28;Sean 指示、ultracode workflow)

> 對象 = 關卡1 R20 PASS 後的 spec(commit `5d68562`)。4 agent 並行、範圍互斥;
> 三線 Fable 對抗(adversarial-reviewer)+ 一線 Opus 流程復盤。686k tokens / 15 分鐘。
> **總計 must-fix 14 條(2+2+10)、nit 18 條**;主對話已親驗抽核(#E73928 零命中+tokens.css:16、
> order-filter-controls.tsx 實存消費、TapPayChargeAdapter server-only 檔頭)皆成立。

## 第一線:拍板一致性(fable/adversarial) —— FAIL(must-fix 2 / nit 5)

- [must-fix] /Users/sean_1/pcm-website-v2/docs/handoff/2026-07-27-e10-order-closure-handoff.md:82-96;對照 docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:614-622
  - 主張:Q 題號跨日重用且零消歧標記:07-27 handoff §3 的 Q1-Q9 與 07-28 v2 §8 的 Q1-Q9 同號、不同題、不同答案,兩表皆標「不得重問」。Q1:A 先E10 vs B 彙總不維護;Q2:B E12不做 vs A 砍26改3;Q3:C E8-B migration expand+flag vs A 吃下RF2b-RF8;Q5:A 只做email+密碼 vs TapPay退款確認;Q7/Q8/Q9 同樣兩用(Q8:接受手打文字繞過 vs B 解除輪次上限)。同里程碑另有至少三套 Q 系統並行(platform plan §0.1 Q1-Q6-2、E8-B 六題 Q1-Q6、model-spec §7 Q7-Q9 ⏳待答),且 E1-E4 拍板題號與 E1-E4 epic 編號(rebuild spec :65)同名。
  - 證據:handoff §3(:82-96)「Q2 = B 供應商主檔 E12 這期不做」vs v2:617「Q2 舊訂單處理 = A 砍 26 張」;STATUS.md 同檔並存兩者(:19 Q2=A、:22 Q2=B)皆裸引用不帶日期。撞號誤用已有前例:rebuild spec :504「2026-07-26 對話中一度以「Q4」稱呼本題,與 §0.1 的 Q4 撞號、已更正」、:466「本檔有兩套題號並存,勿混」。失敗情境:接手 session 依 handoff §1 必讀清單同時載入三個互斥的「Q3」(=C 帳號email / =C expand+flag / =A 退款線),裸引用「Q3」即採錯板。
  - 修法:v2 §8 與 handoff §3 各加一行消歧宣告(本表題號僅限本日,引用一律帶日期,如「07-28 Q2」),並把 STATUS.md 內兩處裸引用補上日期前綴。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:63、296、328;handoff:25
  - 主張:Q9=B(計數器依軸分批加、欄位不得早於真相模型)在 v2 被引用三次,但全 repo 無任何拍板紀錄:不在 v2 §8/§8.5/§8.6 任何拍板表、不在 STATUS、不在 handoff;唯一完整紀錄(題意+A/B 選項+理由)只在 memory 檔。handoff :25 宣稱「全表在總規劃 §4 折入表與 §8 拍板節、本檔 §3」字面不成立(Q9=B 三處皆無;P3/E1-E4 的依據實際也在 §5.1a/§5.4 而非 §4/§8)。
  - 證據:v2:63「(Q9=B;codex R2 抓…)」、:296「Q9=B 連動」、:328「只加這三欄(Q9=B)」;grep 證實 §8 各表零 Q9 列、STATUS.md 零命中。失敗情境:第 2/3 批加 shipped_quantity/return_* 計數器時,施工 session 照 handoff 指示查「全表」查不到 Q9,無從驗證分批約束是 Sean 拍板還是工程自選,可能重問已拍板的題、或視為可改選項一次補齊全部計數器(正面違反 Q9=B)。
  - 修法:v2 §8 表補 Q9=B 一列(題意、選項 A 即時聚合 vs B 存欄分批、拍板理由,內容可自 memory project_m4b-e10-plan-v2-decisions.md:45-47 抄入);handoff :25 的指標句同步修正。
- [nit] /Users/sean_1/pcm-website-v2/STATUS.md:19
  - 主張:拍板紀錄完備性三缺:①Q15=D 全樹僅 STATUS 一句「Sean 拍 Q15=D 續折」,題目與選項 A/B/C 為何無任何檔案記載(v2、handoff、memory 皆零命中);②Q13/Q14 在 E10 脈絡全樹零命中——若當時有題已拍未落檔即違反拍板即落檔,若為跳號亦無從查證;③Q16=A 三份 repo 檔一致但未入 memory 決策檔(project_m4b-e10-plan-v2-decisions.md 零 Q16),與「一板一檔」協議不符。
  - 證據:STATUS.md:19「Sean 拍 Q15=D 續折」為唯一命中;grep -rn Q13/Q14/Q15/Q16 於 docs/、STATUS、memory 僅命中無關舊檔(2026-04-30 架構檔、m4a email 線)。查無=明說:無法排除 Q13/Q14 是被跳過的編號。
  - 修法:主對話補記:Q15 的題意與選項落 memory 或 v2 頁首一行;聲明 Q13/Q14 是否跳號;Q16=A 補入 memory 決策檔。
- [nit] /Users/sean_1/.claude/projects/-Users-sean-1-pcm-website-v2/memory/project_m4b-e10-plan-v2-decisions.md:27-31 vs 63、70
  - 主張:E10 拍板 memory 檔內部殘舊(只補尾段未回改前段):「D1 片(M 型、A0 之後 A1 之前)」與「read-back 需要時再跑」兩句已被 v2 推翻——D1 現為 runbook 型 14 片(非 M 型、非 migration),read-back 已升硬閘(D1b1+D1c 步驟 8b 兩次強制);「需要時再跑」正是 R10 在 v2 抓掉的同款字面,卻在 memory 存活。同檔尾段(:63、:70)已寫 runbook 14 片,自相矛盾。
  - 證據:memory project_m4b-e10-plan-v2-decisions.md:27-28「D1 片(M 型…)」、:31「recordQuery 可查,需要時再跑」vs 同檔 :70「D1 線 14 片 runbook」;v2:618 Q5 列逐字「已升級為硬閘…(R10 抓「需要時再跑」與 §8.4 硬閘矛盾,此處字面已改)」、v2:579「D1 不在此列——它是 runbook 型不是 M 型」。仲裁序上 memory 最低、v2 為準,風險有界,但這是 feedback_claimed-sync-but-only-patched-touched-lines 的第 11 次同族復發。
  - 修法:memory 檔前段兩句原地標記取代(D1=runbook 14 片;read-back=硬閘)。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-26-admin-ux-operability-review.md:76;另 docs/specs/2026-07-25-admin-backend-rebuild-spec.md:505
  - 主張:兩處拍板指標未同步:①UX 審查 #25「空狀態三動作(清除篩選/建手動單/查詢範例)」未原地標記 R14 映射(第 1 批只交付兩動作、建手動單第 3 批啟用)——同檔 #6/#15/#17 都有 R 更新標記,維護模式不一致;②rebuild spec N7 列權威指標寫「UX 審查 §1 U2」,U2 拍板實際在 UX 審查 §7(§1 無 U2 條)。
  - 證據:UX 審查 :76 原文無 R14 註記 vs v2:192「R14 修映射:第 1 批只交付「清除篩選 + 查詢範例」(A14c);「建手動單」第 3 批 RPC 完成後才啟用(死按鈕禁上)」;rebuild spec :505「權威 = UX 審查 §1 U2 + E10 v2 §4」vs UX 審查 U2 拍板表位於 :95(§7)。
  - 修法:UX #25 加一行 R14 phasing 註記;N7 指標改「§7 U2」。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:183
  - 主張:v2 §4 通知矩陣列同一格並存兩個互斥時點:「E10 前 Sean 勾選」(UX 原文殘留)與落點欄「第 2 批開批前拍板」(§8.6 定為唯一權威)。送 Sean 最終批准在即,批准者照前者字面會誤判通知矩陣是本次批准的前置。
  - 證據:v2:183 逐字「事件清單見 UX 審查 §3;E10 前 Sean 勾選 | 第 2 批開批前拍板」;v2:881 §8.6 定「第 2 批項 7(內部通知)開工前」。UX 審查 :44 草案句同款殘留。
  - 修法:該格「E10 前 Sean 勾選」改為「第 2 批開批前 Sean 勾選(§8.6)」,UX :44 同步。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:3、14
  - 主張:v2 頁首閘態字面殘舊/不全:①:14 仍寫「下一步送 R20」而 :3 已記 R20 PASS(只改了 :3 沒回改 :14);②:3 閘序寫「關卡1 先、Sean 批准後」,未含 STATUS/handoff/memory 三處一致記載的中間步「Fable 四線復盤(Sean 指示)」——Sean 的流程指示在施工規格本體查不到。
  - 證據:v2:14「下一步送 R20。」vs v2:3「R20 PASS…現在送 Sean 最終批准」;STATUS.md:19「下一步:①Fable 四線復盤(ultracode,Sean 指示)②送 Sean 最終批准③批准後 A0a 動工」;handoff:160 同序;memory 檔 :66 同序。
  - 修法::14 尾句改「R20 已 PASS」;:3 閘序補「Fable 復盤 → Sean 批准」一步。

**該線總結**:PCM 結論:FAIL(2 must-fix + 5 nit)。是否可繼續:需修正——全部為文件層一行級修正,不推翻任何拍板內容,修完即可送 Sean 最終批准,無需 Sean 拍板(無商業取捨題)。第一線範圍=拍板一致性,已逐板盤點:07-28 E10 系 Q1-Q5/Q7/Q8/Q9/Q10-Q12/Q15-Q19、07-27 系 Q1-Q9+P1-P4+E1-E4、07-26 U1-U7、07-25 N1-N9,共 40+ 板。②標記檢查全過:U7=B override、U1/Q16=A 縮小、Q19=A 作廢 P1、Q1=B 推翻主規格 §3.1,四處皆「有標記且各處一致」(含 HCT 參考檔後綴同步)。③自行發明檢查:查無未拍板的重大設計決定(internal_error 對客文案有 Sean 知情核准、已付款取消 fail-closed 為已揭露的分批而非推翻、shipment_reference 全表唯一為 Q10=A 工程強化)。真正的問題集中在「拍板簿記」而非「拍板內容」:(F1) Q1-Q9 兩天兩套同號不同題零消歧、且已有 Q4/N6 撞號前例;(F2) Q9=B 被 v2 引用三次卻無任何 in-repo 拍板紀錄,handoff「全表」宣稱字面不成立;(F3) Q15=D 僅一句、Q13/Q14 查無、Q16=A 缺 memory;(F4-F7) 四處殘舊/指標字面。凍結紀律:本輪對 HEAD=5d68562 審查,工作樹乾淨,行號可信。WOULD-CHANGE-MY-VERDICT:若主對話出示 Q9=B 其實已有 in-repo 拍板列(我 grep 漏掉的位置)且 Q 系列已有我未讀到的消歧公約,F1/F2 即降 nit、結論轉 PASS-with-comments。

## 第二線:規格 vs repo 事實(fable/adversarial) —— FAIL(must-fix 2 / nit 4)

- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:437
  - 主張:§5.1a 版面規格(標題自稱「repo 內可驗字面」)寫「待付款」PCM 紅 `#E73928`,A11b 片將照此施工
  - 證據:grep -rni 'e73928' 於 design-reference/、packages/、apps/ 全部零命中;design 真權威 token 是 /Users/sean_1/pcm-website-v2/design-reference/styles/tokens.css:16 `--c-red: #dc2626`;且 repo 既有規格 /Users/sean_1/pcm-website-v2/docs/specs/2026-07-12-search-vehicle-work-plan.md:92 早已逐字裁定「品牌色 hex(#E73928…)在網站 repo 零命中,是外部色…鐵則 1:用網站 token、不照抄」。#E73928 在 repo 內僅存在於 v1/v2 這兩份 E10 規格自身
  - 修法:把 `#E73928` 改為 grep 驗證過的 design token(`--c-red`)或明確標註為「design-reference 未含此色、須 Sean 拍板的 override 並登 drift」,不得以「repo 內可驗字面」名義夾帶零命中 hex
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:676-688, 348
  - 主張:§8.5「fulfillment_status 的 stale reader 全樹清單」宣稱「實查全樹 8 處在讀」且為完整清單,A9e 片的移除範圍照此清單具名(order-filter-bar.tsx:36 + order-list-view.ts:31,149,184)
  - 證據:grep 實測 admin 內另有整支檔案消費同一 stale 篩選鏈而未列:/Users/sean_1/pcm-website-v2/apps/admin/src/components/orders/order-filter-controls.tsx:9(import FULFILLMENT_STATUS_PARAM)、:41(`[FULFILLMENT_STATUS_PARAM, state.ful || undefined]` 寫回 URL)、:56/:63(fulfillmentOptions prop)、:105(`options={fulfillmentOptions}` 渲染篩選器);另 order-filter-bar.tsx:30(`fulfillmentOptions={FULFILLMENT_STATUS_OPTIONS}`)與 order-list-view.ts:56/88/127-129(VALUES/LABEL/OPTIONS 常數)也在同鏈。`order-filter-controls` 一詞於規格全文零命中(grep exit 1)。規格自己把「同類必須全掃」列為第 10 次復發的鐵律,這份清單正是同型漏掃
  - 修法:重跑 grep 補完清單(至少補 order-filter-controls.tsx 全檔與 order-filter-bar.tsx:30、order-list-view.ts 常數群),並把 A9e 的移除範圍改列完整檔案清單
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:122, 554
  - 主張:§2.1/§6.2 引 `20260725130100:326-327` 為 order_refunds/order_refund_items 的 service_role SELECT only
  - 證據:實際 GRANT SELECT 在 /Users/sean_1/pcm-website-v2/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:324-325(grep -n 親驗);:326-327 是其後的函式 EXECUTE 收斂註解。宣稱本身(REVOKE ALL 後僅 GRANT SELECT TO service_role)為真
  - 修法:行號改 324-325
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:593
  - 主張:§7.2 引 `ORDERS_PAGE_SIZE = 20`(order-list-view.ts:26)
  - 證據:實際在 /Users/sean_1/pcm-website-v2/apps/admin/src/lib/orders/order-list-view.ts:27(grep -n 親驗);:26 是其 docstring。值 20 與「以訂單為分頁單位」宣稱皆為真
  - 修法:行號改 27
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:364
  - 主張:A9v 寫「親驗 `20260716120000:76` 它(admin_update_order_workflow)已在 D-2 收窄(送 workflow_status key = RAISE)」
  - 證據:20260716120000:76 是 COMMENT ON COLUMN 的註解文字,其內文自己說收窄發生在「20260716130000 §4」;真正的強制在 /Users/sean_1/pcm-website-v2/supabase/migrations/20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:217(CREATE OR REPLACE)、:231-234(白名單=shipping_method+發票三欄)、:261(非白名單 key RAISE)。宣稱實質為真,但引用點是會漂移的註解、不是強制本體;「D-2 收窄」的檔號也與註解所指(130000 非 120000)有一碼之差
  - 修法:改引 20260716130000:231-234,261 為強制本體證據,:76 降為輔證
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:123
  - 主張:§2.1 ACL 表寫 admin_audit_log 對 service_role「INSERT only(20260712210000:88)」
  - 證據:/Users/sean_1/pcm-website-v2/supabase/migrations/20260712210000_m4a_admin_audit_log.sql:88 是註解「🔴 不給 SELECT(最小權限;稽核 viewer slice 才顯式 GRANT SELECT TO service_role)」、GRANT INSERT 本體在 :89;規格同格引述的「稽核 viewer slice 才顯式 GRANT SELECT」逐字命中 :88,故僅 INSERT-only 那半句差一行。宣稱實質為真
  - 修法:行號改 88-89

**該線總結**:第二線(規格 vs repo 事實)逐條抽驗 v2 規格全部 repo 字面引用,共 36 組引用群、約 60 個 檔案:行號 斷言逐一 Read/grep 親驗。優先清單全數過關:payment_status 5 值(20260604120000:50 四值 + 20260725130000:45 加 partiallyRefunded)、record_status 7 值與 top status {0,2}(tappay-reference.md:85-86 逐字)、begin_charge_attempt 最新定義確為 20260613140000:73(0c 補 existing_bank_transaction_id;130000:350 為前版、其後無重定義)、confirm_order_payment :181 逐字 payment_method='tappay'、order_refunds.bank_refund_id :86 NOT NULL/:108 UNIQUE 與 :114-115 金額不變式、ITapPayAdapter.ts:43 port 簽章、TapPayChargeAdapter.ts:224 recordQuery 無 signal(settle-charge.ts:77 確為呼叫點)、orders/order_items GRANT SELECT :190-191 逐字、admin_update_order_workflow 已拒 workflow_status(強制本體 20260716130000:261、白名單=運送方式+發票三欄 :231-234)、pending_invoices CHECK 僅 pending/issued(:201,無 voided ⇒ D0 必要性成立)、payment_double_charge_anomalies.old_order_id :48 逐字、anomaly_events 僅 anomaly_id FK。零命中類斷言複驗全對:assertDisplayId 僅 domain 四檔、createOrder 零生產呼叫端、delivered 全樹零命中、order_refunds 於 apps/admin/src 零引用、兩支金流 RPC 零 cancelled 檢查、後台零取消入口、email_outbox allowlist 僅 order_created/order_shipped;FK 規則五表(NO ACTION×2/RESTRICT/CASCADE×2)、orders 唯一 BEFORE INSERT trigger、admin RPC 恰 4 支、'use server' 指令檔恰 6、業務 route 恰 7、HCT :49/:81/:121、domain 六處行號、stale reader 已列各行號、28 字元字母表與 28^5/28^6 組合數皆逐字/逐值吻合。發現 2 條 must-fix:①§5.1a 自稱「repo 內可驗字面」卻寫入 repo 全樹零命中的 PCM 紅 #E73928,design 真權威為 tokens.css:16 --c-red:#dc2626,且 2026-07-12 規格早已明文裁定該 hex 為外部色、鐵則 1 禁照抄 —— A11b 照施工即違鐵則 1;②§8.5「stale reader 全樹 8 處」清單漏掃 order-filter-controls.tsx 整檔(9/41/56/63/105 五處消費同一篩選鏈,規格全文零提及),A9e 移除範圍因此不完整,正是規格自己標記為第 10 次復發的「同類未全掃」型錯。另 4 條行號漂移 nit(:326-327→324-325、:26→27、:76 引註解非本體、:88→88-89),宣稱實質皆真。依 must-fix ≥1 判 FAIL;兩條修正後本線可轉 PASS。

## 第三線:D1 runbook 攻擊(fable/adversarial) —— FAIL(must-fix 10 / nit 9)

- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 D1c 執行器定義(檔內約 762-767)
  - 主張:D1 orchestrator 在純 node/tsx 下無法 import TapPayChargeAdapter —— 檔頭 server-only 會在載入時 throw,D1t1/D1t2/D1b1/D1c 四片全部起不來
  - 證據:packages/adapters/src/tappay/TapPayChargeAdapter.ts:22 逐字 `import 'server-only';`。node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/index.js 全檔內容 = `throw new Error("This module cannot be imported from a Client Component module. ...")`;同套件 package.json exports 只有 `"react-server": "./empty.js"` 條件才不 throw,`"default": "./index.js"`。repo 自證:packages/adapters/src/tappay/TapPayChargeAdapter.test.ts:1 逐字「node 環境直接 import 會 throw」、:10 `vi.mock('server-only', () => ({}));`(vitest.config.ts 無任何 server-only alias)。而規格 §8.4 D1c 執行器定義逐字「單一 TS orchestrator script」「步驟 8b 的 TapPayChargeAdapter.recordQuery 在同一 process 內呼叫」。規格全檔 grep 'server-only' = 0 次。
  - 修法:D1t2 片定死執行方式(tsx/esbuild alias `server-only` → 空模組,或以 `--conditions=react-server` 跑),並把「script 能實際 import adapter 並成功打一次 sandbox recordQuery」寫進 D1t2 驗收條件;否則 D1b1 的 read-back 硬閘物理上跑不起來。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 金流證據前置(檔內 825-873)
  - 主張:PCM-2026-0052 若為 sandbox 交易,production 憑證下 read-back 必回零筆 ⇒ 依矩陣永久 abort,規格無任何出口,整條第 1 批 DAG 跟著卡死
  - 證據:規格 §8.3 逐字「早於正式站首筆真刷(07-24 的 0102)⇒ 推測為 sandbox」。apps/storefront/src/lib/payment/composition.ts:66-68 sandbox/production 兩組 Record API URL 由 TAPPAY_ENV 決定,merchantId 另來自 TAPPAY_MERCHANT_ID(:81)。TapPayChargeAdapter.ts:229 `filters.merchant_id = [this.config.merchantId]` 恆帶,:258 對非本商戶紀錄直接 throw。規格 §8.4 判定矩陣逐字「零筆、多筆、狀態不在集合內、金額不符 —— 一律 abort,不得人工解讀後放行」。§5.0 DAG 中 A2/A3/A7/A1 等全排在 D1c 之後。規格全檔 grep TAPPAY_ENV = 0 次。
  - 修法:D1b1 明訂用哪組 TAPPAY_ENV/商戶憑證查詢;並為「查無紀錄(sandbox 或交易不存在於本商戶)」定義合法出口 —— 建議該單移出待刪 cohort、原地保留不動、寫入 remediation audit,而不是讓 D1 無限 abort。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 判定矩陣;§5.1 表 D1b1 片
  - 主張:三筆 pending 的允許 record_status 集合 {-1, 5} 漏掉 4(PENDING),而該三筆的 3DS 已啟動、TapPay 端交易確實存在,4 是最可能的實際值
  - 證據:supabase/migrations/20260619120000_m3_3ds_5b_record_charge_initiation.sql:209 `SET rec_trade_id = p_rec_trade_id`,:227 COMMENT 逐字「3DS charge 啟動回 rec_trade_id 後 durable 寫進**仍 pending** 的 attempt(維持 pending、≠ markCharged)」⇒ 0064/0090/0101 的 rec_trade_id 來自 3DS 啟動,TapPay 端必有紀錄。packages/adapters/src/tappay/wire.ts:83 逐字列出 `4=PENDING`。規格 §8.4 只允許 `record_status ∈ {-1 (ERROR), 5 (CANCEL)}`,其餘一律 abort。
  - 修法:為 record_status = 4 明訂處置(建議同上:移出 cohort、保留不刪),不要只留「一律 abort」—— 否則 Sean 已確認「沒扣到錢」的三筆會把 D1 永久擋住。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 8
  - 主張:步驟 8 的鎖序與既有金流路徑相反 = ABBA deadlock,且 pcm-settle-sweep 每 2 分鐘正在掃這批列,規格零停機步驟
  - 證據:D1 鎖序(§8.4 步驟 8):orders FOR UPDATE → order_items → payment_charge_attempts → pending_invoices。既有路徑反向:supabase/migrations/20260624120005_m3_3ds_r1b1c_markcharged_released_genesis.sql:92 先 `FOR UPDATE` payment_charge_attempts,再同交易 INSERT payment_double_charge_anomalies(20260624120003:48 `old_order_id uuid NOT NULL REFERENCES public.orders(id)` ⇒ 需 orders 的 KEY SHARE,與 FOR UPDATE 互斥)。掃描器命中條件精準:20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql 的 claim_stuck_unsettled_attempts `a.status IN ('pending','charged') ... AND o.payment_status = 'unpaid'` = 待刪 26 張裡那 3 筆 pending。排程:20260723120000_m3_s2_settle_sweep_pgcron.sql:11 逐字 `pcm-settle-sweep(*/2 * * * *)`。規格全檔 grep cron / sweeper 各 0 次。
  - 修法:D1c 前置加一步:確認 pcm-settle-sweep job 已 unschedule 或 CRON_SWEEPER_ENABLED=false,並在交易內 assert;或把鎖序改成 payment_charge_attempts → orders 對齊既有金流路徑,避免 deadlock 犧牲掉真實付款交易。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 驗收矩陣「非 cohort 訂單」列
  - 主張:驗收矩陣「非 cohort 訂單逐 byte 不變」未指定隔離等級,在 READ COMMITTED + 併發結帳下必然誤判 abort
  - 證據:規格 §8.4 驗收矩陣逐字「非 cohort 訂單 | 列數與內容**逐 byte 不變**(執行前後快照 checksum 比對)」。規格自己確認併發新單是預期狀態:§5.1 逐字「D1 之後任何真實結帳都會再長出舊格式的新單」;§7.4「訂單量預期 1-300 筆」。規格全檔 grep REPEATABLE = 0、ISOLATION = 0、MVCC = 0。READ COMMITTED 下同一交易的前後兩次 SELECT 取不同 snapshot,任何一張併發新單都會讓 checksum 不等而觸發 abort。
  - 修法:步驟 8 明訂 `BEGIN ISOLATION LEVEL REPEATABLE READ`,或把非 cohort checksum 範圍限縮成 `created_at < <BEGIN 時點>`;dry-run 與 apply 兩次都要用同一設定。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 3 / 閘序段 / 驗收矩陣
  - 主張:匯出(步驟 3)與 apply(步驟 8-13)之間只驗列數不驗內容,且匯出本身無新鮮度上限 ⇒ 刪除後唯一的紀錄可能已過期
  - 證據:規格 §8.4 閘序段逐字「證據有效期 = 24 小時」只綁 D1b1/D1b2(read-back 與 dry-run),對 D1a2 正式匯出無任何時效字面。驗收矩陣對 cohort 全部是列數口徑(「24 → 0」「36 → 0」「2 → 0」),無內容 checksum 比對。而 20260624120008 的 sweeper 可在此窗口把 pending attempt 改成 failed/charged —— 列數不變、內容已變,匯出檔因此與被刪資料不一致,而 §8.4 逐字承認「刪除後唯一的紀錄就是那份檔」。
  - 修法:步驟 8 鎖列後、步驟 9 刪除前,對 cohort 全相依集重算逐表 sha256 並與 D1a2 manifest 比對,不符即 abort 並要求重跑 D1a2;或給匯出同樣的 24 小時時效。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 1 與步驟 13
  - 主張:環境守門只驗「專案」不驗「身分」,而 payment_confirmer 連線字串的形態完全通得過守門;repo 內已有現成的 current_user 斷言寫法未採用
  - 證據:規格步驟 1 逐字「只比對 host/username、不印完整 URL」,兩種合法形態之一 = pooler host + username 含 `.bmpnplmnldofgaohnaok` 後綴。apps/storefront/src/lib/payment/composition.ts:92 逐字 `postgresql://payment_confirmer.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:5432/postgres` ⇒ 完全命中該分支。但步驟 13 逐字依賴「runbook 以 postgres 身分執行,不受 service_role SELECT-only 限制」,而 payment_charge_attempts(20260612150000:119-121)與 pending_invoices(20260613140000:214-216)對 service_role/payment_confirmer 均無寫權。既有前例:20260723120000_m3_s2_settle_sweep_pgcron.sql:62 `IF current_user <> 'postgres' THEN RAISE EXCEPTION`。規格全檔 grep current_user = 0 次。
  - 修法:D1a0 的 SQL 第一步加 `IF current_user <> 'postgres' THEN RAISE`(對齊 S2 前例),D1a0 負測補「以 payment_confirmer 連線必 abort」。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 3;§5.1 表 D1a1 片
  - 主張:匯出/還原的 \copy 格式未定死,CSV 預設會把 NULL 與空字串混同,還原出違反既有部分唯一索引與 CHECK 語意的資料
  - 證據:規格步驟 3 只寫「逐表 `\copy` + 逐表 sha256」,規格全檔 grep CSV = 0 次、無 FORMAT/NULL 參數字面。而 supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:98 `CHECK (status <> 'charged' OR rec_trade_id IS NOT NULL)` 與 :108-109 `CREATE UNIQUE INDEX payment_charge_attempts_rec_unique_idx ON public.payment_charge_attempts (rec_trade_id) WHERE rec_trade_id IS NOT NULL` 兩者都對 NULL vs '' 敏感;24 筆待刪 attempts 中的 failed/released 多半 rec_trade_id 為 NULL。CSV 預設把 NULL 匯成空字串再還原,會讓部分索引把它們全部納入並互撞、CHECK 語意也改變。
  - 修法:D1a1 定死匯出與還原兩端使用同一組參數(例 `(FORMAT csv, HEADER, FORCE_QUOTE *, NULL '\\N')`),並在 D1a6/D1a7 演練驗收加一條「還原後逐表 sha256 與匯出一致 + nullable 欄抽驗仍為 NULL」。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 1 與步驟 4;§5.1 表 D1a4/D1a5 兩列
  - 主張:restore 兩支腳本零環境守門,且 D1a0 的「cohort 29 UUID 存在」assert 在 D1c 之後恆為假 ⇒ 真災難時要嘛沒守門、要嘛被自己的守門擋住
  - 證據:規格步驟 1 逐字把守門綁在「runbook 的第一行」,第二道閘是「assert cohort 的 29 個 UUID 在 orders 全數存在,否則 RAISE abort」—— D1c 成功後 production 只剩 3 張,該 assert 必失敗。而 §5.1 表 D1a4 / D1a5 兩列內容只寫「依 FK 逆序」「用 D1a3 映射」,零守門字面;§8.4 步驟 4 同樣零守門字面。
  - 修法:為 restore 定義專屬守門:專案 ref + current_user='postgres' + 反向 assert「cohort 26 張目前不存在」;D1a6/D1a7 演練必須覆蓋這條守門的正負案例。
- [must-fix] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 4;§5.1 表 D1a3 / D1a5 兩列
  - 主張:D1a3 的 26 組還原新號在第 1 批就凍結,restore-post-n3c 卻在 N3b 換產號器之後才用 ⇒ 與期間隨機產出的號碼碰撞未再驗,災難當下才炸
  - 證據:§5.1 表 D1a3 列逐字「26 組還原用新號映射(依 §5.4a 合約產生、驗 regex 與唯一、與現網及留存 3 組不衝突)」= 驗的是 D1a3 當下的現網。§5.0 DAG 中 N3b(create_order 換產號器)在第 3 批;§5.4a unique = 具名約束 `orders_display_id_key`。凍結映射在數個批次之後才使用,期間 create_order 已在同一 481,890,304 空間隨機產號,碰撞則 restore 直接 unique violation 失敗。
  - 修法:restore-post-n3c.sql 改成執行期檢查:逐列若新號已被佔用,就地依 §5.4a 合約重抽(有界重試 5 次、用盡整交易 RAISE),不要依賴凍結的靜態映射表。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 判定矩陣
  - 主張:consider:read-back 判定矩陣未把回應綁回本單(未斷言 order_number = orders.id),rec_trade_id 一旦錯就可能被別單的合法退款紀錄騙過
  - 證據:規格 §8.3 逐字確立「TapPay 的 order_number 送的是 orders.id(UUID)」並引 packages/adapters/src/tappay/TapPayChargeAdapter.ts:91 `order_number: payload.orderId`。wire 已解析該欄:packages/adapters/src/tappay/wire.ts:78 `orderNumber: string;`、:146 `orderNumber: r.order_number`。但 §8.4 判定矩陣只用 rec_trade_id + merchant_id + record_status + refunded_amount 四項,沒有把回應綁回本單。
  - 修法:矩陣加兩條免費的 fail-closed 斷言:回應 `orderNumber` 必等於該單 `orders.id`、`amount` 必等於 `orders.total`。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 金流證據前置表
  - 主張:consider:「refunded_amount = 授權金額」的「授權金額」來源未定;若取自同一筆 API 回應的 amount 則對「命中錯單」零偵測力
  - 證據:packages/adapters/src/tappay/wire.ts:82 `amount: number;` 與 :87 `refundedAmount?: number;` 同屬一筆 record —— 兩者相比只是自我一致性檢查。規格 §8.4 只寫「`refunded_amount`(須等於授權金額 = 全額退)」,未指明授權金額取自何處。
  - 修法:定死比較基準取 DB 側 `orders.total`(integer 最小單位),並同時斷言回應 amount 也等於它。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 判定矩陣
  - 主張:consider:refundedAmount 在 wire 是 optional,矩陣未定義 undefined 的處置
  - 證據:packages/adapters/src/tappay/wire.ts:87 `refundedAmount?: number;`、:153 `refundedAmount: typeof r.refunded_amount === 'number' ? r.refunded_amount : undefined`。規格 §8.4 只列「金額不符 = abort」,未涵蓋「欄位不存在」這一態。
  - 修法:明寫 `refundedAmount === undefined` = abort(fail-closed),與「金額不符」同級處理。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 1;D1c 執行器 timeout 合約
  - 主張:consider:D1a0 的 pooler 分支未區分 session pooler(5432)與 transaction pooler(6543),而 D1c 需要跨六次 HTTP 持列鎖的長交易
  - 證據:規格步驟 1 兩種合法形態只比對 host/username,無 port/mode 條件。repo 慣例明載於 apps/storefront/src/lib/payment/composition.ts:91-93:`PAYMENT_CONFIRMER_DB_URL` = **session pooler**、port 5432,並註明直連 host `db.<ref>.supabase.co` 為 IPv6-only。§8.4 步驟 8b + timeout 合約要求六筆 read-back 總體上限 3 分鐘,期間交易持續持有 29 列 FOR UPDATE。transaction-mode pooler(6543)在 host/username 形態上與 session pooler 無法區分,會通過守門。
  - 修法:守門加第三條:port 必為 5432(session pooler 或直連);D1t3 的 timeout 整合驗證在該連線模式下實跑。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 三組改號映射表;§5.4a 亂數源列
  - 主張:三組新號寫進版控規格檔,與 §5.4a「亂數源須 CSPRNG,否則客人能猜別人單號」的威脅模型自相矛盾;D1a3 的 26 組會再犯一次
  - 證據:§8.4 三組改號映射表逐字列出 `YWP3PC` / `BKPR5M` / `ZNHY8B`。§5.4a 亂數源列逐字「`gen_random_bytes()`(pgcrypto);**禁 `random()`**(非密碼學安全、可預測 ⇒ 客人能猜別人單號)」。同一份檔案一邊把 display_id 當成不可預測的能力憑證,一邊把三個實際值明文寫進 git 歷史;D1a5 還要把 26 組寫進版控的 restore script。
  - 修法:二擇一並全檔統一:要嘛承認 display_id 非機密(§5.4a 該理由改成「不可推測訂單量」),要嘛把映射表移出版控(封存進 D1a2 的加密證據包)。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§5.4a 產號合約表(unique 列 / 重試列)
  - 主張:§5.4a 寫死的 constraint_name = 'orders_display_id_key' 是推定的自動命名、repo 內從未實查;名稱若不符,N3b/N3c 的重試迴圈永不生效並直接誤報用盡
  - 證據:supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:94 `display_id text NOT NULL UNIQUE,` —— inline 匿名 UNIQUE,無具名 CONSTRAINT。§5.4a unique 列逐字「具名約束 `orders_display_id_key`」、重試列逐字「只捕捉 `unique_violation` **且** `constraint_name = 'orders_display_id_key'`」。
  - 修法:A0a 加一條實查 `SELECT conname FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='u'`,把實名寫回 §5.4a,或改成由 pg_constraint 反查而非硬編字串。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§5.1 表 D0 列
  - 主張:D0 要改的 pending_invoices status CHECK 是 inline 匿名約束,規格未寫如何定位並 DROP;同 repo 有正確前例未引用
  - 證據:supabase/migrations/20260613140000_m3_3ds_0c_bank_txn_pending_invoices.sql:201 `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued')),` —— 無 CONSTRAINT 具名。§5.1 表 D0 列只寫「`pending_invoices` 的 status CHECK 加 `voided`」。正確前例:supabase/migrations/20260624120000_m3_3ds_r1a1_released_status_columns.sql:41 逐字「原 inline auto-named constraint payment_charge_attempts_status_check;DROP → ADD 同名」。
  - 修法:D0 沿用 20260624120000 的作法:先由 pg_constraint 反查實名再 DROP → ADD 同名,並附「約束不存在即 RAISE」的 fail-closed 前置閘。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 驗收矩陣 pending_invoices 列
  - 主張:驗收矩陣的「不再出現在待開票查詢」是不可驗宣稱 —— 全樹目前零 TS 消費端
  - 證據:`grep -rn pending_invoices --include=*.ts --include=*.tsx apps packages` 只命中 packages/adapters/src/supabase/database.types.ts:865 與 :886(型別與 FK 名),零查詢實作。規格 §8.4 驗收矩陣逐字「三筆 `status` 皆改 `voided`、**不再出現在待開票查詢**」。
  - 修法:該列收斂成「DB 層三筆 status = voided」即可(可驗);「不再出現在待開票查詢」移到未來發票片的 DoD,避免 D1 驗收含無法執行的條件。
- [nit] /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:§8.4 步驟 11-12 與驗收矩陣「金流一致性」列
  - 主張:步驟 11/12 的 UPDATE 不會刷 orders.updated_at(orders 只有 BEFORE INSERT trigger),矩陣只規範 paid_at 未動、對 updated_at 無字面 ⇒ 稽核時間軸缺一筆
  - 證據:supabase/migrations/20260725120000_rf2a0_orders_freeze_shipping_rule.sql:104-106 唯一 trigger `orders_freeze_shipping_snapshot_bi BEFORE INSERT ON public.orders`,同檔 :21 逐字「這是 public.orders 上的**第一個** trigger(實查:本 repo 對 orders 零 CREATE TRIGGER)」。supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:110 `updated_at timestamptz NOT NULL DEFAULT now()` 無 update trigger。規格 §8.4 驗收矩陣只寫「`paid_at` 未動」。
  - 修法:步驟 11/12 明訂同時寫 `updated_at = now()`(或明寫刻意不動並記入 remediation audit),並把該欄加進驗收矩陣。

**該線總結**:第三線(D1 runbook 安全攻擊)複審 /Users/sean_1/pcm-website-v2/docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md 的 §8.4 全節 + §5.1 表 D1a0-D1c 十四片 + §5.4a + §5.4b。存取模式=FULL-REPO 唯讀,零修改、零 commit、零 DB 連線。19 條 findings(10 must-fix / 9 nit),全部命中「D1 執行層可失敗且規格未防」。

最硬的一條(問題①環境/wrapper 面的延伸):§8.4 定死「步驟 8b 的 TapPayChargeAdapter.recordQuery 在同一 process 內呼叫」「單一 TS orchestrator script」,但該 adapter 檔頭 packages/adapters/src/tappay/TapPayChargeAdapter.ts:22 是 `import 'server-only'`,而 server-only@0.0.1 的 index.js 全檔就是一句 throw、只有 react-server export condition 才解到 empty.js。repo 自己的測試檔第 1 行逐字寫著「node 環境直接 import 會 throw」並用 vi.mock 繞開。⇒ D1t1/D1t2/D1b1/D1c 四片在純 node/tsx 下連 import 都過不了,全檔零次提及 server-only。

問題④(read-back 判定矩陣可被騙過/騙不過)抓到兩條會讓 D1 在完全正確執行下仍永久卡死:①PCM-2026-0052 極可能是 sandbox 交易,production 憑證 + adapter 恆帶 merchant_id filter 下 read-back 必零筆 → 矩陣「一律 abort、不得人工解讀後放行」= 無出口,而 §5.0 DAG 整條第 1 批都排在 D1c 之後;②三筆 pending 的允許 record_status 集合 {-1,5} 漏掉 4(PENDING),而 20260619120000:209 證明 3DS 啟動就已把 rec_trade_id 寫進 pending attempt ⇒ TapPay 端交易確實存在、4 是最可能值。另外矩陣未把回應綁回本單(未斷言 order_number = orders.id、amount = orders.total),鍵一旦錯就會被別單的合法退款紀錄騙過。

問題③(併發)抓到:步驟 8 鎖序 orders→attempts 與既有金流路徑相反(20260624120005:92 先鎖 attempts、再經 anomaly FK 取 orders KEY SHARE)= ABBA deadlock;而 pcm-settle-sweep 每 2 分鐘掃的條件(status pending + order unpaid)精準命中待刪的那 3 筆,規格全檔零次提 cron/sweeper/停機。

問題②(部分失敗中間態)抓到三條:驗收矩陣「非 cohort 逐 byte 不變」在未指定隔離等級 + 併發結帳(規格自己說 D1 後仍會長新單)下必然誤判 abort(全檔 0 次 REPEATABLE/ISOLATION);匯出→apply 之間只驗列數不驗內容且匯出無新鮮度上限(24 小時只綁 read-back);步驟 1 守門只驗專案不驗身分,而 PAYMENT_CONFIRMER_DB_URL 的形態(composition.ts:92)完全通得過 pooler 分支,repo 內 20260723120000:62 已有現成 current_user 斷言寫法未採用。

問題⑤⑥(restore 可用性 / 匯出保存鏈)抓到三條:restore 兩支腳本零環境守門,且 D1a0 的「cohort 29 存在」assert 在 D1c 之後恆為假(要嘛沒守門、要嘛被自己守門擋住);D1a3 的 26 組還原新號在第 1 批凍結卻在 N3b 換產號器之後才用,碰撞未再驗;\copy 格式未定死(全檔 0 次 CSV/NULL 字面),而 payment_charge_attempts 的部分唯一索引與 CHECK 都對 NULL vs '' 敏感。

不做:拍板(第一線)、非 D1 的規格事實(第二線)。已驗但未成立、故未列為 finding 的三項:orders 只有 BEFORE INSERT trigger(規格正確)、payment_status enum 含 refunded(步驟 12 可行)、payment_double_charge_anomalies 只有 old_order_id 一個 orders FK(規格的 selector 正確)。

## 第四線:二十輪流程復盤(opus/general-purpose)

**重複最多的類別**:
- 文件同步 / 只修被點名處(舊字面殘留)— 44 條 / R2-R16 十五輪,目標從 STATUS→handoff→HCT→相鄰作用中規格逐輪漂移
- 片太大(鐵則 4 >45 分鐘)— R2-R11 每輪 + R16-R18 再犯,片數 14→69 單調成長仍未關死
- 金流語意(取消/退款/付款狀態機、冪等、fencing、世代)— 258 條中 92 條(36%),逐層下探屬合理成本非重工
- D1 不可逆 runbook 安全(TOCTOU/鎖序/備份還原/環境守門/read-back)— R2-R13 約十輪
- 施工序自相矛盾(同一順序寫在多處、DAG 循環)— R3-R19 九輪,其中 R17-R19 三輪是自己的修法造成
- 假綠燈(宣稱項目變綠但 schema→writer→reader→UI 鏈未閉合)— 10 條 / R1-R7,建閉環矩陣後絕跡
- 主對話字面錯(技術斷言 / migration 版本 / port 位置未 grep 就寫進 plan)— v1 三條 + R11 兩條 + R12/R15 各一
- 片型分類不足(M/R/U 裝不下 A/D/T/runbook)— R2/R3/R4/R6/R8/R11 約六輪

**制度教訓候選(候選、Sean 拍板才立法;標機制/規則)**:
1. **「只修被點名處」已復發 11 次,reminder 型 hook 已被證偽 —— 必須升級為 deterministic 檢查**(mechanism;落點候選:機制:改寫 ~/.claude/hooks/contract-sync-reminder.js;同時在 memory feedback_claimed-sync-but-only-patched-touched-lines 補記「reminder 版已被 E10 十五輪證偽,已升級為 grep 檢查版」)
   - 發生了什麼:文件同步類 44 條橫跨 R2-R16 十五輪,每輪只有「被 codex 點名的那一檔」被修,下一輪就從別的檔冒出來(STATUS→handoff→HCT reference→admin-backend-rebuild-spec→order-backend-model-spec→admin-ux-operability-review)。主對話在 `docs/reviews/2026-07-28-e10-k1-r7-codex.md:7` 自承「第 11 次『只同步被點名段落』復發 —— HCT §8 與 handoff §3 我上輪都沒掃到,C1 還寫著『§8 已同步』,字面與事實不符」。現有防護 `~/.claude/hooks/contract-sync-reminder.js`(90 行,PostToolUse,每 session 上限 3 次)只印提醒文字、不做任何檢查,檔頭自述是為了對抗此問題而寫 —— 本次 15 輪證明提醒型防護對這條無效。
   - 提案:把 contract-sync-reminder.js 從「提醒」升級成「檢查」:PostToolUse(Edit) 命中權威文件時,從 diff 抽出被改掉的舊字面 token(數字、片號如 A9w/N3a、RPC 名、檔名、hash),對全 repo 跑一次 grep,**把其他仍命中舊字面的 檔:行 清單直接印出來**(不是提醒句)。清單非空即等於「同步未完成」。移除 max 3/session 上限(它讓第 4 次之後靜音,而本次一輪常改 5+ 檔)。
2. **送審前必須先凍結「文件宇宙」清單,不能讓掃描面逐輪擴大**(mechanism;落點候選:機制:送審前跑的一支 grep 腳本(可掛進 codex-adversary skill 的關卡1 前置);規則面在 ~/.claude/rules/00-work-rules.md §3 T5 審查範本補一行「附文件宇宙清單」)
   - 發生了什麼:R13 是第一次把審查掃到相鄰的作用中規格,結果一口氣抓出 4 條舊字面(`2026-07-25-admin-backend-rebuild-spec.md:36/:441/:498`、`2026-07-26-admin-ux-operability-review.md:104`);R14 再 5 條、R15 再 3 條、R16 再 3 條。R13 findings 檔逐字承認數字回升「不是規格本體退步 —— 是 R13 第一次把文件同步掃到相鄰兩份作用中規格」。也就是說 R13-R16 四輪共 15 條,純粹是因為前 12 輪的掃描面沒有一次定義清楚。
   - 提案:送審 prompt 必附「本次審查的文件宇宙」清單,由腳本產出而非人腦回想:`grep -rl <主題關鍵字> docs/specs docs/reviews docs/handoff STATUS.md docs/reference` 的完整結果,逐檔標「作用中/已作廢」。清單隨受審檔一起凍結,審查者被明確告知「這些檔全在同步範圍內」。
3. **審查期間的凍結紀律要能被擋住,不能靠記得 —— 違反一次等於整輪定位成本作廢**(mechanism;落點候選:機制:新增 ~/.claude/hooks/review-freeze-gate.js + settings.json PreToolUse;memory feedback_freeze-artifact-before-adversarial-review 補「E10 又犯兩次,已改機制」)
   - 發生了什麼:兩次違反。R2:受審檔在審查進行中由 452 行改成 464 行,codex 自己在 nit 抓到,導致該輪 33 條 must-fix 的行號全部不可信,triage 只能改用「按叢分、非按條號 —— 行號因基線瑕疵不可信」逐條比對內容(`2026-07-28-e10-k1-findings-triage.md:124`)。R6:審查進行中 commit 了 `e846b7a`(STATUS 一行),STATUS 在同步檢查範圍內,該輪 STATUS 相關 findings 同樣只能用內容比對。memory feedback_freeze-artifact-before-adversarial-review 早已存在,仍犯兩次。
   - 提案:審查啟動時寫一個 marker 檔(如 `.claude/.review-freeze`,內含受審 commit hash + 涵蓋路徑 glob);掛 PreToolUse(Write|Edit|Bash 的 git commit),命中 marker 涵蓋路徑就 **deny**,並印「審查凍結中,受審 commit=<hash>,要改請先結束本輪」。審查結束刪 marker。fail-open(marker 讀不到就放行)以免擋住正常工作。
4. **「片太大」不能用加片回答 —— 加了 55 片仍在被抓,缺的是可測的體積判準**(rule-text;落點候選:docs/lessons-learned.md §12 新條;判準面連動 ~/.claude/rules/00-work-rules.md §2 R5(品質底線))
   - 發生了什麼:鐵則 4 findings 出現在 R2/R3/R4/R5/R6/R7/R8/R9/R10/R11 每一輪,片數從 14 一路拆到 69(`git log` subject:14→26→31→34→40→48→50→56→60→61→62→64→66→67→69,**從未縮過**),然後 R16/R17/R18 又對 A9w 抓了三輪。R5 codex 逐字判定:「A5a、A8、A11a、A12a、A14 仍分別包含多套規則/互動,沒有可信的 15–45 分鐘中斷點,**R2–R4 的鐵則 4 finding 只是繼續加片、未解這些片**」。R18 才終於用「跨 item action / 共享 parser / port / adapter / status-options 寫入鏈」這種具名清單把 A9w4 拆成三片。
   - 提案:寫 slice 表時每片強制三欄:①**單一驗收句**(一句話、含一個 yes/no)②**觸及檔清單**(具名,不寫『相關檔』)③**是否跨層**(M/R/A/U/T 只准一個)。任一欄為「多個」即自動判定必拆,不進審查。估時欄不可延到「片級 plan 再估」—— R6 逐字抓到這招:「把估時延到片級 plan 沒有解掉鐵則 4」。
5. **施工序只准寫在一處 —— 複製順序敘述讓修法自己造出三輪新 finding**(mechanism;落點候選:機制:送審前 spec-lint grep(同 §2 的文件宇宙腳本一起跑);規則面 docs/lessons-learned.md §12 新條)
   - 發生了什麼:R3 抓到「A2→A1 的依賴圖與表格實際施工序 A1→A2 相反」;R4 抓到「編號線仍有三個相反順序」;R5 抓到「§5.4 仍重述 D0/D1/N3a/N3b/N3c/N2 順序」;R6 逐字要求「§5.4 只保留『順序見 §5.0』連結」。修法建了 §5.0 唯一 DAG(`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:198` 逐字「順序**只寫在這裡**,其他段落只准引用」;:482「連摘要都不准」)。但即使如此,R17 逐字記錄「**我自己的修法造成 DAG 循環:文字要 A9v 排 A11 後、表卻排前**」,R18 再抓重複節點,R19 再抓「唯一施工序仍不唯一」—— 三輪 must-fix 純屬自傷。
   - 提案:規格檔加一條可 grep 的 lint:除 §5.0 錨點段外,全檔禁止出現「片號 → 片號」形態的箭頭序列與「先…再…」的施工序句;`grep -n` 命中即視為違規。DAG 本體改成單一有序表(一列一片、序號連續),不用箭頭圖 —— 有序表無法表達循環,結構上排除 R17 那類錯誤。
6. **綠燈只准掛鏈末 + 閉環矩陣「缺一格不得宣稱綠」—— 本次唯一把一整類 finding 一次殺死的做法**(rule-text;落點候選:docs/patterns/ 規格範本(新增閉環矩陣必填段);docs/lessons-learned.md §12 新條)
   - 發生了什麼:假綠燈 10 條橫跨 R1-R7:R1 #37/#39(顯示片映射輸入項、宣稱 17 項全綠但 UX 折入項未進片)、R2「A4/A5/A6 在只有 RPC、尚無 UI/讀取路徑時就宣稱第 3/5/6/7 項變綠」、R3「A13 把第 19 項標綠」、R4「第 4 項/第 7 項/第 19 項」、R5「第 7 項掛在 A10a 變綠,但輸入在其後的 A10b」、R6「矩陣只把第 4 項標『僅訂貨面』,正文卻列為整項全綠,綠燈映射不誠實」、R14 空狀態。修法 = §5.0b 閉環矩陣(`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:267` 逐字「每個資料域:schema → writer → 讀模型 → UI → 綠燈;**缺一格 = 該綠燈不得宣稱**」)。R7 之後此類零復發。
   - 提案:任何規格宣稱「某項需求變綠/完成」時,必須指到閉環矩陣中一列且該列五格全滿(schema / writer / 讀模型 / UI / 驗收證據)。schema 片與 RPC 片一律不得宣稱綠燈。部分達成一律標「部分綠」並寫明缺哪一格 —— 本次 R7 就是靠這條把第 19 項誠實降級成「整單取消閉環、部分取消剩餘品項卡付款守門」。
7. **寫進 plan 的技術斷言 = 字面值三來源律同級,先 grep/Read 原始碼再寫**(mechanism;落點候選:機制:送審前 citation-check 腳本;memory feedback_plan-numbers-must-match-grep 擴充「migration 取最新版本、介面認定義不認呼叫點」兩款)
   - 發生了什麼:v1 有三條技術斷言直接寫錯,codex 全抓到、triage 逐字裁定「codex 對、v1 主對話寫錯」:#48「篩選必須在資料層」不成立(親讀 `orders-table.tsx:64-77` 後確認 codex 對)、#49「不做整單彙總徽章」過度概化(親讀 `:86-93` 註解)、#54「排序改 created_at」不是待做項(admin 列表**已**用 `created_at DESC, id DESC`,親讀 `SupabaseOrderAdapter.ts:270-272`)。R11 再犯兩次:把 `begin_charge_attempt` 最新定義標成 `20260613130000:350`,實為 `20260613140000:73`(差一小時的後續 migration 補了 `existing_bank_transaction_id`,照舊基底施工會把它蓋掉);把 `settle-charge.ts:77` 這個**呼叫點**當成 TapPay port 介面,實名是 `packages/ports/src/ITapPayAdapter.ts:19-43`。R12 nit 再一次:文件寫「第 3 批加 `bank_refund_id` 欄」,實際 `order_refunds.bank_refund_id` 已存在且 NOT NULL+UNIQUE(`20260725130100:86,108`)。
   - 提案:送審前跑一支 citation check:抽出 plan 內所有 `檔:行` 引用,逐條驗 ①檔存在 ②行號在檔案範圍內 ③若是 migration,該 object 沒有更晚版本的 migration(`ls supabase/migrations | grep <函式名>` 取最新)④若宣稱「某介面/型別」,驗該行確實是定義而非呼叫點。任一項失敗即擋審。
8. **對抗審查卡住時先問審查者根因,不要逐條打地鼠 —— 這一問把 26 條變成 7 條**(rule-text;落點候選:~/.claude/rules/00-work-rules.md §2 R4(換路訊號)新增一條;跨專案適用故另存 memory feedback_ask-reviewer-for-root-cause-when-stalled)
   - 發生了什麼:R2/R3/R4 三輪逐條修,findings 數 33→31→32 完全持平,R4 codex 逐字判「未收斂:仍重複出現 R2/R3 的 D1 安全、取消閉環、計數器真相、片大小與文件同步問題」。R5 主對話**額外向 codex 追問「為什麼一直不收斂」**(`2026-07-28-e10-k1-r5-codex.md:7` 標為「本輪主對話額外提問」),得到根因:「反覆產生 finding 的核心,是新模型/新決策被加進正文後,沒有同步生成一份唯一 DAG 與『schema→writer→reader→UI→驗收』閉環矩陣」。照此建 §5.0/§5.0b 後,R5→R10 從 26 一路掉到 7。這是全程 ROI 最高的單一動作。
   - 提案:審查同一份產物連 2 輪 findings 數未實質下降(±20% 內)⇒ 停止逐條修,改對審查者下一題:「請診斷為何反覆產生 finding,並指出結構性修法」。把答案當成下一版的骨架重寫,而非在舊骨架上補丁。
9. **審查輪次的停止判準改成「類別 × 趨勢」,不是絕對輪數**(rule-text;落點候選:~/.claude/rules/00-work-rules.md §5 輪次紀律(需 Sean 拍板,因會改既有數值判準))
   - 發生了什麼:現行規則是 plan 層審查上限 2 輪(00-work-rules §5)。本案 R2 就達上限,照規則應停下提決策題;Sean 拍 Q8=B 解除上限(逐字「就算有第四輪第五輪都沒差,我要把全貌做好後再用視覺顯示完整一次 才開始動工」),實際跑到 R20 才 PASS。反過來,光看數字也會誤判:R13(4→7)與 R14(7→10)數字回升,但兩份 findings 檔都逐字說明「**不是規格本體退步**,是文件同步第一次掃到相鄰作用中規格」。R2-R4 的 33/31/32 持平才是真警訊,當時卻沒有判準能識別。
   - 提案:停止/換路判準改成:①同一 **finding 類別**連 2 輪未關死、且該輪無新資訊(審查者的『已關死』清單沒成長)⇒ 停,提決策題 ②數字回升但審查者明確標為『掃描面擴大/戰場下探』⇒ 不算發散,續跑 ③要求審查者每輪逐字回報「相對上一輪哪些已關死」(本次 R6-R20 都有,是唯一能區分①②的訊號)。絕對輪數上限降級為提醒,不是硬停。
10. **「駁回 0」不代表可以不驗審查者 —— 但親驗的收益在於抓那 1%**(rule-text;落點候選:memory feedback_verify-subagent-function-behavior-before-decision-question 補本次實證(320 條/駁回 0/codex 路徑錯 1 次/清單重印 2 次);去重校正步驟寫進 codex-adversary skill 的落檔流程)
   - 發生了什麼:320 條 must-fix、**駁回 0 條**(`findings-triage.md:20`「駁回 | **0**」、`:124`「駁回 0 條」、`r20-codex.md:6` 逐字)。也就是說 codex 幾乎每條都對。但親驗仍抓到它兩處事實錯:R14 codex 給的路徑 `docs/reviews/2026-07-26-order-closure-ux-review.md:65` **實測不存在**(`ls` 驗證),真實位置是 `docs/specs/2026-07-26-admin-ux-operability-review.md:65`;R10 主對話親驗 `begin_charge_attempt` 確實存在(codex 對)、R11 親驗反向是主對話錯。另外 R1 與 R2 兩輪 codex 都把同一份 findings 清單**印了兩次**,主對話用 `awk` 切 11-77 與 84-150 兩塊 `diff` 逐位元組比對才確認真實條數是 67 而非 152 行看起來的量。
   - 提案:審查者給的每一條「外部事實」(檔路徑、行號、欄位存在與否、DB 現況)在折入前一律當場 grep/ls/wc 驗一次,成本 1 個 tool call。並固定在 findings 落檔時先做「條數去重校正」:`awk` 切塊 + `diff` 比對是否重複輸出,數字寫進檔頭。禁止把交接檔的約數(本次「約 60」)當條數依據。

**該線總結**:E10 總規劃關卡1 跑了 20 輪(R1 FAIL → R20 PASS),趨勢 67→33→31→32→26→24→15→17→16→7→5→4→7→10→10→6→5→7→3→PASS。含 R1 去重後 62 條,共 **320 條 must-fix,駁回 0 條**(`docs/reviews/2026-07-28-e10-k1-findings-triage.md:20` 與 `:124` 逐字);07-28 當日 46 個 commit;片數 14→69 單調成長、從未縮過(`git log` subject 抽:14→26→31→34→40→48→50→56→60→61→62→64→66→67→69);受審檔 887 行。

三大重複類別:①**文件同步/只修被點名處** 44 條、橫跨 R2-R16 十五輪(R17-R20 歸零),目標依序漂移 STATUS→handoff→HCT reference→三份相鄰作用中規格 —— 掃描面每輪才擴大一格,主對話 R7 自承「第 11 次復發」(`2026-07-28-e10-k1-r7-codex.md:7`)。②**片太大(鐵則 4)** R2-R11 每輪都有 + R16/R17/R18 再犯,修法一律是「再拆」而非先定體積判準,R5 codex 逐字「R2–R4 的鐵則 4 finding 只是繼續加片、未解這些片」。③**金流語意** 258 條中 92 條(36%)涉退款/取消/付款 —— 這類是逐層下探(取消守門→active attempt→跨 RPC 鎖序→`bank_refund_id` 外部冪等→累計 baseline→submitted 隔日→reconciling 相位→dead 結案→世代重開),**每輪都是新資訊、屬合理成本**,不是重工。

製造重複的工作方式(有實錘):凍結紀律兩次違反(R2 審查中把受審檔 452→464 行 ⇒ 33 條 findings 行號全部作廢、只能改用內容比對;R6 審查中 commit `e846b7a`);順序敘述同時寫在 §5.4/§8.4/§8.5 ⇒ R17 的修法自己造出 DAG 循環、R18 重複節點、R19 順序仍不唯一(三輪自傷);技術斷言沒 grep 就寫進 plan(v1 的 #48/#49/#54 三條全錯、R11 把 `begin_charge_attempt` 基底標成 `20260613130000:350` 實為 `20260613140000:73`、把 `settle-charge.ts:77` 呼叫點當成 port 介面);綠燈掛在 schema/RPC 片而非鏈末 ⇒ 假綠燈 10 條橫跨 R1-R7。

有效做法:R7 起把「審查期間全 repo 零 commit」逐字寫進每份 findings 檔頭(R7-R20 十四輪零重演);當場 awk/grep/wc 量數字(triage §0 用 awk 切 11-77 與 84-150 兩塊 diff 證明 codex 把清單印兩次、真值 67 條;`wc -l`=654、`grep -c`=15、`'use server'` grep=6);親驗 codex 事實(R10/R11/R12/R14 各一次,R14 抓到 codex 給的 `docs/reviews/2026-07-26-order-closure-ux-review.md` **實測不存在**);**R5 主動追問 codex「為什麼一直不收斂」拿到結構性修法(唯一 DAG + 閉環矩陣,落成 §5.0/§5.0b)—— R2-R4 逐條修三輪持平 33/31/32,建矩陣後 R5→R10 從 26 掉到 7**,是全程單一槓桿最大的動作;閉環矩陣「缺一格不得宣稱綠」讓假綠燈類 R7 後絕跡。

10 條教訓候選中 4 條可做成機制(freeze 閘 hook、contract-sync 由提醒升級為檢查、送審前文件宇宙清單腳本、plan citation 驗證腳本),6 條只能是規則文字。全部是候選,待 Sean 拍板。
