> ⚠️ **本檔=獨立 Fable 分析輸入(2026-08-05,fresh context、不看 v3/v4 結論)。**
> 🏁 **2026-08-05 Sean 已拍板:Q1=A、Q2=A**(§10 照推薦;C9 摘要表 CHECK + 出貨 RPC 訊息層 +
> oracle 四軸;C6′ 照 v4 落地、標記冗餘。Q1=A 即接受 U1 的兩步更正流程代價)。
> 服務對象=B2 出貨線停損版(v5 兩張表)之後的「shipped 進摘要」那片,依本拍板施工。
> 前情=同題三次分析全被證偽(v2 三桶互斥/v3 已蘊含論/主視窗第三案),詳 memory feedback_claim-scope-exceeds-fact-three-shapes 第五形狀。

# 「已出貨不得取消、不得超過已到貨」強制點分析(fresh context 第四輪)

> 撰寫:2026-08-05,唯讀分析,零 repo 改動。
> 引用基準:主樹 `/Users/sean_1/pcm-website-v2`(HEAD de2bfe9)+ worktree `/Users/sean_1/pcm-a4a-chain`(B2 plan v4 所在)。
> 一句話結論:**不變式拆成兩條後,承重的那條是 `shipped ≤ instock`,它應該放在摘要表當
> CHECK(隨 A4a row-level 重算被評估),而不是只放出貨側 RPC;取消側零改動。**
> 這與 B2 plan v4(第三次分析)的裁決相反,理由在 §6-§7;已由 Sean 重裁=Q1=A(2026-08-05,§10)。

---

## §1 事實底座(全部親自開檔驗證)

| # | 事實 | 出處(檔案:行號) |
|---|---|---|
| F1 | `order_item_quantity_summary` = 衍生快取、惰性建列,唯一 writer = A4a 四支 trigger;重算 helper 是 **per-item(row-level)**:`pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)`,鎖 parent NKU → 三軸真相直讀 → upsert 單列 | `supabase/migrations/20260803140000...sql:140-189`(鎖 :153-157、upsert :180-187);四支 trigger 皆 `FOR EACH ROW` :404-423 |
| F2 | `instock` 真相直讀 receipts JOIN、不經 `received_quantity` 累計欄;且有字面錨釘死「helper 不得讀累計欄」 | 同檔 :170-173、:587-589 |
| F3 | receipts 重算 trigger = `AFTER INSERT OR UPDATE OR DELETE` ⇒ **instock 非單調不減**(刪改到貨紀錄會降) | 同檔 :415-418 |
| F4 | break-glass:owner 單一交易內 DISABLE 四支 trigger → 修資料 → ENABLE → 三軸漂移 oracle 重驗,違反則整段回滾 | 同檔 :82-125(oracle :101-122) |
| F5 | break-glass 的活體 oracle(runbook + verify script)目前是**三軸**,無 shipped | `docs/runbooks/a4a-summary-rollback.md:60-71,147`;`scripts/a4a-verify.sh:152` |
| F6 | A8a2 可取消量守門 = `增量 ≤ quantity − instock − cancelled`,註解自稱「shipped 退化式」;instock/cancelled 皆**真相表重算**,摘要只驗「在場」不讀值 | `supabase/migrations/20260805100000...sql:395-406`(守門)、:376-387(在場閘) |
| F7 | 守門的 instock 式帶 `r.quantity > 0` 過濾,A4a helper 的 instock 式不帶 —— 兩式今日等價僅因 receipts CHECK `quantity BETWEEN 1 AND 100000` | `20260805100000:402` vs `20260803140000:170-173`;CHECK 在 `20260729020000:198` |
| F8 | A1 摘要表七條 CHECK;C7 = `instock + cancelled ≤ quantity`;C1/C6 被蘊含、**誠實標冗餘保留**的先例存在 | `20260730150000:96-125`(冗餘標記 :98-102) |
| F9 | A1 契約債字面:「完整式 `cancelled <= quantity - shipped` 退化為 C6」+「第 2 批同一片 ①加 shipped ②納入 C6/C7 ③改 A8a1/A8a2 守門」 | `20260730150000:152-158` |
| F10 | master plan(主樹)row 37 字面:「③ 把可取消量守門改成 `增量 ≤ quantity − instock − cancelled − shipped`」「② 納入兩條 CHECK」 | `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:384`(row 36 連動 :383) |
| F11 | Sean 2026-08-05 追加拍板:出貨必先到貨(無直送)⇒ 不變式新增 `shipped ≤ instock`;**C7 原樣不動;可取消量 = quantity − instock − cancelled(不減 shipped)**;MP row 37 的 −shipped = 重複扣 | memory `project_m4b-b2-shipments-db-decisions.md`(08-05 追加段);B2 plan v4 §0.1 |
| F12 | B2 plan v4(= 第三次分析的產物)現行裁決:C6 改寫成 `cancelled + shipped ≤ quantity`(C6′,S2);**`shipped ≤ instock` 移出摘要表、改出貨側守門,而出貨 RPC 不在本批 ⇒ 本批交付後該不變式 DB 層零強制力** | `/Users/sean_1/pcm-a4a-chain/docs/specs/2026-08-05-e10-b2-shipments-db-plan.md:24-27(§0.1)、:102-109(§2 末)、:193-229(§3.3)` |
| F13 | plan v4 狀態 = 「v4 折入完成 → 送 R3,不得開工」;S2 片含 C6′ 改寫 + C8(shipped_nonneg)+ A4a 第四軸 + 兩支 row-level trigger | 同檔 :3、:91、:195-229 |
| F14 | Q3=A:包裹作廢後數量退回、可重新出貨或取消 ⇒ **shipped 也非單調**;shipped 真相式過濾 `deleted_at IS NULL AND shipped_at IS NOT NULL` | memory 同上;plan v4 :213-218、:279(驗收 32) |
| F15 | receipts 表零寫入 GRANT(service_role 只 SELECT)⇒ 現況「刪改到貨」只有 owner/SECDEF 路徑,合法更正入口是未來片 | `20260729020000:233-234` |
| F16 | A4a 契約債③:TRUNCATE procurement/receipts 不觸發重算(row trigger 物理限制),靠零寫 GRANT + owner 天花板 | `20260803140000:62-63` |
| F17 | 「20260805100000 已 apply 正式站」:**未確認**(repo 內無法親驗遠端 migration 帳本;需 Supabase 唯讀查 `supabase_migrations.schema_migrations`) | — |

