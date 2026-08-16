# 出貨單補「貨運商 / 追蹤碼 / 出貨日」· PLAN

> ✅ **本 plan 已由 Sean 批准。** 命中鐵則 8(跨 3+ 檔 + 對外可見的紙),批准逐字如下:
> **Sean 2026-08-16 深夜逐字「可以做」**
> (批准字面原本只活在對話與 memory 裡,C-212 於 2026-08-16 補寫進本檔頭。)
> **窗** C · **2026-08-16** · **片型** 標準片(對外單據顯示層;**不碰錢、不碰 schema、不碰權限**)
> **內容分級** L1 · 座標實測自 `/Users/sean_1/pcm-print` @ `1dc65d34`。**行號會漂,引用前自己重跑。**

---

## §0 白話:客人拿到貨,不知道去哪查

設計需求書把**追蹤碼**列為「**必須(缺)**」,理由逐字:**「客人查貨的唯一依據」**
(`2026-08-16-print-docs-design-brief.md:78`)。
**而現在那張紙上一個字都沒有** —— 沒有貨運商、沒有追蹤碼、沒有出貨日。

⇒ 客人收到箱子,想知道「這是誰送的、我的另一半貨在哪」,**紙上沒有任何可用的東西**。

> 📏 **數法**(C-212 2026-08-16 補;原句是沒附數法的全稱句):
> `git show 1dc65d34:apps/admin/src/components/print/shipping-doc.tsx | grep -cE 'carrierCode|trackingNumber|貨運商|追蹤碼'` ⇒ **0**。
> ⚠️ 分母 = 落地前那一版元件檔;**這句只對「片3 落地前」成立**,片3 之後它就是假的。

---

## §1 資料都在手上,不用動 schema(這是本片便宜的原因)

```
ShipmentRow（shipment-repository.ts:199-203）已經有：
  carrierCode      string  ← 🔴 更正（C-212）：ShipmentRow 上它是 string，不是 union
                           （錨點 `carrierCode: string`）。union 是 `CarrierCode`，那是【寫入端】的型別。
                           ⚠️ 這條是 §2.2「未知代碼要能落地」整段論述的前提 —— 寫成 union
                              會讓下一個讀者以為那段多慮。
  carrierNote      'other' 時的說明（自取／自送）
  trackingNumber   string | null
  shippedAt        string | null
```
**⇒ 零 migration、零 API 改動、零新查詢。** 純粹是「有資料沒印出來」。

---

## §2 🔴 `CARRIER_LABEL` 的權威來源 —— **主視窗指名要回答的那一題**

### 2.1 權威在 DB,不在任何一個元件

```sql
-- supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:103-104
CONSTRAINT shipments_carrier_domain
  CHECK (carrier_code IN ('hct', 'sf', 'other')),
```
**⇒ 這三個代碼的【集合】由 DB 定,不由 TS 定。**

**而中文標籤(`新竹物流` / `順豐` / `其他`)在 DB 裡【不存在】** ——
~~目前唯一一份寫在 `components/orders/shipment-section.tsx:20`,**module private**。~~

> 🔴🔴 **更正(C-212 2026-08-16 實作時證偽,並經 R1 code-reviewer 再修一次數字)**:
> 上面那句「**唯一**一份」**是錯的,而且寫的人沒有數**。
> **數法**:`git grep -nE "'hct'|新竹物流" HEAD -- apps packages` ⇒ 落地前這個值域在 TS 側有 **4 份手抄**:
> ```
> lib/shipping/shipment-repository.ts   type CarrierCode = 'hct' | 'sf' | 'other'   ← 🔴 寫入路徑
> components/orders/shipment-section.tsx  Record<string,string>       （訂單卡片顯示）
> components/orders/shipment-dialog.tsx   [{code,label}]              （建箱下拉選單）
> components/orders/shipment-dialog.tsx   useState<'hct'|'sf'|'other'>（表單 state）
> ```
> 🔴🔴 **這裡有三層數法各自漏東西,而漏的方向不一樣 —— 這才是本條真正的教訓**:
> ```
> 用識別字 CARRIER_LABEL 掃 ⇒ 撈到 1 份（原 plan 的數法）
> 用中文標籤「新竹物流」掃  ⇒ 撈到 2 份（C-212 第一次更正的數法）
> 🔴 CarrierCode 那份【兩種數法都撈不到】—— 它一個中文字都沒有，識別字也不同
>    而它偏偏是【寫入路徑】那一份
> ```
> ⇒ 本片除了統一標籤,還把 `CARRIER_LABEL` 的型別綁成 `Record<CarrierCode, string>`
>   ⇒ 之後改 `CarrierCode` 而忘了改標籤表 ⇒ **typecheck 直接紅**,不必等測試。
> ⇒ §6 的檔案清單因此 5 檔 → 8 檔(兩個原因見 §6 的框)。

