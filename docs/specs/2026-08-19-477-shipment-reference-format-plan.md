# `#477` 包裹單號換格式 —— plan(鐵則 8:動 schema,等 Sean 批)

> 落檔 2026-08-19 00:5x CST(`date` 實跑)。作者 G2(後台訂單線)。
> **狀態:未批准。** 鐵則 8(動 schema)+ 鐵則 12③(DB 結構)⇒ 要 plan 等批,且 commit 前要過 codex 關卡2。
> 🔴 **本檔不做決定,它把決定攤開。** 兩處要 Sean 拍,寫在 §5。

---

## 0. 🔴 先讀:本片的體積由一個【我拿不到的數字】決定

```
shipments 現在有幾列?   ⇒ 我沒有 DB access,答不出來。這不是還沒查,是查不到。
  = 0  ⇒ 路 A:改一行 CHECK + 產號器換長度,零遷移
  > 0  ⇒ 路 B:多一格「既有列怎麼辦」,而那一格要 Sean 拍
```
### 🔴 更正(2026-08-19 01:0x):**那個時鐘【沒有在跑】,而原句寫成它在跑**

```
本檔第一版寫:「這個數字正在變大…訂單流正在被走」
🔴 那是【假的】。主視窗當場更正:它把「我派了 G5 去做」講成了「G5 正在做」。
G5 一手回報:它對正式後台的全部動作 = 三發【不帶憑證的 GET】
  admin/ ⇒ 303 ／ admin/orders ⇒ 303 ／ sso/start ⇒ 302 ／ quote authorize ⇒ 401
⇒ 它【沒有登入過】⇒ 那三筆單一次都沒打開 ⇒ 零寫入 ⇒ 【一次都沒按過出貨】
```
⇒ **正確的寫法**(引用本檔時請照這句,不要照第一版):
> **這個數字在【今晚這段時間】沒有增加;而它在【今晚之前】是多少,沒有人量得到。**

📌 **停錶那個動作仍然成立,只是價值換了位置**:它防的不是「正在發生的惡化」,
是「**一件還沒開始、而我們正要去做的事**」——**在按之前擋住,比事後補救好**。
實證:G5 寫給 Sean 的操作清單**第 5 站原本就是叫他按出貨**,已改成「先跳過」並 commit(`075d31c3`),
**改在那份檔到他手上之前**。

### 🔴 那個數字為什麼拿不到 —— **是「不拿」,不是「拿不到」,這兩者不要寫混**

```
· 四個窗都沒有 DB access
· 而 G5 特別聲明它【拿得到而不去拿】—— `.env.local` 就在它的工作樹裡,它逐字:
  「若我為了一個數字去讀 `.env`,我就親手示範了那條界線可以被一個好理由推開」
  ⇒ 引用時要用【不拿】,不要寫成能力不足。
· 🔴 而且【從畫面上也數不出來】:後台沒有全域包裹列表頁
  git ls-files apps/admin/src/app | grep -ci shipment ⇒ 3,而那 3 支全在
  apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/  = 逐單列印,不是清單
  ⇒ **零 `/shipments` 路由**(G5 先講,我獨立重跑確認)⇒ 只能從 DB 數。
  ⇒ 寫在這裡是為了擋住下一個人跑去畫面上找。
```
⇒ **主視窗已把「`shipments` 幾列」直接送 Sean**,不用窗再想辦法。

### 🔴 那個數字的欄位 —— **填的時候一定要帶「誰、什麼時候、怎麼量的」**

```
shipments 列數 = ______
量的人   = ______        (要具名到窗代號)
量的時間 = ______        (`date` 實跑值,不要寫 00:5x 這種外插值)
量法     = ______        (一句 SQL、或後台哪一頁的哪個筆數欄)
```
🔴 **這個數字會過期,而且是【每按一次出貨就過期一次】。**
⇒ 引用它之前先看時間欄;**時間欄比數字欄重要**。
⇒ 若時間欄早於「最近一次有人按出貨」⇒ **這個數字作廢,要重量**,不要拿它決定走哪條路。
📎 這一格的形狀 = `docs/patterns/guard-and-instrument-traps.md`
  「數字要離開量測現場時,把環境/層級/時點寫在數字旁邊跟著走」。
  **表會被複製走,前後文不會。**

