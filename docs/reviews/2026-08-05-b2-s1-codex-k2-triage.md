# B2 三片 · 關卡 2 codex findings 逐條 triage(交接給夜跑那棒)

> 來源報告:`docs/reviews/2026-08-05-b2-s1-codex-k2.md`(316 行)。
> 裁示:`B-119-A` ③ = **A 修正版全修、吸收 C 的一半;不選 B**(理由=循環論證,見文末)。
> 產出者:視窗B 主對話,2026-08-05 收工前。
>
> **分類定義**
> - **真缺口** = DB 真的擋不住的東西,壞資料寫得進去 ⇒ 必修
> - **判別力** = 守門可能是對的,但 harness 證明不了(消融後仍全綠)⇒ 必修(裁示不准拆)
> - **規格深度** = plan §4 本來就沒要求到那個深度 ⇒ **先更新 plan §4 再補測**(裁示第 5 步)
> - **誤判** = 我有反證 ⇒ 附依據
>
> 🔴 **「已親驗」欄只寫我真的跑過/讀過的**;沒驗的一律寫「未驗」,不要讓下一棒把推論當事實。
> 🔴 codex **未重跑任何 harness**(自述純靜態 + `bash -n`)⇒ 它的 15-26 全是**靜態推論**,
> 下一棒逐條修之前建議先用消融實測確認(那也正是它要求的那件事)。

---

## A. must-fix 26 條