### 2.2 ⇒ 本片要做的事,與**不**做的事

```
✅ 做：把那份標籤抽到 lib/shipping/carrier-label.ts，【三個】消費端共用
       （後台卡片 shipment-section／建箱彈窗 shipment-dialog／出貨單 shipping-doc）
       🔴 「兩個」是本 plan 落地前的錯數，見 §2.1 更正框
✅ 做：加一格守門，斷言標籤表【對 DB 那三個代碼是完備的】
        —— 而它釘的是「TS 這份表有沒有漏一個代碼」，不是「DB 有沒有改」
❌ 不做：把標籤搬進 DB。那會多一次查詢、而且中文文案改一次要跑 migration
❌ 不做：讓標籤表變成代碼的權威 —— 它是【投影】，DB 才是真相
```

🔴🔴 **而守門有個【天生做不到】的地方,要先講清楚,免得它看起來比實際強**:
> **DB 加了第四個代碼時,這格【不會紅】。**
> 它只看得到 TS 這一側;真相在 migration 裡,而 TS 讀不到 migration。
> ⇒ **回退行為必須是安全的**:未知代碼 **印出代碼本身**
> (落地前 `shipment-section.tsx` 的 `CARRIER_LABEL[code] ?? code` 就是這樣;落地後改走
>  `carrier-label.ts` 的 `carrierLabelOf`,行為逐字相同。**行號已漂,用錨點文字找**),
> **絕不印空白** —— 空白會讓客人以為沒有貨運商,印出 `xyz` 至少會讓人來問。
> ⚠️ **這是「多報」不是「少報」的同一條原則**(見 `outstandingQuantity` docstring)。

---

## §3 三個欄位各自的規則

| 欄 | 規則 | 依據 |
|---|---|---|
| **貨運商** | `CARRIER_LABEL[code] ?? code`;`other` 另印 `carrierNote`(自取/自送) | DB 雙向配對 CHECK `:106` |
| **追蹤碼** | 有就印。**沒有時不要留一個空欄位** | 見 §3.1 |
| **出貨日** | `shippedAt` 有值印它;**沒有值印【列印當天】** | Sean 拍甲,見 §3.2 |

### 3.1 🔴 追蹤碼是 `null` 的兩種情形,**意思完全不同,紙上不可以長一樣**

`shipments.tracking_number` 的 COLUMN COMMENT 逐字(`20260805170000…:195`):
> **已出貨的列**之中,`tracking_number IS NULL` **只可能發生在 `other`**(自取/自送,`carrier_note` 有說明)。

而 `mark_shipped` `:165` 擋:**非 `other` 且追蹤碼空白 ⇒ 拒絕標記出貨。**

```
情形①  箱還沒標出貨          ⇒ 追蹤碼還沒有（正常）  → 印「尚未出貨，出貨後補」
情形②  已出貨 + other（自取）⇒ 本來就沒有（正常）   → 見下方【更正】
情形③  已出貨 + 非 other 但沒有 ⇒ 🔴 DB 說這不可能發生
                                → 印「追蹤碼缺漏，請回報」，不要靜靜留白
```
⚠️ **③ 是 fail-loud**:那代表寫入鏈有洞,而**紙已經要寄出去了** ——
**留白的話員工不會發現,客人拿到一張查不到貨的紙。**