---

## 1. 現況(全部當場開檔,不吃轉述)

```
DB 側
  supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:99
    CHECK (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$')
  產號器 public.pcm_generate_display_id()
    supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql:62
  後續動過 shipment_reference 的三支 migration
    20260807230000 / 20260808100000 / 20260810233000  ⇒ 沒有一支改長度(G6 查,我未重跑)

訂單號那一側(**注意:它不是本片要改的東西**)
  packages/domain/src/order/order-number-format.ts:27
    ORDER_NUMBER_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/
  消費端只有 display-id.ts:53 的 isValidDisplayId
```
🔴 **兩者同形狀、同產號器,而 TS 那條 regex 只服務【訂單】** ——
`git grep 'shipmentReference|shipment_reference' -- packages/domain packages/schemas`(排除 test)⇒ **零命中**
(分母:`git ls-files packages/domain packages/schemas | wc -l` ⇒ 57)
⇒ **包裹單號在 TS 側【沒有任何形狀驗證】**,它只是被當字串搬。
⇒ ✅ **好消息:改包裹格式【不需要】動 `order-number-format.ts`,訂單號那條不受影響。**

---

## 2. 影響面(`git grep -l 'shipment_reference|shipmentReference' -- apps packages` ⇒ **18 檔**)

```
 8  apps/admin/src/components/orders          列表/面板顯示
 5  apps/admin/src/lib/shipping               邏輯層
 2  apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]
 1  apps/admin/src/components/print           出貨單樣板
 1  packages/ports/src                        介面型別
 1  packages/adapters/src/supabase            讀寫
```
**它們全部把它當 `string` 用 ⇒ 改長度不會讓任何一支型別紅。** 🔴 而那正是風險所在。

### 🔴 2-a 真正會壞而【不會自己紅】的那一格:列印版面

```
apps/admin/src/components/print/shipping-doc.tsx:295   箱號 <b class='font-mono tracking-[0.04em]'>{shipmentReference}</b>
apps/admin/src/components/print/shipping-doc.tsx:452   箱號 {shipmentReference}
而測資把長度【釘死在 6】—— 🔴 **分母是 12 檔,不是 2**(M2;GR 抓到,我獨立重跑確認):
  `git grep -l "K7X2MP" -- apps packages | wc -l` ⇒ **12**
    app/print/orders/[id]/shipping/[shipmentId]/page-measure.test.tsx   ← 量版面那支
    app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx
    components/orders/receipt-undo-bar.test.tsx
    components/orders/shipment-dialog.test.tsx
    components/orders/shipment-launcher.test.tsx
    components/orders/shipment-mark-shipped-button.test.tsx
    components/orders/shipment-section.test.tsx
    lib/orders/receipt-actions.test.ts
    lib/orders/receipt-repository.test.ts
    lib/shipping/order-shipments.test.ts
    lib/shipping/shipment-actions.test.ts
    lib/shipping/shipment-repository.test.ts
```
🔴 **我第一版只寫了 2 檔 —— 少報 10 檔,而少報的方向是「看起來比較好做」。**
⇒ 那 10 檔換格式後**照樣綠**,而它們**從此量的是舊世界** ——
  §2-a 那句話對它們同樣成立,只是我當時沒把它們算進來。
⇒ **處置:逐檔判「換新格式」或「刻意留舊 + 在該檔寫下為什麼」**,不要全域 sed。
🔴 **`page-measure.test.tsx` 是【量版面】的守門,而它量的是 6 碼那個世界。**
換成 8 碼或加前綴之後,**那格照樣綠** —— 因為測資沒跟著換。
⇒ 這正是 `docs/patterns/guard-and-instrument-traps.md`
  「測試環境裡每一個【釘死】,都是主動移除一個維度」與「測資裡不存在的維度,不可能以失敗的形式出現」。
⇒ **驗收條件必須含:測資換成新格式之後,版面守門仍綠。** 只改 code 不改測資 = 沒驗。
📎 出貨單本來就有截斷守門的歷史(`#`ee7b1f35 那條)⇒ **箱號變長是它的正面靶,不是邊角。**

