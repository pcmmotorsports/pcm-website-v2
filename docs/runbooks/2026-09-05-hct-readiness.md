# 新竹物流 API:串接到哪了(唯讀實查 · 2026-09-05)

> 問題來自 Sean 的北極星那句「**新竹物流 API 串接好了沒**」。
> ⛔ ~~**一句話:沒有。而缺的【不只是那兩顆 env】—— 還缺【呼叫端】。**~~
> 🟢 **2026-09-05 深夜訂正**:呼叫端**已經接上了**(`7ddbba166`,Sean 拍甲批准的步驟②),
> 六支 migration 也**全部貼進正式庫**了。⇒ ✅ **現在的一句話是:**
> **碼與 DB 都到位,而【開關仍然是關的】,且那三個送單預設值還沒跟新竹確認過。**
> 🔴 **而放 env 之前還有兩件**:①新竹的**連線網址**(`HCT_API_ENDPOINT`,今天不存在,只有 Sean 問得到)
> ②`⟦ship-HCTUNKNOWNSTUCK⟧`(卡在 unknown 的箱**沒有出口**)—— **兩件都不是「開了就好」。**
> 本檔唯讀量測,**沒有改任何碼、沒有翻任何開關、沒有印任何 env 的值**。
> ⚠️ 量測基準 = `agent/line-ship` @ 2026-09-05,**並在 `origin/dev`(比本分支新 71 顆)上複驗過關鍵那兩發**。

## 一、已經做好的(各附 `檔案:行號`)

| 面 | 落點 | 狀態 |
|---|---|---|
| 出貨送單 | `apps/admin/src/lib/shipping/hct-client.ts:117` `submitTransData` | ✅ 有 |
| 查貨(補問單號) | `apps/admin/src/lib/shipping/hct-client.ts:176` `queryEdelno` | ✅ 有 |
| 兩道開關 | `hct-client.ts:57` `:58` 讀 env、`:76` `gateOpen` | ✅ 有 |
| 送不送的決策 | `apps/admin/src/lib/shipping/hct-submit-flow.ts:48` `decideSubmit` | ✅ 有 |
| 送單流程 | `hct-submit-flow.ts:93` `runHctSubmit` | ⚠️ **有,而沒有人叫它** |
| 送出結果寫回 DB | `supabase/migrations/20260904170000_...:113` `admin_record_hct_submit` | ⚠️ **有,而沒有 TS 叫它** |
| 單號寫一次就不能改 | `20260904170000_...:81` `pcm_b2_shipments_hct_request_id_write_once()` | ✅ 有 |
| 三態 + `unknown` | `20260904140000_m4b_shipments_hct_status_unknown.sql` | ✅ 有 |
| 送單欄位組裝 | `apps/admin/src/lib/shipping/hct-trans-data.ts:35-60`(預設重量/發票別/商品種類/長度上限) | ✅ 有 |
| 自印標籤版面 | `hct-label-layout.ts:45` `A4_GRID`、`:93` `buildLabelPages`、`:135` 批次上限 | ✅ 有 |
| 託運清單 | `hct-manifest.ts:108` `buildHctManifest` | ✅ 有 |
| 單號格式檢查 | `tracking-number.ts:78` `trackingNumberIssue` | ✅ 有 |
| 出貨通知信 | `packages/use-cases/src/enqueue-order-shipped-emails.ts:146` | ✅ 有 |
| 單號更正信 | `packages/use-cases/src/enqueue-tracking-corrected-emails.ts:65` | ✅ 有(**migration 未貼**) |

## 二、沒接的(量到的,不是推的)

1. ⛔ ~~`runHctSubmit` 沒有任何【非測試】呼叫端~~ ⇒ 🟢 **已接**(`7ddbba166`):
   出貨單頁一顆獨立的「送新竹」鈕 → `submitShipmentToHctAction` → `runHctSubmit`。
   🔵 **本節其餘各條仍然成立** —— 這一條翻面**不代表**它們也翻了。
2. ⛔ ~~`admin_record_hct_submit` 沒有 TS 呼叫端~~ ⇒ 🟢 **已接**(同一顆):
   `recordHctSubmit()` 在 `shipment-repository.ts`。
   🔴 **而寫回的時序是承重的**:佔位列寫在**送出之前**(狀態推成 `unknown`,不帶 request_id)——
   送出成功而寫 DB 之前掛掉時,那一列是唯一擋住「下次又送一次」的東西。有一格測試在守那個**順序**。