> 🔴 **情形② 的更正(C-212 實作時偏離,R1 code-reviewer 指出)**:
> 原文寫「印 `carrierNote`,**不印追蹤碼欄**」。實作**兩處都沒照做**,而兩處都是刻意的:
> ```
> ① 不重印 carrierNote —— 它已經印在「貨運商」那格了（貨運商:其他(客人自取)）
>    同一句話在同一張紙出現兩次 ⇒ 讀的人以為是兩件事
> ② 追蹤碼那一列【照印】，內容是「無追蹤碼(自取 / 自送)」
>    🔴 整欄消失 = 留白，而留白正是 §3.1 其他三條分支拚命在避免的東西
> ```
> ⇒ 逐字採用 plan 會讓本節自相矛盾;偏離已寫進 commit body,不是漏做。

### 3.2 出貨日:Sean 已拍板,而且**明知會偶爾差一天**

設計需求書 `:137` 逐字:
> 未出貨時印**列印當天**。標籤兩條路共用「出貨日」(Sean 拍甲,**明知偶爾會與系統差一天**)
> ⇒ 設計端**不要**額外加「以系統為準」之類的但書。

⇒ **照做,不加但書。** ⚠️ 但實作上有一個坑要處理:
```
🔴「列印當天」在 server component 裡是 new Date() —— 它算的是【伺服器的今天】
   而伺服器在 UTC 時,台北時間 00:00–08:00 之間會印成【昨天】
   ⇒ 必須走 Asia/Taipei 曆面（repo 既有 formatOrderListDate 就是為這件事寫的：
      order-list-view.ts:753 逐字「年份比較在 Asia/Taipei 曆面做、不是拿 UTC 年份比」）
   ⚠️ 測試要注入固定的 now，不能讓它讀真實時鐘（否則那格會在半夜自己紅）
```

---

## §4 🔴 三個碼並排,客人不知道該拿哪個去查

紙上現在會有**三個號碼**:訂單編號 / 箱號 / 追蹤碼。
設計需求書 `:72` 早就標了這個風險(當時只有兩個):
> **兩個碼並排裸印,客人不知道該拿哪個去查**

⇒ **三個都必須各自帶標籤**,而且**追蹤碼要標明是哪一家的**(「新竹物流追蹤碼」不是光「追蹤碼」)。
📎 **因為只有追蹤碼是【拿去別人家網站查】的**,另外兩個是我們內部的號。

---

## §5 ⚠️ 新竹物流那些約束,與本片的關係(主視窗指名要答)

我查了 `memory reference_hct-logistics-api`,**逐條對本片判定**:

```
「回傳圖檔一次上限 5 筆」        → ❌ 與本片無關。那是【呼叫 HCT API 印託運標籤】的限制，
                                    本片只印我們自己的 A4 紙，不呼叫任何 HCT API
「同日訂單編號不可重複」          → ⚠️ 與本片【無關但相鄰】，見下
「查貨只查得到 30 天內」          → ⚠️ 與本片【無關但相鄰】，見下
「貨號 10 碼含檢查碼、可自行驗證」→ ❌ 本片不驗，見下
```

### 🔴 「相鄰」那兩條的意思:**它們影響【客人查得到嗎】,而本片只負責【印得出來嗎】**

```
· 同日分批出貨時我方訂單編號會撞（memory 逐字「後綴規則須先定案(未定)」）
  ⇒ 那是【送單給 HCT】那條線的債，不是列印線的。本片印的是 DB 裡已經有的追蹤碼
  ⇒ 但若那條規則之後定了、而它改了箱號的形狀，本片印的箱號會跟著變 ⇒ 登記為連動面
· 查貨只查 30 天 ⇒ 客人拿三個月前的紙去查會查不到，而紙上不會有任何說明
  🔴 我【不建議】在紙上加「30 天內有效」——那是 HCT 的政策、可能改，
     而紙印出去就收不回來。⇒ 明確不做，登記在此
```

### ❌ **本片不驗追蹤碼的檢查碼**,理由要寫下來
memory 記著貨號 10 碼 = 9 碼 + `MOD(前9碼,7)`、**可自行驗證**。
**而本片不做**:那是**寫入端**該擋的(`mark_shipped` 已經擋空白),
**在列印端驗 = 在最後一刻才發現,而那時貨已經要出門了**。
⇒ 登記成 backlog 候選:**追蹤碼格式驗證應該加在建箱/標記出貨的表單上,不是紙上。**

