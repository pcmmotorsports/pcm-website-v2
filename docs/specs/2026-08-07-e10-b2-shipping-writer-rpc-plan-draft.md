# B2 出貨 writer RPC 片 —— plan **v4.1**(2026-08-07,定稿候選)

> 🔴 **v4.1 = 折入 confirmation 輪(fresh fable、FAIL 1 = 收斂)**:唯一 must-fix 見 **§11**。
> 🔴 **估時全域失效**:**`W6a` 完成前,本 plan 的所有估時都不作數**(R3 A2 + D4;C-2 要求複寫在此)。
> 🔴 **v4.1 對 confirmation 的 n-2 有一處<u>實測推翻</u>**(§11 末),證據 = 拋棄庫實跑輸出。
> 🔴 **v4 = 折入 R3(opus 四角度、FAIL 12)+ 乙案合流(W6a 早期探針)**。
> R3 全文 = `docs/reviews/2026-08-07-writer-rpc-plan-r3-findings.md`;逐條折入帳見 **§9**。
> 🔴 **v4 對 R3 有兩處<u>更正</u>**(D1 的修法、D3 的形狀歸屬),證據在 §9,**不是打折扣、是換修法**。
> 🔴 **v3.2 = DAG 重對(§2a 最終片序表;主視窗 `B-178-A` ④)**,折入三條約束:
> `W3c < W6`、`W0b < W2`、五支 RPC 對 W1 ACL 斷言數的連動。
> 🔴 **v3.1 = 回填 Q7=五支 / Q8=A(`B-177-A`)+ 把 W6 的三組 barrier <u>逐條展開</u>(§6a)**。
> 🔴 **v3 = 折入 R2(fresh fable)的 M1-M4 + N1-N4 + Q6=A 裁定**。逐條落點見 §8。
> (v2 = 折入關卡1 的 F1-F10 + Q5 結案,落點見 §7;R2 已判 **F1-F6 全數 FOLDED**。)
> 🔴🔴 **W6 是本片的心臟**(主視窗 `B-169-A` ②:寫進抬頭)—— 它是 B2-S2b 欠下的併發證據**唯一還款處**,
> **不得因進度壓力被砍**。

> **狀態:草稿,未批准,未施工。** 派工 = 主視窗 `B-164-A` ② / `B-168-A` ④:**只偵察 + 寫 plan**。
> **本文件不含任何會改 DB 或 code 的動作。**
> 流程:我寫草稿 → 主視窗審 → 連同 apply 排程一起給 Sean 裁。
>
> 所有事實皆附 `檔案:行號`,由本輪偵察與我自己實查取得;**查無就寫查無**,不推測。

---

## §0 這一片是什麼

**一句話**:今天 `shipments` / `shipment_items` **在應用層完全沒有 writer** —— 建包裹、掛品項、出貨
全部沒有入口。這一片要造出那個入口,並把 B2-S2b 移交過來的**併發證據**在真路徑上做出來。

### 0.1 🔴 今天的現況(實查,非推理)

| 事實 | 出處 |
|---|---|
| `anon` / `authenticated` 對兩張表**零權限**;`service_role` **只有 SELECT** | `20260805170000_…s1a1_shipments.sql:274,277`、`20260805170200_…s1b_shipment_items.sql:253-254` |
| 兩張表 **RLS ENABLE、zero-policy**(刻意不 FORCE ⇒ **table owner 仍可直寫**) | `…s1a1_shipments.sql:268`、同檔 `:15-21` 的 COMMENT |
| `apps/admin/src` 與 `packages/` **零命中** `shipments` / `shipment_items` 寫入路徑 | 偵察 `grep -rln`,唯一命中是 `.next` 產物與 `packages/domain/src/order/types.ts` 的 JSDoc |
| `hct_status` / `hct_request_id` / `hct_raw_response` **今日無任何寫入路徑** | 同上 grep 查無 |
| S1a-1 檔頭自陳:「本片交付後**零『應用』writer**:service_role 只有 SELECT ⇒ 無任何 INSERT 入口」 | `…s1a1_shipments.sql:14-17` |

⇒ **這片是「從零造 writer」,不是「改既有 writer」。** 這決定了它的風險形狀:
沒有既有行為要保住,但**所有守門第一次被真正的應用路徑打**。

### 0.2 權威範圍來源(**不是我發明的**)

`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:598-624` §5.2 第 2 批工作項 2
「出貨 owner RPC」**早就有一份五條 DoD**:

1. 🏁 **`shipped` 強制點已定案、該條 DoD 已結清**(Sean 2026-08-05 拍 Q1=A / Q2=A)。
   **終案是三段**:摘要表 CHECK `oiqs_shipped_le_instock`(C9)**承重** + **出貨 RPC 訊息層** +
   **break-glass oracle 四軸**;C6′ 照落地並標冗餘;**可取消量公式不減 shipped**。
   🔴 該處逐字:「**下方『尚未定案 / 重新開放 / 必須重新分析』的字面自 2026-08-05 起全部失效,不得據以施工。**」
   ⇒ 那些刪除線文字與「兩案至今沒有被正確比較過」**不得引用**。(出處:master plan `:600-606`)
2. 🔴 **可取消量守門公式** —— B2 批裁「現在不做」,理由逐字是「本批 `shipped` **恆為 0**、生產環境走不到」。
   **那個前提現在不成立了**(B2-S2b 已 apply,`shipped` 是被維護的第四軸)。
   而原文逐字說:「**本片本來就要動取消線鄰接面、本來就要跑關卡2 ⇒ 在這裡做是順路。**」
   ⇒ **這件事落在本片**,見 §1 的 Q5;且原文另有前置:「**本片開工前先取得主視窗另委的獨立分析結論(`B-31-A` ②)**」。
3. **三組併發 barrier 負測**(2×unvoid / shipment INSERT×unvoid / cancel×unvoid)+ **冪等重放 oracle** 本片必須補齊;
4. 開工先跑 `scripts/a1-verify.sh`;
5. `shipment_reference` 是 `order_shipped` outbox 去重鍵候選。

🔴 **這份 DoD 早於 B2-S2b 的交棒,而且更嚴**(它要三組 barrier,S2b 只交棒了一組)。
⇒ **本片的範圍 = 這五條 ∪ S2b 的交棒**,不是二選一。

### 0.3 B2-S2b 移交過來的義務(逐條,附出處)

| 交棒 | 內容 | 出處 |
|---|---|---|
| **1** | RPC 自己守 `增量 ≤ instock − shipped`(**為訊息與前緣拒絕,不是正確性**);多品項同交易 `ORDER BY order_item_id` + `40P01` 重試 | S2b plan §9 交棒 1 |
| **10** | 🔴 **一句 `UPDATE shipments … WHERE <多列>`(批次出貨)會逐列發火,跨 shipment 的取鎖順序 = 該 UPDATE 的列序、無排序保證** ⇒ 兩句併發即可能真 `40P01`。主視窗 `B-159-A` 裁定**併進本片、不拆** | S2b plan §9 交棒 10 |
| **項19 重新定性** | S2b 的 barrier 只是**編排可行性證明**(owner 直寫模擬),**不是併發證據**;真併發證據**等 writer RPC 存在時在真路徑上做** | S2b plan §4.19 ⑥ / §8 |
| 2 | 被 C9 擋時的**引導訊息**:先作廢包裹 → 改到貨 → 重新出貨 | S2b plan §9 交棒 2 |
| 6 | A8a2 多品項取消的 `order_items` 取鎖順序**未驗** ⇒ 與本片出貨重算仍可能 `40P01` | S2b plan §9 交棒 6 |
| 9 | 停寫涵蓋面:`admin_cancel_order` 對 service_role 有 EXECUTE、經 A4a trigger 寫得到摘要表 | S2b plan §9 交棒 9 |

---

## §1 🔴 **五個**要 Sean / 主視窗裁的題(**開工前必須有答案**)

我把選項寫成互斥、可執行的形狀;**推薦排最前**。

### Q1:RPC 的慣例照哪一支?**三支既有 admin RPC 的慣例互相不一致**(實查)

| | A5a `admin_upsert_item_procurement` | A8a1/A8a2 `admin_cancel_order` |
|---|---|---|
| `search_path` | `public, pg_temp`(`…a5a…:122-123`) | `''` 空字串(`…a8a1…` 該函式屬性) |
| `lock_timeout` | 函式屬性**無**,靠外層 `SET LOCAL`(`…a5a…:103-104`) | A8a2 有函式屬性 `SET lock_timeout='5s'`(`…a8a2…:92`) |
| 回傳 | `text` 固定碼(17 個) | `jsonb` |
| 冪等 | **upsert 鍵 + 全欄 `IS NOT DISTINCT FROM`** → `NO_CHANGE`;`p_request_id` 只進稽核 | **顯式 `p_idempotency_key uuid` + `payload_hash`(sha256)+ 產物集不變式重驗** |
| 業務拒絕 | 回固定碼(可分辨) | 回**單一通用訊息**,不洩存在性/狀態 |

