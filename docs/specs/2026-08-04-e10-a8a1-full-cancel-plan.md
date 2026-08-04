# A8a1 片級 plan:`admin_cancel_order` 整單取消核心(v4)

> **v4(Fable R3 換角度輪折入)**:F1 must-fix=a7 runbook 終態把採購寫入永久打死(a4a 步⑦
> 回權前提在 a7 終態不可滿足)⇒ a7 升 v4 補步 8 A5a 回權+a4a 步⑦ 互指;F2=I3/R11 判別力
> 缺口 ⇒ M15(拿 actor 分句)+R11 遮蔽誠實認列;F4=2c 部分保留案逐單 DML;F5=audit 分句
> retention 外部前提入 §3.3;F6=S4 正向格(已配採購零到貨可取消)。vector 36 格×14 突變。

> 2026-08-04 視窗A。高風險(鐵則 12①③)走全 9 步自驅 SOP(SOP 步數;RPC 本體=§3.2 十步,
> 兩者不同計數、勿混讀)。母計畫 row 36(:383)+§5.1b/§5.1d;
> 同構繼承 A8c1/A8c2 plan。**不 apply**(⛔)。前置=runbook(現 v3)已落檔。
> **v2**:關卡1 R1 FAIL(21MF+2nit,`/tmp/a8a1-k1-codex-r1.txt`)全折入——冪等回放驗全產物集/
> I4 不可達認列/EXCEPTION 移除/hash 用入庫原文/audit 形狀/同批驗收字面/runbook 六條(v2 重寫)。
> **v3**:關卡2 雙線 R1 FAIL(code-reviewer opus 4MF+6nit、codex xhigh 9MF+3nit+runbook 6 條)
> 全折入,僅一條反駁(「全 9 步 vs 十步」=SOP 與 RPC 步數兩回事,上句已消歧)——
> 冪等不變式擴全集(header 欄位對輸入/零在途 attempts/audit 在場)/I2b 竄 hash 欄判別格/
> 步5 判別力(R9b 改 header-only+R9c+M10)/零品項守門(R13+M11)/items·audit 筆數守
> (PC2·PC3+M12·M13)/audit 快照形+source_app 顯式/前置閘加 A7-t/A4a trigger 面 pin/
> S1 驗回傳 id+audit before·after/兩份 runbook 各修(a7 v3、a4a 五處)。
> **估時(鐵則 4,v2 補)**:runbook 已先行完成;本片主體=migration(~20 分)+harness(~25 分)
> ≈45 分內;超出即停下拆(實況:關卡2 折入使 harness 重寫一輪,超時屬審查折入、非範圍失控)。

## §0 位置與部署合約

- 前置閘 pin 四組(v3b):begin=A8c1、confirm=A8c2、`admin_cancel_order` 零 overload(首建)、
  **A7-t/A4a trigger 面=(表, trigger, 函式)三元組×5 存在+enabled+三支 helper functiondef md5**
  (codex R2:只數名稱抓不到錯綁/no-op 替身;負向格=harness N4)。
- 🔴 **同批約束(v2 更正 v1「已解除」錯字面)**:row 37 明定**本片仍須與 A8a2 同批驗收部分取消**
  ——本片寫滿整單 items 只解「零明細 header」風險,不解同批字面 ⇒ **A8a1+A8a2 同窗接續施工、
  apply 佇列同批**(A8a1 commit 後不單獨 apply,標 ⛔ 等 A8a2 齊);主視窗收割可逐片、apply 必同批。
- 綠燈:不宣稱。

## §1 目標

「取消訂單」第一次存在:unpaid+零收款在途+零到貨的單,一次取消全部品項,寫真相(header+items)
+對客欄,冪等可重放、fail-closed。

## §2 親讀契約(差異項;A8c1 §2/§2c、A8c2 §3.3 全承接)