---

## §6 檔案清單與驗收

```
新  lib/shipping/carrier-label.ts          標籤表 + 完備性守門的被測物
新  lib/shipping/carrier-label.test.ts     不需渲染就跑得動（同 shipping-doc-quantities 的理由）
新  lib/shipping/shipping-doc-dispatch.ts       追蹤碼三情形 + 出貨日（實作時新增，見下）
新  lib/shipping/shipping-doc-dispatch.test.ts  出貨日那格要切 TZ=UTC，在頁測裡做不乾淨
改  components/orders/shipment-section.tsx 改 import，刪掉私有那份（行為零變更）
改  components/orders/shipment-dialog.tsx  改 import，刪掉【第二份手抄】（行為零變更，見 §2.1 更正）
改  components/print/shipping-doc.tsx      表頭區加三個欄位
改  app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx  紙面格
⇒ code 檔 8 顆（本 plan 原寫 5 檔）
⚠️ 但 `git show --stat` 會看到 10 個檔：另外兩個是【plan 本身】，其中
   `2026-08-16-shipping-doc-information-architecture-plan.md` 是【別片】的 plan
   （C-212 的全稱句盤點順手更正了它兩句）。commit body 要交代，否則數字對不上。
```

> 🔴 **5 → 8 的原因有兩條,逐條列在下面(分母 = 這兩條,不是「大致上」)**:
> ① `shipment-dialog.tsx` 是**第二份手抄**(§2.1 更正)⇒ +1 檔。
> ② 追蹤碼/出貨日的判斷**不放進 `carrier-label.ts`** —— 那支的職責是「有哪些貨運商」
>    (三個消費端共用),而追蹤碼三情形只有出貨單在用。混在一起 ⇒ 檔名比內容窄。⇒ +2 檔。
> ⚠️ **鐵則 8 的判定不變**(本來就跨 3+ 檔、本來就要這份 plan);**這是同一片內的機械擴張,
> 不是範圍擴張**。主視窗 2026-08-16 逐字裁「同一片內的機械擴張,不需要重新提 plan,寫進 commit body 就好」。
> 📏 **「沒有 plan 沒講的行為」的數法**(可重跑):
> `grep -c "  it(" "apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx"` 之中,
> `#10 片3` 那個 describe 有 **8 格**,逐格對照 ⇒ 每一格都指得回 §3 / §3.1 / §4 的某一條。
> ⚠️ **這個數法看得到的是「新格有沒有出處」,看不到「有沒有漏做 plan 講過的事」** —— 後者靠 §6 驗收逐條。

**驗收(每格事前指名紅在哪)**
```
① 標籤表對 DB 三個代碼完備
   負向：從表裡刪掉 'sf' ⇒ 必紅
② 未知代碼 ⇒ 印代碼本身，不留白
   負向：改成印空字串 ⇒ 必紅
③ other ⇒ 追蹤碼那列印「無追蹤碼(自取 / 自送)」，carrierNote 只在貨運商那格印【一次】
   🔴 本條字面已更正（原寫「不印追蹤碼欄」）—— 理由見 §3.1 更正框
   負向：實作改成重印 carrierNote ⇒ 頁測「只印一次」那格紅
④ 已出貨 + 非 other + 追蹤碼缺 ⇒ 印「請回報」，不留白（§3.1 情形③）
   負向：改成留白 ⇒ 必紅
⑤ 未出貨 ⇒ 出貨日 = 列印當天（Asia/Taipei 曆面）
   🔴🔴 **本條 2026-08-16 實測後改寫 —— 原本寫的修法【無效】,見 §8.1**
   做法：測試裡先把 process.env.TZ 切成 'UTC'（實測在 vitest 裡切得動），
        再斷言輸出仍是台北曆面的那一天
   前提斷言：切之前先 expect(process.env.TZ).toBe('Asia/Taipei')
        —— 沒有這一半的話，哪天設定檔改了、這格會【靜默】變成在測一個沒被釘住的環境
   負向：把實作的 { timeZone: 'Asia/Taipei' } 拿掉 ⇒ 在 TZ=UTC 下輸出差一天 ⇒ 必紅
⑥ 三個號碼各自帶標籤，追蹤碼標明貨運商
⑦ shipment-section 行為零變更：既有測試一個字不改仍全綠
⑧ 三綠（--force）+ 全測
```