---

## 3. 兩條路

### 路 A —— `shipments` 列數 = 0

> 🔴 **R1 對抗審查(GR,2026-08-19)判 FAIL,3 must-fix。下面是折疊後的版本。**
> 原五步留在本節末尾當訃聞 —— **照原五步做會把出貨整條弄壞**,那個錯值得留著。

```
🔴🔴 **①-⑦ 必須在【同一支 migration、單一交易】裡**(R2 MF-2)——
   切成多檔的失敗形狀:檔1(新 CHECK)成功、檔2(改呼叫端)失敗
   ⇒ 停在「**新 CHECK + 舊產號器**」= M1 那個病的狀態,**而且會一直停在那裡直到下次成功 apply**。
   ⇒ M1 的病會在**接縫上**重生。單交易讓它要嘛全成、要嘛全退。

① apply 期斷言(M3;放在 migration 最前面,見 §3-a)
     IF EXISTS (SELECT 1 FROM public.shipments) THEN RAISE EXCEPTION
       '#477 路 A 前置不成立:shipments 已有列 ⇒ 改走路 B(見 plan §3 路 B)。
        🔴 回報主視窗,不要重試 —— 重試不會讓它變成 0。';
     🔴 訊息裡那半句是刻意的(R2 nit-a):`db push` 失敗時的自然直覺就是再跑一次,
        而這一條**重試永遠不會過**,不寫清楚會讓人白試好幾輪。
② 新 migration:DROP 舊 CHECK、ADD 新 CHECK(新形狀)
③ 產號器:pcm_generate_display_id 固定 6 碼且被【訂單】共用
   ⇒ 🔴 不要改它。包裹要自己的產號路徑,否則訂單號會一起變長。
   兩個做法(§5 Q2):加參數 / 另開一支 pcm_generate_shipment_reference()
④ 🔴🔴 **改呼叫端 —— 這一步原本【整個漏掉】(M1,BLOCKER)**
     CREATE OR REPLACE public.admin_create_shipment,把產號那行改成新路徑
     🔴 **函式名是 `admin_create_shipment`,不是 `create_shipment`**(R2 MF-1;見下方)
     ⇒ **以 w3a 那一版為底**(`20260807170000_m4b_e10_b2_w3a_create_shipment.sql:83` 是現行定義;
        w2 `20260807160000:599` 是它的前一代冪等層,拿 w2 當底會把冪等層退掉)
     要改的那一行:同檔 `:161` 逐字 `v_ref := public.pcm_generate_display_id();`
     並照本 repo 慣例補 N3b 式前置閘(`20260730120100:65` 那種:新函式解析不到就 RAISE)
⑤ TS 側:新增 SHIPMENT_REFERENCE_RE(N1),形狀照 order-number-format.ts
   ⚠️ 現況非測試 code 零 6 碼釘(GR 補量;我未重跑)⇒ 加它不是為了修今天的洞,
      是**給未來的 grep 一個錨點**,讓「DB 與 TS 不同步」這件事有地方被抓到。
⑥ 測資:**12 檔,不是 2**(M2,見 §2-b)—— 逐檔判「換新格式 / 刻意留舊並寫理由」
⑦ 回退:新 migration 附 rollback 段(照本 repo 慣例)
```
估:**90-150 分**(⚠️ 看影響面估的,**沒拆到步驟級**;上修是因為 ④⑤⑥ 是折疊後新增的)。

#### 🔴 R2 MF-1:**M1 的病差點在【它自己的修法】裡活下來**

```
本檔第一版的 ④ 寫「CREATE OR REPLACE public.create_shipment」
而那個名字【不存在】(我獨立重跑確認):
  git grep -c "FUNCTION public.create_shipment" -- supabase/migrations   ⇒ 命中檔數 0
  git grep -n "CREATE OR REPLACE FUNCTION public.admin_create_shipment" -- supabase/migrations
    ⇒ 20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:599
      20260807170000_m4b_e10_b2_w3a_create_shipment.sql:83      ← 現行版本
```
⇒ 照第一版字面做:`CREATE OR REPLACE` 一個不存在的名字 = **憑空 CREATE 出一支孤兒**,
   而**真正的 `admin_create_shipment` 繼續呼舊產號器** ⇒ **M1 的病原封不動地活下來,而 apply 全綠。**