3. 🔴 **沒有 webhook 接收端。** 檔名層與內容層各掃一次,`hct|新竹|logistic` × `webhook` **零命中**
   ⇒ 新竹若有主動回拋,我們**接不到**;今天單號只能靠「人工填」或「我們去查」。
4. ⚠️ **今天單號怎麼進來的 = 人工**:`admin_mark_shipment_shipped` 的 `p_tracking_number`
   (`apps/admin/src/lib/shipping/shipment-actions.ts:359` 註解逐字)。**這條路是通的、正在用。**

## 三、兩顆開關的現況(**只印名稱,不印值**)

🔴 **2026-09-05 實查了三個地方(只列名稱,一次都沒有印值)**:

| env 名 | 本機 `.env*` | Vercel `pcm-admin` | 判定 |
|---|---|---|---|
| `HCT_API_ACCOUNT` | 無 | ✅ **有**(Encrypted · Production + Preview · 4 天前) | 帳密已就位 |
| `HCT_API_PASSWORD` | 無 | ✅ **有**(同上) | 帳密已就位 |
| 🔴 `HCT_API_ENDPOINT` | 無 | 🔴 **沒有**(而 2026-09-05 深夜**位址已知一半**,見 §六) | **2026-09-05 步驟②【新引進】的名字** —— 沒有它,那顆鈕按下去回 `disabled`(連 `runHctSubmit` 都不呼叫)。⚠️ **值只有 Sean 與新竹之間問得到**:廠商檔那幾個 URL 分測試/正式、也分服務,我不從文件推一個出來 |
| `HCT_SUBMIT_ENABLED` | 無 | 🔴 **沒有** | 依 `gateOpen` = **關** |
| `HCT_QUERY_ENABLED` | 無 | 🔴 **沒有** | 依 `gateOpen` = **關** |
| `HCT_DEFAULT_WEIGHT` / `HCT_INVOICE_TYPE` / `HCT_PRODUCT_KIND` | 無 | 🔴 **沒有** | 用碼裡的預設值(而那些值沒人跟新竹確認過) |

🔴🔴 **而我第一發查錯專案** —— 本機 `.vercel/project.json` link 的是 **`pcm-website-v2`(顧客站)**,
而 HCT 的碼在 `apps/admin` ⇒ env 在 **`pcm-admin`**(`prj_vzKNmbKryBdp4mAenFbyD6gehJjF`)。
顧客站那 54 個名字裡 `HCT_` **零命中** ⇒ 📌 **那個 0 是【查錯專案】,不是「沒有」。**
🟢 尺會動的證據:同一把尺在顧客站抓到 **54** 個名字、在 admin 抓到 **18** 個、本機四支 `.env*` 抓到 15/3/24/6。

🔴 `gateOpen`(`hct-client.ts:76`)的四條性質,照抄不改寫:
① **只認字面 `'true'`** —— 未設 / `'false'` / `'1'` / `'TRUE'` 全部視為關(打錯的值不會變成開)
② **閘在建依賴【之前】** —— 關著時那條路連帳密都不讀
③ **關著回一個成功的 no-op,不是錯誤** —— 它是預期的安全態(回錯誤會吵,吵到最後會被關掉)
④ **`NODE_ENV=development` 一律當關,不看值** —— 理由是「**本機不該有能力送出真的託運單**」,
   不是「本機沒有值」。📌 一個建立在「某個東西剛好不存在」上的安全性質,
   它的失效條件是**有人做了一件方便的事**,而那件事沒有人會覺得自己在冒險。

⚠️ 另外五顆 env 名(同樣不印值):`HCT_API_ACCOUNT` / `HCT_API_PASSWORD` /
`HCT_DEFAULT_WEIGHT` / `HCT_INVOICE_TYPE` / `HCT_PRODUCT_KIND`。

## 四、真出一箱之前還缺哪三步