三份互相衝突的公式(F9/F10/F11)並存中:主樹 MP row 37 仍是 −shipped 舊字面,worktree 已依 v4 §7 回寫 10 處(`pcm-a4a-chain .../2026-08-05-e10-b2-shipments-db-plan.md:337-351`)。合併前存在雙權威窗口。

---

## §2 不變式拆解與蘊含結構

題目的不變式其實是兩條,層級不同:

- **I1(狀態不變式)**:`shipped ≤ instock` —— 任何時點,已出貨量不得超過已到貨量。
  雙向約束:出貨方向(不可超出到貨)+ 到貨方向(**不可把到貨紀錄刪改到低於已出貨**)。
- **I2(動作不變式)**:已出貨的件不得被取消。

代數關係(全部在同一摘要列上逐點成立,可機器窮舉,見 §8 PR2):

```
I1(s ≤ i) ∧ C7(i + c ≤ q)      ⇒  c + s ≤ c + i ≤ q   =  C6′
I1(s ≤ i) ∧ 守門(增量 ≤ q−i−c)  ⇒  取消永遠碰不到 shipped 件  =  I2
```

⇒ **I1 是唯一的承重件**。I1 成立時:C6′ 是冗餘(C7∧I1 蘊含)、I2 免費(既有守門已擋)、
守門公式不必減 shipped(F11 拍板正確)。I1 不成立時:C6′ 是唯一擋 I2 的東西,而且只在
「取消到 c+s>q」那一刻才擋 —— 損壞狀態(s>i)本身自由存在。

三次失敗的共同病理:每一次都對「某層是無條件不變式」下了斷言,而那個性質其實是條件式的
(第一次:三桶互斥前提假;第二次:instock 單調前提假;第三次:「表級=不依賴 trigger」前提假)。
所以本輪的方法是:**不問哪層「絕對」,改問哪個組合的前提最少、失效面最小、失效時誰會發現**。

---

## §3 先回答題目裡的那個問句:停用視窗內,摘要表 CHECK 還算不算不變式?

分兩層答,兩層都對:

1. **對快取列**:算。`DISABLE TRIGGER` 不影響 CHECK constraint;任何寫入摘要表的語句
   (含 break-glass 內 owner 手寫)仍被 CHECK 擋。CHECK 唯一的死法是 owner `DROP CONSTRAINT`。
