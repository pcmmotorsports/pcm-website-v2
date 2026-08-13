# #445 超退閘 — slice plan v1

> 2026-08-13 · 主視窗十三代自寫 · **未經 codex 關卡1 審查、未經 Sean 批准**
> 片型 = **高風險片**(鐵則 12①**錢**;12③ schema/RPC)⇒ 鐵則 8 提 plan 等批 + 對抗審查不降級
> 來源 = backlog `#445`(Sean 2026-08-12 **知情推翻拍板⑤**,排 2g 之前)

---

## §1 一句話目標

**讓 100 元的訂單退不出 99999。**

現況三層全不擋(§2 逐條實查),TapPay 是唯一防線 —— 而我方對它的拒絕行為**只有 sandbox 實證**,
且 partial 路徑我方完全不查帳。本片把「算得出來但沒人用」的剩餘額**升格成守門**。

🔴 **做完也不得宣稱「擋得住超退」**,只能宣稱「**擋得住本系統自己造成的超退**」(§8)。

---

## §2 偵察發現(全部實查,附檔案:行號 —— 引用前不必重查)

### 2-1 算式已經存在,而且只算一半的帳

`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:394-408`:

```sql
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT o.total::bigint - COALESCE(
           (SELECT SUM(r.refund_amount) FROM public.order_refunds r
             WHERE r.order_id = o.id AND r.status IN ('processing','confirmed')), 0)
    FROM public.orders o WHERE o.id = p_order_id;
$$;
```

- **只算 `order_refunds`**;`payment_refunds`(2g 那本帳)一毛不扣。
- COMMENT(`:411`)逐字:「🔴 **不是守門、沒有 trigger 讀它**(拍板⑤)」。
- 查無訂單回 **NULL**。

### 2-2 守門的位置早就有,是刻意留空的

`order_refunds` 的 INSERT 守門已有六道,COMMENT(`:298`)最後一句逐字:
「🔴 **不含任何超退檢查(拍板⑤)**」。同檔 `:25` 是拍板⑤ 原文:「**零超退守門**(金額上界不設;TapPay 10051 是權威)」。
`:254` 另有一句劃界:「本道擋『沒收過錢』**不擋『還能退多少』**=拍板⑤」。

⇒ **這不是沒地方放,是當初決定不放。** 本片=推翻該決定(Sean 已知情拍板)。

### 2-3 🔴 2f(今晨已 apply)把最難的部分解決了

超退守門最難的不是算數,是**並發**:兩個人同時送,各自看到「還能退 5000」,兩個都過檢查。

2f 在 `admin_initiate_order_refund` **步 2 之後、步 3 之前**取了 order 級 advisory lock
(`20260812170000` 檔頭 A 段)⇒ **同一張訂單的退款發起已經序列化**。

⇒ 守門放在那把鎖**之後**,並發問題自動消失;放 DB trigger 反而要自己再做一次序列化。
**這一點翻轉了「trigger 最徹底」的直覺**,是 Q1=A 的技術理由。

### 2-4 RPC 的檢查順序是合約,而 partial 是唯一沒查的那條

`:418-420` 逐字順序:
`1 輸入衛生 → 2 kind/金額互斥 → 3 鎖訂單 → 4 冪等 G4 → 5 業務前置 → 6 凍結額+NOTHING_LEFT → 7 產鍵 → 8 INSERT → 9 稽核`

步 6 現況(`:537-540`)**只管 full**:

```sql
IF p_kind = 'full' AND v_frozen < 1 THEN
  RETURN jsonb_build_object('result','REFUND_NOTHING_LEFT');
END IF;
```

而 `v_frozen` 的兩條來源:`:485` partial = `v_frozen := p_amount`(**員工輸入多少就是多少**)、
`:496` full = `p_record_amount`(走 TapPay Record 的剩餘額)。

⇒ **本片的落點就是步 6,把 partial 納入。**

### 2-5 回傳碼是封閉集合,呼叫端會斷言

`:414-416` 八碼:`INITIATED / DUPLICATE_REQUEST / ORDER_NOT_FOUND / ORDER_NOT_REFUNDABLE /
ORDER_NO_CARD_TRANSACTION / REFUND_LEDGER_FULL / REFUND_IN_FLIGHT / REFUND_NOTHING_LEFT`,
逐字註「**呼叫端必斷言 ∈ 全集,未知碼=呼叫端 bug**」。同檔 `:599` COMMENT 重述、`:1031` 有結構斷言核對碼名字面。

