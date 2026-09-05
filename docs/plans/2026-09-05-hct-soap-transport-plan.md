# plan · 新竹傳輸層改 SOAP(`⟦ship-HCTAPI⟧` 乙)—— **第二版**

> 🔴🔴 **開工前先讀** `docs/runbooks/2026-09-05-hct-readiness.md` **`:100-194`**(方法表 + endpoint 粒度 + 第三個參數 + 順序)。
> **那份 runbook 是這一片的第一來源, 而它比本檔完整。** 📌 第一版就是因為我沒讀它而寫錯(見 §7)。
>
> **狀態**:草案, 等 Sean 一個字(鐵則 8)。**一行碼都還沒改。**
> **授權鏈**:Sean 2026-09-05 逐字「**16 丙+乙 把它做好**」⇒ 丙(空探測)**已做完**;本檔是乙。
> **片型**:🔴 **高風險**(鐵則 12⑤ 對外不可回收 + 跨 3 檔以上)。
> **帳密**:一律走 env 名 `HCT_API_ACCOUNT` / `HCT_API_PASSWORD`,**值不在本檔、也不進任何對話。**

---

## 0. 這一版與第一版的差別(先講, 因為第一版是錯的)

```
⛔ 第一版說「查詢那支吃 DataSet ⇒ 難做 ⇒ 另開一片」  ⇒ 假的。我查了 QueryEDELNO,
   而服務裡還有 QueryEDELNO_Json(company, password, json) —— 與送單【同款】。
⛔ 第一版說「rollback 第一步 = 關 env, 一秒生效」    ⇒ 假的。Vercel 的 env 變更
   【只套用到新的 deployment】⇒ 不 redeploy 就不會停送。
⛔ 第一版把「真的送一箱」放進拆片(D)               ⇒ 抽掉。理由見 §5。
```
🎯 **三條都不是筆誤, 是【我沒有讀自己那份 runbook】+【把一個方便的假設當事實】。**

---

## 1. 為什麼(量到的)

**2026-09-05 11:0x 空探測**(Sean 授權, 只發一次、不帶帳密):
```
POST …/Service1.asmx    Content-Type: application/json    body: {}
⇒ http 500 · application/soap+xml · <soap:Fault>「在根層次的資料無效。 第 1 行,位置 1。」
```
⚠️ **射程**(codex nit①, 收下):這證的是「**這個 URL 不吃這個 JSON 形狀**」,**不是**「所有方法型 URL 都只有 SOAP」。
✅ 而**服務描述頁**兩支的 `HTTP POST` 綁定區塊數 **= 0** ⇒ 兩條證據指同一個方向。

🔴🔴 **而今天這件事不會以「錯誤」的形式出現**:`hct-client.ts:155` 把非 2xx 判成 `unknown`
⇒ **每一發送單都會 `http_500` ⇒ 全部落進 `unknown`** ⇒ 而 `unknown` 沒有出口(`⟦ship-HCTUNKNOWNSTUCK⟧`)。
🛑 **⇒ 開關一開, 第一箱就卡死, 而畫面上看起來像「新竹沒回應」。**

## 1-b 🔴 而傳輸層【不是唯一】的錯(runbook `:140-152`)
```
第三個參數    規格叫 `json`, 型別 string      而我們送 `data`
送單的值      應是 JSON.stringify([fields])   而我們送 `data: [fields]`(陣列)
```
📌 **⇒ 就算今天改成 SOAP, 鍵名與型別還是錯的。三件事要一起修, 否則第一箱照樣失敗而換一個症狀。**

---

## 2. 要改什麼

### 2-a 事實(**線上服務描述頁, 2026-09-05 當場抓;PDF 只做交叉**)
```
端點        https://hctrt.hct.com.tw/EDI_WebService2/Service1.asmx
            ⇒ 🔵 SOAP 兩支方法【共用同一個 URL】, 靠 SOAPAction 分 ⇒ endpoint 粒度爭議自然消失
命名空間    http://tempuri.org/
送單  SOAPAction "http://tempuri.org/TransData_Json"
      <TransData_Json xmlns="http://tempuri.org/"><company/><password/><json/></TransData_Json>
查詢  SOAPAction "http://tempuri.org/QueryEDELNO_Json"     ← 🔴 第一版查錯成 QueryEDELNO
取消  SOAPAction "http://tempuri.org/TransDataCancel_Json" ← 🔴 第一版完全沒提到它存在
服務共 24 支方法(當場抓 `?op=` 清單)
```
🔵 **大小寫**:線上兩支都是**小寫 `<company>`**。⛔ ~~2022 PDF 寫大寫 `Company`~~ 只做交叉。
   而**我們的碼今天兩支不一致**(`:145` 大寫 · `:207` 小寫)⇒ 一併對齊。