2. **對真相**:不算。停用視窗內真相表可以寫進違反 I1 的狀態而摘要不動 ⇒ CHECK 根本沒被評估。
   恢復通電後,違規**惰性浮現**:該品項下一次任何事件觸發重算 → upsert → CHECK 才紅。

但 F4 的 break-glass 程序把這個洞收掉一半:整段單一交易 + 收尾漂移 oracle,摘要與真相不一致
= RAISE 整段回滾 ⇒ 操作者被迫在同交易內把摘要寫成與真相一致,而那次寫入會過 CHECK
⇒ **CHECK 的效力經由 oracle 傳遞進 break-glass 視窗**。前提:oracle 含該軸。
F5 實查:**現行 runbook/verify oracle 是三軸、無 shipped** ⇒ S2 若不同步改 runbook 與
verify script,break-glass 對 shipped 軸就是真空。這是無論選哪個方案都必須補的一格。

所以正確的講法不是「表級 CHECK 是/不是不變式」,而是:
**摘要 CHECK = 「重算鏈通電時逐語句強制 + break-glass 時由 oracle 強制」的條件不變式,
條件是明文的、可驗的、且有既有機制承接。** 第三次分析用「它只是通電時才存在」否定 C6′,
這個否定同樣打中它自己保留的 C1-C7 與 C6′ —— 它不是層與層之間的判別條件。

---

## §4 強制點窮舉(把「可放守門的位置」當空間掃)

每項列:機制 / 成立前提(誰保證、誰改得掉)/ 一句話評價。

**E1|摘要表 CHECK `shipped_quantity ≤ instock_quantity`(下稱 C9)**
- 機制:S2 加欄時同片加 CHECK;A4a 第四軸重算(plan v4 §3.3 已有)每次 upsert 自動評估。
  受影響品項的任何真相事件(出貨、作廢、unvoid、到貨、**刪改到貨**)都會打到這條。
- 前提:P1 四張真相表事件全有 row trigger(保證:A4a+S2 結構驗收;能改掉:owner DISABLE、
  `session_replication_role=replica`、未來 migration)/ P2 helper 真相直讀+鎖先於 SUM
  (保證:字面錨 `20260803140000:569-607` + S2 md5 前置閘;能改掉:owner 重建函式)/
  P3 惰性列在首事件建立(~~shipped>0 必經 shipment_items 事件 ⇒ 必有列~~
  🔴 **2026-08-05 改述(B-201-STOP ⑥;v5 X3 之下)**:「必有列」結論不變 —— 品項事件在
  draft 期就建列;但 X3 擋死已寄出包裹再加品項 ⇒ **讓 shipped 升值的是 `shipments.shipped_at`
  那筆 UPDATE、不是 shipment_items 事件** ⇒ S2 重算必須同時掛
  `shipments AFTER UPDATE OF shipped_at, deleted_at`,只掛 shipment_items 會讓 shipped
  恆 0 且零錯誤訊息;已釘進 B2 plan v5 §7.1 交棒)/
  P4 shipped 真相式三處同式(重算、驗證、未來守門;能改掉:任何新片自己重寫 SUM —— F7 是
  這型分歧的現行實例)/ P5 break-glass oracle 含第四軸(F5 現況未含,**必補**)。
- 評價:一行 SQL,零新機制,雙向都擋(出貨超量、到貨刪到低於出貨),**未來 writer 忘記守門也擋**。

**E2|摘要表 CHECK `cancelled + shipped ≤ quantity`(C6′,v4 現案)**
- 前提:同 E1 的 P1-P3、P5(它同樣只是通電時的條件不變式 —— 第三次分析宣稱的
  「不依賴 instock 行為」是真的,但「表級=無條件」是假的)。
- 評價:只擋「取消到侵入 shipped」那一刻;**損壞狀態 s>i 自由存在**、出貨超量完全不管;
  在 C9 在場時被 C7∧C9 蘊含成冗餘(§2)。

**E3|真相表上的表級 CHECK** —— 不可行:I1 是跨表聚合(shipment_items SUM vs receipts SUM),
PG CHECK 表達不了;A1 的複合 FK 去正規化 pin 技只適用於凍結值(order_items.quantity),
instock 是可變聚合,pin 不住。淘汰,不是選項。