```
Q1:出貨 RPC 照哪一套?
A: A|B|C

A. 🏁 **已裁定 = 照 A8a1/A8a2**(主視窗 `B-169-A`)—— `search_path=''`、函式屬性帶 `lock_timeout`、
   顯式 `p_idempotency_key` + payload_hash、業務拒絕不洩狀態。理由:出貨**不可逆**,at-most-once 要顯式鍵;
   三支不一致中取最嚴。
   🔴 **C2 裁定(R3 角度3;主視窗 `B-179-A` ④)——「業務拒絕不洩狀態」這句<u>在本片不適用</u>**:
   本片五支 RPC 是**員工面內部工具**,A8a1 的「不洩存在性」條款是為**顧客面**寫的。
   它與 Q8=A 攔截轉譯、交棒 2 的引導訊息**直接矛盾**(引導必然要講到貨/出貨狀態)。
   ⇒ **裁定 = 引導訊息優先**。本片業務拒絕**必須**回可操作的人話(哪一箱、哪個品項、差多少),
   不得退回單一通用訊息。**W3/W3c/W8 的訊息設計照此**;不洩存在性只在顧客面 RPC 續用。
   🔴🔴 **v1 的理由我引反了**(關卡1 F4):「**重試必換鍵**」是 **TapPay 那種「對方的鍵恆久消耗」下的
   <u>呼叫端</u>對策**;**自家的顯式冪等要的是「重試必<u>同</u>鍵」** —— 同鍵才觸發重放,換鍵等於每次重試
   **新建一箱**。方向完全相反,v1 拿它當推薦理由是錯的。
   ⇒ **三個情境的行為在此寫死**(W2 照此實作、W8 呼叫端契約照此):
   | 情境 | 必須的行為 |
   |---|---|
   | 重試**同鍵、同 payload** | **重放**:回上次的產物,零新寫入 |
   | **同鍵、異 payload** | `payload_hash` 不符 ⇒ **RAISE**(不得靜默採用新 payload) |
   | 部分成功後重試同鍵 | **產物集不變式重驗** ⇒ 不一致即 **RAISE**(照 A8a1 樣板) |
B. **照 A5a** —— `text` 固定碼 + upsert 鍵冪等。理由:訊息可分辨、前端好做引導(交棒 2 要引導訊息)。
C. **混合** —— 冪等照 A8a1(顯式鍵),回傳照 A5a(可分辨碼,為了交棒 2 的引導訊息)。
```
🔴 **這題不選會怎樣**:三種慣例並存,下一個人不知道照哪個;而且**冪等機制選錯是不可逆的**
(出貨動作本身不冪等 —— 貨寄出去了)。

### Q2:X8 的三個已知缺口,本片補到哪裡?

S1a-2 檔內**明文誠實邊界**(`…s1a2_shipments_guards.sql:112-130`):X8 只凍結
`recipient_snapshot` / `carrier_code` / `carrier_note` **三欄**,
**不凍結** `tracking_number` 與 `hct_*` 三欄,**也不擋** `submitted → draft` 這種**狀態倒轉**。
該處逐字寫「已列為給 Sean 的決策題」+「不變式**交棒給出貨 writer RPC**」。

```
Q2:X8 沒守住的那幾件,本片做到哪?
A: A|B|C

A. **RPC 層守、DB 層不動**(推薦)—— RPC 是唯一寫入口 ⇒ 在 RPC 裡擋狀態倒轉;
   DB 的 X8 維持現狀。理由:改 trigger = 動既有守門,風險與片體積都上升,而 RPC 一旦是唯一入口就夠。
   🔴 代價:**owner 直寫仍繞得過**(兩表未 FORCE RLS)—— 這條要寫進誠實邊界,不能宣稱「擋住了」。
B. **DB 層補 trigger** —— 把 `tracking_number` / `hct_*` 的合法轉移寫成 trigger。
   最強,但動既有守門面 ⇒ 鐵則 12 全套 + 片體積大增。
🏁 **已裁定 = A**(主視窗 `B-169-A`),另附**兩條硬要求**:
① 「owner 直寫繞得過」**寫進每一個守門的宣稱裡**;
② **DB 層凍結(`tracking_number` / `hct_*` + 狀態倒轉)立為債,綁 HCT 那片(Q4)一起評,不無限期。**
🔴 **F8**:三個缺口要**逐項標**清楚哪個是 by-design 可改、哪個是該由 RPC 守;債條目的落點要**寫死**
(= 綁 Q4 那片的 plan §9 交棒),不寫「未來某片」。
C. **本片不處理**,原樣再交棒下去。
```

### Q3:**批次出貨(一句 UPDATE 改多列)本片做不做?**

交棒 10 被裁定「併進本片、不拆」,但**批次出貨的 UI/需求今天不存在**(偵察查無)。

```
Q3:交棒 10 的批次鎖序面,本片怎麼處理?
A: A|B|C

A. **RPC 契約上禁止批次**(推薦)—— RPC 一次只處理一個 `shipment_id`,
   並在檔內寫死「**禁止一句 UPDATE 改多列 shipments**」+ 一格守門證明 RPC 內沒有那種語句。
   ⇒ 交棒 10 的風險面**在應用路徑上**被契約消滅。
   🔴 **F7 更正 v1 的過度宣稱**:v1 寫「風險面被消滅」是**太滿**了 ——
   **owner / break-glass 走多列 UPDATE 仍然逐列亂序**。照 Q2 的樣式標註:**契約只管應用路徑**。
B. **支援批次並證明它安全** —— 要做全域 `ORDER BY` 取列 + barrier 負測。片體積大增。
C. 本片只做單筆,交棒 10 再往後傳(🔴 但主視窗已裁「不拆」,選這個等於推翻該裁定)。
```

### Q5 🏁 **已結案:公式不改、W3b 撤銷**(主視窗 `B-170-A`,獨立分析 fable fresh context)

結論與**理由**(理由比結論重要 —— 舊理由已失效,不得再引用):
- 🔴 **`instock` 已經涵蓋 `shipped`**:已出貨必有到貨,而 C9(`shipped ≤ instock`)把它鎖死
  ⇒ 現行 `quantity − instock − cancelled` 在 trigger 通電的**一切可達狀態**下已排除已出貨件。
  顯式再減 `shipped` = **重複扣**(例:訂 10 / 到貨 6 / 出貨 4 ⇒ 可取消量會從 4 變成 0)。
- 與 master plan `:600-602` 的終案(Sean 2026-08-05 拍「公式**不減** shipped」)**字面一致**
  ⇒ **這是確認舊拍板,不是新拍板**,不回 Sean。
- 全文:`docs/reviews/2026-08-07-q5-cancellable-vs-shipped-analysis.md`。
- 🔴 **舊理由「`shipped` 恆為 0」已失效、永久禁用** —— 正確理由是「**instock 已涵蓋**」。
- **代價落在訊息層**:拒絕訊息不會指路「去退貨」⇒ 歸入本片 writer RPC 的**訊息層射程**(見 W3)。

⇒ **W3b 撤銷**,不再是條件片。

### Q7 🔴 M2(R2 must-fix):**RPC 要幾支?**(v2 §1b 自陳五動作,W1 卻只寫單數簽章)

連動面:**鍵表的 `action` CHECK / W7c 的 REVOKE 清單支數 / W1 的 ACL 斷言數**。

```
Q7:出貨 writer 做成幾支函式?
A: A|B

A. **五支**(我推薦)—— 建箱 / 掛品項 / 出貨 / 作廢 / unvoid 各一支。理由:
   ①**體積** —— a8a2 **單一動作就 640 行**,五動作塞一支會失控、審不動;
   ②**守門差異大** —— 建箱要產號重試、出貨要 C9 前緣、unvoid 要 M4 守門,合併只會變成大分支;
   ③ 缺點(REVOKE 清單五行、易漏)**用守門解掉**:W7c 加一格斷言
     「**被 GRANT EXECUTE 的出貨 RPC 集合 = 凍結的那五支**」⇒ 漏一行會紅。
B. **一支 + `p_action`** —— ACL 一行、REVOKE 一行,但五套守門擠一支,與 a8a2 的體積前例相衝。
```
🏁 **已裁定 = A(五支)**(主視窗 `B-177-A`)。兩個理由被採納,且
「REVOKE 漏行的風險由 W7c『GRANT 集合 = 凍結五支』守門解掉」被認定為**機制優先律的正確用法**。
支數與 W0b 新表**一起進 apply 排程的白話簡報給 Sean 過目**(非問題、是透明)。

### Q4:HCT 送單是否同片?(🔴 **F10**:v1 引的 `:619` 錨錯,正確錨 = grep `新竹 API 失敗/重送安全` 那一行)

`hct_*` 三欄今天無任何 writer;`docs/reference/hct-logistics-api-reference.md` 只是 **API 參考**,
**查無 adapter 程式碼**。master plan `:619` 把「新竹 API 失敗/重送安全」列為**§5.2 工作項 5**(另一項)。

```
Q4:HCT 送單放這片還是另一片?
A: A|B

A. **另一片**(推薦)—— 本片只做 DB 層的出貨 writer(建箱/掛品項/出貨),
   `hct_*` 欄由本片**允許寫入但不主動送單**。理由:master plan 本來就把它列成獨立工作項 5;
   混在一起會讓本片同時碰 DB 守門 + 外部 API 失敗語意,體積與風險都爆。
B. 同片做完。
```

---

## §1b 🔴 F3:冪等鍵**沒有落腳處** —— 我的推薦與它的代價

**事實**(實查):
- A8a1 樣板把鍵存在**產物表**:`order_cancellations.idempotency_key uuid NOT NULL`
  + `UNIQUE (order_id, idempotency_key)`(`20260730130000:86,118-119`)。
- 🔴 **`shipments` 建表<u>沒有</u> `idempotency_key` 欄**(實查)⇒ 建箱 INSERT 的重放偵測**沒有查表面**。
- 🔴 **`admin_audit_log.request_id` 不能當去重面**:它 `NOT NULL` 但**沒有任何 UNIQUE 約束**
  (`20260712210000:51,57` —— 只有 nonempty CHECK),而且它的語意是**貫穿多列的 correlation id**
  (欄註解逐字)⇒ 硬加唯一索引會與它的語意衝突。