| 契約 | 出處 | 約束 |
|---|---|---|
| 片規格 | row 36 `:383` | orders FU 先;允許集合=unpaid+attempts 全終態 failed 或零筆;冪等鍵+hash;整單才寫對客欄;other→reason_detail;instock 讀真相(⚠️ nit 更正:row 36 字面寫摘要 LEFT JOIN,「守門讀真相」的權威=row 37+A1 契約 `:361`,本片採真相表、引用以後者為準)|
| §5.1b/§5.1d | `:448-454`/`:479-492` | 冪等鍵 client 產;同鍵不同內容 RAISE;七值映射可測合約、未知 RAISE;other 對客=detail 逐字 |
| A7 債①③⑥⑦⑧ | `:174-181` | hash 算法寫死+golden;對客欄一致性自扛;is_active 負測;冪等三格;非空白判定(⚠️ v2:**translate 只做判空白,入庫/hash/對客=btrim 後原文**——v1「剝除後入庫」會竄改內文) |
| 排序契約 | A4a plan 鎖序段 | 主序 orders→proc→order_items;cancellation 多列按 `order_item_id` 全序;**v2 更正環面字面**:A5a=proc upsert(非 receipts writer)、環②在本片守排序契約時關閉、環③=receipts×receipts 與本片無關;本片殘餘環=與未來 receipts 多列 writer 的 40P01 fail-closed 可重試 |
| 鎖原語 | A2b1 C8 | order_items 鎖=NKU;orders=FU 第一觸表動作(A8c2 §3.3 硬前置) |
| Q17=B | `:452` | 每品項 Σreceipts=0 才可整單取消;摘要 CHECK=第二道網 |
| audit | `20260712210000` schema+A6 慣例 | **action=`order.cancel`**(`<domain>.<verb>` 慣例);request_id=p_idempotency_key(不加參數,明文);target=`'order:'||order_id`(既有 `order:<uuid>` 合約);before/after=payment_status/cancelled_at 快照(**v3:after 另帶 cancellation_id;source_app 顯式 'admin' 不倚賴欄預設**);reason=reason_code |
| ACL | A6 `:220-223`+A8c2 版式 | service_role only;窮舉+GRANT OPT+有效權閘;**SECDEF fail-open 面(v2 補):orders/order_items/兩取消表/receipts/**`payment_charge_attempts`**(步 7 NOT EXISTS 承重,FORCE RLS=錯誤放行)/`admin_audit_log` 七物件 owner 對齊+FORCE RLS off;**v2b 實作補強=八物件:+`order_item_procurement`(步 8 EXISTS 走 procurement JOIN receipts,任一表隱列=守門靜默放行,同承重)** |
| 地雷 | §2c-5 | 舊 RF2b 同名合約作廢 |

TS 連動面:零(接線=A9d2)。

## §3 設計

### 3.1 產物(=allowlist 恰 5 路徑)

migration `20260804180000_m4b_e10_a8a1_admin_cancel_order.sql` / `scripts/a8a1-verify.sh` /
本 plan / runbook(v4)/ **`docs/runbooks/a4a-summary-rollback.md`**(R2-18b 一行對齊 CURRENT.md
+v3 關卡2 折入四處:證據表 escape 三件套/②→⑤ 同連線鐵律/GRANT 回權時點釘死/drain 含等號)
——**allowlist 恰 5 路徑**。

### 3.2 RPC 全序(v2)

`admin_cancel_order(p_order_id uuid, p_idempotency_key uuid, p_actor text, p_reason_code text,
p_reason_detail text) RETURNS jsonb {cancelled, cancellation_id, idempotent}`;SECDEF、`search_path=''`。

1. 隔離閘(P8C01)。
2. 輸入驗:key 非 NULL;code ∈ 七值(未知=具體 RAISE);detail:btrim 後,`other` 必經明列碼位
   translate 判非全空白、其餘必 NULL;**入庫/hash/對客一律 btrim 原文**(不剝內部字元)。
3. orders **FOR UPDATE**(第一觸表)+NOT FOUND RAISE。
4. **冪等格(v2 加嚴=驗全產物集+現況不變式;v3 擴全集)**:同 `(order_id, key)` header 存在時
   ——先比 hash 欄+actor(hash=輸入導出 ⇒ hash **欄自身**竄改只有這裡抓得到,判別格=I2b);
   再驗不變式全集:`cancelled_at` 非空 **且** `cancelled_reason`=映射預期 **且** header
   `reason_code`/`reason_detail`=輸入 **且** items 全品項全額(逐一比對)**且**
   `payment_status='unpaid'` **且** 零在途 attempts(`status<>'failed'` 不存在)**且**
   audit 列在場(request_id/action/target 全符)——病理態(取消後又 paid/在途金流/產物殘缺/
   header 竄改/audit 被刪)一律 RAISE fail-loud,不回成功 ⇒ 全符才回 idempotent:true。
   hash=`sha256('a8a1:v1:'||order_id||':'||code||':'||coalesce(btrim(detail),'')||':full')`
   (分隔符碰撞已核可:uuid 正規、code 無冒號 allowlist、detail=末欄);golden vector 進 harness。
5. 已取消守門:`cancelled_at` 非空或存在異鍵 header ⇒ RAISE(部分取消歷史單的整單收尾=A8a2)。
   **v3 判別力註**:R9(取消後異鍵重呼)被步 8 遮蔽=誠實認列;本步的判別格=R9b(header-only
   合成態)+R9c(`cancelled_at` 非空、零 header),M10 恰殺這兩格。
6. actor:staff 存在且 `is_active`,否則 RAISE。
7. 允許集合:`payment_status='unpaid'` + `NOT EXISTS(attempts WHERE status<>'failed')`。
8. 品項守門:鎖全部 order_items(NKU、按 id 序)→ **零品項單拒(v3;row 36「零明細 header」
   fail-closed,A7-t presence 是 DEFERRED 且訊息非通用、不倚賴)** → 每品項 Σreceipts=0、
   Σcancellation_items=0。
9. 寫入(同交易):header → items(全額、按 order_item_id 序)+**筆數守=品項數(v3;BEFORE
   trigger 抑制單列 ⇒ 部分取消冒充整單,判別格=PC2/M12)** → orders 對客欄
   +**row_count 守(v2b 實作補;A8c2 PF-C 同款)**:trigger 抑制/FORCE RLS ⇒ 對客欄靜默
   漏寫=產物集不一致,`ROW_COUNT<>1` 必炸全回滾(PC1 格的 RAISE 承重就在這道——拋棄庫實測
   A7-t 不含 orders 一致性 trigger,無此守 PC1=靜默成功)→ audit(`order.cancel` 形狀照 §2)
   +**筆數守恰 1(v3;判別格=PC3/M13)**。**前置閘第四組(v3)**:A7-t/A4a 五 trigger 存在
   且 enabled='O' pin(缺失或 disabled ⇒ 零品項 header/摘要第二道網靜默失效)。
10. 回傳。**零全函式 EXCEPTION handler(v2)**:同鍵併發被步 3 FU 序列化 ⇒ 後到走步 4;
    `(order_id,key)` UNIQUE=**不可達 backstop、誠實認列不設格**(A2b1「列格先證可達」課);
    任何 23505=真異常 fail-loud。

### 3.3 鎖面與誠實邊界

orders FU → order_items NKU(排序)→ 讀真相(無鎖)→ 寫入;A4a trigger 同交易重入 NKU=已持有、
無自鎖(關卡1 已核可)。對客欄一致性=交易原子自扛+負測(債③)。actor 非驗證身分=E8-B(債⑨)。
**v3b(code-reviewer R2)**:冪等不變式的「零在途 attempts」分句讓**合法重放**在該單出現非 failed
attempt 時轉 fail-loud(通用訊息、與業務拒絕不可分辨)——現況安全的前提=A8c1 的 begin 守門擋掉
已取消單的新 attempt(CC1 實證),這是**外部前提、非本函式自持**;若未來 begin 守門被改弱,
此分句會把「本該冪等成功」變成誤拒(fail-closed 方向、不損錢,但誠實列明)。
**v4(R3 F5)**:「audit 在場」分句同款——合法重放永久依賴 audit 列存活;未來若立 audit
retention/歸檔政策,已清列的重放=誤拒(同 fail-closed 方向);立政策那片必須回頭重看本分句。

## §4 harness(全套慣例同 A8c2;身分閘含三支部署鏈 pin+trigger 三元組;committed 格清理)

### 4.1 格

vector 36 格(v4)= S×4 + I×10 + R×17 + C9×2 + PC×3;G1/CC1/CC2/M2 示範=非 vector。
**S4(v4)**=已配採購(allocated>0)零到貨的合法整單取消正向格(守門誤改嚴會紅);
**R11 遮蔽認列(v4)**:NOT FOUND 拿掉後零品項守門照紅 ⇒ R11 對 NOT FOUND 分支零判別力、
無專屬突變(該守門價值=fail-fast 與訊息語意、非唯一防線)。
成功:S1 整單(header+items 全額有序+對客欄+audit `order.cancel` 一筆**含 before/after 快照、
source_app、after.cancellation_id=回傳 id(v3)**+**回傳 cancellation_id=真 header id(v3)**+
摘要 cancelled=quantity)/S2 other→detail 逐字(**含內部多空格原文保留**)/S3 七值映射逐字。
冪等:I1 同鍵重放(產物完整)→ idempotent:true 零新列(**含 audit 恰 1**);I2 同鍵異 code
(**v3:用 customer_request→price_change 同映射對,hash 與 header 欄位不變式都抓得到**)→RAISE;
**I2b(v3)竄改 payload_hash 欄+輸入不變→RAISE(hash 比對的專屬判別格)**;I3 同鍵異 actor→
RAISE;I5 病理重放 paid→RAISE;I6 產物殘缺(刪一列 item)重放→RAISE;**I7(v3)取消後合成
pending attempt→重放 RAISE**;**I8(v3)竄改 header reason_code→重放 RAISE**;**I9(v3)刪
audit 列→重放 RAISE**。~~I4 併發 backstop~~ 不可達、不設格(§3.2-10)。
拒絕:R1 未知 code/R2 other 空 detail(**v3:NULL 與 U+3000 兩分支**)/R3 非 other 帶 detail/
R4 停用 actor/R5 不存在 actor/R6 paid/R6b `refunded`/R7 pending attempt/R7b charged attempt/
R8 released attempt/R9 已取消異鍵重呼(被步 8 遮蔽=誠實認列)/**R9b header-only 合成態
(v3 改:不插 ci 列——DEFERRED presence 在 ROLLBACK 格內不觸發、構造得出;步 5 判別格)**/
**R9c(v3)`cancelled_at` 非空+零 header→RAISE(步 5 第一分句判別格)**/R10 有到貨→RAISE
(通用訊息、非 23514)/R11 不存在單/R12 NULL key/**R13(v3)零品項單→RAISE**。
隔離/併發:C9a/C9b;CC1 cancel(真 RPC)先→begin 醒來 RAISE(A8c1 §3.6 承諾的真 RPC 重驗);
CC2 begin 先 acquired→cancel 醒來 R7 拒。抑制族(v3 成套):PC1 orders UPDATE 抑制/
**PC2 單列 items INSERT 抑制**/**PC3 audit INSERT 抑制**→皆 RAISE 全回滾。