**E4|真相側 constraint trigger(shipment_items INSERT/unvoid + receipts DELETE/UPDATE 直讀真相驗 I1)**
- 前提:與 E1 完全同一組(同鎖紀律、同通電天花板),再加兩支函式自己的正確性。
- 評價:與 E1 判別力等價、失效面相同,但多寫兩支 trigger + 各自負測/突變 —— 純粹更貴的 E1。
  唯一差異:錯誤可以帶更好的訊息與 SQLSTATE。不推薦作主件,可作訊息層(見 E5)。

**E5|寫入端 owner RPC 守門(未來出貨 RPC:增量 ≤ instock − shipped;未來到貨更正 RPC:刪改後 instock ≥ shipped)**
- 前提:P6 該 RPC 是唯一寫入路徑(保證:零寫 GRANT + ACL;能改掉:owner、任何新 SECDEF writer)/
  P7 **每一個**未來 writer 都記得抄同一條守門(保證:只有文件與審查 —— 這正是
  「RPC 記得呼叫=第二真相」被 A4a 判死的形狀,`20260803140000:14`)/ P8 RPC 本體不在本批(F12)。
- 評價:必要(好錯誤訊息、擋在最前緣、業務語意分流)但**不充分**:對 receipts 刪改方向、
  對 owner 直寫、對「下一個 writer」零防護。v4 把 I1 全押在這層,還自己誠實寫了
  「本批交付後零強制力」(F12)—— 等於把已拍板的不變式降級成備忘錄。

**E6|應用層 server action / adapter 檢查** —— E5 的更弱版(多入口、可繞),只配當 UX 預檢。非強制點。

**E7|讀模型與 UI(取消畫面灰掉已出貨件、明細顯示 shipped 軸)** —— 防員工誤操作、不防資料損壞;
A13a 已有同型先例(MP :412)。非強制點,但推薦做(降低 fail-closed 紅的頻率)。

**E8|不強制、只監測(a4a-verify 第四軸 + 夜跑漂移掃描 + break-glass oracle)**
- 前提:有人看告警、告警到修復之間的窗口可接受(訂單 100-300/月,窗口內可發生真取消)。
- 評價:單獨不及格(事後才知),但作為 E1 的偵測背板必要 —— **E1 失效時誰會發現 = E8**
  (memory `feedback_review-process-shrinking-verification-surface` 的總閘)。

**E9|物理/FK 層:出貨對到貨逐筆配貨子表(shipment_item_allocations(receipt_id, qty) 複合 FK pin 到
receipts(id, quantity))或單件序列化**
- 機制:receipts 被配貨引用後,刪列被 RESTRICT 擋、改量被複合 FK 擋 —— **唯一不依賴 trigger 的形狀**。
- 前提:配貨粒度建模 + writer 大改 + Q3=A void/unvoid 的配貨生命週期 + 仍需 per-receipt
  聚合守門(配貨總量 ≤ receipt 量,又回到 trigger)。
- 評價:誠實列出:這是天花板最高的一層,但推翻已拍板的 shipment_items 形狀(F13)、成本數倍,
  且最後一哩仍要 trigger。以本案量級(月 100-300 單)不成比例。不推薦,留檔備查。

**E10|取消側守門改式(`增量 ≤ quantity − GREATEST(instock, shipped) − cancelled`)**
- 評價:只在 C9 不存在的世界才載重(正常態 GREATEST=instock,無行為差;損壞態保住 shipped 件)。
  F11 已拍「公式不減 shipped」;若 §10 Q1 選了 C9,此項零必要。不動。

---

## §5 失效矩陣(靜默失效 = ✗;會被擋/會浮現 = ✓;○ = 部分)

