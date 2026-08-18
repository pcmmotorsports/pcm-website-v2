# TapPay Sandbox 測試卡(官方文件實查,2026-08-18)

> **這些是【公開的測試卡】,不是任何人的真卡** —— TapPay 官方文件公開列出,可以進 repo。
> 🔴 **沙盒 = 假錢。正式站的付款一次都不要碰。**

## 來源(三來源律:親讀 DOM、附 URL,不憑記憶)
```
中文版:https://docs.tappaysdk.com/tutorial/zh/reference.html   （測試卡段）
英文版:https://docs.tappaysdk.com/tutorial/en/reference.html   （Test Card 段）
查閱時間:2026-08-18 夜（G3）
✅ 兩個語言版本【逐張對照過，卡號與 CVV 完全一致】
```

## 卡表(逐字)

| 卡別 | 卡號 | CVV | 官方註記 |
|---|---|---|---|
| VISA | `4242 4242 4242 4242` | `123` | Success |
| JCB | `3543 9234 8838 2426` | `123` | Success |
| **AMEX(美國運通)** | `3454 5465 4604 563` | `1234` | Success |
| MasterCard | `5451 4178 2523 0575` | `123` | 「3D 驗證時會直接授權成功」/ en:「Complete three-domain-secure transaction without OTP validation」 |
| UnionPay | `6234 5774 3859 4899` | `123` | Success |
| VISA | `4716 3139 6829 4359` | `123` | 這張回傳的 `bank_id` 與 `issuer_zh_tw` 會是空的 |

**AMEX 的卡號是 15 碼、CVV 是 4 碼**(其餘是 16 碼 / 3 碼)—— 這不是打錯,AMEX 本來就這樣。

## 有效期限
官方逐字(en 版):**"Use a valid future date for card expired year and expired month"**
⇒ **任何未來的年月都可以**,文件沒有指定某一組。

## KYC 測試值(zh 版同頁)
```
身分證字號:A123456789
電話號碼:0912345678
```

## 🔴 一個【對不起來】的地方,原樣記下,不要替它調和

```
Sean 逐字(2026-08-18，經 MAIN 轉述):
  「要刷 AE（美國運通卡）才會跳 3D 驗證」

而官方文件把 3DS 的註記掛在 **MasterCard 5451 4178 2523 0575** 上，
AMEX 那一列的註記只有 "Success"，**一個字都沒提 3DS**。
```
**兩者不一定衝突** —— 文件那句講的是「進了 3DS 之後會怎樣(直接過、不用 OTP)」,
不是「哪張卡【會觸發】3DS」。觸發與否還受商戶端的 `three_domain_secure` 設定影響。

### ✅ 已解:以 Sean 為準,官方文件那一列不採信(2026-08-18,經 MAIN 轉述)
```
Sean 逐字:「AMEX 這個才有 3D 驗證，之前是很多次了。」
```
🔴 **為什麼採信他而不是官方文件**:「之前是很多次了」= **實務量測,樣本數 > 1**;
而官方那一列只是**沒有寫**,「沒有寫」不等於「不會觸發」——
兩邊講的根本不是同一件事(文件講的是進了 3DS 之後怎樣,他講的是誰觸發)。
⇒ **要測 3DS 就刷 AMEX。**

### 另一格,Sean 同日答的(2026-08-18,經 MAIN 轉述)
```
Q: .env.local 的 TAPPAY_PARTNER_KEY / TAPPAY_MERCHANT_ID 是沙盒那組嗎?
A: 逐字「沙盒跟正式都用一樣的。」
```
⇒ 憑證不必換。~~但若刷下去在憑證那一步失敗,這句是第一嫌疑~~