### 4.2 突變(EXPECT 實作時逐格定死)

M1 拿允許集合→R6/R6b/R7/R7b/R8 紅;M2 拿品項守門→R10 紅+**示範格:紅在 SQLSTATE 23514 且
`CONSTRAINT_NAME='oiqs_instock_cancelled_le_quantity'`(v2 釘名)且 header/items/orders/audit
全回滾斷言**=第二道網實證;M3 拿 hash 比對(**只窄化 hash 分句、留 actor 分句**)→**I2b 紅
(v3;I2 因 header 欄位不變式仍綠=hash 判別力只在 I2b,誠實設計)**;M4 拿 is_active→R4 紅;
M5 拿隔離閘→C9a/C9b 紅;M7 拿對客欄寫入(含 row_count 守)→S1/S2/S3/I1/PC1 紅(實證 5 格);
M8 拿 audit 寫入(含筆數守)→S1/I1/PC3 紅(實證 3 格);**M9 拿冪等不變式全集→I5/I6/I7/I8/I9
紅(v3 實證 5 格;I2 因 hash 比對仍綠)**;**M10(v3)拿步 5 已取消守門→R9b/R9c 紅(R9 被
步 8 遮蔽、M10 下仍綠=誠實認列)**;**M11(v3)拿零品項守門→R13 紅**;**M12(v3)拿 items
筆數守→PC2 紅**;**M13(v3)拿 audit 筆數守→PC3 紅**;**M14(v3b;code-reviewer R2 nit)拿
orders row_count 守(留 UPDATE)→PC1 紅**;**I10(v3b)取消後清 `cancelled_at`(留 reason)→
重放 RAISE(冪等不變式第一分句的專屬判別格,M9 下紅)**;**M15(v4;R3 F2)拿冪等 actor 分句
(留 hash 分句)→I3 紅(actor 分句的專屬判別)**。EXPECT 14 條向量全 36 位、實跑釘死。
**M6 排序(v2 改結構格)**:migration 內兩處 `ORDER BY`(鎖 items 的 SELECT、INSERT items 的
SELECT)=結構碼錨各一條;mutant 移除任一→**結構斷言紅**(行為無判別力誠實認列,承重=結構層)。