⇒ 新增第 9 碼**要同步四處**(RPC 內、COMMENT、結構斷言、app 層對照),不是加一行就好。

### 2-6 🔴 前台已經有一半了(這點讓本片比原估小)

`apps/admin/src/components/orders/order-detail.tsx:429` 逐字:

```tsx
!(refundUnregisteredAmount !== null && refundUnregisteredAmount < 0) &&
```

**未登記額為負(=帳本登記已超過訂單總額)時,整個退款入口 fail-closed 關閉。**
值的流向也通了:`order-detail-route.tsx:143` 取值 → `:220` 傳下 → `order-detail.tsx:410` 給帳本區塊。

⇒ 缺的**不是**「把值弄到前台」,是「**把值用成逐筆金額的上界**」。
現況上界:`apps/admin/src/lib/payment/refund-form.ts:36` = `2_147_483_647`(PG int32),`:107` 是唯一比對點。

### 2-7 措辭鐵律(不得違反,已有負向測試盯著)

`apps/admin/src/lib/payment/refund-ledger-view.ts:4-8` 逐字:
「UI 措辭必須是「**帳本未登記額**」,**不得**寫「還能退」「剩餘可退」—— 值班照著錯的名字按下去 = 同一筆錢退兩次。」

---

## §3 Sean 拍板(2026-08-13,五題全照推薦)

| 題 | 拍板 | 落點 |
|---|---|---|
| Q1 幾層 | **前台 + RPC 兩層**(不做 DB trigger 層) | §4-1 |
| Q2 算式 | **另寫守門版,方向翻成 blocklist**(新狀態預設佔額度) | §4-2 |
| Q3 兩本帳 | **現在就把 `payment_refunds` 算進去**(現恆 0、2g 上線自動生效) | §4-2 |
| Q4 卡單擋到合法退款 | **擋死,但訊息直接指出是哪一筆卡住** | §4-4 |
| Q5 場外退款登記入口 | **不做**,守住範圍、另立 backlog | §8 |

---

## §4 設計

### 4-1 兩層,各自擋什麼(講清楚誰擋不到什麼)

| 層 | 擋什麼 | 擋不到什麼 |
|---|---|---|
| **前台**(`refund-form.ts` 上界) | 手滑打太多 —— **最大宗**,而且當場就看得到 | 繞過前台的請求;兩人同時送 |
| **RPC 步 6**(2f 鎖之後) | 繞過前台;**並發**(2f 已序列化) | 直接對 DB `INSERT`(需 service_role = 我方自己的程式) |
| TapPay(不動) | 最後一道 | partial 我方不查帳;正式環境行為只有 sandbox 實證 |

🔴 **Q1=A 刻意不做 trigger 層**,代價寫在這裡不掩飾:**我方未來若有程式繞過 RPC 直接寫帳本,本片擋不到。**
理由=trigger 層擋不了並發(要自己再做序列化)、而唯一能直接 INSERT 的身分是我方自己的 service_role。
⇒ 列 §8 誠實邊界,不寫成「已全面防護」。

### 4-2 守門專用算式(新函式,與顯示用那條並存)

新函式(名稱待定,暫稱 `pcm_order_refund_guard_remaining(uuid)`),與 `pcm_order_refundable_remaining` 的**三點差異**:

1. **方向翻轉為 blocklist**:只有**明確證實不佔額度**的狀態(`deferred` / `failed`)才扣掉,
   其餘一律**佔額度**。⇒ 未來新增任何狀態,**預設是擋**(fail-closed),不是放行。
   對照:顯示版是 allowlist(`:411` 逐字「未來新增任何 status 值預設不佔額度」)=**fail-open 方向**。
2. **算兩本帳**:`order_refunds` ∪ `payment_refunds`。
   ⚠️ `payment_refunds` 現無 writer(2g 未建)⇒ 這半**現在恆為 0**,加它是零行為影響。
3. **NULL 語意**:查無訂單回 NULL;**守門遇 NULL 一律擋**(fail-closed),不當成無限額度。