**我的推薦 = 新表**,理由是**取消線的樣板套不過來**:
> 取消線是「**一個產物、一個動作**」⇒ 鍵放產物列上剛好。
> 🔴 **本片是「<u>同一列</u> `shipments` 上有五個動作」**(建箱 / 掛品項 / 出貨 / 作廢 / unvoid)
> ⇒ **單一 `idempotency_key` 欄放不下五個動作的鍵。** 這一點 v1 與關卡1 都沒點破。

⇒ 建議新表(名稱待定),鍵 = `(action, idempotency_key)` 全域唯一,另存 `shipment_id`(建箱時**先無**、
產出後回填)、`payload_hash`、產物集快照 —— 後兩者正是 A8a1 樣板要的重放證據。

```
Q6:冪等鍵落腳處(F3 三選一)
A: A|B|C

A. **新表**(我推薦)—— 唯一能承載「五個動作 × 各自的鍵」的形狀;可存 payload_hash 與產物集快照。
   🔴 代價:**新 migration ⇒ 鐵則 12 ⇒ 片界要加一片(W0b)且要過 Sean**。
B. `shipments` 加欄 —— 貼近取消線樣板,但**只夠建箱一個動作**,其餘四個動作無處可放。
C. 用 `admin_audit_log.request_id` —— 🔴 **不可行**:無 UNIQUE、語意是 correlation id。列出來是為了說明為何排除。
```
🔴 **A 涉及 migration ⇒ 依 F3 的指示由主視窗帶去 Sean。** 在有答案之前 **W2 不能開工**(它就是冪等層)。

## §1c 🏁 Q6=A **新表**已裁定(主視窗 `B-174-A`)—— 設計四要素與三個必答的面

**前提**(裁定時附的):這張表是**純機械帳表(防重放)**、**無業務語意**。
**片界**:🔴 **W0b 排在 W2 之前**(N1)—— W2 就是冪等層,沒有落腳表無從實作。

| 四要素 | 內容 |
|---|---|
| 鍵 | `(action, idempotency_key)` **全域唯一** |
| 關聯 | `shipment_id`(**建箱時先無、產出後回填**) |
| 重放證據 | `payload_hash`(sha256,照 A8a1 樣板) |
| 產物快照 | 產物集,供「部分成功重試」做不變式重驗。🔴 **只含 `shipments`/`shipment_items` 的不可變事實,禁含任何重算衍生欄**(R3 **B2**,C-1 回填) |

**🔴 三個必須先寫死的面**(`B-174-A` 點名 R2 會攻):
1. **清理策略 = 永不清理**(N2)。🔴 **冪等鍵是稽核證據,不是快取** —— 任何 TTL / 清理排程都會把
   **at-most-once 保證優化掉**(鍵過期後同鍵重試 = 新建一箱)。表註解逐字寫死「**永存、禁止 TTL 或清理排程**」,harness 釘一格。
2. **hash 比對時機** = **取得鍵列之後、任何寫入之前**;不符立即 RAISE,不得先寫再回滾。
3. **同鍵並發回填競態**:第二個同鍵請求撞唯一鍵 ⇒ **那是正常路、要轉重放**(見 §1d),不是錯誤。
   `shipment_id` 的回填必須**在同一交易內**完成,否則會有「鍵列在、`shipment_id` 仍 NULL」的中間態被讀到。
4. 🔴 **鍵列 INSERT 必須在產號重試迴圈<u>之外</u>**(R3 **C1**,C-1 回填)——
   放在迴圈內,第二圈會撞到自己上一圈寫的鍵列 ⇒ 誤判成併發、轉重放 ⇒ 回傳 `shipment_id` NULL 的半成品。
   併:**重放路徑對 `shipment_id IS NULL` 必須 fail-closed `RAISE`**,不得回半成品。
5. 🔴 **快照禁含重算衍生欄**(R3 **B2**,同上)——災難日 forward 後,含衍生欄的快照會讓
   **合法的同鍵重試**被不變式重驗判成不一致 ⇒ `RAISE` **永久擋死唯一一條合法重試路**(A7b D8 同型)。
   機制落點見 §1c-1 的 `CHECK … snapshot_no_derived`,**不是只靠這條散文**。

## §1c-1 🔴 **W0b 表定義草稿**(主視窗 `B-181-A` ③ 指派,供 Sean 白話簡報)

> 🔴 **這是草稿、不是 migration**:本 plan 不產 `.sql` 檔、不 apply。
> 欄位/慣例照 `supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql` 的樣板(親讀,非憑記憶)。
> 🔴 **設計主張**:R3 的 **B2 / C3 / D2** 三條在 v4 §9 是「散文要求」——
> 這裡把它們**做成表自己帶的機制**(CHECK / trigger / 凍結格),照機制優先律,不靠註解與人記得。

### 白話(給 Sean 看的一段)

出貨的每個動作(建箱、掛品項、出貨、作廢、復原)都會帶一把**收據號碼**。
這張新表就是**收據存根簿**:記下「這把號碼我處理過了、結果是這個」。
網路斷線或員工手滑按兩次,系統拿同一把號碼來,就**直接回上次的結果、不會重做一次**。
**存根永遠不清**——清掉的那天,同一把號碼會被當成新的,就會**真的多出一箱貨**。

### 表(草稿 DDL)

```sql
CREATE TABLE public.pcm_b2_shipping_idempotency (
  action           text NOT NULL,
  idempotency_key  text NOT NULL,
  payload_hash     text NOT NULL,
  shipment_id      uuid NULL,
  result_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pcm_b2_shipping_idem_pk
    PRIMARY KEY (action, idempotency_key),

  CONSTRAINT pcm_b2_shipping_idem_action_known
    CHECK (action IN ('create_shipment','add_items','ship','void','unvoid')),

  CONSTRAINT pcm_b2_shipping_idem_key_not_blank
    CHECK (NOT public.pcm_b2_is_blank(idempotency_key)
           AND length(idempotency_key) <= 200),

  CONSTRAINT pcm_b2_shipping_idem_hash_sha256
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT pcm_b2_shipping_idem_snapshot_no_derived
    CHECK (NOT (result_snapshot ?| ARRAY[
      'shipped_quantity','instock_quantity','cancelled_quantity',
      'quantity','procured_quantity'
    ]))
);
```

| 要素(§1c) | 落在哪 |
|---|---|
| 鍵 `(action, idempotency_key)` 全域唯一 | `pcm_b2_shipping_idem_pk` ⇒ **§1d 分派就認這個 conname** |
| 關聯 `shipment_id` 先無後回填 | 可為 NULL 的欄 + 同交易回填(§1c 面 3) |
| 重放證據 `payload_hash` | sha256 格式 CHECK,照 A8a1 樣板 |
| 產物快照 | `result_snapshot` + **禁衍生欄 CHECK** |

### 🔴 三條 R3 findings 在這裡變成機制

1. **B2(快照禁含重算衍生欄)⇒ `pcm_b2_shipping_idem_snapshot_no_derived`。**
   R3 只要求「快照只含不可變事實」。**寫成註解的話,第一個趕工的人就會塞 `shipped_quantity` 進去**,
   而後果要到災難日 forward 之後才爆(同鍵合法重試被不變式重驗判不一致 ⇒ `RAISE` 永久擋死)。
   ⇒ 做成 CHECK,塞進去**當場 `23514`**。
   🔴 **誠實邊界**:黑名單只擋**這五個鍵名**。改名或巢狀塞(`{"a":{"shipped_quantity":1}}`)**擋不到**
   (`?|` 只看 top-level key)。它擋的是「順手塞」,不是「刻意繞」——**不得被讀成後者**。
2. **D2(永不清理要效果斷言)⇒ 兩發具名 trigger,不是註解:**
   ```sql
   CREATE FUNCTION public.pcm_b2_shipping_idem_no_purge() RETURNS trigger
   LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
   BEGIN
     RAISE EXCEPTION '出貨冪等存根禁止刪除或清空:冪等鍵是稽核證據、不是快取'
       USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_no_purge';
   END $$;

   CREATE TRIGGER pcm_b2_shipping_idem_block_delete
     BEFORE DELETE ON public.pcm_b2_shipping_idempotency
     FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipping_idem_no_purge();

   CREATE TRIGGER pcm_b2_shipping_idem_block_truncate
     BEFORE TRUNCATE ON public.pcm_b2_shipping_idempotency
     FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_b2_shipping_idem_no_purge();
   ```
   🔴 **`TRUNCATE` 那發非有不可**:`DELETE` trigger **不會**被 `TRUNCATE` 觸發。
   🏁 **這條已實測、不再是假設**(2026-08-07 拋棄庫 PG 17.10,埠 54367,跑完自拆、工作樹零留痕):
   | 情境 | 實測結果 |
   |---|---|
   | 只掛 `BEFORE DELETE`,跑 `DELETE` | `ERROR: BLOCKED` ✅ 擋住 |
   | 只掛 `BEFORE DELETE`,跑 `TRUNCATE` | **無錯誤、剩餘列數 = 0** 🔴 **清光了** |
   | 補掛 `BEFORE TRUNCATE` 後再跑 `TRUNCATE` | `ERROR: BLOCKED`、剩餘列數 = 2 ✅ **靶會翻面** |
   ⇒ 第二列證明「只掛 DELETE 擋不住」,第三列證明 **D2 的突變靶真的有判別力**(拿掉那發會由紅轉綠)。
   只掛 `DELETE` 就是「防護被命名成超出它實際能力的樣子」(memory
   `feedback_control-named-beyond-its-actual-power`)——一句 `TRUNCATE` 照樣清光。
   🔴 **突變靶(D2 要的)**:拿掉 `BEFORE TRUNCATE` 那發 ⇒ 負測的 `TRUNCATE` 必須**由紅轉綠**。
   兩發共用同一個函式,所以**不能**用「函式在不在」當斷言——那對「少掛一發 trigger」全盲。
   🔴 **誠實邊界**:`DROP TABLE` 與 owner 的 `ALTER TABLE … DISABLE TRIGGER` 都**擋不住**。
   這張表和 `shipments` 一樣,DB 層擋不住 owner(S1a-1 檔頭已立此誠實邊界)。
