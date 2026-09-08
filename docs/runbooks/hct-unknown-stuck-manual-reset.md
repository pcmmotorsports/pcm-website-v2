# 卡在 `unknown` 的箱怎麼救出來(2026-09-05 · `⟦ship-HCTUNKNOWNSTUCK⟧`)

> **誰會用到這一份**:後台按了「送新竹」之後,那一箱的狀態卡在 `unknown`,
> 而**畫面上那顆鈕按幾次都不會動**(那是刻意的)。
>
> **今天的實際暴露 = 0** —— `HCT_SUBMIT_ENABLED` / `HCT_API_ENDPOINT` 沒設 ⇒ 那顆鈕連
> `runHctSubmit` 都不會呼叫。**這一份是趁還沒有人受傷之前先寫的,不是在救火。**
>
> 🔴 **本檔的每一個欄位名、每一個值域、每一道 CHECK 都是當場開檔量的**,檔案:行號附在每一格旁邊。
>
> ## 🔴🔴 2026-09-08 訂正 —— **本檔原本的「乙型」判準是【到不了的】,而那個錯的方向會害人**
> ⛔ 原本教你:乙型的形狀是「`hct_raw_response` **沒有** `placeholder` 這個鍵」。
> 🛑 **那個形狀產生不出來** ⇒ 你照著判 ⇒ **每一箱都會被判成甲型** ⇒ 而甲型的處置是
>    「放回草稿 ⇒ 重送」⇒ 📌 **那正是【會出兩箱】的方向。**
> ✅ 訂正後的答案很短:**今天分不出來 ⇒ 一律停下來給人看。**(詳見下面第一節,舊字面留刪除線)
> 🔵 同時訂正:第二節那段 SQL 原本用 `->>` 比字串,而那支 RPC 自己明文說不可以(理由在下面)。
>
> ## 🔴 2026-09-08 第二次訂正 —— **有一部分的乙型,現在【分得出來】了**(`⟦ship-UNKNOWNTYPEUNREAD⟧`)
> ⛔ ~~甲型與乙型今天完全分不出來~~ ⇒ 🔴 **那句話對「大部分」仍然成立,而【不是全部】。**
> 🔬 `unknownReason.flowReason` 的值裡,有 **五種**代表**新竹的服務確定回過話了**:
> ```
> soap_fault              新竹回了 SOAP Fault
> epino_mismatch          回了, 而單號對不上
> row_count_<數字>        回了, 而列數不對
> unrecognised_success_…  回了, 而 success 欄我們不認得
> unrecognised_query_…    查詢那條路回了, 而我們不認得
> ```
> 🛑 **看到這五種的任何一種 ⇒ 那箱是乙型 ⇒ 不准放回草稿, 停在第 0 步。**
>    📌 **理由**:新竹已經收到那張單了 ⇒ **重送 = 第二張託運單 = 客人收到兩箱、兩個追蹤號。**
> ✅ **而畫面現在會替你擋** —— 後台那顆「重設為草稿」的鈕對這五種**不會出現**
>    (`apps/admin/src/lib/shipping/hct-unknown-kind.ts` + `shipment-repository.ts` 的 `isPlaceholderStuck`)。
>    ⛔ ~~乙型的鈕不出現~~ 這句在檔裡寫了很久,而 **2026-09-08 之前它是假的** ——
>    佔位標記是我們在 HTTP 發出去**之前**寫的,乙型也有 ⇒ 📌 **那顆鈕以前對乙型照樣亮。**
> 🔵 **其餘的值(`network:*` / `http_*` / `body_read:*` / `body_not_soap_json` / 沒見過的新值)
>    仍然【分不出來】** ⇒ 照下面第一節,走第 0 步。**沒見過的新值一律落在這一堆**(白名單,保守側)。

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
   ⛔ ~~形狀:hct_status = 'unknown' 且 hct_raw_response 是新竹的真實回應(沒有 placeholder 這個鍵)~~
   🔴🔴 [2026-09-08 訂正] **那個形狀【產生不出來】。** 寫 hct_raw_response 的路只有三條,逐條:
        · admin_record_hct_submit ⇒ unknown⇒unknown 被 RAISE 擋
          (20260904170000_m4b_hct_record_submit_result.sql:164-170)⇒ raw 停在 {placeholder:true};
          而 unknown⇒submitted/failed 會覆寫 raw, 但那時 hct_status 就不是 unknown 了
        · admin_record_hct_unknown_reason(20260908020000)⇒ 合併不覆蓋 ⇒ placeholder 留著
        · admin_hct_reset_unknown_to_draft(20260905320000)⇒ 它把 status 改成 draft ⇒ 也不是 unknown
        ⇒ 📌 **凡是 hct_status='unknown' 的列, raw 裡【一定】有 placeholder。**
        ⇒ 🛑 **所以照舊字面判, 你會把每一箱都判成甲型 —— 而甲型的處置是重送。**
   ✅ **今天真正的答案:甲型與乙型【分不出來】。**
        · 2026-09-08 起 raw 會多一格 unknownReason.flowReason(20260908020000),
          它記著我們這端為什麼讀不懂 —— **而它【不足以】判乙型**:
          network: / http_ / body_read: 這幾種它也會有值, 而那幾種【可能根本沒送到】。
        · 而最常見的那幾種(逾時 · http_500/502/504 · soap_fault)**新竹建單了沒, 我們這端沒有量具**
          ⇒ 那是要問新竹的問題, 不是查 DB 查得出來的。**已列進要寄給新竹的信(第 ④ 題)。**
   ⇒ 🛑 **在新竹回答之前, 這一節的操作結論是**:
        **看到 unknown ⇒ 走第 0 步。除非新竹的人明確說「這張單我們沒有」, 否則不准改。**
        📌 而第 0 步本來就是這樣寫的 —— **它擋得住這個錯, 而上面那個判準會讓你繞過它。**
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
       -- 🔴 [2026-09-08 訂正] 用 `->` 比 jsonb, ⛔ ~~不要用 `->>` 比字串~~
       --    理由是那支 RPC 自己寫的(20260905320000_m4b_hct_reset_unknown_to_draft.sql:151-155):
       --    `->>` 會把 JSON boolean `true` 與 JSON 字串 `"true"` 都轉成文字 `true`
       --    ⇒ 一筆新竹的真實回應若剛好帶 `"placeholder":"true"`(字串)會被誤判成甲型。
       --    🛑 而這一段是【給你複製貼上】的 ⇒ 它用的比法必須與那支 RPC 一致,
       --      否則你在這裡看到 true 而 RPC 拒絕你, 你會以為是別的問題。
       (s.hct_raw_response -> 'placeholder') = 'true'::jsonb AS 是甲型佔位,
       -- 🔵 2026-09-08 起多這一格:我們這端為什麼讀不懂(20260908020000)
       --    ⚠️ 有值【不代表】新竹沒收到 —— 見上面「乙型」那一段的訂正。
       s.hct_raw_response #>> '{unknownReason,flowReason}' AS 我們讀不懂的原因,
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
是甲型佔位 = true  且 新竹貨號 IS NULL     ⇒ ⚠️ 先看 unknownReason.flowReason(下一行), 再決定
   └ 值是 soap_fault / epino_mismatch / row_count_* / unrecognised_success_* / unrecognised_query_*
                                          ⇒ 🛑 **乙型, 停。新竹收到了, 重送會出兩箱。**
   └ 其餘的值, 或那一格是空的            ⇒ ✅ 本檔要救的那一型, 往下走(仍要走第 0 步)