---

## §7 Rollback / 不做什麼

單顆 commit revert。**無 migration、無資料變更、無 API 介面改動。**
```
❌ 不把標籤搬進 DB      ❌ 不驗追蹤碼檢查碼（那是寫入端的事，§5）
❌ 不在紙上寫「30 天內有效」（HCT 政策會改，紙收不回來）
❌ 不碰 mark_shipped 或任何寫入鏈 —— 本片純顯示
❌ 不動金額區塊（另一片）
```

---

## §8 誠實邊界

### 🔴🔴 §8.1 出貨日那格:我原本寫的修法【是錯的】,實測之後改掉

**原文寫**:「若測資的 now 挑在台北與 UTC 同一天,這格恆綠 —— **必須挑跨日的那一刻**」。
**那句話假設「換一個時刻就能分辨」。實測推翻它**(2026-08-16,可重跑):

```
探針①  TZ=Asia/Taipei 下掃 960 個整點（40 天）：
        naive（不指定時區，吃 process TZ） vs fixed（明確 Asia/Taipei）
        ⇒ 兩者不同的時刻 = 0
   🔴 在釘死的 TZ 下【挑不到任何測資】能分辨兩者 —— 換時刻救不了這格。
      因為 process TZ 就是 Asia/Taipei，兩個實作讀的是【同一個時區】。

探針②  同一份 code 在 TZ=UTC 下跑（= production 伺服器的樣子）：
        naive = 2026-08-16 ／ fixed = 2026-08-17   ⇒ 差一天，缺陷是真的

探針③  在【vitest 裡】執行期 process.env.TZ = 'UTC' 之後，naive 跟著變成 08-16
        ⇒ 測試【切得動】環境 ⇒ 這才是有效的修法
        （在真環境跑的，不是在 node 裸跑推的；用完即刪、git status 零留痕）
```

**⇒ 修法從「挑時刻」改成「切環境 + 斷言前提」,§6 ⑤ 已改。**
🔴 **記法**:`vitest.config.ts:64` 釘死 TZ 讓**整族時區測試在 CI 恆綠**,
而**它同檔 :62-63 自己就寫著這件事** —— 我讀過那段、還在 plan 裡引用了它,
**卻仍然寫出一個「換測資就好」的修法**。⇒ **引用一個警告,不等於把它套用到自己正在寫的東西上。**


```
· 完備性守門【看不到 DB】—— DB 加第四個代碼時它不會紅（§2.2 已寫明，回退行為是安全方向）
· 我【沒有】跟 HCT 申請過任何服務，也沒看過真實的追蹤碼長什麼樣
  ⇒ §4「追蹤碼要標明是哪一家的」是從「客人要拿去別人家網站查」推的，不是觀察來的
· ~~出貨日那格我【還沒寫】~~ 🔴 **已於 C-212 寫完**（`lib/shipping/shipping-doc-dispatch.ts`
  + 同名 test 在執行期切 `TZ=UTC`）。§8.1 量到的那個假綠機制**已經被那份測試接住**。
  📎 `vitest.config.ts:64` 逐字 `env: { TZ: 'Asia/Taipei' }`，而同檔 :62-63 自己寫著
     「拿掉這行不會讓任何測試轉紅 —— 它會讓時區類守門**靜默失去判別力**」
     ⇒ 那正是會讓這格假綠的東西：測試跑在台北時區下，而 production 的伺服器不一定是
     ⇒ 這格要【自己強制壞值 + 斷言前提生效】，不能依賴環境（house 既有做法：
        `receipt-record-form.test.tsx` 有一格前置斷言直接檢查現行時區）
· 紙沒有印出來看過
```