3. **C3(W0b 的守門函式不在五支凍結集合)⇒ W0b 自帶凍結格:**
   `pcm_b2_shipping_idem_no_purge` 的 `proname / prosecdef / proconfig` + **兩發 trigger 各自的 `tgtype`**
   進 W0b 的結構 oracle。🔴 **`tgtype` 必須逐發量**:它是 `BEFORE DELETE ROW` 與
   `BEFORE TRUNCATE STATEMENT` 的唯一判別處,只數「trigger 數 = 2」對「兩發都掛成 DELETE」全盲。

### ACL / RLS

```sql
REVOKE ALL ON TABLE public.pcm_b2_shipping_idempotency FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ROW LEVEL SECURITY;
```

🔴 **service_role 也不給** —— 五支 RPC 是 `SECURITY DEFINER`、以 owner 身分寫這張表,
應用連線**沒有任何理由**直接碰它。給了就等於留一條繞過 RPC 的寫入路。
🔴 **零 policy 的 RLS 是縱深防禦、不是主鎖**;主鎖是 ACL。
且 **owner 不受兩者限制**(不 FORCE)——與 S1a-1 同一條誠實邊界,**不得讀成「沒有東西寫得進去」**。

### 🔴 三個我沒有自己拍的題(進 Sean 白話簡報或主視窗裁)

| 題 | 選項 | 我的推薦 |
|---|---|---|
| **W-a 表名** | 🏁 **已定 = `pcm_b2_shipping_idempotency`**(主視窗 `B-183-A` ②:自取、照 repo `pcm_b2_*` 族)。理由更正:它**不是業務表**、是機械帳表,跟著 `pcm_b2_*` 族比跟著 `shipments` 對 | — |
| **W-b `shipment_id` 要不要 FK** | 🏁 **已定 = 不加**(主視窗 `B-183-A` ②核可)。理由:FK 會在寫鍵列時對 `shipments` 取 `KEY SHARE`,而 §6a 組② 的判別力論證正建立在「`KEY SHARE` 不與 `NKU` 衝突」上 ⇒ 加 FK 等於**在 barrier 的證明面上多一個變數**。🔴 **主視窗補的前提(必須寫進表註解)**:`shipments` **無硬刪路徑**(soft delete only)⇒ 孤兒鍵不可達;**未來若出現硬刪,本裁定同步重估** | — |
| **W-c `action` 的五個字面** | 見上 CHECK | 🔴 **卡在 Q7 五支的最終函式名** —— 兩處字面必須同源,現在是我暫擬的。W1 定名後**同一 commit** 回填 |

## §1d 🔴 M1(R2 must-fix):**兩個 UNIQUE 都丟 `23505`,不分派就是災難**

| 撞到誰 | 意義 | 正解 |
|---|---|---|
| `shipments_reference_unique` | 產號撞號 | **重產號、重試** |
| 鍵表 `(action, idempotency_key)` | **同鍵併發的第二個請求** | **轉重放** |

🔴 **不按 constraint name 分派 ⇒ 併發被誤判成撞號 ⇒ 重產號 ⇒ 新建一箱** = **F4 要防的那場災難**。

**寫死的做法**(兩個前例都在本 repo,已實查):
- 分派用 `GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;` 再 **`IS DISTINCT FROM`**,**不得用 `<>`**
  —— `CONSTRAINT_NAME` 為 NULL 時 `<>` 會靜默吞掉(A5a `20260803160000:365-368` 逐字有這條註解,關卡1 R1-15 的前科)。
- **產號重試上界 = 5**,照 N3b(`20260730120100:12` 逐字「包在**上限 5 次**的重試迴圈裡」;
  `:25` 另有「為什麼重試迴圈在這一層、不在 helper 裡」的論證,與 master plan「**重試在本層**」一致)。
- **耗盡要有自己的錯誤碼**,不得靜默回一般失敗;碼值在 W0 寫死。

## §1e 🔴 M3 / M4(R2 must-fix):C9 的**兩條**未設計路徑

**M3 併發下修 instock ⇒ 前緣檢查白做**:前緣檢查之後、寫入之前,若 A5a 路徑把 `instock` 下修,
S2b 的重算 trigger 會觸 C9 ⇒ **raw `23514 / oiqs_shipped_le_instock` 直噴員工**
(Q1=A 樣板**沒有全函式 handler**)。
```
Q8:M3 怎麼處理?
A: A|B

A. **設計 23514 攔截轉譯**(推薦)—— 攔到該 conname 轉人話 + 交棒 2 的引導訊息
   (先作廢包裹 → 改到貨 → 重新出貨)。理由:master plan 的「訊息層」是**第二腿**,要的就是人話。
B. **證明這條路不可達**(附證據片)。🔴 本線已有前例:「構造不出負測 = 先懷疑守門是 no-op」
   ⇒ 要**真的證**,不是宣稱。
```
🏁 **已裁定 = A(攔截轉譯)**(主視窗 `B-177-A`)。理由逐字:B 案「證明不可達」**正踩本線自己引的
「構造不出負測 = 先懷疑 no-op」陷阱**,且 master plan 訊息層的第二腿要的就是人話。
**轉譯格式對齊交棒 2 的引導訊息**(先作廢包裹 → 改到貨 → 重新出貨)。

**M4 unvoid 的<u>順序</u>路徑撞 C9**(v2 的 W3c **只寫了併發 barrier**,順序路徑一字未提):
作廢退量 → 採購改量下修 `instock` → **unvoid 回加 shipped** ⇒ `shipped > instock` 撞 C9。
⇒ **W3c 必須有 unvoid 的前緣守門 + 引導訊息**,不能只靠 C9 擋(那會紅在 unvoid 這一筆、訊息不指路)。

## §2 片界(草稿;每片 15-45 分鐘,鐵則 4)

> 🔴 **實際片數與順序取決於 Q1-Q5 的答案**,以下是「Q1=A / Q2=A / Q3=A / Q4=A / Q5=C」那組答案下的切法
> (Q5=C ⇒ W3b 不存在;Q5=A 才有 W3b,而它還卡在 `B-31-A` ② 的獨立分析結論)。

| 片 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|
| ~~**W0**~~ | 🔴 **已降級併入 W1**(R2 N4)—— 本列僅存內容說明、**不是獨立片**,片序以 §2a 為準。原文:`shipment_reference` 產號 + 撞號重試(關卡1 **F2**;v1 零設計)。實查:`shipments.shipment_reference` 是 **NOT NULL + UNIQUE + `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`**(`…s1a1_shipments.sql:82,99,100`);而 **N3a `public.pcm_generate_display_id()` 產的正是「固定 6 碼、同一個 28 字母表」的<u>候選值</u>**(`20260730120000:62`、COMMENT `:123-124`)⇒ **字母表與長度逐字相符,可直接用**。🔴 它只是**候選** ⇒ 唯一性由 UNIQUE 約束強制 ⇒ **RPC 必須接 `23505` 並重試**(master plan 工作項 2 標題行逐字「由 N3a 產生、**重試在本層**」)。N3a **零 GRANT、owner-only**(`:同檔 ACL 段`)⇒ 本 RPC 是 SECURITY DEFINER owner=postgres,**呼得到、不需加 GRANT**。 | **是** | 40 分 |
| **W1** | RPC 骨架:簽章 + `SECURITY DEFINER` + `search_path=''` + `lock_timeout` + 隔離閘 + ACL(REVOKE 全部 / GRANT service_role)+ 檔內結構驗收 | **是**(權限 + DB 寫入) | 45 分 |
| **W2** | 冪等層:`p_idempotency_key` + payload_hash + 產物集不變式重驗(照 A8a1 樣板) | **是** | 45 分 |
| **W3** | 業務層 A:建箱 / 掛品項 / 出貨三個動作 + 交棒 1 的 `增量 ≤ instock − shipped` **訊息層**前緣拒絕 + 交棒 2 的引導訊息 | **是** | 45 分 |
| **W3c** | 🔴 **業務層 B:作廢 + unvoid 兩個 writer**(關卡1 **F1**)。v1 漏了它們,而 **DoD③ 三組 barrier <u>全部</u>是 ×unvoid**、交棒 2 的引導訊息要員工「**先作廢包裹**」、S1a-1 拍過 Q3=A 作廢退量(soft delete 可 unvoid)。**不補 ⇒ W6 退化回 owner 直寫模擬 = S2b §8.1 要進 STOP 的同一個坑。** | **是** | 45 分 |
| **W4** | 多品項取鎖:`ORDER BY order_item_id` + `40P01` 重試;**Q3=A 的「禁止批次」契約守門** | **是** | 40 分 |
| **W5** | harness 建檔:結構格 + 行為格(外部 oracle,照 `b2s2b-verify.sh` 形狀) | 否 | 45 分 |
| ~~**W6**~~ | 🔴 **已拆成 W6a/W6b/W6c**(R3 A2 + 乙案)—— 本列僅存內容說明、**不是獨立片**,片序以 §2a 為準。原文:真併發證據 = master plan DoD 的**三組 barrier 負測** + 項19 移交的真路徑併發 + 冪等重放 oracle | 否 | 45 分 |
| **W7** | 突變矩陣(每條斷言一發靶)+ 覆蓋帳 | 否 | 45 分 |
| **W7b** | 🔴 **交棒 6 清償**(關卡1 **F5**:v1 把它列進範圍表卻**零片認領**)。a8a2 已釘 `ORDER BY oi.id` + NKU ⇒ 清償便宜,**補一格**斷言取鎖序,不是重寫。 | 否 | 20 分 |
| **W7c** | 🔴 **runbook 義務**(關卡1 **F6**:v1 低估成「改一句字面」)。writer 上線後 `docs/runbooks/a4a-summary-rollback.md` **步驟① 要新增「REVOKE 出貨 RPC 的 EXECUTE」**、**步驟⑦ 對應回權**;且 shipments 側那句「**沒有可以 REVOKE 的 actor**」**會變成假的**。⇒ 要有片認領 + `REH-*` 那組守門重跑當裁判。 | 否 | 40 分 |
| **W8** | admin 呼叫端(repository + server action,照 `procurement-repository.ts:147-163` 樣板) | 否 | 40 分 |

