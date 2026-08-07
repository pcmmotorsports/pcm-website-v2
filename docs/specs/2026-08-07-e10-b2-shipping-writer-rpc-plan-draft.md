# B2 出貨 writer RPC 片 —— plan **草稿 v1**(2026-08-07)

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

A. **照 A8a1/A8a2**(推薦)—— `search_path=''`、函式屬性帶 `lock_timeout`、顯式 `p_idempotency_key`
   + payload_hash、業務拒絕不洩狀態。理由:出貨是**不可逆的對外動作**(貨會真的寄出),
   冪等鍵必須顯式;而且 S2b 記憶裡「TapPay 鍵消耗恆久」那族教訓指向「重試必換鍵、動作要 at-most-once」。
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
C. **本片不處理**,原樣再交棒下去。
```

### Q3:**批次出貨(一句 UPDATE 改多列)本片做不做?**

交棒 10 被裁定「併進本片、不拆」,但**批次出貨的 UI/需求今天不存在**(偵察查無)。

```
Q3:交棒 10 的批次鎖序面,本片怎麼處理?
A: A|B|C

A. **RPC 契約上禁止批次**(推薦)—— RPC 一次只處理一個 `shipment_id`,
   並在檔內寫死「**禁止一句 UPDATE 改多列 shipments**」+ 一格守門證明 RPC 內沒有那種語句。
   ⇒ 交棒 10 的風險面**被契約消滅**,不需要證明它安全。
B. **支援批次並證明它安全** —— 要做全域 `ORDER BY` 取列 + barrier 負測。片體積大增。
C. 本片只做單筆,交棒 10 再往後傳(🔴 但主視窗已裁「不拆」,選這個等於推翻該裁定)。
```

### Q5:可取消量守門公式改不改(master plan DoD ② 落在本片)

原文:是否把可取消量守門改成 `quantity − GREATEST(instock, shipped) − cancelled`。
B2 批當時裁「現在不做」的**唯一理由是「`shipped` 恆為 0、走不到該情境」** —— **那個前提已經失效**。

```
Q5:可取消量公式在本片改不改?
A: A|B|C

A. **改**(master plan 原文說「在這裡做是順路」)—— 但 🔴 **必須先取得主視窗另委的獨立分析結論
   (`B-31-A` ②)**,原文逐字把它列為開工前置。沒有那份結論就不能動。
B. **不改** —— 但要寫明新的理由(舊理由已失效),不能沿用「shipped 恆為 0」。
C. 先取得 `B-31-A` ② 的結論再決定(= 把這題延後,但**不得沿用舊理由**)。
```
🔴 **不論選哪個,「shipped 恆為 0」這個理由都不能再被引用** —— 它今天是假的。

### Q4:HCT 送單是否同片?

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

## §2 片界(草稿;每片 15-45 分鐘,鐵則 4)

> 🔴 **實際片數與順序取決於 Q1-Q5 的答案**,以下是「Q1=A / Q2=A / Q3=A / Q4=A / Q5=C」那組答案下的切法
> (Q5=C ⇒ W3b 不存在;Q5=A 才有 W3b,而它還卡在 `B-31-A` ② 的獨立分析結論)。

| 片 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|
| **W1** | RPC 骨架:簽章 + `SECURITY DEFINER` + `search_path=''` + `lock_timeout` + 隔離閘 + ACL(REVOKE 全部 / GRANT service_role)+ 檔內結構驗收 | **是**(權限 + DB 寫入) | 45 分 |
| **W2** | 冪等層:`p_idempotency_key` + payload_hash + 產物集不變式重驗(照 A8a1 樣板) | **是** | 45 分 |
| **W3** | 業務層:建箱 / 掛品項 / 出貨三個動作 + 交棒 1 的 `增量 ≤ instock − shipped` **訊息層**前緣拒絕 + 交棒 2 的引導訊息 | **是** | 45 分 |
| **W3b** | (**只在 Q5=A 時存在**)可取消量公式改動 + a8a2 回歸 —— 🔴 動取消線 ⇒ 鐵則 12 全套,且**前置 = `B-31-A` ② 的獨立分析結論** | **是** | 45 分 |
| **W4** | 多品項取鎖:`ORDER BY order_item_id` + `40P01` 重試;**Q3=A 的「禁止批次」契約守門** | **是** | 40 分 |
| **W5** | harness 建檔:結構格 + 行為格(外部 oracle,照 `b2s2b-verify.sh` 形狀) | 否 | 45 分 |
| **W6** | 🔴 **真併發證據**:master plan DoD 的**三組 barrier 負測** + 項19 移交的真路徑併發 + 冪等重放 oracle | 否 | 45 分 |
| **W7** | 突變矩陣(每條斷言一發靶)+ 覆蓋帳 | 否 | 45 分 |
| **W8** | admin 呼叫端(repository + server action,照 `procurement-repository.ts:147-163` 樣板) | 否 | 40 分 |

🔴 **W6 是本片的心臟** —— 它是 B2-S2b 欠下的併發證據的唯一還款處。**不得因為進度壓力被砍。**

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

## §6 下一步

1. 主視窗審這份草稿。
2. **Q1-Q5 要有答案**才有 §2 的片界;沒答案就不能開工。
3. 🔴 **開工前先把 §4.1(交棒 5)派給誰** —— 它不在本片範圍,但本片 W8 卡在它上面。

— a4a-chain 施工窗,2026-08-07(草稿,未批准)