### 4.3 oracle

定義唯一次數/碼錨+順序錨(完整條件字面;隔離閘<輸入驗<FU<冪等<守門<寫入)/md5 封條/COMMENT
md5 pin/ACL 窮舉+有效權閘/**SECDEF fail-open 面(八物件 owner 對齊+FORCE RLS off;§2 v2b)**/
前置閘負向格×4(N4=trigger 面;v3b)/剝殼格/十二表零留痕(v3 更正 v2「九表」字面;
實作自始為 TWELVE 清單)/計數閘。

## §5 驗收(yes/no)

1. 全格綠+突變逐格吻合;2. G1 綠;3. migration asserts 全過;4. 三綠;5. 剝殼+零留痕+雙跑穩;
6. allowlist 恰 5;7. runbook v3 含 §10 全要件+唯一有序程序(步 0 退款線 FK 前置)+可執行
ACL 斷言+orders 欄處置無條件化+A7-t helper 併拆+
A2b1/A4a 函式體閘+overload 枚舉。

## §6 apply 前置與 rollback

⛔ 停點+**同批鐵律:與 A8a2 同批 apply**(§0)。apply 前:四組 pin(v3b 含 trigger 面)/取消表 0 列+cancelled_at
名單/隔離三層/ACL。apply 後 read-back 同 A8c2 版式。rollback=runbook v3 §0 唯一有序程序
(本函式=其步 1)。

## §7 已定非決策項

- 訊息:業務拒絕通用、輸入類具體。內容分級 N/A。
- **零 Sean 決策題**:同批約束=母計畫既有字面(v2 已照抄、非新決策);整單 items 由本片寫=
  A7-t 物理強制;其餘全既有拍板。