| **W0b** | (**只在 Q6=A 時存在**)冪等落腳表 migration —— 🔴 動 schema ⇒ 鐵則 12 全套 + 過 Sean | **是** | 45 分 |

### §2a 🔴 **最終片序表(DAG 重對)**

> 🔴 **表內「估時」一欄在 §2 舊表;那些數字在 `W6a` 完成前一律不作數**(C-2)。

片界到此已**變第四次**(v1 八片 → v2 加四片 → v3 加 W0b・W0 降級 → v3.1 冒出 `W3c < W6`)
⇒ 這一版不再只列片名,把**依賴**寫出來,片序才有判別力。

| 片 | 依賴 | 為什麼是這個依賴 |
|---|---|---|
| **W0b** | — | 冪等落腳表 migration(Q6=A)。**沒有它 W2 無從實作** |
| **W1** | — | 五支 RPC 骨架 + ACL。含原 W0 產號重試(N4 降級後併入本片) |
| **W2** | **W0b**, W1 | 冪等層:鍵表要先在、骨架要先有 |
| **W3** | W1, W2 | 業務層 A(建箱 / 掛品項 / 出貨) |
| **W3c** | W1, W2 | 業務層 B(作廢 / unvoid + M4 順序前緣守門) |
| **W4** | W3, **W3c** | 取鎖序 + 禁批次契約 —— 它約束**全部五支**,五支都在才做得完整 |
| **W5** | W1 | harness 建檔(有東西可測就能開) |
| **W6a** | **W3c**, W2, W5 | 🔴 **早期判別力探針**(主視窗 `B-180-A` ②裁乙 + R3 A2 拆片合流):只跑組①`2×unvoid`。**不依賴 W4** —— 它的靶是 RPC 自己的取鎖 `ORDER BY`,W3c 一到就構造得出 |
| **W6b** | W6a, W4, W3 | 組②`INSERT×unvoid` + 組③`cancel×unvoid`。要等 W4 的取鎖序落定 |
| **W6c** | W6b, W2 | 冪等重放 oracle + **三表 Δ=0 / audit 增量凍結**(R3 D5) |
| **W7** | W5, **W6c** | 突變矩陣要先有格可打(依賴的是 **W6c**,不是已拆掉的 W6) |
| **W7b** | W5, **W3c**, **W4** | 交棒 6(a8a2 取鎖序)。🔴 依賴補正(n-3):R3 **D4** 把它從「結構錨」改成**跨函式行為格**(a8a2 × 出貨重算真併發)⇒ 需要 W3c 的 writer 與 W4 的取鎖序都在 |
| **W7c** | **W1** | runbook 的 REVOKE 清單 = 五支函式名 ⇒ 骨架定案才寫得出 |
| **W8** | W3, W3c | admin 呼叫端要五支都在(型別重生 ✅ `3d123ac5` 已完成) |

**拓樸序(v4 採用)**:
`W0b → W1 → W2 → W3 → W5 → W3c → W6a → W4 → W6b → W7b → W7c → W6c → W7 → W8`
**關鍵路徑**:`W0b → W1 → W2 → W3c → W6a → W4 → W6b → W6c`

🔴 **v3.2 的「W6 上游 7 片」已被乙案拆掉一半**:`W6a` 的上游只有 `W0b W1 W2 W3c W5`(5 片),
且它**先於 W4** —— 這正是乙案的重點:提前的是「rig 有沒有判別力」,不是「證據本身」。
🔴 **W5 提前到 W3c 之前**(v3.2 排在 W4 後):W6a 要用 harness,不提前就跑不了探針。
🔴 **W6b/W6c 仍在 W4 之後不是降級**:它們的靶是 W4 落定的取鎖序,提早跑是拿半成品當被測物。

#### 🔴 「五支」這個數字的三處連動(Q7=A 之後)

| 處 | 內容 | 誰在守 |
|---|---|---|
| W1 的 ACL 斷言 | 五支 ×(REVOKE PUBLIC/anon/authenticated + GRANT service_role) | W1 檔內結構格 |
| 鍵表 `action` CHECK | 五個動作值 | W0b |
| W7c runbook REVOKE 清單 | 五行 | **W7c 守門格**:「被 GRANT EXECUTE 的出貨 RPC 集合 = 凍結的那五支」 |

🔴 這裡刻意讓「五」**只有一個權威來源**(W7c 的凍結集合),另兩處由它對帳。
理由 = 本線一路踩過的「枚舉寫下即過期」:三處各寫各的,漏改一處**不會有人紅**。
🔴 **反面自陳**:W7c 那格只有在**函式真的被 GRANT** 時才有判別力;若某支根本沒建,
集合比對會少一個 ⇒ 紅(這是要的)。但它**證不了「該支 ACL 內容正確」**——那是 W1 的責任,
兩格不得互相充數。

🔴 **W6 是本片的心臟** —— 它是 B2-S2b 欠下的併發證據的唯一還款處。**不得因為進度壓力被砍。**
🔴 **N3(R2)**:**W3c 也是同型低估**(作廢 + unvoid 兩個 writer + M4 的順序守門 + 引導訊息)
⇒ 「**開工超時當場再拆**」的註記同樣掛在 W3c 上,不是只掛 W3。
🔴 **N4(R2)**:**W0 原本沒有獨立交付物**(產號重試是寫在 RPC 裡的邏輯)⇒ 改定位為
**設計節 + W1 的一部分**,並在 §1d 明寫它的 artifact = 「產號重試迴圈 + 23505 分派 + 耗盡碼」三件,
不再假裝它是一片可獨立交付的東西。
🔴 **F9(關卡1)**:W3 一片裝三個 writer + 守門 + 訊息,對照 a8a2 **單一動作就 640 行** ⇒ **估時偏低**,
**預期還要再拆**。v2 已先把作廢/unvoid 拆出成 W3c;W3 本身若開工後超過 45 分,**照鐵則 4 當場再拆**。

---

## §3 開工前置(照 master plan DoD ④ 與本線慣例)

1. `scripts/a1-verify.sh`(master plan DoD ④ 逐字要求)—— 🔴 注意它現在**跑完會 teardown**(B2-S2b-4b)。
2. `scripts/b2s2b-verify.sh all` + 三支 S1 harness ——確認起點乾淨。
3. 🔴 **`database.types.ts` 必須先重生**(見 §4.1),否則 W8 的呼叫端沒有型別可用。

---

## §4 🔴 兩個本片以外、但**現在就到期**的缺口

### 4.1 交棒 5 已到期,而且缺口比一欄大(**我實查的,還沒人接**)

S2b plan §9 **交棒 5** 逐字:「Sean apply 之後:`database.types.ts` 重生 → nullable 校正 → `pnpm typecheck`」。
**apply 已於 2026-08-07 完成**(主視窗 `B-168-A`)⇒ 這條到期。實查
`packages/adapters/src/supabase/database.types.ts`:

- `order_item_quantity_summary` 只有 **`quantity` / `ordered_quantity` / `instock_quantity` /
  `cancelled_quantity`** —— **`shipped_quantity` 零命中**(S2a 那一欄沒進去)。
- 🔴 **`shipments` 與 `shipment_items` 兩張表在型別檔裡完全不存在**(`shipment_items:` / `      shipments:` 各 0 命中)
  —— 整條 B2-S1 線的表**從來沒被重生進來**。

⇒ **這不是本片的範圍**(它是交棒 5),但**本片 W8 直接依賴它**。⇒ 已在 §3 列為前置。

### 4.2 交棒 9 的停寫涵蓋面仍未結清

`admin_cancel_order` 對 service_role 有 EXECUTE、經 A4a trigger 寫得到摘要表
⇒ runbook 步驟①「A5a 是唯一 service_role 寫入口」**今天就是假的**。
🔴 **本片會再加一個 service_role 寫入口(出貨 RPC)⇒ 那句話會更假。**
本片**不結清**它(結清要動取消線的 ACL),但**必須同批更新 runbook 的那句字面**,否則災難當天照著做會漏。

---

## §5 誠實邊界(草稿階段就寫,不等收工)

- **owner 直寫繞得過所有 RPC 層守門** —— 兩表 RLS 未 FORCE(`…s1a1_shipments.sql:15-21` 的 COMMENT 自陳)。
  ⇒ 任何「RPC 擋住了 X」的宣稱都只對**應用路徑**成立。
