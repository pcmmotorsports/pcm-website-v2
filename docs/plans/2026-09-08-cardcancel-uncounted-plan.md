# `⟦0a-CARDCANCELNOREFUND⟧` 甲 —— 取消的刷卡單「還沒退刷」要數得出來(plan,不寫碼)

> 線【退款】`-refund` 2026-09-08 出;主視窗 A 派、指定**先提 plan 不要先動手**。
> **本檔零改碼、零 migration。**
> 🔴 **鐵則 8**(跨 3+ 檔:migration + ports + adapters + use-cases)**+ 鐵則 12③**(新 DB 物件)
> ⇒ **A 批 ⇒ 之後 codex 對抗審查不降級 ⇒ Sean 貼。**
> 🛑 **而「貼」沒有預授權** —— Sean 0906 拍的是「**他說貼 N 才貼**」⇒ **我不貼、A 也不貼。**

## §0 三步跑完的結果

```
① what-happened-to 0a-CARDCANCELNOREFUND ⇒ 末格在 :2273
② board-row-by-anchor ⇒ 整列【4010 字元】
   🔴 而我這次【從尾巴讀】—— 上一列(⟦b9-REFUNDNUM1⟧)我從頭讀 3400 字, 讀到的是過期那半
   ⇒ 板列的規矩是【新的往尾巴加】⇒ 要截斷就截開頭
③ L3 判定:不是內容(不是 CRUD 頻率題), 是一個【數字存不存在】的問題 ⇒ 非 L3
```

## §1 要改什麼(而它為什麼不是「再加一個告警」)

**乙(提醒句)2026-09-07 已做**:`packages/use-cases/src/check-anomaly-alerts.ts:679`
`CARD_CANCEL_REFUND_REMINDER`,接在安靜日心跳信裡。
🔴 **而板列自己把差別講死了,那句是量出來的不是選出來的**:
> **它是【提醒】不是【計數】** ——「今天有幾張取消的刷卡單還沒退刷」**這個數字不存在**。

🔬 **我自己複現那四格(逐字對上,不是轉述)**:
```
· CARD_CANCEL_REFUND_REMINDER      ⇒ check-anomaly-alerts.ts:648 用 / :679 定義
· AnomalyAlertSummary 裡只有兩族計數:
    orderRefundsStuck*    (:118 :119 :225)  分母 = 【已經開始退】的 order_refunds 列
    unpaidCancelledGap*   (:255 :259)       分母 = 【未付款】取消 ⇒ 沒有錢要退
  🛑 兩族【都不是】本列的母體(取消 + 刷卡【已付】+ 零退款列)
· pcm_pending_refund_amounts 的軌值域 20260902030000:87 逐字
    FROM (VALUES ('bank_transfer'), ('cash'))            ⇒ 值域裡沒有卡
· order_manual_refunds 的 rail 20260820010000:163 逐字
    CHECK (rail IN ('bank_transfer', 'cash'))            ⇒ 刻意不含 card
```
🎯 **⇒ 所以「卡片退款」在今天的資料模型裡【沒有任何一張表在記】** —— 那筆錢的去向只在 TapPay。
📌 **⇒ 本片要的不是一個新告警,是一個【今天不存在的數字】。**

## §2 那個數字的定義(而每個名詞要指到欄)

**母體 = 同時滿足三件的訂單**:
```
① 已取消            ⇒ orders.cancelled_at IS NOT NULL
② 刷卡【已付】      ⇒ 有 order_payments 列 rail = 'card' 且淨額 > 0
③ 零退款列          ⇒ order_refunds 沒有 status = 'confirmed' 的列
```
🔴 **而 ②③ 兩格我【還沒查到底】,plan 階段明說**:
```
② 「刷卡已付」要不要扣沖銷(order_payments 有負列)?
   ⇒ 我傾向【要】—— 一筆被沖銷掉的刷卡收款, 錢沒有真的收到 ⇒ 不該叫人去退
   ⚠️ 而這是【口徑】不是實作 ⇒ 寫進 §5 決策題
③ 「零退款列」的判準:status = 'confirmed' 還是 confirmed_at IS NOT NULL?
   ✅ 這一格【已經有答案】, 而它是本夜量到的:
      order_refunds_confirmed_consistency ⇒ confirmed_at 非 NULL ⟺ status IN (confirmed, voided)
      🛑 ⇒ 用 confirmed_at 會把【已作廢、錢沒出去】的也算成退過 ⇒ 少報
      ⇒ 判準必須是 status = 'confirmed'
```