| 情境 | E1 C9 | E2 C6′ | E5 RPC 守門 | E8 監測 |
|---|---|---|---|---|
| break-glass 停用視窗內寫壞真相 | ○ 停用中不擋;**收尾 oracle 含四軸則整段回滾**(F4/F5),oracle 沒改則 ✗ 直到該品項下次事件才紅 | 同左(同一條件) | ✗(RPC 沒被呼叫就不存在) | ✓ 下次掃描 |
| owner 直寫真相表(trigger 通電) | ✓ 重算照觸發、CHECK 紅 | ○ 只有取消寫入那刻紅 | ✗ | ✓ |
| owner 直寫摘要表(捏造自洽數字) | ✗(CHECK 只驗被寫的值) | ✗ | ✗ | ✓ 唯一防線(oracle 對真相重算) |
| TRUNCATE receipts(F16:不觸發重算) | ✗ 當下;○ 該品項下次事件紅 | ✗ 當下 | ✗ | ✓ |
| 批次匯入語句序(同交易先出貨後補到貨) | ✗→誤擋(CHECK 不可 defer,fail-closed 紅;writer 契約規定「先 receipts 後 shipments」即消失,A4a 債② 同型) | 同左但更少觸發 | 由 RPC 自己排序,✓ | — |
| 併發:出貨 vs 刪到貨(兩交易) | ✓ 兩邊都走 helper 的 parent NKU ⇒ 序列化,後者紅(前提 P2;S2 已規定同 helper,plan v4 :220-226) | ✓ 同鎖 | ○ RPC 也得搶同一把鎖才成立 | — |
| 併發:取消 vs 刪到貨 | ✓ A8a2 步 8 鎖同一把 parent NKU(`20260805100000:367-370`)⇒ 序列化 | ✓ | — | — |
| migration 中途(S2 四 cut point) | ✓ 加欄 DEFAULT 0 ⇒ C9 對既有列恆真;中斷態零 writer(plan v4 §8) | ✓ 同理(c ≤ q 已由舊 C6 保證) | — | — |
| 未來新 writer 忘記守門 | ✓ **狀態層不認 writer** | ○ 只擋取消那刻 | ✗ 本情境定義即此 | ✓ |
| replica/logical apply(`session_replication_role`) | ✗ trigger 不觸發(A4a 誠實邊界 `20260803140000:127` 同型) | ✗ | ✗ | ✓ |
| 到貨合法更正(貨真的沒到、但已誤出貨) | 擋(fail-closed;合法出路 = 先作廢包裹 Q3=A → 改到貨 → 重出貨;或 break-glass) | 不擋(更正成功、損壞態留存) | 未來 RPC 可給好訊息 | — |

讀法:沒有任何一層無 ✗。差異在 ✗ 的形狀 —— E1 的 ✗ 集中在「owner 越權與 replica」
(全 repo 既有守門共用的同一天花板,`20260803140000:127` 明文),E2/E5 的 ✗ 落在
**通電中的合法路徑**(這是質的差別:同樣的攻擊面,E1 只剩天花板,E2/E5 連地板都有洞)。

---

## §6 三次錯誤的病理,與「為什麼本結論不是反射性反轉」

第三次分析(= plan v4 §0.1 第 4 列)把 `shipped ≤ instock` 移出摘要表的理由是
「receipts 一刪會讓**無關的**摘要列變非法、紅在『修正打錯的到貨登錄』這種合法操作上」。
前半句已被證偽(F1:重算是 per-item,被打紅的就是 shipped>instock 的那個品項)。
剩下的實質問題只有後半句:**「修正到貨」被 C9 擋,是誤擋還是正確的 fail-closed?**

分析:C9 只在「更正後 instock < shipped」時紅。那個狀態的語意是「我們寄給客人的貨,
帳上現在說它從來沒到過」—— 出貨紀錄與到貨紀錄**聯合矛盾**,單獨改一邊必有一邊是假帳。
而 Q3=A(F14)給了完整的合法走廊:作廢包裹(shipped 退量)→ 改到貨 → 重新出貨。
⇒ 這不是誤擋,是強迫兩本帳一起改的 fail-closed —— 與本 repo 對錢與帳的一貫姿勢一致
(A4a 直寫 received 被 P4A01 擋、值寫對也擋,`20260803140000:216-217`)。
真正付的代價是操作步數(先作廢再更正)與錯誤訊息品質,不是正確性。代價的量級取決於
「到貨更正在出貨後發生」的頻率 —— 未知(§9 U3),這是本結論最大的業務前提。

同時,不反轉的部分:第三次分析的 C6′ 方向、C7 不動、守門不減 shipped(F11 拍板)全部保留。
本輪只推翻「I1 不放摘要表」這一格,且理由不是「它的理由錯所以結論反過來」,而是
§5 矩陣:**v4 現案讓 I1 在本批零強制力、在出貨 RPC 上線後也只有單向強制
(receipts 刪改方向永遠沒人擋,直到取消那一刻才由 C6′ 兜底)**,而 C9 把兩個方向
都收進既有機制,新增成本一行。

---

## §7 推薦方案(分層組合;無單層答案)