🔴 **兩條式子並存 = 漂移風險,必須有機械守門**:
加一條測試 —— **在現行狀態集合下,兩式對同一組資料必須回傳相同值**。
新增狀態時該測試會紅 ⇒ 逼人回訪兩邊。**沒有這條,Q2=A 就是在製造下一個漂移點。**

> 為什麼不直接改顯示版:顯示版已被驗收、有措辭鐵律與負向測試綁著,改它會把顯示層一起拖進本片。
> 片界紀律:**本片不動顯示層語意**。

### 4-3 RPC 步 6 的改法

```
步 6(現況只管 full)→ 擴成:
  full   : v_frozen < 1                    → REFUND_NOTHING_LEFT(不動,既有語意)
  partial: v_frozen > guard_remaining()    → REFUND_EXCEEDS_REMAINING(新第 9 碼)
```

位置紀律:**必須在步 3(2f 的 advisory lock)之後**,否則並發防不住。
順序紀律:**必須在步 4 冪等 G4 之後**——否則同 token 重播會拿到超退碼而非 `DUPLICATE_REQUEST`
(這正是 `:418-420` 註記過的同型陷阱:關卡2 codex MF4 的教訓)。

### 4-4 第 9 碼與訊息(Q4=A 的落點)

新碼 `REFUND_EXCEEDS_REMAINING`。回傳除 `result` 外**附帶**:
- `remaining`:守門算出的可退額
- `blocked_by_pending`:布林 —— 是否**有 `processing` 狀態的退款正佔著額度**

前台文案據此分流:
- `blocked_by_pending = false` → 「這張單最多還能退 N 元」(單純打太多)
- `blocked_by_pending = true` → 🔴 「有一筆退款卡在處理中、正佔著額度,**先去處理那一筆**」+ 指向帳本區塊
  (這就是 backlog `#442` 的卡單;Q4=A 的用意是**逼人面對它,不製造繞道**)

⚠️ 新增碼要**同步四處**(§2-5):RPC 內、`:599` COMMENT、`:1031` 結構斷言、
app 層 `refund-actions.ts:300` 對照 + `refund-action-state.ts:74,120` 文案 + `refund-actions-dispatch.test.ts:363` 對照表。

---

## §5 片界:**拆兩片**,且順序不可顛倒