- **本草稿沒有讀過的東西**(偵察誠實列出,我沒有補讀):A8a2 `:200` 之後的完整冪等不變式、
  既有四支通用 admin RPC(`admin_adjust_wallet` 等)的原始定義、`cancel-repository.ts` 逐字內容、
  `docs/specs/2026-08-05-shipped-enforcement-analysis.md` 全文(§10 是 Q1/Q2 拍板出處)。
  🔴 `shipped-enforcement-analysis.md` §10 是**強制點**那題的拍板出處(已定案,見 §0.2 ①),
  **與 Q1(RPC 慣例)是不同的題** —— Q1 不受它影響。我沒讀那份全文,但已確認它管的是哪一題。
- **片界與估時是「Q1-Q5 都選推薦」那組答案下的切法** —— 答案不同,片界要重切。
- **我沒有查 master plan §5.2 那三組 barrier 負測的原始定義細節**(只讀到 DoD 的一行摘要)
  ⇒ W6 的驗收條目要在開工前把那三組逐字展開。

---

## §6a 🔴 W6 的三組 barrier —— **逐條展開**(這件事從 v1 拖到 v3,現在做掉)

### 🔴 先更正一個我和主視窗都講錯的前提
我們一直說「**去讀那三組 barrier 的原始定義**」。**實查:沒有原始定義。**
全 repo 只有兩處提到它,而且是**同一句 shorthand 的複述**:
- `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:621`
- `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md:691`(逐字複述 + 標 inconclusive)

⇒ **「逐字展開」其實是設計工作,不是檢索。** 以下是我的設計,**要過審**,不是既有事實的抄寫。

### 展開後的三組(形狀照 S2b 項19 已驗證的 barrier rig:真 session + `pg_blocking_pids` 同步點)

| # | 參與者 | 危險在哪 | 期望觀察值 | 翻面靶(必須真的翻) |
|---|---|---|---|---|
| **B1** `2×unvoid` | 兩個 session 同時 unvoid **同一張**已作廢包裹 | 兩邊都把 `shipped` 加回去 ⇒ **重複計數** | 恰一個生效;`shipped` = 真值(**不是兩倍**);另一個走**重放**或被拒 | 拿掉 unvoid 的冪等/鎖 ⇒ `shipped` 變兩倍 |
| **B2** `shipment INSERT × unvoid` | A 對品項 X 建箱掛品項並出貨;B 同時 unvoid 另一張也含 X 的包裹 | 兩邊各自前緣檢查都過,合起來 `shipped > instock` ⇒ **C9 紅在誰身上不確定**;或反序取鎖 ⇒ `40P01` | 兩者不得同時成功到超出 instock;紅的那一筆要**帶轉譯後的人話**(Q8=A) | 拿掉前緣檢查 ⇒ 出現 raw `23514`;拿掉鎖序 ⇒ 出現 `40P01` |
| **B3** `cancel × unvoid` | A8a2 部分取消(抬 `cancelled`)與 unvoid(抬 `shipped`)併發 | `cancelled + shipped > quantity` ⇒ **撞 C6′**;或可取消量算在過期值上 | 兩者不得合計超出 `quantity`;拒絕訊息要指路 | 拿掉其中一側的鎖 ⇒ 撞 C6′ |
| **B4** 冪等重放 oracle | 同鍵、同 payload 的兩個請求併發 | 第二個撞鍵表 `23505` **被誤判成撞號** ⇒ 重產號 ⇒ **新建一箱**(§1d M1) | 恰一組產物;第二個**轉重放** | 把 §1d 的 conname 分派拿掉 ⇒ 新建第二箱 |

🔴 **四組都要有「翻面靶真的翻面」的證據**,否則就是 S2b 項19 那種「編排可行性證明」而非併發證據。
🔴 **B2 / B3 依賴 W3c(unvoid writer)存在** ⇒ 片序上 **W3c 必須排在 W6 之前**。

## §6b 🔴 W6 的起手位置**比 plan 一路假設的要好** —— 已有五支同型 rig

寫 §1c-1 時 `git status` 冒出一個未追蹤檔,順手查來歷,**查出一件影響 W6 估時的事**。

**已進版控的 barrier rig(`git ls-files` 實查)**:

| 檔 | 行數 | 關係 |
|---|---|---|
| `scripts/a7t-concurrency-probe.sh` | 245 | **母形狀**:自建拋棄式 cluster、自拆、可觀察 barrier、預期會漏的格算 PASS |
| `scripts/a2b2-concurrency-probe.sh` | 353 | 同族 |
| `scripts/a4b-concurrency-probe.sh` | 424 | 同族 |
| `scripts/s2c-concurrency.sh` | 533 | 同族 |

**外加一支未進版控的**:`scripts/b2s1-concurrency-probe.sh`(568 行、30KB、2026-08-05、**從未 commit**)
—— 檔頭自述「**B2-S2 併發證據 harness、出貨數量軸的超量防護、實跑兩次翻案後的定案**」,
且「形狀照抄 `a7t-concurrency-probe.sh`」。**它就是為本片這條軸寫的。**

🔴 **這修正了一個 plan 與 R3 共有的隱含前提**:A2 說「W6 估 45 分 = 4-6 倍低估」,
論據是「S2b 一組 barrier 就吃整片還 inconclusive」。那個論據**成立**,
但整串討論(我的 §6a、R3 的 A1、主視窗的乙案裁定)**都預設 rig 要從零長出來**。
實況是 **`W6a` 開工時手上有一支同軸的 568 行 rig**。

🔴 **但它不是可以直接用的資產,三個保留**:

1. **它沒進版控** ⇒ 不是資產,是**某個 session 的遺留物**。任何 `git clean` 或換 worktree 就沒了。
   ⇒ **W6a 的第一動 = 判它去留**(採用就 commit 進來、不採用就明說為什麼),不是默默讀它。
2. **它的被測物是 S2 的 trigger 層,不是本片的 RPC 層** ⇒ 正好撞 R3 **A3**:
   W4 之後 RPC 先取鎖,**trigger 序的觀察面會消失**。照抄它的斷言**必全綠、零判別力**。
   ⇒ 可搬的是**編排骨架**(fifo 餵 psql、`pg_blocking_pids` 輪詢、自建自拆),
   **不可搬的是斷言**。這條界線 W6a 驗收要寫死。
3. **「實跑兩次翻案後的定案」= 它自己的假設被推翻過兩次** ⇒ 它的結論**不得當前提引用**,
   要引就引它的**實測輸出**,不是它的散文。

**估時**:v4 §10-1 已寫「W6a 完成前所有估時不作數」,本節**不改那條**——
有 rig 可抄會讓 W6a 快一些,但 R3 A2 的低估論據沒被推翻,兩件事不互相抵銷。

## §7 🔴 關卡1 折入帳(F1-F10 逐條落點,便於複核)

| # | findings | 落點 | 我另外發現的 |
|---|---|---|---|
| **F1** | W3 缺 unvoid writer | **新增 W3c**(作廢 + unvoid 兩個 writer) | — |
| **F2** | `shipment_reference` 產號零設計 | **新增 W0** | 🟢 N3a 產的是**固定 6 碼、同一個 28 字母表**,與 CHECK **逐字相符**,可直接用;它零 GRANT owner-only,本 RPC 呼得到 |
| **F3** | 冪等鍵無落腳處 | **§1b + Q6 + 條件片 W0b** | 🔴 **取消線樣板套不過來**:它一產物一動作,本片是**同一列五個動作** ⇒ 單一欄放不下(v1 與關卡1 都沒點破);`admin_audit_log.request_id` **無 UNIQUE**、語意是 correlation id ⇒ 不可行 |
| **F4** | Q1A 理由方向引反 | Q1 段**自首更正** + **三情境行為寫死** | — |
| **F5** | 交棒 6 無片認領 | **新增 W7b** | — |
| **F6** | runbook 義務低估 | **新增 W7c** | 加註 `REH-*` 那組守門重跑當裁判 |
| **F7** | Q3A 過度宣稱 | Q3 段改成「**在應用路徑上**被消滅」 | — |
| **F8** | X8 三缺口要逐項標、債落點寫死 | Q2 段補 | — |
| **F9** | W3 估時偏低 | §2 加註「**開工超時當場再拆**」 | v2 已先拆出 W3c |
| **F10** | Q4 錨錯 | Q4 標題改用 grep 錨 | — |

**Q5** 另依 `B-170-A` 結案:公式不改、**W3b 撤銷**、理由改成「**instock 已涵蓋**」。

---

## §8 🔴 R2 折入帳(M1-M4 / N1-N4 逐條落點)

R2(fresh fable,審 dev `3e624824`)判 **F1-F6 全數 FOLDED**(含 N3a 字母表、A7 鍵形狀親驗吻合),
新 FAIL 4 條 + consider 4 條,落點:

| # | findings | 落點 |
|---|---|---|
| **M1** | `23505` 雙來源不可分辨 + 重試上界零設計 | **新增 §1d** —— conname 分派(`IS DISTINCT FROM`,A5a 前科)+ 上界 5(N3b 前例)+ 耗盡碼 |
| **M2** | RPC 支數未裁 | **新增 Q7**,我推薦**五支**,並用「EXECUTE 集合 = 凍結五支」的守門解掉它的缺點 |
| **M3** | C9 競態 `23514` 無轉譯 | **新增 §1e + Q8**(推薦攔截轉譯;選 B 要**真的證**不可達) |
| **M4** | unvoid **順序路徑**撞 C9 零設計 | **§1e** —— W3c 補前緣守門 + 引導訊息(v2 只有併發 barrier) |
| **N1** | Q6=A 字面回填 | **新增 §1c**,四要素寫死,**W0b 排 W2 之前** |
| **N2** | 鍵表永不清理要明文 | **§1c 面①** —— 表註解逐字寫死 + harness 釘一格 |
| **N3** | W3c 同型低估 | §2 註記「超時當場再拆」擴到 W3c |
| **N4** | W0 無獨立交付物 | 改定位為設計節 + W1 一部分,artifact 三件寫明 |