| # | codex 主張(一句) | 分類 | 已親驗 | 建議修法(一句) | 落在 |
|---|---|---|---|---|---|
| 1 | 「零 writer」只證明 runtime 表 ACL;table owner 仍可直寫且豁免非 FORCE RLS | 註解說過頭 | 未驗(但論證成立:owner 本來就繞得過,S1a-1 檔頭自己也寫過同型誠實邊界) | 註解改「**零應用 writer**」;owner 直寫列為明文未擋 | `20260805170000:16` |
| 2 | X1 只守事件、沒掃既有列;S1a-2 與 S1b 之間若已存在「非草稿零品項」列,X1 不會回頭抓 | 真缺口 | 未驗 | S1b 前置閘加 anti-join:存在非草稿零品項列即 `RAISE` | `20260805170200` 前置閘 |
| 3 | 八支函式只 `REVOKE FROM PUBLIC`;shim 對 anon/authenticated/service_role 有 default grant ⇒ 可能仍有 grantee | 真缺口 | 未驗 | 改 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 並用 `aclexplode(proacl)` 斷言除 owner 外零 grantee | 三支 migration 全部 |
| 4 | 函式面只按 `proname` 數 `prosecdef`,沒釘 schema/signature/owner/精確 `proconfig`/ACL | 判別力 | 未驗 | 斷言改以 `regprocedure` 為鍵,四項雙向比對 | `20260805170200:267` 等 |
| 5 | RLS 判別力格在空表上只查 `count(*)=0`,FORCE 開關都是 0 ⇒ 仍恆真 | 判別力 | 🔴 **成立(我自己的設計缺陷)** —— 我先前實測過「非 superuser owner + FORCE ⇒ 42501」有判別力,但寫進 harness 時退化成 count 查詢 | 用**有資料的 fixture**做成對紅綠;並驗 SECDEF 函式 owner 而不只 table owner | `b2s1a1-verify.sh:128` |
| 6 | `btrim()` 只移除 **ASCII 空格**,tab/換行可冒充「非空白」 | **真缺口** | ✅ **實測成立**:`length(btrim(E'\t'))=1`、`length(btrim(E'\n'))=1`;tab 當 `carrier_note` 餵 A3 → **放行** | 三條守門(A3 / X7 / A8)一起換掉,改 `regexp_replace(x,'\s','','g') <> ''` 或等價 | `20260805170000:63,110,120` |
| 7 | X4 只要求 `hct_request_id IS NOT NULL`,`''` 或 `'   '` 可讓 `submitted` 合法 | **真缺口** | 未驗(但與 6 同族、幾乎必然成立) | X4 併入非空白判斷 | `20260805170000:86` |
| 8 | 「hct_* 有恆時守門接住」說過頭:已出貨 HCT 包裹可改回 `draft` 並清空證據 | 註解說過頭 + 真缺口 | 未驗 | 要嘛補狀態轉移守門(禁 submitted→draft),要嘛把註解降級並明文交棒給 writer RPC | `20260805170100:61` |
| 9 | P1/P1b 的 grep 不等於「原樣 RETURN NEW」;`RETURN OLD`、`NEW := OLD`、`SELECT … INTO NEW` 都躲得過 | 判別力 | 未驗 | 逐支釘唯一允許的 return/賦值形狀,並加那三個突變 | `20260805170100:199` |
| 10 | 宣稱約束集合雙向比對,但清單漏 `shipments_customer_user_id_fkey` | 判別力 | 未驗(清單可逐字核,幾乎必然成立) | 全集補 FK,多一條少一條都紅 | `20260805170000:232` |
| 11 | 索引驗收只看名稱/是否 partial,沒釘欄位、唯一性、精確 predicate | 判別力 | 未驗 | 對 `indkey`/`indisunique`/`indpred` 精確雙向比對 | `20260805170000:282` |
| 12 | X1 不存在時多個 scalar subquery 回 NULL,`IF NULL` 不會 RAISE ⇒ 消融 X1 後檔內 DO 不紅 | 判別力 | 未驗 | 改具名 `NOT EXISTS` / `IS DISTINCT FROM TRUE` | `20260805170200:237` |
| 13 | S1b 結構驗收沒核約束全集、兩支 FK、quantity CHECK、unique 形狀、index 欄位 | 判別力 | 未驗 | 補齊 catalog 雙向斷言 | `20260805170200:218` |
| 14 | 前置閘沒 pin 規格承諾的表/約束/trigger 三元組(S1a-2 只數 10 CHECK、S1b 只數 6 trigger) | 判別力 | 未驗 | 以具名集合 + 事件面 + 啟用狀態雙向 pin | `20260805170100:41` |
| 15 | A8 正測插「other + 已出貨 + 零品項」,deferred X1 前就 ROLLBACK ⇒ 真 COMMIT 必紅 | **判別力(我的漏)** | 🔴 **成立** —— 同型病我在 S1b 抓到並修了,**沒回頭查 S1a** | 該格補品項 + `SET CONSTRAINTS ALL IMMEDIATE` | `b2s1a1-verify.sh:103` |
| 16 | S1a-2 多數 SHIPPED/F9/同句出貨正測都建「零品項已出貨」列,X1 從未跑 | **判別力(我的漏)** | 🔴 **成立**(同 15) | 每張已出貨 fixture 先給合法品項,所有成功格結束前強制 deferred | `b2s1a2-verify.sh:47` |
| 17 | 主流程與「唯一 DB 驗收」作廢重開都 `expect_ok` 後 ROLLBACK,沒觸發 X1、沒回查終態 | **判別力(我的漏)** | 🔴 **成立**(同 15;而項 24 是 Sean Q1=A 流程的唯一 DB 驗收,更不能只驗「沒噴錯」) | 成功前強制 X1 + 逐項回查兩張包裹與兩組品項終態 | `b2s1b-verify.sh:46` |
| 18 | 檔頭宣稱所有成功格回查落庫,但 `expect_ok` 只看沒例外 | **判別力(我的字面 vs 事實)** | 🔴 **成立** —— `expect_landed` 只寫在 S1a-2,S1a-1 檔頭卻照抄了那個宣稱 | `expect_ok` 改成檢查 `ROW_COUNT` + 指定欄終值 | `b2s1a1-verify.sh:54` |
| 19 | 15 欄矩陣未獨立測 `carrier_note`/`customer_user_id`/`updated_at`;carrier_note 那格同時改了 carrier_code | 判別力 | 未驗 | 三欄各自獨立格 + 各自突變 | `b2s1a2-verify.sh:67` |
| 20 | X5 負測同時違反 X6 ⇒ 把 X5 改恆真仍會紅在 X6 | 判別力 | 未驗(讀 fixture 即可確認,幾乎必然成立) | 改用 `sf + failed + 零 hct 證據` 的 X5 專屬格 | `b2s1a1-verify.sh:97` |
| 21 | 同時 TRUNCATE 兩表只驗 SQLSTATE;拿掉父表 trigger 仍會由子表 trigger 報 P0001 | 判別力 | 未驗 | 捕捉 `CONSTRAINT`/訊息歸因,或隔離子表 trigger | `b2s1a1-verify.sh:117` |
| 22 | X1 狀態積缺「直接 INSERT submitted」與「failed + 已作廢」兩格 | 判別力 | 未驗 | 補兩格 + 各自消融 | `b2s1b-verify.sh:112` |
| 23 | S1b harness 沒驗 RLS/ACL、service_role 正面、client 零權限、函式 owner/config/proacl、quantity/FK | 判別力 | 未驗(讀檔即知該段確實不在) | 補齊 catalog + 非 owner 行為格 | `b2s1b-verify.sh:54` |
| 24 | A7 正測只保證同客人不同訂單,沒保證兩張訂單**收件地址不同** ⇒ 可能假證 Q1=B | 判別力 | 未驗 | fixture 明確篩不同 `shipping_address_snapshot` 並先斷言不相等 | `b2s1b-verify.sh:25` |
| 25 | parent guard 全是單 session;把 `FOR NO KEY UPDATE` 換成普通 SELECT 仍全綠 | **規格深度 + 判別力** | 未驗 | 加兩 session barrier 負測;**plan §4 要先寫進這個要求**(memory `feedback_race-test-without-barrier-proves-nothing` 同形) | `b2s1b-verify.sh:64` + plan §4 |
| 26 | Q3=A 要求 draft/submitted/shipped 三態作廢 + unvoid,現只有已出貨作廢與已作廢 unvoid | 判別力 | 未驗 | 三態各自成功 + 落庫回查 + `RETURN NULL` 突變 | `b2s1a2-verify.sh:84` |