| # | 缺什麼 | 誰做 | 卡在哪 |
|---|---|---|---|
| 1 | ⛔ ~~跟新竹申請兩張表單 + 金鑰~~ ⇒ ✅ **帳密已經給了**(2026-09-05 實查,見 §三)。**還缺**:客戶代號 `escsno`(11 碼)、出貨站 `esstno`(4 碼)、**貨號區間規則** | **Sean → 新竹** | `docs/reference/hct-logistics-api-reference.md:41-50` 那張表**其餘各項未確認**;貨號區間決定「我們自己配號還是系統配」,那會改 `hct-trans-data.ts` |
| 2 | ✅ **已完成**(`7ddbba166` + 兩輪審查修訂 `f1b3e8461`;Sean 2026-09-05 拍甲批准 plan `cae1b84f6` 後接的):獨立「送新竹」鈕 → action → `runHctSubmit` → `admin_record_hct_submit`,送出前寫 `unknown` 佔位 | **我們** | 🔴 **而它多需要一顆 env:`HCT_API_ENDPOINT`** —— `HctClientDeps.endpoint` 是呼叫端傳進去的,而 repo 與 Vercel 都**沒有任何 endpoint 來源**;廠商檔那幾個 URL 分測試/正式也分服務 ⇒ **挑哪一個是 Sean 與新竹之間的事**。缺它 ⇒ fail-closed 回 `disabled`,**連 `runHctSubmit` 都不呼叫**(空字串與空白也算缺)<br> 　🛑 **而它帶著一個已知缺口 `⟦ship-HCTUNKNOWNSTUCK⟧`**:送出前寫的 `unknown` 佔位,在「寫完而 HTTP 還沒發出去就被砍」時會讓那一箱**永久卡在 unknown**,而**今天沒有任何 UI 把它推回 draft**。📌 **那不是 bug,是「寧可誤判成送過了」的另一面** —— 反過來的代價是**客人收到兩箱**。⚠️ **在放 env 之前要先做掉它**,否則第一次卡住就要 Sean 手動改 DB<br> 　✅ **2026-09-05 補:【怎麼改】寫好了** ⇒ `docs/runbooks/hct-unknown-stuck-manual-reset.md`(甲型佔位/乙型真回應要先分開;五道前置閘寫在 SQL 裡;**第 0 步是「什麼時候不准改」**)。🛑 **而那份沒有跑過 —— 零次**(今天暴露 = 0, 沒有卡住的箱可以演練)⇒ 它是【讀起來對】不是【跑過對】。 |
| 3 | **把兩顆 env 放進 production**,並先用**測試帳號**跑一發 | **Sean**(放 env)+ **我們**(驗) | `hct-client.ts:92` `hctMode(account)` 會依帳號判 `test`/`live` ⇒ **先跑 test 那一側** |

🛑 **順序不能換**:2 沒做完就放 env ⇒ 開關開著而沒有人會走到那條路(**零效果,而它看起來像上線了**);
1 沒回來就做 2 ⇒ 欄位規則(貨號區間、代號長度)還是猜的,做完要重做。

## 五、這份檔答不出來的

· 它讀的是**碼**,不是正式站 —— **正式站的 env 有沒有那兩顆,我沒有權限查,也沒有查。**
· 它不答「新竹那邊審過了沒」——那只有 Sean 問得到。
· ⚠️ 「未在本 repo 任何設定檔出現」**不等於**「正式站沒有」:env 本來就不進 git。
  ⇒ 📌 **要知道正式站現況,得有人去 Vercel 看一眼,而那是【名稱】層就答得出來的事,不必印值。**

## 六、endpoint:Sean 給了三條網址,而**只對得上一半**(2026-09-05 深夜,唯讀比對,零真請求)

> 🔴🔴 **【本節從這裡到 `§六` 結尾, 前半是【已被推翻】的 —— 而推翻它的那一段在最下面】**
> **不要照本節前半做。** 它一路教「走 JSON、endpoint 要接方法名」, 而那兩件在 `:159` 起被實測推翻。
> ⇒ 📌 **一份「先講錯的、後面才訂正」的文件, 對【只讀前半的人】等於沒有訂正過。**
> ⇒ ⇒ 所以這一句放在**最前面**, 而不是留在下面等人讀到。
>
> **今天成立的三句**(2026-09-05 11:0x 實測, Sean 授權的一發空探測):
> 1. **那個服務只講 SOAP** —— `POST` JSON ⇒ `http 500` + `application/soap+xml` + `soap:Fault`
>    「在根層次的資料無效。 第 1 行,位置 1。」(它把 JSON 當 XML 解析)
> 2. **`HCT_API_ENDPOINT` = 那條 `.asmx` 本身**(SOAP 兩支方法共用同一個 URL, 靠 `SOAPAction` 分)
>    ⇒ **不接方法名**。Sean 2026-09-05 已設在 Vercel `pcm-admin` Production(開關仍關)。
> 3. **兩支方法的參數都是小寫 `<company>`** —— 2022 PDF 的大寫 `Company` 只做交叉。
>
> 📎 傳輸層改寫的 plan(**R2 判 `FAIL`, 不可開工**):`docs/plans/2026-09-05-hct-soap-transport-plan.md`
> 📎 廠商參考檔 `docs/reference/hct-logistics-api-reference.md:78` 那句「不必處理 SOAP envelope」**同日已加刪除線**。