是甲型佔位 = false 或 NULL                ⇒ 🛑 停。本檔不處理。
hct_status <> 'unknown'                   ⇒ 🛑 停。它沒卡住, 你找錯箱了。
deleted_at IS NOT NULL                    ⇒ 🛑 停。這張單已作廢, 不要碰它。
```

---

## 二-b、🔴 打電話時**照著唸這五句**(2026-09-05 補;來源=新竹官方 PDF 的【缺口】)

Sean 2026-09-05 給了新竹的官方文件 `API服務說明 2022/12/30 ver 2.0`(27 頁,
抓在 scratchpad, **沒進 repo**;原址 `https://www.hct.com.tw/Report/API服務說明_V1.pdf`
—— ⚠️ 檔名寫 `_V1` 而文件自己每頁頁尾寫 `ver 2.0`, 是同一份, 別被檔名騙了)。

🛑 **那份文件裡【沒有取消這支服務】。** P.8「主要提供服務項目」表逐字只列四族十二個:
`TransData`(上傳託運資料)/ `UpdData`(**只改重量**)/ `TransReport`(確定出貨、列印總表)/
`QueryEDELNO`(查貨號)。
· 量法與正對照(同一發, 尺會動的證據):`TransDataCancel` **0** · `作廢` **0** · `Cancel` **0**
  ↔ `TransData` **15** · `QueryEDELNO` **8** · `UpdData` **9** · `TransReport` **9**。
· ⇒ 🎯 **而 `.asmx` 上掛著 `TransDataCancel_Json`** ⇒ 它是**未公開介面**, 官方文件不解釋它。

### ✅ 照唸(五句, 缺哪一句都不能寫碼)
1. `TransDataCancel_Json` 的 `json` 字串裡要放哪些欄位、各是什麼型別, 給一份範例。
2. 單號用哪一種:**新竹貨號(`edelno`)** 還是**我們的訂單編號(`epino`)**, 還是兩個都要。
3. 回什麼算成功?(我們在 `TransData` 那邊看到的 `success` 是 `Y` / `R` / `N`。)
4. 有沒有截止時點?是不是也吃「當日 18 時前 / `TransReport` 之前」這條線。
5. **已經被 `TransReport` 確認過**的單, 有沒有任何 API 路可以作廢?

### 🔵 而文件給了一條【可能不用打電話】的替代路 —— **但它是推的, 不是文件裡的一句話**
P.8 同一頁逐字兩句:
```
新竹貨號+訂單編號 -> 當日重複上傳, 視同更正資料內容
TransReport()  確定出貨資料(列印託運總表)  當日確認出貨時(18時前上傳)
```
⇒ 我從這兩句**推**出來的形狀:**18 時前、還沒 `TransReport` 確認之前**, 用同一組
「新竹貨號 + 訂單編號」重傳可以更正內容(那就是我們碼裡把 `success='R'` 判成 `amended` 的那條路);
**確認之後**文件沒有任何路。
🛑 **而「重傳 = 更正內容」與「重傳 = 讓這張單不存在」不是同一件事** ——
**文件沒說能不能把一張已經產生的單變成不存在。** ⇒ 📌 **這就是第 5 句要問的那一句;**
**在它有答案之前, 電話這一步劃不掉。**

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
   -- 🔴 [2026-09-08 訂正] `->` 不是 `->>`(理由同上;RPC 逐字否決 `->>`)
   AND (hct_raw_response -> 'placeholder') = 'true'::jsonb     -- 閘②:確實是甲型
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