### §2-③ 補驗(2026-09-08 10:3x · 主視窗 A 指派 · **唯讀**, 零寫入)

> 上面那句原本標著「**已有答案而我沒有實跑驗證**」。**跑了。而結論要分兩半, 不能混講。**

**🟢 前半【被證實】—— 而證實它的是正式庫, 不是 repo**
```sql
-- bash scripts/readonly-prod-sql.sh <唯讀.sql>  ⇒ 正式庫回:
order_refunds_confirmed_consistency
  CHECK (((confirmed_at IS NOT NULL) = (status = ANY (ARRAY['confirmed'::text, 'voided'::text]))))
🟢 正對照 同一張表的 CHECK 共 18 道(⇒ 那個結果不是空表也不是權限問題)
⚪ 負對照 現造 order_refunds_zq7fh3k2m9x_nope ⇒ 0 列
```
⇒ 📌 **`confirmed_at 非 NULL ⟺ status IN (confirmed, voided)` 在正式庫【逐字成立】。**
🔵 連帶讀到一件:**正式庫那道 constraint 已經是 `20260907030000`(A2 補登片)那一版的形狀**
—— 而**那句話的主詞是「constraint 的定義」, 不是「那支 migration 已 apply」**:
前者我讀到了, 後者要問帳本或 `is-migration-applied.sh`。

**🛑 後半【今天量不到】—— 而那不是推翻它, 是分母太小**
```
order_refunds 全表          1 列(status = confirmed)
status='voided' 且 confirmed_at 非 NULL   ⇒ 0 列
兩種判準算出的【單數】      by_status_confirmed = 1 · by_confirmed_at = 1  ⇒ 差 0
```
⇒ 📌 **「用 confirmed_at 會少報」今天【零發生】** —— 因為整張表只有一列, 而它不是 voided。

**🎯 而這一格真正的收穫是那個區分**
```
「這個機制成立」  ⇒ constraint 的定義答的(結構保證)⇒ ✅ 已證實
「今天踩到幾次」  ⇒ 資料答的                        ⇒ 0, 而分母是 1 列
🛑 而它們不是同一個宣稱 —— 前者【不需要】資料來證實, 後者為 0 也【不推翻】前者。
```
📌 ⇒ **判準用 `status = 'confirmed'` 仍然是對的, 而理由要改寫**:
理由是**那道 CHECK 明文允許 `voided` 帶著 `confirmed_at`**(結構), 不是「今天有幾列踩到」(資料)。
🎯 **一個結構保證配一個 0 的資料讀數, 讀起來像「這件事不會發生」** —— 而它其實是
**「這件事被允許發生, 只是今天還沒有」**。⇒ 寫理由時要寫前者, 因為資料明天就會變。

⚪ **本次仍沒做的**:沒有構造一列 `voided` 去實測那道 CHECK 會不會擋
(那要寫入 ⇒ 今晚沒有 apply 授權涵蓋我 ⇒ 不做)。
🛑 **而 §2 這三格答不完之前不要寫碼** —— 理由同 OP7 plan 那句:
**一個看起來對的金流算式,錯的地方通常在「那個欄位到底裝什麼」。**

## §3 形狀(照既有那族抄,不自創第二種)

