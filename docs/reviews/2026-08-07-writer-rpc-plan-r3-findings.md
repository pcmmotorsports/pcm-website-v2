# writer RPC plan v3 — R3 審查 findings 全文(opus 換角度,2026-08-07)

> R1(fable)FAIL6→v2;R2(fresh fable)FAIL4→v3;R3(opus,四指定角度:假設審查/災難日可用性/修法回歸/測試假綠)**FAIL 12**。本檔=R3 原文轉錄(主視窗代錄),B 窗折入 v4 的權威依據。主視窗裁定見文末。

## 角度 1:假設審查

**A1 must-fix**:「三組 barrier 原始定義」不存在——master plan 全檔 grep 只有 `:621` 那句括號 shorthand(另 `:396` 屬 A7b)。plan 寫「開工前逐字展開」=假設出錯。修法=本片自行定義寫進 W6 驗收。**R3 已代展開三組**(與 B 窗 §6a 獨立設計交叉對照):

- **組① 2×unvoid**:fixture=兩包裹皆已出貨已作廢、共用品項 I1/I2、shipment_items 實體列序相反;同步點注入在 **RPC 自己的取鎖迴圈**第一次取鎖後(不動 trigger——它被四支共用);期望=皆成功、無 40P01、shipped 各等真值;**翻面靶=拿掉 RPC 取鎖 SELECT 的 ORDER BY**;🔴 拿 trigger 迴圈的 ORDER BY 翻不了面(DISTINCT 已規劃成 Sort,S2b §4.19③+BAR-PLAN-SHAPE 釘住)。
- **組② INSERT×unvoid**:A 掛品項持 parent NKU 不 commit、B unvoid 必須阻塞、斷言 `pg_blocking_pids(B)={A}`;方向乙=A 持鎖 12 秒、B 正確結局=5 秒被自己 lock_timeout 中止;判別力來源必寫進驗收:FK 的 KEY SHARE 不與 NKU 衝突 ⇒「B 被擋」只可能來自 guard 顯式 NKU;翻面靶=guard 改普通 SELECT。
- **組③ cancel×unvoid**:🔴 形狀必須重定義——兩邊同鍵同向取鎖,**40P01 構造不出來**(L2a 同型陷阱)。正確形狀=①正向格皆成功兩軸等真值 ②衝突格=cancel 推 cancelled 到邊界+unvoid 回加 shipped,後提交者必紅在具名 C9/C6′ 且被 Q8 攔截轉人話;翻面靶=helper parent NKU 移到讀 SUM 後(BMUT-L1 已實證會翻)。

**A2 must-fix**:W6 估 45 分=4-6 倍低估(S2b 一組 barrier 就吃整片還 inconclusive)。拆 **W6a/W6b/W6c**。
**A3 must-fix**:W4 讓 RPC 先取全部 order_items 鎖 ⇒ S2b 移交的 trigger 序靶在應用路徑**失去觀察面**、照抄必全綠零判別力。W6 靶改打 **RPC 自己的取鎖序**,驗收明寫「量的是 RPC 的序不是 trigger 的序」。

## 角度 2:災難日可用性

**B1 must-fix**:runbook 步驟①現行序(REVOKE A5a→(1b)DISABLE trigger→revoke_at→drain)在五支 RPC 上線後會做錯事:drain 未歸零前 RPC 交易仍提交而 trigger 已停 ⇒ shipments 動了摘要不算、C9 不評估 ⇒ 步驟⑤ 紅因是**順序**但災難日的人會查錯地方。修法=W7c 指定插入點:**REVOKE 五支→revoke_at→drain 歸零→才 DISABLE**,並重推 runbook R2 論證段。
**B2 must-fix**:冪等表在 runbook 全程是孤兒(沒人 DROP/凍結/驗未動);且「產物集快照」內容未定義——若含摘要衍生值,災難回滾+forward 後同鍵重試被不變式重驗判不一致 ⇒ **RAISE 永久擋死唯一合法重試路**(A7b D8 同型)。修法=快照**只含 shipments/shipment_items 不可變事實、禁含重算衍生欄**;runbook 加「本表不動不清不重放」。
**B3 must-fix**:`REH-*` 當 W7c 裁判超出其自陳射程(`b2s2b-verify.sh:2154` 只演練出貨表 0 列那條路)。修法=另立「出貨表非空」演練格,或明寫 REH 不背書本片。
**B4 consider**:W7c 認領漏 runbook ③(b) 消費端清單回寫義務(W8 若 PostgREST 讀 shipments 即命中)+⑤ 債⑤ 判讀字面。

## 角度 3:修法回歸

**C1 must-fix**:產號重試迴圈 × 鍵表「撞唯一鍵轉重放」同交易互相引爆——鍵列 INSERT 若在迴圈內,第二圈撞自己 ⇒ 誤判併發轉重放 ⇒ 回傳 shipment_id NULL 半成品。修法=①鍵列 INSERT 在迴圈**外** ②重放路徑對 `shipment_id IS NULL` fail-closed RAISE。
**C2 must-fix**:Q1=A「業務拒絕單一通用訊息不洩存在性」與 Q8/交棒 2 引導訊息**直接矛盾**(引導必洩到貨/出貨狀態)。修法=明文裁定其一,寫進 Q1=A 字面。
**C3 consider**:Q7 凍結集合=五支被 GRANT 的 RPC,W0b 新表的守門 trigger 函式不在集合、不在凍結面 ⇒ 被 GRANT/DROP 都沒守門紅。
**C4 nit**:M4 前緣守門缺交棒 1 的「為訊息非正確性」限定詞(讀的是惰性摘要)。

## 角度 4:測試假綠

**D1 must-fix**:「EXECUTE 集合=凍結五支」格被 `proacl IS NULL` 打穿(NULL=PUBLIC 可執行而 aclexplode 回零列=呈現為沒被 GRANT)。修法=先斷言五支 `proacl IS NOT NULL` 再比 grantee 集合(前科 `20260806180000:331-333`)。
**D2 must-fix**:N2「永不清理」若斷言註解字面=恆真族。改效果斷言(DELETE/TRUNCATE 必紅在具名 conname/P0001)+突變。
**D3 must-fix**:Q3 禁批次的 position() 文字檢查對 `WHERE id = ANY(p_ids)` 等價繞過全盲。改白名單式可判定字面+一發 `=ANY` 突變靶。
**D4 must-fix**:W7b 再補一格 `position('ORDER BY oi.id')` 結構錨=第二個恆真錨,清償不了交棒 6(a8a2 自陳「結構層承重、行為無判別力」)。修法=跨函式行為格(a8a2×出貨重算真併發),20 分估時不成立。
**D5 must-fix**:冪等重放 oracle 缺「零新寫入」量測——「回同 reference」可被「新建一箱但回第一箱的號」滿足。併斷言三表列數 Δ=0+audit 增量凍結。

## 主視窗裁定(B-179-A)

1. **A2 拆片=批**(W6a/b/c);**A1 的 R3 展開版與 B 窗 §6a 交叉合併**,差異點(組③ 40P01 不可構造/組① trigger 靶翻不了面)以 R3 版為準——它帶實測錨。
2. **C2 裁定=引導訊息優先**:本片 RPC 是員工面內部工具,A8a1 不洩存在性條款在本片不適用,寫進 Q1=A 字面;此裁定連同 Q7 支數/W0b 新表進 Sean 白話簡報。
3. 其餘 must-fix/consider/nit 全數折入 **v4**;v4 完成後派 confirmation 輪(fresh、窄驗折入)。