🔴 **這個錯名是 R1 的審查者遞給我的**(它把檔名當函式名),它自己在 R2 認了。
📌 **而這一格的形狀值得記**:
**我抓了它路徑少一段(`m4b_e10_b2_`),而同一句裡的函式名也是錯的 —— 兩個人都沒抓到。**
⇒ **部分更正會讓剩下的部分看起來更可信。** 我修了它的路徑,於是那一句「已經被檢查過了」。
⇒ **可操作**:引函式名一律 `grep -n "CREATE OR REPLACE FUNCTION"` 開檔抄,**不從檔名推**。

#### 🔴 M1 的失敗情境(具體,而且三綠與 18 檔 TS 全綠)

```
只做 ②③ 而漏 ④ ⇒ 新 CHECK 只收新形狀,而 create_shipment 仍呼舊產號器出 6 碼
⇒ **每一次出貨的 INSERT 都撞 CHECK ⇒ 出貨整條壞掉**
⇒ 而 typecheck / lint / build / 18 檔 TS 全部綠 —— 它們看不到 DB 裡的字串比對
```
📎 **我為什麼會漏(GR 的診斷,我認)**:§1 盤點掃的是「**動過**這個欄位的三支 migration」,
**沒有掃「【寫入】它的那一支」**。⇒ 判別句:**盤一個欄位要改,問的是「誰寫它」不是「誰改過它」。**
🔴 而我獨立重跑時發現**證據比 GR 給的更硬**:
`20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:59-66` 逐字
「**不自寫,重用 N3a 的 `pcm_generate_display_id()`**…本片**零產號程式碼**」
⇒ **共用產號器不是巧合,是那一片明文的設計裁定** ⇒ 改格式必然要碰呼叫端。

#### 📌 訃聞:本節原本的五步(**照它做會弄壞出貨**)
```
~~① 新 migration:DROP 舊 CHECK、ADD 新 CHECK  ② 產號器 ③ TS 側零改動
   ④ 測資 page-measure.test.tsx:188 與 page.test.tsx:80  ⑤ 回退~~
漏掉的是【呼叫端】,而測資分母寫成 2(實際 12)。
```

### 3-a 🔴 M3:那個「拿不到的數字」可以被**一行 apply 期斷言**溶解

GR 的 finding,我認為它是本輪最有價值的一條 —— **它換掉了問題,不是回答問題**。

```sql
-- 路 A migration 的第一段
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shipments) THEN
    RAISE EXCEPTION '#477 路 A 前置不成立:shipments 已有列 ⇒ 改走路 B(見 plan §3 路 B)';
  END IF;
END $$;
```
**它一次解掉四件事**:
```
① 0 / >0 的交界由【機器】在【唯一要緊的那一刻】判 ⇒ 零 TOCTOU
   (人去量的那個數字,量完到 apply 之間隨時可能變 —— 那正是本檔 §0 的整段焦慮)
② 那個數字過期變成【無害】⇒ §0 的四欄戳記從「決定走哪條路」降級成「估時參考」
③ Sean 不用先去量 —— 他只要 apply,機器會告訴他走錯路了
④ 走錯路的後果從「靜默寫壞」變成「apply 當場 RAISE」⇒ 從安靜變成吵
```
📎 **本 repo 現成慣例,不是新發明**:N3b 前置閘(`20260730120100:65`)、
W1/W3 的 `to_regprocedure` 前置閘(`20260807150000:72` / `20260807170000:73`)。
🔴 **而 §0 那四欄戳記【不刪】** —— 它仍然決定「這片要排多久」,只是不再決定「走哪條路」。

---