承重:**E1(C9)**。S2 加欄同片加 `CONSTRAINT oiqs_shipped_le_instock CHECK
(shipped_quantity <= instock_quantity)`(命名循 oiqs_* 慣例;同型 `::bigint` 不需要 ——
單欄比較無相加溢位,A1 :121-122 的坑不適用)。
配套(每項有名有姓,不留無人承接的債):
1. **C6′ 照 v4 落地但改標冗餘**(A1 C1/C6 先例,F8):COMMENT 寫明「被 C7 ∧ C9 蘊含;
   保留理由 = A1 契約債字面完整 + break-glass 天花板下的第二層」。v4 驗收 28/29 需重設計:
   28 的情境(刪 receipts 後取消)會在**刪除語句**當場紅在 C9,到不了 C6′ ——
   C6′ 的獨立負測在通電路徑上**不可構造**(這正是它冗餘的機器證明,
   memory `feedback_unconstructible-negative-test-means-noop-guard` 的正用)。
2. **E5 照 v4 三機制交棒**(MP §5.2 項 2 DoD):出貨 RPC 仍要自己守 `增量 ≤ instock − shipped`
   —— 為了訊息與前緣拒絕,不是為了正確性;到貨更正片的 DoD 加「更正被 C9 擋時的
   引導訊息(先作廢包裹)」。
3. **E8 補洞**:S2 同片改 `docs/runbooks/a4a-summary-rollback.md` 與 `scripts/a4a-verify.sh`
   的漂移 oracle 為四軸(F5)。不改 = break-glass 對 shipped 真空(§3)。
4. **取消側零改動**:A8a2 守門、冪等格、允許集合全部不動(F11 拍板 + §2 蘊含)。
   唯一備忘:摘要「在場閘」(F6 :376-387)的 shipped 分支,掛在出貨 RPC 片 DoD,非本批。
5. **P4 單式紀律**:shipped 真相式(`deleted_at IS NULL AND shipped_at IS NOT NULL` 過濾)
   只在 A4a helper 出現一次,任何未來守門/驗證引用 helper 或逐字同式 + 字面錨釘住
   (F7 是反面教材:同軸兩式已經存在於 instock)。
6. **誠實天花板照抄 A4a :127**:owner、replica、TRUNCATE(F16)、DROP CONSTRAINT 在所有層之上;
   E8 是那個面的唯一偵測。不宣稱 C9 是無條件不變式 —— 它是「P1-P5 成立時的不變式」,
   前提逐條可驗、失效時 E8 會發現。

對 B2 plan v4 的具體差異(供 B 窗折入或反駁):
- §0.1 第 4 列理由作廢(row-level 事實),結論改 ⇒ C9 進 S2;
- §2 末「本批零強制力 + 三機制」段落縮小為「訊息層交棒」;驗收 33 的斷言照舊
  (shipped 恆 0)但註解改為「C9 已在、writer 未在」;
- §4 驗收 28/29 重寫為 C9 的正負對 + C6′ 冗餘性機器證明(§8 PR2);
- S2 估時 +5-10 分(一條 CHECK + oracle 四軸化 + 兩格驗收),仍在 45 分內或拆出 oracle 格。

---

## §8 可證偽預測(我錯了會觀察到什麼)

**PR1|C9 承重性/獨立判別力**(harness 格,拋棄庫):
fixture:quantity=3、receipts 到貨 3、建包裹掛 3 件、設 shipped_at。
步驟:owner `DELETE FROM order_item_procurement_receipts WHERE id = <其中一筆>`。
預測:該語句紅 `23514`,constraint = `oiqs_shipped_le_instock`,且紅的摘要列正是該品項。
突變:`ALTER TABLE ... DROP CONSTRAINT oiqs_shipped_le_instock` 後重放,必須**全綠**且摘要呈
`shipped=3 > instock=2`。若突變後仍有東西擋(C6′/C7/守門任何一條),則 C9 非承重,§2 蘊含圖錯。

**PR2|C6′ 冗餘性(代數層,一條 SQL 可跑)**:
`SELECT count(*) FROM generate_series(0,6) q, generate_series(0,6) i, generate_series(0,6) c,
generate_series(0,6) s WHERE s<=i AND i+c<=q AND c+s>q;` 預測 = 0。
非 0 ⇒ 「C7∧C9 蘊含 C6′」為假,C6′ 必須保留為承重件、§7 第 1 點作廢。