Sean 逐字給的第三條是 `https://hctrt.hct.com.tw/EDI_WebService2/Service1.asmx`(`.asmx` = ASP.NET WebService)。

**✅ 對得上的兩件**
- **不必處理 SOAP envelope**:廠商參考檔 `:78` 逐字「每支服務都有 `_Json` 與 `_XML` 變體 ⇒ 可走 JSON」
  ⇒ `hct-client.ts` 送 `Content-Type: application/json` 並 `res.json()` **是對的方向**。
- **認證欄位**:參考檔 `:88`「`Company` + `password` 兩個字串參數」
  ⇒ client 逐字送 `{ Company: …, password: … }` **相符**。

### 🟢 2026-09-05 深夜補:**讀了 Sean 給的那份 PDF(公開文件,27 頁),方法名確定了**

`pdftotext -layout` 抽出逐字(下面每一條都附 PDF 文字行號,可自己重抽複核):

| PDF 逐字 | 行 |
|---|---|
| `TransData _Json(string Company, string password, string json)` | :384 |
| `string QueryEDELNO_Json(string company, string password, string json)` | :766 |
| `TransData _Json()` / `QueryEDELNO_Json()` 在服務一覽表 | :219 / :228 |

⇒ ✅ **endpoint = 根 + `/TransData_Json`(送單)、根 + `/QueryEDELNO_Json`(查貨號)。**
   📌 **兩支是【不同的網址】** —— 若只放一顆 `HCT_API_ENDPOINT`,查貨那條會打到送單那支。

### 🟢 2026-09-05 拍板:**Sean 要填的那一格 = 服務的【根】,不含方法名**

```
HCT_API_ENDPOINT = https://hctrt.hct.com.tw/EDI_WebService2/Service1.asmx     ← 就填到這裡
```
兩個方法名寫成碼裡的常數(`hct-client.ts` 的 `HCT_METHOD_SUBMIT` / `HCT_METHOD_QUERY`,
旁邊各附 PDF 行號),各有一格測試釘住。
🔴 **主視窗原本拍「env 含方法名」,同日推翻自己** —— 理由是它沒看到查貨是第二支網址。
📌 **而「方法名核完就是常數」正是它該在碼裡的理由**:常數放 env = 讓人手打那段字,
   而**打錯了沒有東西會紅**;放碼裡有測試釘得住。
⚠️ 根尾端有沒有斜線都吃得下(`hctMethodUrl` 會剝掉)—— **因為 env 是人打的。**

⛔ ~~**而有一件我們【早就對了】**:`TransData` 的第一個參數是大寫 `Company`…
   📌 那個不對稱不是意外,是前一輪的人讀過文件。~~
🔴🔴 **2026-09-05 05:0x 訂正:上面整段是錯的,而錯法值得記。**
   我去抓了**線上服務描述**(`…/Service1.asmx?op=TransData_Json` 與 `?op=QueryEDELNO_Json`),
   兩支的參數逐字都是 **`<company>`(小寫)、`<password>`、`<json>`** —— **沒有那個不對稱。**
   ⇒ 📌 **我拿一份 2022 年的 PDF(ver 2.0)當現況,而且替那個差異【編了一個理由】。**
   ⇒ 🎯 **一個「看起來像有人查證過」的解釋,比一個明顯的錯更難被推翻** ——
     推翻它的不是更仔細地讀 PDF,是**去看那個服務今天長什麼樣**。
   🟢 而指出這一格的是 codex(它引線上服務描述);**我沒有直接照它改,先自己抓了那頁**,
     結果比它那一條更大(見下)。

