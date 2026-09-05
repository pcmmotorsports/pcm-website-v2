# 卡在 `unknown` 的箱怎麼救出來(2026-09-05 · `⟦ship-HCTUNKNOWNSTUCK⟧`)

> **誰會用到這一份**:後台按了「送新竹」之後,那一箱的狀態卡在 `unknown`,
> 而**畫面上那顆鈕按幾次都不會動**(那是刻意的)。
>
> **今天的實際暴露 = 0** —— `HCT_SUBMIT_ENABLED` / `HCT_API_ENDPOINT` 沒設 ⇒ 那顆鈕連
> `runHctSubmit` 都不會呼叫。**這一份是趁還沒有人受傷之前先寫的,不是在救火。**
>
> 🔴 **本檔的每一個欄位名、每一個值域、每一道 CHECK 都是當場開檔量的**,檔案:行號附在每一格旁邊。

---

## 🛑🛑 第 0 步 —— **什麼時候【不准改】**(先讀完這一節,再讀別的)

```
❌ 打電話問新竹,他們說「有收到」        ⇒ 不准改。那箱是 submitted 不是卡住。
❌ 打電話問新竹,他們說「我查不到／等等再說」⇒ 不准改。查不到 ≠ 沒收到。
❌ 電話打不通 / 現在是半夜 / 找不到窗口   ⇒ 不准改。等得到人再說。
❌ 你只是覺得「應該沒送出去吧」           ⇒ 不准改。
✅ 只有一種情況可以改:**新竹那邊的人明確說「這張單我們沒有」。**
```

🔴 **為什麼這麼硬** —— 這兩個方向的代價**不一樣重**:
```
改錯了(其實新竹收到了, 而你放回 draft ⇒ 有人再按一次送出)
   ⇒ 🔴 **客人收到兩箱。** 這是不可回收的:貨已經在路上, 而運費付兩次。
沒改(其實新竹沒收到, 而那箱留在 unknown)
   ⇒ 🟡 那箱不會出貨, 而**有人會發現** —— 客人會問、盤點會對不起來。
```
📌 **⇒ 一種錯會被發現,一種錯不會。所以預設是【不改】。**
(來源:`apps/admin/src/lib/shipping/shipment-actions.ts:590-596` 逐字
 「兩種都會錯, 而它們錯的方向不同:一種讓單子卡住(要人救), 一種讓客人收到兩箱。」)

⚠️ **而「查」這件事今天【只能打電話】** —— 新竹那個服務只講 SOAP,我們的查詢功能還沒接
(`Q-新竹傳輸方式` 未答)。**打電話問就是查,那不是繞過流程。**

---

## 一、先分清楚:卡住的箱**有兩種**,而它們要做的事不一樣

🔴 **這兩種在畫面上長得一模一樣,只有 DB 分得出來。**

```
甲型「佔位卡住」—— 我們寫了佔位, 而 HTTP 可能【從來沒發出去】
   形狀:hct_status = 'unknown'  且  hct_raw_response 裡有 "placeholder": true
   來源:shipment-actions.ts:599-605 —— 送出【之前】先寫的那一發,
        它逐字帶 requestId: null 與 raw: { placeholder: true, at: <ISO 時刻> }
   ⇒ 🔵 **新竹很可能真的沒收到。** 這一型才是本檔要救的。

乙型「新竹回了而我們讀不懂」—— HTTP 發出去了, 回應我們解不出結果
   形狀:hct_status = 'unknown'  且  hct_raw_response 是新竹的真實回應(沒有 placeholder 這個鍵)
   ⇒ 🔴 **這一型【本檔不處理】。** 送出去了是事實, 只是不知道結果。
     要處理它要先看得懂那份回應 —— 那要等 Q-新竹傳輸方式。
```

🎯 **`raw` 裡那個 `at` 就是佔位寫下去的時刻** ⇒ 它比 `updated_at` 準得多。
⚠️ **為什麼不要用 `updated_at`**:`shipments` 有 touch trigger
(`20260805170100:192` `pcm_b2_shipments_touch_updated_at`)⇒ **任何一次改動**都會動它,
不只是新竹這一路。⇒ 用它算「多久沒動」會把別人改的動作算進來。

---

## 二、貼板 —— **第 1 塊:只讀,先看清楚**

> 🔴 **這一塊一個字都不會改到東西。先跑它,把印出來的東西唸給新竹聽。**