---

## §6 下一步

1. 主視窗審這份草稿。
2. 🏁 **Q1-Q6 已全部有答案**(Q6=A 新表,`B-174-A`)。
   🔴 **新開 Q7(RPC 支數)與 Q8(M3 處置)** —— 兩題都影響片界與 W1 的 ACL 斷言數,**沒答案不開工**。
3. 🏁 **Q1-Q5 的舊帳**(Q1/Q2/Q3/Q4 = `B-169-A`,Q5 = `B-170-A` 結案)。
   🔴 **新開的 Q6(冪等落腳處)沒有答案之前,W2 不能開工** —— 它就是冪等層本身;
   而且 Q6=A 會多一片 migration(W0b)⇒ **片界會再變一次**。
3. 🔴 **開工前先把 §4.1(交棒 5)派給誰** —— 它不在本片範圍,但本片 W8 卡在它上面。

<!-- 🔴 舊草稿的結尾簽名(§6 下一步)。§7 之後為歷次審查折入帳,文件<u>未</u>在此結束。n-3 同族殘影,保留原字面僅作追溯。 -->


---

## §9 🔴 R3 折入帳(must-fix 12 / consider 2 / nit 1 逐條落點)

> R3 全文 `docs/reviews/2026-08-07-writer-rpc-plan-r3-findings.md`(dev `64323b41`)。
> 🔴 **本表兩欄是分開的**:「R3 說什麼」與「v4 怎麼折」。**兩處我沒有照抄**,理由附證據。

### 角度 1:假設審查

| # | 折入 |
|---|---|
| **A1** | 三組 barrier 定義不存在 —— 與我 §6a **獨立發現同一件事**(交叉驗證成立)。差異點照裁定**以 R3 版為準**:見下方 §6a 修正三條 |
| **A2** | W6 拆 **W6a/W6b/W6c** ⇒ 已進 §2a;與乙案(W6a 提前到 W4 前)合流 |
| **A3** | 🔴 **深水雷,全收**:W4 讓 RPC 先取全部 `order_items` 鎖 ⇒ S2b 移交的 **trigger 序靶在應用路徑失去觀察面**、照抄必全綠零判別力。W6 系列的靶一律改打 **RPC 自己的取鎖 `SELECT … ORDER BY`**,驗收字面必須寫「**量的是 RPC 的序,不是 trigger 的序**」 |

#### §6a 修正(A1 差異點,以 R3 版取代我的原設計)

1. **組①`2×unvoid`**:翻面靶改為 **RPC 取鎖 `SELECT` 的 `ORDER BY`**。
   🔴 我原本寫「拿掉取鎖 ⇒ shipped 翻倍」,方向對但**靶選錯**:
   拿 trigger 迴圈的 `ORDER BY` 翻不了面 —— `DISTINCT` 已規劃成 `Sort+Unique`,
   迭代序是值集合的函數、跨 session 相同(`scripts/b2s2b-verify.sh:1674` `BAR-PLAN-SHAPE` 釘住)。
2. **組③`cancel×unvoid`**:🔴 **`40P01` 構造不出來**(兩邊同鍵同向取鎖)—— 與 `BMUT-L2A` 同型陷阱。
   形狀重定義為:①正向格皆成功、兩軸等真值 ②衝突格 = cancel 推 `cancelled` 到邊界 + unvoid 回加 `shipped`,
   **後提交者必紅在具名 `C9`/`C6′` 且被 Q8 攔截轉人話**;翻面靶 = helper 的 parent NKU 移到讀 `SUM` 之後
   (`BMUT-L1` 已實證會翻)。我原設計只寫「危險 = C6′」是對的,**但沒給可翻面的靶**。
3. **組②`INSERT×unvoid`**:判別力來源必須寫進驗收 —— FK 的 `KEY SHARE` 不與 `NKU` 衝突
   ⇒「B 被擋」**只可能**來自 guard 的顯式 `NKU`;翻面靶 = guard 改普通 `SELECT`。
4. **B4(我的第四組)保留**,併入 **W6c**,加掛 R3 **D5** 的三表 Δ=0 + audit 增量凍結。

### 角度 2:災難日可用性

| # | 折入 |
|---|---|
| **B1** | 🔴 **runbook 步驟①順序改**:`REVOKE 五支 → revoke_at → drain 歸零 → 才 DISABLE`。現行序在五支上線後,drain 未歸零前 RPC 仍提交而 trigger 已停 ⇒ shipments 動了摘要不算、C9 不評估。W7c 認領此插入點 + 重推 runbook R2 論證段 |
| **B2** | 🔴 **冪等快照禁含重算衍生欄**,只含 `shipments`/`shipment_items` 的**不可變事實**。否則災難回滾+forward 後同鍵重試被不變式重驗判不一致 ⇒ `RAISE` **永久擋死唯一合法重試路**(A7b D8 同型)。runbook 加「本表不動、不清、不重放」 |
| **B3** | `REH-*` 不背書本片(其自陳射程只演練出貨表 0 列那條路)⇒ W7c 另立「**出貨表非空**」演練格;做不到就在 runbook 明寫「REH 不背書本片」,**二選一、不留空白** |
| **B4**(consider) | W7c 認領補:runbook ③(b) 消費端清單回寫義務(W8 若走 PostgREST 讀 `shipments` 即命中)+ ⑤ 債⑤ 判讀字面 |

### 角度 3:修法回歸

| # | 折入 |
|---|---|
| **C1** | 🔴 **產號重試迴圈 × 鍵列 INSERT 同交易互相引爆**:鍵列 INSERT 若在迴圈內,第二圈撞自己 ⇒ 誤判併發轉重放 ⇒ 回傳 `shipment_id` NULL 半成品。修法=①鍵列 INSERT 移到迴圈**外** ②重放路徑對 `shipment_id IS NULL` **fail-closed RAISE**。連動 §1d |
| **C2** | 🏁 **裁定=引導訊息優先**(主視窗 `B-179-A` ④):本片 RPC 是**員工面內部工具**,A8a1 的「不洩存在性」條款**在本片不適用**。已寫進 §1 Q1=A 字面。此裁定連同 Q7 支數 / W0b 新表進 Sean 白話簡報 |
| **C3**(consider) | Q7 凍結集合 = 五支被 GRANT 的 RPC ⇒ **W0b 新表的守門 trigger 函式不在集合、不在凍結面**,被 GRANT/DROP 都沒守門紅。W0b 自帶一格凍結它 |
| **C4**(nit) | M4 前緣守門補交棒 1 的限定詞「**為訊息、非為正確性**」(它讀的是惰性摘要) |

### 角度 4:測試假綠

| # | 折入 |
|---|---|
| **D1** | 🔴 **concern 收、修法更正** —— 見下方「更正一」 |
| **D2** | N2「永不清理」若斷言註解字面 = 恆真族。改**效果斷言**:`DELETE`/`TRUNCATE` 必紅在具名 conname / `P0001`,並配突變 |
| **D3** | 🔴 **concern 收、歸屬更正** —— 見下方「更正二」 |
| **D4** | W7b 再補一格 `position('ORDER BY oi.id')` = **第二個恆真錨**,清償不了交棒 6(a8a2 自陳「結構層承重、行為無判別力」)。修法=**跨函式行為格**(a8a2 × 出貨重算真併發);**20 分估時不成立**,W7b 重估 |
| **D5** | 冪等重放 oracle 補「**零新寫入**」量測 —— 「回同 reference」可被「新建一箱但回第一箱的號」滿足。併斷言三表列數 **Δ=0** + audit 增量凍結。落 W6c |

#### 🔴 更正一:D1 的修法(`proacl IS NOT NULL`)被我們自己的實測推翻過

R3 的 concern **成立**:集合比對可被「呈現為沒被 GRANT」滿足。但它開的藥不對:

- R3 引的前科 `20260806180000:331-333` **不是 proacl** —— 該處是 A4a 隔離閘(`P2B02`)。
  真前科在 `scripts/b2s2b-verify.sh:1300-1302`(`SA-aclnotnull` / `SA-grantee0` + 註解)。
- 🔴 更關鍵:`scripts/b2s2b-verify.sh:1388-1393` 記著一次**實測推翻**——
  「我們都以為『漏 REVOKE ⇒ `proacl` 為 NULL』,**實跑不是那樣**」:
  漏 REVOKE 時 `proacl` 仍**非 NULL**(`{=X/postgres,…,anon=X/postgres,…}`)、owner 外 grantee = 4。
  結論逐字:「**`SA-aclnotnull` 這一維沒有任何靶**」——它**在無靶清單裡**。
- ⇒ 照 R3 的藥加一條 `proacl IS NOT NULL`,等於**新增一條恆真斷言**,正是 R3 自己 **D2** 警告的族。
  原因也清楚:W1 只要下了 `GRANT … TO service_role`,ACL 就被物化,`proacl` **必然非 NULL**。

**v4 採用的修法**:W7c 的集合格 = **四角色 + PUBLIC 點名**
(`has_function_privilege('anon'|'authenticated'|'service_role'|…)`,對照 `SA-rolesnone`),
再比 grantee 集合。**不加 `proacl IS NOT NULL`**。
🔴 突變靶照 S2b 實證的形狀:拿掉某支的 `REVOKE` ⇒ 必紅在**角色點名格**。