🔬 **既有那族的架構是量到的**(`getAlertSummary` 三處實作):
```
packages/ports/src/IAnomalyAlertReader.ts            介面(168 行)
packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts  實作(1920 行)
packages/use-cases/src/check-anomaly-alerts.ts       消費(2575 行)
🔵 而 adapter 【不用 supabase rpc()】—— 實查:rpc( ⇒ 0 · .from( ⇒ 0 · query( ⇒ 36
   它走 pg Client 的 query();RPC 名收在檔頭常數(RPC_MANUAL_SEARCH 等四支)
```
⇒ **新的照抄那個形狀**:一支唯讀 RPC + `IAnomalyAlertReader` 加一個方法 + adapter 加一支 + summary 加欄。

🔴 **而「未 apply」那一態【一定要有】,那是既有那族已經踩過的**:
`check-anomaly-alerts.ts:115` 逐字「`null` = 那支 RPC 尚未 apply ⇒ route 據 `orderRefundsStuckUnknown` 回 503」
📌 **⇒ 三態不是兩態:有數字 / 是 0 / 【問不到】** ——
**而「是 0」與「問不到」印同一個東西的話,這片就白做了。**

## §4 影響面

- **新 DB 物件**(唯讀 RPC)⇒ 鐵則 12③ ⇒ ACL 要三道 REVOKE + 只 GRANT `service_role`,
  `SECURITY DEFINER` + `SET search_path = ''`,並帶**制式收權斷言清單**。
- **跨 4 檔**(migration + ports + adapters + use-cases)⇒ 鐵則 8。
- 🔴 **而板列自己指定了一個【連帶動作】,不做等於沒做完**:
  > 甲做出來、那個計數上線 ⇒ 本列轉 `done`,**而同一個動作要把 `CARD_CANCEL_REFUND_REMINDER`
  > 那三行【換掉】不是並存** —— **一句永遠印的提醒 + 一個大部分時候是 0 的數字,
  > 兩個都會被讀成雜訊。**
  ⇒ 📌 **所以本片的收尾包含【拿掉乙】,而不是留著兩個。**

## §5 要 Sean 拍的(一題,而它是口徑不是實作)

```
Q:「刷卡已付」要不要扣掉沖銷的那筆?
A: A) 要扣 —— 被沖銷的刷卡收款, 錢沒有真的收到 ⇒ 不該叫人去 TapPay 退(我推薦)
   B) 不扣 —— 只要有過 card 收款列就算, 寧可多叫一次
```
🛑 **而在他答之前,本片不預設方向** —— 兩邊的代價都是真的:
A 漏掉一張真的該退的單 / B 叫人去退一筆其實沒收到的錢。

## §6 rollback(Sean `Q76`:寫在寫 migration 之前)

- 新 RPC 用**裸 `CREATE`**(不是 `OR REPLACE`)⇒ 撞名當場紅;回滾 = `DROP FUNCTION`。
- TS 那三支是純增(介面加一個方法 / adapter 加一支 / summary 加欄)⇒ 回滾 = `git revert`。
- 🔴 **而回滾擋不住的**:回滾之後那個數字消失,而**乙(提醒句)若已被拿掉就沒有東西在講這件事**
  ⇒ ✅ **所以順序是【先上甲、確認它在報、才拿掉乙】** —— 不可以同一顆 commit 兩件一起。

## §7 本 plan 證不到什麼

1. **沒有碰正式庫** —— 今天有幾張這種單,我答不出來(而那正是本片要做的那個數字)。
2. **§2 的 ②③ 兩格沒查到底**(②是口徑要 Sean、③已有答案但我沒實跑驗證)。
3. **沒有量** `PgAnomalyAlertReaderAdapter` 那 1920 行裡既有四支 RPC 的完整形狀 ——
   我只量到「它走 `query()` 不走 `rpc()`」與「RPC 名收在檔頭常數」,**沒有逐支開檔**。
   ⚠️ **⇒ 寫碼前要先讀完一支既有的當範本,而不是照本 plan 的描述寫。**
4. **沒有查** `IAnomalyAlertReader` 有沒有別的實作(測試樁以外)⇒ 加方法會不會撞到別處。