**PR3|取消側零改動的充分性(barrier 併發格)**:
T1 = `admin_cancel_order` 部分取消至守門上限;T2 = 刪一筆 receipts。用 dblink/兩 session +
advisory-lock barrier 對齊(memory `feedback_race-test-without-barrier-proves-nothing` 紀律),
兩種提交序各跑。預測:所有交錯的終態,`Σ order_cancellation_items ≤ quantity − Σ有效 shipment_items`
(真相式)恆成立 —— T2 先提交則 T1 重算後守門/CHECK 紅,T1 先提交則 T2 紅在 C9。
若存在一個交錯讓兩者都 COMMIT 且不等式破 ⇒ 「同一把 parent NKU 序列化」的前提(P2)在
shipped 軸失效,E1 不足、需回頭考慮 E4/E10。

**PR4|break-glass oracle 的洞是實的(BEGIN…ROLLBACK 模擬,零留痕)**:
拋棄庫:DISABLE 六支(四舊+二新)→ owner 刪 receipts 造出真相 shipped>instock → ENABLE →
跑**現行三軸 oracle**(runbook :60-71 原式)。預測:三軸 oracle 對 shipped 軸**通過**
(它看不到)⇒ 洞實證;換四軸版必 RAISE。若三軸版也 RAISE,則我對 oracle 覆蓋面的判讀錯、
§7 第 3 點降為 nice-to-have。

---

## §9 不確定的地方與所需實驗

- **U1(業務,最大)**:「出貨後才發現到貨登錄錯」的真實頻率與員工可接受的更正流程
  (先作廢包裹再改帳,多兩步)。無資料。**這決定 C9 的 fail-closed 代價是否可付** ——
  需要 Sean 用營運經驗答,不是實驗能答(§10 Q1 選項已含此取捨)。
- **U2**:F17 —— A8a2 是否真的已 apply 正式站,未親驗。實驗:Supabase MCP 唯讀查
  `supabase_migrations.schema_migrations` 有無 `20260805100000`。
- **U3**:C9 紅出來的錯誤在「未來出貨 RPC / 到貨更正 RPC」呼叫端的呈現形狀
  (23514 穿過 SECDEF RPC 的訊息與 SQLSTATE 保真度)。實驗:拋棄庫建最小 SECDEF 函式
  包一個違反 CHECK 的 upsert,觀察呼叫端收到什麼(唯讀庫外、零正式站寫入)。
- **U4**:同交易「先出貨語句後補到貨語句」的批次匯入是否真會出現(§5 誤擋列)。
  現況零 writer,無從觀察;寫進出貨 RPC 片的 writer 契約即可消滅,列為該片 DoD 措辭建議。
- **U5**:主樹 MP 與 worktree MP 的雙權威窗口(§1 末)。非實驗題,是合併紀律:B 窗
  merge 時以 v4 回寫版為準,主樹引用者(含本檔 F10)屆時失效。
- **U6**:B2 plan v4 尚未過 R3(F13),S2 的最終形狀可能再變。本分析以 v4 為靶,
  R3 若改動不變式集合,§7 差異清單需重對。

---

## §10 給 Sean 的決策題(prose,B 窗收攏後一次問)

```
Q1:出貨不變式 shipped ≤ instock 放哪裡?
A. 摘要表 CHECK(C9)+ 出貨 RPC 訊息層 + oracle 四軸(本檔推薦;
   代價 = 出貨後要改到貨紀錄,得先作廢包裹再改,多兩步但帳永遠對)
B. 照 B2 plan v4 現案:只放未來出貨 RPC;本批零強制力,
   到貨刪改方向永遠靠 C6′ 在取消當下兜底(代價 = 帳可長期呈現
   「已出貨 > 已到貨」而無人擋,員工看到怪數字才會發現)
C. A + 取消側守門同時改 GREATEST 形(§4 E10;多一層但與拍板
   「公式不減 shipped」字面衝突,需重拍)
推薦:A

Q2:C6′(cancelled + shipped ≤ quantity)在 Q1=A 之下如何處置?
A. 照 v4 落地、標記冗餘(A1 C1/C6 先例;break-glass 天花板下第二層)
B. 不落地(嚴格 YAGNI;A1 契約債字面改由 C9 + 註解清償)
推薦:A(改動 v4 最小、契約債字面完整)
```

🏁 **2026-08-05 Sean 拍板:Q1=A、Q2=A**(兩題照推薦;落檔 memory
`project_m4b-b2-shipments-db-decisions`,已通知 B 窗 `B-107-A`)。

—— 完 ——