### 路 B —— `shipments` 列數 > 0
路 A 全部,**加**:
```
⑥ 既有列怎麼辦 —— 三個形狀,代價不同,要 Sean 拍(§5 Q1)
   甲 舊列原地改號   最乾淨,而【已經印出去的出貨單上的箱號會對不上】
   乙 舊列保留舊格式,CHECK 放寬成「新格式 或 舊 6 碼」  零遷移,而混淆問題只解一半
   丙 舊列加前綴不改長度                                 折衷,仍要遷移
```

---

## 4. 這一片【不做】什麼(邊界,先寫死)

```
· 不動 packages/domain/src/order/order-number-format.ts —— 那是【訂單】號,不是包裹號
· 不動 pcm_generate_display_id 本體 —— 它被 create_order 共用,動它 = 訂單號一起變
· 不 apply、不 push。migration 寫好等 Sean apply(照 08-07 那次壞 8 小時的順序:先 apply 再上應用層)
```

---

## 5. 🔴 要 Sean 拍的兩題(**不要我替他選**)

```
Q1(只有路 B 才需要):既有的包裹列怎麼辦?
   甲 原地改號(已印出的單會對不上)
   乙 放寬 CHECK 收兩種格式(零遷移,混淆只解一半)
   丙 加前綴不改長度(折衷,仍要遷移)
   丁 **>0 而那些列【全是 Sean 自己的測試單】⇒ 確認後清掉,回到路 A**(N2,GR 補)
      🔴 為什麼一定要列丁:今晚已知後台訂單**全是他測試刷的**
        (memory `project_0818-payment-path-verified-by-seans-real-cards`)
        ⇒ 不列丁,他會在甲乙丙裡**替一批測試資料挑一個遷移策略** —— 那是白付成本。
      ⚠️ **清資料是他的動作,不是我們的**(鐵則 12① 動錢/資料面,不順手清)。

Q2:新格式長什麼樣?他 2026-08-14 拍的是「B = 換不同長度」,而【幾碼】沒定。
   甲 8 碼、同字母表(最小改動;而 8 碼與 6 碼一眼還是有點像)
   乙 6 碼 + 固定前綴,例如 `S-` (一眼可分;而它會讓箱號變長 2 字元 ⇒ 撞 §2-a 版面)
   丙 換一組不同的字母表(一眼可分、長度不變、版面零風險;而員工要記兩套字母表)
```
⚠️ **我對 Q2 有傾向但不寫進選項**:三案的**版面風險**不同(丙 = 零),
而版面那格是本片唯一「不會自己紅」的風險 ⇒ **這一點應該讓他知道再選**,而不是我代選。

---

## 6. 誠實揭示

```
· shipments 現在幾列 —— 我拿不到,本檔所有「路 A 還是路 B」都懸在這個數字上
· 「訂單流正在被走」是主視窗轉述,我沒有直接看到
· G6 那三支 migration「沒有一支改長度」是它查的,我未重跑
· 60-90 分是看影響面估的,沒有拆到步驟級
· 我沒有開瀏覽器、沒有跑列印預覽 ⇒ §2-a 的版面風險是【讀 code 推的】,不是量到的
· 🔴 **本檔第一版被 R1 對抗審查判 FAIL(GR,3 must-fix + 2 nit),全部已折疊**:
  M1 路 A 漏掉呼叫端(**照原版做會把出貨整條弄壞**)/ M2 測資分母寫成 2 而實際 12 /
  M3 那個數字可以被一行 apply 期斷言溶解 / N1 補 SHIPMENT_REFERENCE_RE / N2 Q1 漏了丁案。
  **M1 與 M2 我都獨立重跑確認過**(不是照收):
    `grep -n pcm_generate_display_id <create_shipment migration>` ⇒ `:161` 逐字命中
    `git grep -l "K7X2MP" -- apps packages | wc -l` ⇒ 12
· 📎 **一格給下一個讀 GR 那封信的人**:它給的路徑是
  `20260807170000_w3a_create_shipment.sql`,而**實際檔名是**
  `20260807170000_m4b_e10_b2_w3a_create_shipment.sql`(中間少了 `m4b_e10_b2_`)。
  🔴 照它的路徑開會得到 `No such file or directory` ——
  **而那個輸出與「這支 migration 不存在」長得一模一樣**。行號與內容都是對的。
```