> 依據:P 十一代交接的片界紀律「一片=一支 migration **或**一個純應用層改動,**不混**」;
> 以及 memory `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 A9h 正式站壞 8 小時)。

### 445a —— 純應用層(**輕量片**,先做)

1. `refund-form.ts` partial 金額上界:`MAX_AMOUNT`(`:36`)→ **改成該單的帳本未登記額**
   (值已經在頁上,見 §2-6;`:107` 是唯一比對點)
2. app 層**先認得**第 9 碼 `REFUND_EXCEEDS_REMAINING`(此時該碼還不會出現 ⇒ 純向後相容)
3. 文案兩支(§4-4 分流),**措辭必守 §2-7 鐵律**

🔴 **445a 不依賴任何 migration** ⇒ 可先上線,先擋住最大宗的手滑。
🔴 **445a 的碼處理必須先於 445b apply** —— 反過來就是「migration 產出 app 不認得的碼」= caller bug 路徑。

### 445b —— 純 migration(**高風險片**,後做)

1. 新守門函式(§4-2)
2. `admin_initiate_order_refund` 步 6 擴充(§4-3)+ 第 9 碼(RPC 內 / COMMENT / 結構斷言)
3. 兩式等價測試(§4-2 末)
4. **apply = Sean 停點**;停點要講的話寫進本片 plan,以 **migration 檔頭為準**
   (今晨 2f 停點的教訓:只轉述 plan §9 會漏掉檔頭裡最能左右決策的那句)

---

## §6 驗收條件(逐條 yes/no,不可用「應該」回答)

**445a**
1. ☐ partial 輸入超過帳本未登記額 ⇒ 表單**擋下、不送出**(正測)
2. ☐ partial 輸入等於未登記額 ⇒ **放行**(邊界正測,防 off-by-one)
3. ☐ 未登記額為 `null`(讀不到)⇒ **擋**(fail-closed 負測)
4. ☐ app 收到 `REFUND_EXCEEDS_REMAINING` ⇒ 不進 unknown-code 路徑、吐兩支文案之一
5. ☐ 文案零命中「還能退」「剩餘可退」(§2-7 鐵律,機械 grep)
6. ☐ 三綠 + `vitest run` 全綠

**445b**
7. ☐ 守門函式在現行狀態集合下與顯示版**逐值相等**(等價測試)
8. ☐ 新增一個假狀態值 ⇒ 守門版**佔額度**、顯示版不佔(方向翻轉的負測 —— 沒這格等於沒證明翻轉)
9. ☐ partial 超額 ⇒ 回 `REFUND_EXCEEDS_REMAINING`,且 `blocked_by_pending` 值正確(兩種情境各一格)
10. ☐ partial 恰等於可退額 ⇒ `INITIATED`(邊界正測)
11. ☐ 同 token 重播超額請求 ⇒ 回 `DUPLICATE_REQUEST` **不是**超退碼(順序負測,§4-3)
12. ☐ `payment_refunds` 造一列在途 ⇒ 額度被扣(**證明兩本帳真的都算**,不是只寫了 SQL)
13. ☐ 回傳碼閉集斷言(`:1031`)已含第 9 碼且通過
14. ☐ 回退腳本可單獨跑回舊版本 + 負測

---

## §7 回退

- 445a:純前端 + 純函式,`git revert` 即可,無資料面。
- 445b:`CREATE OR REPLACE` 回舊版 RPC + `DROP FUNCTION` 新守門式;**不動任何資料列** ⇒ 回退零資料風險。
- ⚠️ 回退腳本的連線拓樸紀律沿用 2f:**直連 5432、不走 pooler 6543**(2f rollback 檔頭已有先例)。

---

## §8 誠實邊界(做完能宣稱什麼 / 不能宣稱什麼)

**能宣稱**:擋得住**本系統自己造成的**超退(前台手滑、繞過前台的 RPC 呼叫、同單並發)。

**不能宣稱**:
1. 🔴 **擋不住「Portal 場外退過了、後台又退一次」** —— Sean 直接在 TapPay Portal 退的錢永遠在帳本之外
   (`:411` 逐字「真實剩餘額 ≤ 本值」)⇒ 我方算出的可退額**只會高估**。Q5=A 決定不做登記入口 ⇒ 這個洞留著。
2. 🔴 **擋不住繞過 RPC 直接 INSERT**(Q1=A 不做 trigger 層,§4-1)。
3. TapPay 正式環境的拒絕行為**仍只有 sandbox 實證**,本片不改變這件事。
4. 445a 單獨上線時,**只擋前台** —— 那段期間 RPC 仍不查帳。

> **名字大於實力的防護比沒有防護更危險**:員工會以為系統會擋。
> ⇒ 任何 UI 文案、commit body、STATUS 都不得出現「已防止超額退款」這種全稱句。

---

## §9 相關既有紀錄與連動面

- backlog `#445`(本片)/ `#442` 卡住的補償退款永久隱形(Q4=A 的訊息會指向它)/ `#443` 異常清單只讀一本帳
- `#444` `payment_charge_attempts.order_id` 無 immutable 守門 —— **與本片共用「尺度可信」假設**
- 2f = `20260812170000`(**今晨已 apply**);本片的並發前提整個騎在它的 advisory lock 上
- 2g(未建)= `payment_refunds` 的 writer;本片 §4-2 第 2 點在 2g 上線那天自動生效
- memory:`project_0812-fuzzy-logdrain-dirty-decisions`(超退閘拍板)/
  `feedback_app-layer-must-not-ship-before-migration-apply`(§5 順序紀律)

---

## §10 估時

- 445a:**45-60 分**(輕量片;上界 + 碼對照 + 兩支文案 + 測試格)
- 445b:**90-120 分**(高風險片;新函式 + 步 6 + 第 9 碼四處同步 + 8 個驗收格 + rollback + 對抗審查)

---

## §11 這份 plan 還沒過的關

1. ☐ **關卡1 codex 對抗審查**(高風險片必跑;08-12 拍板 R1 一律先 codex)
2. ☐ **Sean 批准**(鐵則 8)
3. ☐ 445b 的 **apply 停點**(Sean 停點,素材以 migration 檔頭為準)