🔴 **而第三個參數對不上 —— 這一格今天會讓第一箱直接失敗**:
```
PDF        第三個參數叫 `json`, 型別是 **string**
我們送的   `data: [fields]`(送單, :145)/ `data: epino`(查貨, :207)
```
⇒ **鍵名錯(`data` vs `json`)、而且送單那邊型別也錯(陣列 vs 字串)** ——
  `.asmx` 的 JSON 端點會把它當成一個 **JSON 字串參數**,所以要 `JSON.stringify([...])` 再放進去。
⚠️ **而這一格沒有人會在測試裡發現** —— 我們的測試餵的是假 fetch,它不在乎鍵叫什麼。

**🔴 原本以為對不上的那件 —— 而它其實是 endpoint 的【粒度】**
`.asmx` 的 JSON 變體是**一個服務一個網址**,要帶方法名:
```
Sean 給的      …/Service1.asmx                 ← 服務的【根】
要放進 env 的  …/Service1.asmx/TransData_Json  ← 那支方法(名稱依參考檔 :172 `addrCompare_Json` 的命名慣例)
```
⚠️ **那個方法名我【沒有證實】** —— 參考檔 `:82` 只寫服務叫 `TransData()`,
`_Json` 後綴是我從 `:172` 的另一支服務推的。**要從 PDF §2.2 確認,或用測試帳號實打一次。**
⚠️ 另一格也**未確認**:client 的外層是 `{ Company, password, data: [ …欄位… ] }`,
而參考檔 §3 只列**欄位**,沒列 JSON 的**外層鍵名**(`data` 這個字)。

### 🔴🔴 2026-09-05 05:0x:**那個服務只講 SOAP** —— 而我們的 client 送 JSON

抓 `…/Service1.asmx?op=TransData_Json` 那一頁(公開的服務描述,**零真請求打 API**),同一頁的協定計數:
```
SOAP 1.1  ×2      SOAP 1.2  ×2
HTTP POST  0      HTTP GET  0      application/json  0
```
它給的 wire format 逐字:
```
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://tempuri.org/TransData_Json"
<soap:Envelope …><soap:Body>
  <TransData_Json xmlns="http://tempuri.org/">
    <company>string</company><password>string</password><json>string</json>
  </TransData_Json>
</soap:Body></soap:Envelope>
```
⇒ 📌 **`_Json` 的意思是「信封【裡面】那個參數是一段 JSON 字串」,不是「傳輸走 JSON」。**
   那正是 PDF 寫 `string json` 的原因 —— **型別讀對了,層次讀錯了。**
⇒ 🔴 **`hct-client.ts` 送 `Content-Type: application/json` ⇒ 打過去會被拒,
   而我們的碼把非 2xx 判成 `unknown` ⇒ 那一箱當場卡住。**
🛑 **而「服務頁沒有列 HTTP POST」與「它不支援」不是同一件事**(ASP.NET 的 HttpPost 協定
   可以開著而不列)⇒ 📌 **這個結論是【從沒有列推的】,不是打過去證實的。**
   ⇒ 已端 Sean 決定(佇列 §B「Q-新竹傳輸方式」)。**在他回答之前,不要改 client 的傳輸層。**
🔵 草稿留在 `~/pcm-mailbox/ship-hct-soap-draft-20260905.patch`(那一版改了網址與 payload,
   **而它的前提是 JSON POST** ⇒ 若走 SOAP,它只有「常數與大小寫」那幾格還有用)。

**🛑 而這件事的代價不是「試一下就知道」**
endpoint 錯 ⇒ HTTP 非 2xx 或 200 而 body 不是 JSON ⇒ `hct-client.ts` 兩條路都回 **`unknown`**
(它刻意如此:那兩種情況「它可能收了」)⇒ 📌 **那一箱當場卡住**,
而卡住的出口(`⟦ship-HCTUNKNOWNSTUCK⟧`)**還沒做**。
⇒ 🔴 **所以順序是:先做完那個出口,再放 env,再送第一箱。**
🔵 **而第一箱一定要用測試帳號**(參考檔 `:89`:公司名稱 `test` / 密碼 `test1`;
`hct-client.ts` 的 `hctMode()` 就是靠帳號字面判 test/live)。

**⇒ 給 Sean 的一句**:「新竹那個網址後面還要接一段方法名 —— 麻煩問他們 `TransData` 的 JSON 版完整網址。」