#### 🔴 更正二:D3 講的「`position()` 文字檢查」plan 裡不存在

grep 全 plan:`position(` **零命中**;「禁批次」只在 §1 Q3=A 與 §2 W4 出現,
且 W4 只寫「**Q3=A 的『禁止批次』契約守門**」—— **從未定義守門形狀**。

⇒ D3 的真面目**不是「文字檢查太弱」,是「形狀未定義」** —— 與 **A1 同族**(把設計當成已存在的東西)。
這比 R3 描述的更嚴重:未定義的守門**無法被審**,而 v3.2 的 §2a 還把它列成 W4 的交付物。

**v4 採用的修法**:W4 的禁批次守門形狀當場定義,且**不走文字比對**:
①契約層 = 簽章只收單一 `p_shipment_id`(`= ANY` 等價繞過在型別層就不成立)
②行為層 = 一發 `= ANY(p_ids)` 形狀的突變靶,必須紅。
🔴 R3 提的「白名單式可判定字面」我**不採**:那仍是文字層守門,
本線 memory `feedback_guard-checks-existence-not-effect` 記的正是這族。

---

## §10 🔴 v4 的自裁與誠實邊界

1. **W8 依賴自裁**(主視窗 `B-180-A` ④ 授權):維持 `W8 ← W3, W3c`,**不分批接**。
   理由:admin 呼叫端分批接會讓「五支凍結集合」在中途處於**不完整態**,
   而 W7c 的集合格正是拿完整集合當權威 ⇒ 分批期間那格要嘛紅、要嘛被放寬,兩條都壞。
   代價=W8 開工晚;可接受,因為它不在關鍵路徑上。
2. **估時全面失效**:R3 的 A2(W6 低估 4-6 倍)與 D4(W7b 20 分不成立)兩條同指估時。
   v4 **不逐片重估** —— 拆片後的估時要有依據,依據 = W6a 跑完的實際耗時。
   ⇒ 明寫:**`W6a` 完成前,本 plan 的所有估時都不作數**。
3. **§9 的兩處更正只證了「R3 的藥不對」,沒證「我的藥對」**。
   更正一有 S2b 實測背書(`:1388-1393`);**更正二的兩層修法沒有任何實測背書**,
   它跟 §6a 一樣是**設計**,confirmation 輪應該當新面審,不能因為它掛在「更正」名下就放行。
4. **R3 其餘十條我是照收的** —— 我只親驗了它給的四個 `檔案:行號`(兩對兩錯)。
   B1/B2 的災難日推理、C1 的迴圈引爆我**沒有實測**,是讀 plan 與 runbook 推得合理即收。

---

## §11 🔴 confirmation 輪折入帳(FAIL 1 = 收斂;主視窗 `B-182-A`)

### must-fix-1 —— **我的「更正二」擋不住體內一句多列**(v4 新面,非重複層)

我在 v4 §9 更正二寫:禁批次守門 = ①簽章只收單一 `p_shipment_id` ②`= ANY(p_ids)` 突變靶,
並自標「零實測背書、請當新面審」。**審查者攻進來了,而且是對的**:

> 簽章單數型別層擋得住 `p_ids = ANY(...)`,
> 但擋不住**函式體內**一句 `UPDATE public.shipments … WHERE order_id = v_order_id`(**同單多箱**)——
> 它完全合法、簽章仍是單數,而**跨 shipment 的取鎖序 = 該 UPDATE 的列序、無排序保證**
> ⇒ **交棒 10 的風險原封不動還在**,Q3=A 要的「證明 RPC 內沒有那種語句」那格**根本沒被交付**。

🔴 **這正是我自己在 §9 更正二裡引的那條教訓反過來咬**:
我批評 R3 的文字層守門、改用「型別層 + 突變靶」,但**型別層只看得到簽章、看不到函式體內**——
守門又一次畫在**比不變量窄的面**上(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。

**修法(W4 行為層守門,取代 v4 §9 更正二的兩層)**:

| 層 | 內容 | 靶 |
|---|---|---|
| **行為層(新;承重件)** | 五支函式內**每一句** `UPDATE public.shipments …` 之後立刻 `GET DIAGNOSTICS v_n = ROW_COUNT`;**`v_n <> 1` 即 `RAISE`**(fail-closed,具名 conname) | 把某句的 `WHERE` 改成會命中多列(如 `WHERE order_id = v_order_id`)⇒ **該格必紅** |
| 簽章層(保留、降為第二道) | 只收單一 `p_shipment_id` | 塞 `= ANY(p_ids)` 形狀 ⇒ **簽章格必紅**(靶與行為層格**分開記名**,不共用一格) |

🔴 **為什麼行為層才是承重件**:它守的是**不變量本身**(「一次動一箱」),
而不是「語句長什麼樣」。`WHERE` 怎麼寫、用不用 `ANY`、是不是同單多箱 —— 一律被 `ROW_COUNT <> 1` 接住。
🔴 **`<> 1` 不是 `<= 1`**:0 列也要紅(該箱不存在或被別人搶走 = fail-closed),不得靜默通過。
🔴 **兩個靶必須紅在<u>不同</u>格**:共用一格的話,行為層格綠了會掩蓋簽章層失效(反之亦然)。

### considers / nits

| # | 折入 |
|---|---|
| **C-1** | ✅ B2 / C1 / C4 的藥**回填設計節字面**:§1c 四要素表(產物快照欄)+ §1c 面 4/面 5 新增(C1 迴圈外、B2 禁衍生欄)。原本只在 §9 帳表 ⇒ 按節施工會漏 |
| **C-2** | ✅ 「`W6a` 完成前估時不作數」複寫到**抬頭 🔴 區** + **§2a 表頭** |
| **n-1** | ✅ W7c 集合格期望值**寫死 = `{service_role}`**,且 **grantee `0`(PUBLIC)顯式列入比對集合**。🔴 **審查者這條是對的,已實測**(見下) |
| **n-2** | 🔴 **實測推翻,見下** |
| **n-3** | ✅ §2 舊表 `W0` / `W6` 標成殘影(僅存內容說明、非獨立片);`W7` 依賴 `W6` → **`W6c`**;`W7b` 依賴補 **`W3c` + `W4`**(D4 把它改成跨函式行為格後才對) |

### 🔴 n-1 / n-2 的實測(拋棄庫 PG 17.10,埠 54367,自建自拆、工作樹零留痕)

| 量什麼 | 實測輸出 | 判定 |
|---|---|---|
| 新函式未動 ACL 的 `proacl` | `NULL` | — |
| **下一次 `GRANT` 之後的 `proacl`** | `{=X/postgres,postgres=X/postgres}` | 🏁 **v4 §9「更正一」再度證實**:一旦 W1 下了 GRANT,`proacl` **必然非 NULL** ⇒ `proacl IS NOT NULL` 恆真 |
| `aclexplode` 的 grantee 清單 | `0,10` | PUBLIC = **grantee `0`** |
| `aclexplode` **join `pg_roles`** 後列數 | **`1`**(非 2) | 🏁 **n-1 正確**:join `pg_roles` **靜默丟掉 PUBLIC 那列** ⇒ 集合比對若 join 了 `pg_roles`,對「PUBLIC 有 EXECUTE」**全盲** |
| `has_function_privilege('public', fn, 'EXECUTE')` | **`t`(不報錯)** | 🔴 **n-2 被推翻** |
| 對照組 `has_function_privilege('nosuchrole', …)` | `ERROR: role "nosuchrole" does not exist` | 對照組行為正常 ⇒ 上一列的 `t` **不是錯誤被吞** |

**n-2 的處理**:`has_function_privilege('public', …)` **可以用、不報錯**,v4 §9 更正一的「PUBLIC 點名」機制**成立**。
🔴 **但 n-1 的結論不受影響、且更重要**:點名格**只能驗你點到的名字**,
**第五個意外角色只有集合比對抓得到**。⇒ W7c 驗收**兩格都要**:
①集合比對(顯式含 grantee `0`、**不得 join `pg_roles`**)②四角色 + PUBLIC 點名。
**這句寫進 W7c 驗收字面**,理由是兩格覆蓋不同的失效形狀,不得互相充數。

---

## §12 🔴 v4.1 的誠實邊界(定稿候選)

1. **must-fix-1 的修法沒有實測背書** —— 與它取代的那版同性質。
   但這次**有一件事變了**:`ROW_COUNT <> 1` 是**執行期事實**,不是文字或型別,
   它的突變靶(把 `WHERE` 改成命中多列)在 W4 當場就能跑。⇒ 風險從「設計對不對」降成「實作有沒有漏掛某一句」。
   🔴 **「有沒有漏掛某一句」本身沒有守門** —— 五支裡漏掛一句 `GET DIAGNOSTICS`,這格照樣綠。
   這是 v4.1 **已知未關的洞**,W4 開工時要嘛補一格「`UPDATE public.shipments` 出現次數 = `GET DIAGNOSTICS` 出現次數」,
   要嘛明寫接受。**現在不假裝它關上了。**
2. **§11 的實測只涵蓋兩條 PG 語意**(TRUNCATE trigger / `has_function_privilege('public')`)
   與兩條 ACL 事實(`proacl` 物化 / join `pg_roles` 丟列)。**其餘 confirmation findings 我照收未實測。**
3. §1c-1 的 DDL **仍然一行都沒跑過**(§10-1 那條未變)。表名改成 `pcm_b2_shipping_idempotency` 後尤然。
4. 🔴 **本版是「定稿候選」不是「已定稿」** —— 定稿以主視窗口頭確認為準(`B-182-A` 定稿程序)。

— a4a-chain 施工窗,2026-08-07(草稿,未批准)