### ✅ 已關掉(2026-08-18 23:44:48–23:54:58 CST 之間,G3 實測)——「憑證是第一嫌疑」這句不再成立
```
打法(可重跑):POST https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime
              帶本機 .env.local 的 TAPPAY_PARTNER_KEY + TAPPAY_MERCHANT_ID,
              故意餵一個假 prime(test_prime_invalid)
回應:{'status': 121, 'msg': 'Invalid arguments : prime'}
```
🔴 **判別力在哪**:121 是「prime 這個參數無效」。它**已經過了認證那一關**才輪得到嫌 prime ——
   如果 key / merchant_id 不是沙盒認得的那組,回的會是認證類錯誤而不是 121。
   ⇒ **Sean 那句「沙盒跟正式都用一樣的」在沙盒端【成立】。**

⚠️ **這條關掉的射程只到「沙盒端點收下這組 key/merchant」為止**,它**不**證明:
   ①刷得過(2026-08-18 第一筆就沒刷過,見流水帳)②正式端也用同一組 ③3DS 會怎麼走。

## 實測紀錄
🔴 **~~尚未實測~~ 作廢(2026-08-18 23:45 CST 起已實刷)。** 正本在
`docs/probes/2026-08-18-tappay-sandbox-charge-log.md` —— **那份是全部,本段只是指標**。
```
第 1 筆:AMEX / 訂單 WCYCW5 建出來、款零收、3DS 沒跳、失敗原因看不到(generic catch 刻意不透傳)
        ⇒ **刷【不】過。不要把本檔讀成「沙盒刷卡驗過了」。**
```

## ✅ 開刷已獲授權(2026-08-18 Sean,經 MAIN 轉述) —— 但條件要照做

```
Sean 逐字:「可以 —— 直接刷，窗會當場記下訂單編號讓你事後找得到」
```
🔴 **「當場記下訂單編號」是他答應的【條件的一部分】,不是可選的。**
   ⇒ 每刷一筆立刻寫進 `docs/probes/2026-08-18-tappay-sandbox-charge-log.md`,不是只寫在報告裡。
   ⇒ 因為那些單會**真的躺在他的正式後台**,而他事後要找得到。
⚠️ 授權來源 = **MAIN 轉述的 Sean 原句**(我沒有直接看到他打字)。引用時帶上這個限定。

## 🔴🔴 底下這段仍然成立:本機刷沙盒卡,訂單會寫進【正式站 DB】

三件都是量到的,不是推論:
```
① storefront 的 TapPay composition **沒有** env↔DB 配對守門
   數法:`git grep -c PROD_SUPABASE_HOST -- apps/storefront` ⇒ 0 個檔命中
   （admin 有:apps/admin/src/lib/payment/composition.ts:97-100）
② 正式站 project ref 是公開字面,釘在 apps/admin/src/lib/payment/composition.test.ts:84
③ 本機 apps/storefront/.env.local 含那個 ref 的行數 = 2
   數法:`grep -c '<ref>' apps/storefront/.env.local` ⇒ 2（只印行數,沒印任何值）
```
⇒ **本機跑結帳 = 假錢(沙盒)+ 真資料(正式站 DB)。**
   錢是假的沒錯,但 `orders` 之類的列會**真的寫進正式站**,而那是不可逆寫入(鐵則 12③)。
🔴 **這不是我可以自己拍的板(R3:動 prod DB 必停問 Sean)。**

⚠️ 而且這道**不會有紅可看** —— storefront 沒有那個配對守門,
   所以它**不會擋、不會警告、就是安靜地寫進去**。
   (admin 那道會擋,而它的訊息講 env 配對 ⇒ 兩者是完全不同的兩件事,別混。)

## 已知天花板(先寫,免得把沙盒的綠當成正式站的保證)
```
· 3DS 態 5 CANCEL 沙盒【構造得出來】；態 -1 ERROR 【構造不出來】(backlog #353)
  ⇒ 「3DS 全部驗過」這句話在沙盒裡永遠講不出來
· 沙盒證明的是「我們送出去的東西對不對」，不證明「真的發卡行會怎麼回」
· 持卡人 email 有 ≤40 字元硬限制 ⇒ 失敗可能【跟 3DS 無關】，是踩到這條
· 退款要隔日才看得到可退金額，當日退不了
```