## B. nit 7 條

| # | 主張 | 分類 | 處置 |
|---|---|---|---|
| 1 | 回滾說 S1b「對應函式 ×5」,實際只有 3 支(3 個 block trigger 共用同一支) | 誤判(我的數字錯) | 🔴 **codex 對、我寫錯**:S1b 只建 3 支函式 ⇒ 檔尾回滾把「×5」改「×3」 |
| 2 | 「拆兩支就多一個死結面」缺證據 | 規格深度 | 要嘛補 wait-graph 證據,要嘛把該句降成「少一次鎖」 |
| 3 | 「`tracking_number IS NULL` 只可能是 other」少了「已出貨列」限定 | 註解說過頭 | 補限定詞(draft 的 hct/sf 本來就可 NULL) |
| 4 | §8 說每支開頭應有 forward-only DO,S1a-1 沒有 | 規格深度 | 要嘛補 DO,要嘛在 plan §8 明文豁免第一支(`CREATE TABLE` 的 42P07 即前置閘) |
| 5 | 多列 INSERT 可依輸入順序鎖多個 shipment ⇒ 反序仍可能真 40P01 | 規格深度 | 交棒 writer RPC:每交易單一 shipment 或按 id 排序 + 40P01 重試 |
| 6 | service_role DELETE 只有 `has_table_privilege`,沒有真正非 owner caller 的拒絕結果 | 判別力 | 補非 owner 行為格 |
| 7 | S1b 新增的是 AFTER constraint trigger,不改變四支 BEFORE UPDATE 名稱序 ⇒「本批立刻欠自己一次」說過頭 | **誤判** | 🔴 **我的反駁**:契約債的文義是「**任何在本表掛 trigger 的片都要重跑該斷言**」,不是「名稱序一定會變」。S1b 確實在 `shipments` 上掛了 trigger,重跑斷言是**遵守契約**而非多餘;但「欠自己一次」措辭確實過重 ⇒ 改成「本批內即觸發一次該契約,已重跑」 |

## C. 為什麼不拆兩批(裁示 `B-119-A` ③ 的理由,逐字保留)

> 我原本替 B 案的辯護是「判別力那族**不會讓壞資料寫進去**」——
> **那句話本身就是「守門有效」的宣稱,而那正是判別力不足的 harness 證明不了的事。
> 用「守門是對的」去論證「不必證明守門是對的」= 循環。**
> codex 15-26 抓的是「消融某條守門後仍全綠」= **我們不知道那條守門有沒有在工作**,
> 不是「它有在工作但測試寫得醜」。schema 片、apply 不可逆,不能帶著「不知道」落地。

## D. 下一棒動手前的三個提醒

1. **先做消融實測再修**:codex 15-26 是靜態推論,逐條先用「拿掉那條守門 → 該格是否轉紅」實測確認,
   避免修一個不存在的問題(也避免漏掉它沒看出來的)。
2. **fixture 合法化與 `SET CONSTRAINTS` 要一起做**(15/16/17):只改 fixture 而不強制 deferred,
   X1 依然不會發火。
3. **規格深度那幾條(25、nit 2/4/5)先更新 plan §4 再補測** —— 裁示第 5 步:
   規格與測試同批對齊,不要讓測試偷偷超前或落後規格。