```sql
-- ① 這箱現在到底是什麼
SELECT s.shipment_reference,
       s.hct_status,
       s.carrier_code,
       s.hct_request_id                              AS 新竹貨號,
       (s.hct_raw_response ->> 'placeholder') = 'true' AS 是甲型佔位,
       s.hct_raw_response ->> 'at'                   AS 佔位寫下的時刻,
       s.updated_at,
       s.shipped_at,
       s.deleted_at
  FROM public.shipments s
 WHERE s.shipment_reference = '<把箱單編號貼這裡>';

-- ② 🟢 正對照:這把尺在【正常的箱】上會印不一樣的東西
--    (少了它, 上面那一發印什麼你都會覺得合理)
SELECT hct_status, count(*) AS 幾箱
  FROM public.shipments
 GROUP BY hct_status
 ORDER BY hct_status;
```

**讀法**
```
是甲型佔位 = true  且 新竹貨號 IS NULL     ⇒ ✅ 本檔要救的那一型, 往下走
是甲型佔位 = false 或 NULL                ⇒ 🛑 乙型, 停。本檔不處理。
hct_status <> 'unknown'                   ⇒ 🛑 停。它沒卡住, 你找錯箱了。
deleted_at IS NOT NULL                    ⇒ 🛑 停。這張單已作廢, 不要碰它。
```

---

## 三、貼板 —— **第 2 塊:打完電話、確定新竹沒有這張單之後**

> 🔴 **前置閘寫在 SQL 裡面, 不是寫在你的記憶裡。**
> 條件不成立時它會改 **0 列**, 而它會**印出來告訴你改了幾列** —— 那就是你的驗收。

```sql
BEGIN;

-- 🔴 前置閘 + 動作合在同一發:條件不成立 ⇒ 改 0 列, 不會靜靜地做錯事
UPDATE public.shipments
   SET hct_status       = 'draft',
       hct_raw_response = jsonb_build_object(
         'manual_reset_to_draft', true,
         'at',      now(),
         ⛔ ~~'by',      '<你的名字>',~~
         ⛔ ~~'reason',  '電話向新竹確認未收到此單',~~
         🔴🔴 **2026-09-05 訂正:上面兩行【不可以放在這裡】。**
         🛑 `20260902060000` 逐字 `GRANT SELECT ON TABLE public.shipments TO authenticated`
            ⇒ **整張表、每一欄, 客人自己讀得到**
            ⇒ 把你的名字與那通電話的內容寫在這裡 = **直接給客人看**。
         ✅ 改放這一行(不含身分, 只留一個查得回去的號碼):
         'note',    '手動放回草稿-已電話確認',
         'previous', hct_raw_response          -- 🔴 舊的留著, 不要蓋掉
       )
 WHERE shipment_reference = '<把箱單編號貼這裡>'
   AND hct_status = 'unknown'                                  -- 閘①:現在確實卡住
   AND (hct_raw_response ->> 'placeholder') = 'true'            -- 閘②:確實是甲型
   AND hct_request_id IS NULL                                   -- 閘③:確實沒拿到貨號
   AND deleted_at IS NULL                                       -- 閘④:沒作廢
   AND (hct_raw_response ->> 'at')::timestamptz < now() - interval '15 minutes';  -- 閘⑤

-- ⬆️ 跑完看它印 UPDATE 1 還是 UPDATE 0
--    UPDATE 1 ⇒ 往下跑事後閘
--    UPDATE 0 ⇒ 🛑 **ROLLBACK, 不要調條件讓它變成 1。** 五道閘有一道不成立,
--               而「哪一道」要用第 1 塊查出來, 不是用試的。
```

```sql
-- 事後閘:確認它現在真的是我們要的樣子
SELECT shipment_reference, hct_status, hct_request_id,
       hct_raw_response ->> 'manual_reset_to_draft' AS 有留痕,
       hct_raw_response -> 'previous'               AS 舊的還在
  FROM public.shipments
 WHERE shipment_reference = '<把箱單編號貼這裡>';
-- 要看到:hct_status = draft · 有留痕 = true · 舊的還在 = 那個 placeholder 物件
-- 🔴 **而【誰做的、為什麼】不在這一欄** —— 它是客人讀得到的地方。
--    那兩件事今天沒有落點(手動改 DB 不進任何稽核表)⇒ 📌 **請自己記在別的地方。**
--    ✅ 而那正是 ⟦ship-HCTUNKNOWNSTUCK⟧ 片 A 那支 RPC 要解掉的事:
--       它把證詞與 actor 寫進 `admin_audit_log`(零 client 權限), 而不是寫進這一欄。
-- 任何一格不對 ⇒ ROLLBACK
```

