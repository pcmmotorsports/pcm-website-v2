# 突變普查總帳(2026-08-18,T① 線,單人掃五族)

> 這份表是【證據台帳】,不是心得。每一列都能追回一顆 commit 或一封窗間信。
> 產出目的:Sean 看不懂 code,五族的結論此前散在十幾顆 commit 與七八封信裡;此表把它們收成一張。
> 分支:sso-security-log(基底 dev 3409ca1d),本表落筆時界線 5d5af269,未 push。

## 0 一句話

錢/權限/列印/經銷價/寄信/結帳3DS,用「真突變 + 執行信標 + 三讀法」逐格量測「有沒有格在守」。
掃到的真①(斷言沒判別力、可達輸入沒測)=**3 個,全部補上並各配反向負測**;其餘守門實測有牙齒。

## 1 每族一列

| 族 | 分母(支) | 驗畢 | 真① | ③遮蔽 | ④等價 | 刻意不掃 + 理由 |
| --- | --- | --- | --- | --- | --- | --- |
| 錢/權限(refund/wallet/tier/session/sso) | 36 | 36 | 1 | 4 | 1 | 0 |
| 列印/出貨單 | 16 | 9(錢邏輯) | 0 | 0 | 0 | 8 UI 顯示層(顯示錯看得到、非靜默算錯;且全陣通則「驗功能開伺服器跑真的」⇒ UI 已有更強守門) |
| 經銷價/tier | 8 核心點 | 8 | 1 | 0 | 0 | 廣義 tier grep 命中大量顯示層,只掃 price_store 真洩漏路徑 |
| 寄信/通知(M-4a) | 8 | 5(核心) | 0(K1 部分缺口→補) | 0 | 0 | 樣板/UI 顯示層;enqueue allowlist 負測在組裝層(B 窗結案 #281) |
| 結帳/3DS/TapPay | ~40(退款子族已在錢族掃) | 6 核心守門 | 0 | 0 | 0 | 退款子族在錢族;UI feedback 顯示層 |

> ⚠️ 「驗畢」= 對該族的【核心守門】跑過真突變;不是「該族每一格都掃過」。三讀法四類定義見 §4。

## 2 真①逐條(實際補過的格)

### ①-1 refund-judgment 超退(over-refund)零測試
- **位置**:`packages/use-cases/…` → 判定在 `apps/admin/src/lib/payment/refund-judgment.ts:146`(executed 閘 `delta === refundAmount`)。
- **原病**:測試行使過的 delta 全集={−50,0,1,249,250},`delta>250`(退超過凍結額=錢最危險方向)**一格都沒有**。把 `===` 突變成 `>=` ⇒ 全套綠+信標 EXEC ⇒ over-refund 靜默判 executed 乾淨結案。
- **修法**:補一格 `withRefundedNow(360)⇒delta_mismatch,delta=260`(期望值當場量,初估 110 錯、實測 260);另補反向格 `before=300/now=0⇒delta=−300`(換 fixture 才可達,非誠實缺口)。
- **負測**:`===→>` / `===→>=` 各驗;反向格 fall-through 改 `delta<0?executed` ⇒ 該格紅。基準綠、cksum 驗。
- **commit**:`f1601e4e`(正向)+ `f12cffd5`(反向+不對稱註解)。**複驗**:V 窗獨立跑真函式(`node --strip-types`),delta=260 第三度對上、`>=`唯一/`>`冗餘量到。

### ①-2 product-level priceByTier.store dummy 零測試
- **位置**:`packages/adapters/src/supabase/mappers/product.ts:216`(mapSupabaseProductToDomain 的 store dummy)。
- **原病**:leak-protection 測試 `product.test.ts:86-92` 只斷 `mapVariantRow`;product-level 那顆 dummy 零覆蓋。把 :216 改成 leak `price_general` ⇒ 全綠+EXEC。
- **血半徑(不誇大)**:當前真經銷價洩不出(products_public view 物理排除 price_store);此格能洩的是 general 灌 store=顯示錯。價值=「一道寫進檔頭(:172)的防線,原本沒有任何東西證明它還在」。
- **修法/負測**:鏡像 :86-92,`store===0 且 !==general`;負測 :216 leak ⇒ 該格紅(4ms)。基準綠、cksum 驗。
- **commit**:`adebc9e3`。

### ①-3(部分缺口,已補)寄信 body 契約 contains→exact
- **位置**:`packages/use-cases/src/sweep-email-outbox.test.ts`(斷言);渲染在同檔 buildOrderCreatedText。
- **原病**:body 斷言是 `stringContaining('PCM-2026-0001')`+`not.toContain(收件 email)`,非 exact。把整包 payload JSON 塞進 orderLine ⇒ 三條 contains 全過。對外不可回收的信,契約是【只能有這些】不是【至少有這些】。
- **血半徑**:當前 code 安全(buildOrderCreatedText 只讀 display_id);釘的是內容契約,非修現存洩漏。
- **修法/負測**:補 `toBe(具名 fixture 的 exact body)`;負測塞 payload JSON ⇒ 該格紅(21ms)。
- **commit**:`538aca94`(與 findById 同 commit)。

### 附:同 commit 的第二個否定恆綠(V 窗抓,非普查族但同病)
- `SupabaseProductAdapter.test.ts` `findById` 只有 not.toContain(經銷欄)、零正向斷言 ⇒ `select *`(帶回 price_store)恆綠。補 `toContain('price_general')`;負測 select* ⇒ 紅(5ms)。commit `538aca94`。**這是經銷價外洩最危險的手滑面**。

## 3 單元測試原理上摸不到的(單獨列,附接手)

- **RSC payload 實測**:鐵則要的是「一般會員【瀏覽器實收 payload】無經銷價欄」,單元只驗 mapper/dispatch 產出物,驗不到 Next RSC 序列化+網路實傳(可能夾帶 server component 閉包)。
  - V 窗做了 **anon=401**(REST 層);🔴 **RSC payload(匿名 + 登入態)那條路從沒人量過** —— 匿名那半 V 窗在做,登入態等一般會員帳號。要真瀏覽器,非單元。
- **enqueue payload allowlist(migration:38-45 REQUIRED-E1b③)**:B 窗查完=負測【在組裝層】(order-email-assembly.test.ts:23,突變 DTO spread ⇒ 2 格紅),且 enqueue 型別上不收 payload(結構上不存在該失敗模式)。已結案併 #281。我早先誤標「在 DB 層」=引錯 migration 的層,已更正。

## 4 方法論(只寫可複製的,全文在 docs/patterns/mutation-harness-restore.md §4b)

- **三讀法/四類**:突變後【綠】有四種成因,印出來一樣:①斷言沒判別力 ②突變沒被執行到 ③執行到但被冗餘遮蔽 ④等價突變(在可達輸入上不改變行為)。
- **可達性分水嶺(最前面問)**:我改的行為,落在可達輸入嗎?可達但沒測⇒補(①);不可達⇒不用補(④)。看到 GREEN 就加斷言是最常見的錯。
- **執行信標**:突變的那行前掛 `process.stderr.write('MUT-BEACON')`,run log grep 即判 EXECUTED/NOT-EXECUTED,分開②與①③④。零依賴、比 coverage 準(直指那行、穿透 transform）。
- **信標射程**:①stderr 被吞則盲 ②只判「執行過」不判「影響斷言」（③要人掃冗餘產出點）③🔴 **文字掃描型測試（掃 SQL/原始碼文字、不執行 code）信標永遠 NOT-EXEC，那不是②**——自證改用「掃描器讀到的那段字串真的變了嗎」。
- **③vs④ 引信位置**:③引信在遮蔽層檔案:行號（拿掉就從③變①）；④引信在上游 reject 那行（消失才變真洞）。而引信的守門力還依賴【斷言層級】（kind vs ok；量具解析度不足會假裝無差別）。
- **收工 git status**:還原機制只保證「你列進清單的檔」回得來，對「沒列進、卻被寫壞的檔」完全沉默——收工 `git status --porcelain` 是唯一涵蓋「我沒想到的檔」那道（本人 harness bug 實錘）。
- **期望值當場量**：寫進斷言的期望值若是【我算的】先跑一發讓 code 吐（over-refund 初估 110、實測 260）。
- **deadline 不用倍率**：倍率的分母是機器狀態、會浮動；任何固定 deadline 在無上界 load 下證不了安全，只能緩解。再紅=換做法（去牆鐘/隔離），不是抬更大的數（見 note-compose 停止規則）。

## 5 這份表【撐不起】什麼(誠實邊界)

1. 它答的是「**有沒有格在守**」，不是「**這個功能對不對**」——守門存在≠邏輯正確。
2. 「驗畢」是【核心守門】層級，不是逐格窮舉；每族分母外與「核心」外的格未必掃過。
3. 單元層盲面：RSC payload 實傳、DB trigger 層、真瀏覽器行為、真 TapPay/Resend 網路（全程禁真呼叫）——都在單元外，見 §3。
4. 「①=3」是【這把尺 + 這些突變】掃到的；未構造的突變、未掃的格不在分母。三讀法本身有射程（§4 信標盲面）。
5. 每族「刻意不掃」的判斷（UI 顯示層豁免）依賴「顯示錯看得到 + 開伺服器跑真的通則」兩個前提；前提變了，豁免要重估。

---
落筆:T① 線,2026-08-18。commit 追溯見 §2 各條 hash;窗間信在各窗 socket 紀錄。