### 2-b 動的檔
```
apps/admin/src/lib/shipping/hct-soap.ts        (新) 信封組裝 + 回應拆解 + XML 跳脫, 純函式零 I/O
apps/admin/src/lib/shipping/hct-soap.test.ts   (新)
apps/admin/src/lib/shipping/hct-client.ts           兩支函式的 headers / body / 回應解析 + 狀態模型
apps/admin/src/lib/shipping/hct-client.test.ts      既有 mock 全部要改(它們餵 JSON 回應)
apps/admin/src/lib/shipping/hct-submit-flow.ts      🔴 新增 not_sent 的處置(見 §3)
```
🛑 **不動**:`hct-trans-data.ts`(欄位組裝)· `shipment-actions.ts` 的閘與稽核 · 任何 migration。

### 2-c XML 這一層要指定的(codex must-fix, 第一版全缺)
· **parser**:repo **沒有 XML 相依** ⇒ 要嘛加一個(鐵則 12④ 平台設定), 要嘛只用**嚴格的字串抽取**(只認 `<...Result>` 一種形狀, 認不得就 `unknown`)。**本 plan 推薦後者** —— 它不需要新相依, 而失敗方向是安全的那一側。
· **DOCTYPE / 外部實體**:回應若含 `<!DOCTYPE` ⇒ **直接 `unknown`, 不解析**。
· **大小上限**:回應 > 256 KB ⇒ `unknown`(不把 label image 之類的東西吃進來)。
· **跳脫**:`company` / `password` / `json` 三個值都要 escape `& < > " '`。**帳密裡有 `&` 而不跳脫 ⇒ 信封結構壞掉, 而它會回一個看起來像業務錯誤的東西。**

---

## 3. 🔴 狀態模型(本片的核心 —— 第一版三分法不夠)

```
not_sent   ✅ 新增。信封組不出來 / 設定缺 / 跳脫失敗 ⇒ 【一個 byte 都沒送出去】
           ⇒ 這是【可以安全重送】的, 而第一版把它塞進 unknown 就再也救不回來
submitted  只有在 success=Y 且 edelno 非空 且 【回傳的 epino 等於本箱】 且 【恰好一列】
rejected   只有在 success=N ⚠️ 而「N 保證新竹完全沒建立/沒部分寫入」這件事【未確認】
           ⇒ 在確認之前, 下游【不得】把 rejected 當成「可以直接重送」
updated    ✅ 新增。success=R = 【修改成功】不是新增成功
           🔴 第一版把 Y|R 合併 ⇒ 一次意外重送改掉既有託運資料會被當成正常
unknown    其餘一律 —— 網路炸 / 非 2xx / body 不是 XML / 沒有 Result / Result 不是 JSON /
           認不得的 success / soap:Fault / 超過大小上限 / 含 DOCTYPE
```
🛑 **`unknown` 的證據要存, 而【不能直接存整個 SOAP body】**(codex must-fix):
   存 **①http 狀態 ②SOAPAction ③Result 的前 512 字元 ④長度** —— **不存收件資料、不存圖。**

---

## 4. 預期影響面

| 面 | 影響 |
|---|---|
| 送單 | **仍然送不出去** —— 因為本片**不開開關**(見 §5)。行為改變的是「送出去時會走對的協定」 |
| 查詢 | 同片一起改(`QueryEDELNO_Json` 與送單同款)⇒ 🔴 **這解掉 `⟦ship-HCTUNKNOWNSTUCK⟧` 的前置** |
| 稽核 / DB | **零 migration、零資料**;`shipment-actions.ts` 的稽核路徑不動 |
| 開關 | `HCT_SUBMIT_ENABLED` / `HCT_QUERY_ENABLED` **本片一個字都不碰, 維持關** |
| 顧客站 | 零影響 |

---

## 5. 拆片 —— 🔴 **「真的送一箱」不在本 plan 裡**