```sql
COMMIT;   -- 三格都對才跑這一行
-- 或
ROLLBACK; -- 任何一格不對, 或你改變主意
```

### rollback(已經 COMMIT 之後想退回去)
```sql
BEGIN;
UPDATE public.shipments
   SET hct_status       = 'unknown',
       hct_raw_response = hct_raw_response -> 'previous'
 WHERE shipment_reference = '<把箱單編號貼這裡>'
   AND hct_status = 'draft'
   AND (hct_raw_response ->> 'manual_reset_to_draft') = 'true';
COMMIT;
```
🔵 **它退得回去的理由**:第 2 塊把舊的 `hct_raw_response` 整個塞進 `previous` 了。
🛑 **而它退不回去的東西**:`updated_at` 已經被動過兩次 —— 那是**留痕,不是損害**。

---

## 四、🛑 這一份【證不到】什麼(照實寫)

```
1  🔴 它證不到「新竹真的沒收到」—— 那是【電話那頭的人說的】, 我們這邊沒有任何量具。
   ⇒ 整份 runbook 的正確性掛在第 0 步那通電話上。
2  🔴 乙型(新竹回了而我們讀不懂)本檔不處理 —— 要等 Q-新竹傳輸方式。
3  15 分鐘這個數字**沒有來源** —— 它是我挑的,理由只是「比一次 HTTP 逾時久」。
   ⚠️ 而它是【前置閘】不是【判準】:它擋的是「剛按下去還在跑」那一種, 不是在證明什麼。
4  本檔沒有被跑過 —— **零次**。今天沒有卡住的箱可以拿來演練(暴露 = 0)。
   ⇒ 📌 **所以這一份是【讀起來對】, 不是【跑過對】。** 第一次真的用它的人請回報哪裡不對。
5  稽核那一半:送出流程的稽核是**應用層 structured log**(`console.info`),
   **不是** `admin_audit_log`(`shipment-actions.ts:85` 逐字)。
   ⇒ 要查「這箱到底有沒有被按過送出」, 去看 Vercel 的 runtime log, 不是 DB 的稽核表。
   🔴 而手動改 DB 這件事**不會進任何稽核表** —— 它的痕跡只有第 2 塊塞進 `hct_raw_response`
     的那幾個欄位。**那就是為什麼那幾個欄位要填。**
```

## 五、量到的事實(這一份的地基)

```
hct_status 值域   draft / submitted / failed / unknown
                  20260904140000_m4b_shipments_hct_status_unknown.sql:98
CHECK             hct_status <> 'submitted' OR NOT pcm_b2_is_blank(hct_request_id)
                  20260805170000:138  ⇒ 🔵 只管 submitted ⇒ draft 帶著貨號是合法的
CHECK             hct_status = 'draft' OR carrier_code = 'hct'
                  20260805170000:142  ⇒ 🔵 回 draft 一定過得了這一道
write-once        hct_request_id 一旦非 NULL 就【不可改也不可清空】
                  20260904170000 pcm_b2_shipments_hct_request_id_write_once
                  🎯 **而甲型不受它影響** —— 佔位那一發逐字 requestId: null
                     (shipment-actions.ts:602)⇒ 貨號從來沒被寫過
                  ⇒ ⇒ 📌 **所以放回 draft 之後那箱【還送得出去】。**
                     🛑 而如果貨號【有】值, 那就不是甲型, 回頭讀第一節。
RPC 為什麼救不了  admin_record_hct_submit 對 old=unknown, new=unknown 直接 RAISE
                  20260904170000:163-169  ⇒ 那顆鈕按幾次都不會動, 那是刻意的
```

---
> **為什麼今天只有 runbook 沒有那顆鈕**:那支「查了確認沒送出去 ⇒ 放回 draft」的 RPC
> 要判斷「什麼叫查到了」,而**那個形狀由新竹的傳輸方式決定**(SOAP 回 XML,查無的形狀
> 與 JSON 不一樣)⇒ 📌 **migration 是不可變歷史,現在寫等於猜。**
> ⇒ 板列 `⟦ship-HCTUNKNOWNSTUCK⟧` 的 RPC 那半仍然 open,等 `Q-新竹傳輸方式`。