**理由**(codex 五條 must-fix 收攏成一句):**一發不可回收的動作, 不能跟一次協定探索綁在同一片。**
第一版的 D 片同時要:確認環境是不是測試站、猜內層 JSON 形狀、驗協定、驗欄位、還要真的送出去 ——
📌 **那不是一片, 那是「用第一張真單當實驗器材」。**

| 片 | 內容 | 驗收 | 估時 |
|---|---|---|---|
| A1 | `hct-soap.ts` **組信封** + 跳脫 | 含 `&`/`<`/`'` 的值、小寫 `company`、三支 SOAPAction 各一格 | 40 分 |
| A2 | `hct-soap.ts` **拆回應** | Fault / 缺 Result / Result 非 JSON / DOCTYPE / 超大 / namespace prefix 變體 / 多 Result | 45 分 |
| B1 | `hct-client.ts` **狀態模型**改成 §3 五態 | 每一態各一格 + **每格一發突變** | 45 分 |
| B2 | `submitTransData` 接上 A + 修 `json` 鍵名與 `JSON.stringify` | 既有 mock 全改;**餵一份真的 SOAP 回應字串**當 fixture | 45 分 |
| B3 | `queryEdelno` 走 `QueryEDELNO_Json` | 同上 | 40 分 |
| C | `hct-submit-flow.ts` 處理 `not_sent` / `updated` 兩個新態 | 下游不得把 `not_sent` 當 `unknown` | 40 分 |
🔴 **順序依賴**:A1 → A2 → B1 → (B2 ‖ B3) → C。**小寫 `company` 屬 A1**(它是信封的一部分), 第一版把它排成獨立的 C 片是錯的。

### 🔴 而「真的送第一箱」是另一份 plan, 它的**硬前置**(不是備註)
1. **確認 `hctrt` 是測試環境還是正式** —— **未量**。答不出來**不准送**。
2. **拿到廠商的內層 JSON 範例**(`json` 參數裡那段的 schema)—— **不准用第一張真單去猜。**
3. `⟦ship-HCTUNKNOWNSTUCK⟧` 的救援路徑**已經做完**(否則卡住就沒有出口)。
4. 一次只送一箱 · 唯一 `epino` · 送前查重 · timeout 之後**禁止重按** · Y/R/N/unknown 各自的 stop rule 寫在紙上。
5. **Sean 在場。**

---

## 6. rollback

**碼**:純碼改動、零 migration ⇒ `git revert` + 重新部署 `pcm-admin`。
🔴🔴 **而第一版寫「關 env 一秒生效」是錯的**(codex must-fix, 我複核收下):
> **Vercel 的環境變數變更只套用到【新的 deployment】⇒ 不 redeploy 就不會停送。**
✅ **⇒ 真正的緊急停送 = 改 env **並且** 觸發一次 redeploy**, 而那有部署時間。
🛑 **而切換當下【已在途】的請求不會被停** ⇒ 停送生效後仍要**圈出那個時窗內所有 `unknown`, 逐筆查詢再決定**, **不得直接恢復重送**。
🛑 **已經送進新竹的箱收不回來** —— `revert` 只讓「不再送」, 不讓「沒送過」。
   🔵 而 `TransDataCancel_Json` **存在** ⇒ 那條路可能有取消, **而我沒有查過它的語意** ⇒ 不列為 rollback 手段。

---

## 7. 🛑 我不知道的事(不要讀成已解決)

1. **我沒有帶著正確信封打過一發** —— 空探測只證明「它講 SOAP」。
2. **`<json>` 裡那段的確切 schema 未知** —— PDF 只列欄位, **沒列外層鍵名**。⇒ **這是 A/B 片之後最大的未知。**
3. **`hctrt` 是測試站還是正式站** —— **未量**。
4. **`success=N` 是否保證新竹完全沒建立** —— **未確認**。
5. **SOAP 1.1 vs 1.2** —— 描述頁兩種都列, 我選 1.1(`text/xml` + `SOAPAction`)。**這是選的, 不是量到的**;A2 要用固定 fixture 驗一次 Action / Content-Type / 回應 namespace。
6. 🔴 **第一版的三個錯我沒有靠自己發現** —— 兩個是 codex 抓的, 一個是我複核它時才翻出自己的 runbook。
   📌 **⇒ 本片的下一輪審查不要只換輪次, 要換角度**(鐵則:第三輪起換模型)。
