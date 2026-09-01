# ⟦b4-NONCARDPAID1⟧ plan v4 —— 同一個事實,兩個相反的行動

> 線【出貨】`-0e` 2026-09-01 23:3x。**v1/v2/v3 都不刪。**
> 🛑 **形狀第二次變了 ⇒ 鐵則 8 要重批。主視窗 `-0a` 下令停手,碼停在半支(`docs/specs/…-v3.sql`,檔頭有停工橫幅)。**
> 🎯 **要問 Sean 的只有一句:「你說兩個觸發器,而我要交一個 —— 因為第二個已經有人做了。可以嗎?」**

---

## 0. 一句話

**v2 的第二個觸發器不是補一個洞,是開【第二個寫入端】——**
**而那半自 2026-08-23 起就有人在管了。**

---

## 1. 🔴 codex 對 v2 的碼:`FAIL`,20 個 must-fix + 2 nit

零留痕:兩支受審檔 sha256 跑前跑後一致(codex 自己也印了那一句)。
它只跑了 `bash -n`(通過),**沒有跑 harness**。

### 1-a 三條最重要的

```
🔴 ① v2 把 expire_unpaid_orders 的【成功心跳整段刪掉】了, 而它自稱「只加一句」
🔴 ② v2 的第二個 trigger 是【第二個 payment_status 寫入端】
🔴 ③ v2 的 cron 腿寫成「有沒有收款列」⇒ 淨額 0 的單被【永久擋住】, 再也不會被取消
```

---

## 2. 🔴🔴 ① 的因果鏈 —— 我修 harness 時親手造出的盲區,兩小時後讓我抄錯一代

```
22:1x 我把 20260828060000 加進 provision 的 pg_cron 跳過清單(它讀 cron.job, 本機沒有)
   ⇒ 拋棄式庫裡的 expire_unpaid_orders 變成【20260809160000】那一代 —— 沒有心跳
23:0x 我從那個庫 pg_get_functiondef 抄函式體 ⇒ 抄到舊的那一代
   ⇒ 我的 CREATE OR REPLACE 會把正式庫的心跳整段蓋掉
   ⇒ ⇒ 後果不是難看:cron 照樣取消訂單, 而後台會把它顯示成【失聯】
```
✅ 複查:`bash scripts/latest-definition-of.sh expire_unpaid_orders`
⇒ `newest = 20260828060000` / `live(帳本) = 20260809160000` ⇒ 工具自己就喊了 `newest ≠ live`。

📌 **⇒ 而 CLAUDE.md 路由表【逐字】寫著:「要抄一支既有的 DB 函式來改 ⇒ 先跑 `latest-definition-of.sh`」。**
🛑 **⇒ 而那條路由的觸發情境,逐字就是我在做的事。⇒ 而我沒跑。**
🔴 **⇒ 而那不是「忘了讀規矩」—— 那條規矩我今晚讀過。**
**⇒ ⇒ 它是【一條寫對地方的規矩,在那個人正在做那件事的當下沒有被觸發】。**

---

## 3. 🔴🔴 ② —— 同一個事實,兩個相反的行動

```
22:3x 我量到:OP6a(admin_compute_order_settlement)看不到 order_manual_refunds
        prosrc 0 次 · 🟢 正對照 order_payments 7 次 · 實跑「退 400 之後一個字都沒變」
   ⇒ 我推出的結論:「所以要【自己補】那個面」⇒ 丁 ⇒ 第二個 trigger
23:2x codex:「repo 已有 pcm_sync_order_refund_payment_status 作為退款狀態寫入端,
        且 admin_record_manual_refund 已接線」
   ⇒ 正確的結論:「所以那個面【由別人負責】」
```
🎯 **⇒ 同一個事實,兩個相反的行動。而量測、正對照、實跑,每一格都是對的。**
🛑 **⇒ 錯的是【推論的方向】,而沒有任何一把尺抓得到那個。**
🔵 **⇒ 抓到它的是 codex,而它抓到的方式是【它知道那支函式的存在】——**
**⇒ ⇒ 那是「codex 的價值是它不共用我們的前提」的實錘,今晚第二次。**

### 3-a 證據(我獨立複查過,不是轉述)

```
bash scripts/latest-definition-of.sh admin_record_manual_refund
  ⇒ newest = live = 20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql
     檔名逐字含 record_calls_sync
     該檔 :17 逐字「pcm_sync_order_refund_payment_status(order_id)。**只加這一行**, 其餘一字未改。」
```

### 3-b 而 codex 直接演出「兩個寫入端」的後果

> total=1000,先人工退款 400(我寫 `partiallyRefunded`),之後卡片再退 600;
> 兩本退款帳合計已達 1000,但我對退款態直接 RETURN,現行卡片 helper 又只看卡片自己的 600
> ⇒ **狀態永久停在 `partiallyRefunded`,不會成為 `refunded`。**

📌 **⇒ 兩個互相不知道對方分母的狀態寫入端。而它不報錯。**

---

## 4. 🎯 v4 的形狀 —— 而這就是要 Sean 重批的那一格

| | v2(Sean 批的) | v4(現在要批的) |
|---|---|---|
| 掛點 | **兩個** trigger | 🔴 **一個**(`order_payments` AFTER INSERT) |
| 退款狀態 | 本片自己寫 `refunded`/`partiallyRefunded` | 🔴 **完全不寫** —— 有任何退款活動就交還退款管線 |
| cron 腿 | `NOT EXISTS(order_payments)` | 🔴 **淨額 > 0**(沖銷回 0 的單恢復可取消) |
| cron 來源 | 從拋棄式庫抄(舊代、無心跳) | 🔴 從 `20260828060000:189` 抄(含心跳) |
| #6 例外範圍 | 只包 OP6a 那一發 | 🔴 **整段包住**(SUM / UPDATE / 下游 trigger 都在保護內) |
| 鎖 | `SELECT … FOR UPDATE` | 🔴 **不鎖**,改條件式 UPDATE(避開 FK KEY SHARE ⇒ FOR UPDATE 的升級死結) |
| 還原段 | 整段是註解 | 🔴 **可直接貼的 SQL** |
| 前置閘 | 無 | 🔴 `current_user` 必須是 OP6a 的 owner;心跳表在;現行 cron 必須已接心跳 |

### 🔴 要給 Sean 的那一句(寫在交件檔頭【第一段】,不是 §N)

> **你說「加兩個觸發器」,而我交【一個】。不是做不到 —— 是查下去發現第二個早就有人做好了。**
> 那另一半誰在管:`admin_record_manual_refund` 自 2026-08-23 起會呼叫
> `pcm_sync_order_refund_payment_status`(`20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql`,
> 檔名逐字 `record_calls_sync`,該檔 :17 寫「只加這一行,其餘一字未改」)。
> 我再加一個會變成第二個寫入端,而兩邊用不同的算法 ⇒ 訂單會永遠停在「部分退款」。
> **⇒ 所以少的那一個不是漏掉,是【不該加】。**

🔵 **檔名與行號要寫進去 —— 他不會查,而【下一個懷疑這件事的人】會。**

---

## 5. 🔴 harness 那半:codex 抓到 6 條假綠,而第一條打的正是我最得意的那格

```
B:73  三發突變證人【只看 rc 非 0】⇒ DROP 失敗、權限錯、fixture 壞掉, 全被算成「殺死 mutant」
      🛑 而 M3 那個「突變沒裝上會自己 RAISE」的設計 —— helper 不看訊息
      📌 ⇒ 我為了分辨兩種紅而寫的那道訊息, 【從來沒有被任何東西讀過】
      🔴 ⇒ 而我今晚【才剛修過】那個 M3(第一版突變會產生語法錯)
        ⇒ 我修的是【突變】, 而漏的是【讀它的那一端】
B:255 W2-4 / W2-5 只驗「不是 paid」⇒ 寫成任何別的值都綠 ⇒ 沒測到它標題宣稱的狀態機
B:343 W2-8 把兩個 trigger 都拿掉【仍然全綠】⇒ 分不出「exception 邊界正確」與「根本沒有 trigger」
B:217 S2 在含註解的 prosrc 搜字串 ⇒ 刪掉述詞留下註解, 它仍綠
B:305 W2-6 沒有隔離候選集合 ⇒ 庫裡若有 500 張更舊的單, fixture 根本不會進 target 而它照樣綠
B:82  fixture 隨機三位尾碼可能撞 UNIQUE;沒斷言 customer / variant 真的存在
```
✅ **這六條與形狀無關 ⇒ 不等 Sean,我現在就修。**

---

## 6. 🛑 這一版證不到什麼

```
· 正式庫【現在】跑的是哪一代 expire_unpaid_orders —— 帳本說 20260809160000, 而帳本不是正式庫
  ⇒ 所以 v4 加了一道前置閘:貼下去之前它自己去讀 prosrc, 沒接心跳就拒繼續
· 今天有沒有真的踩到 —— orders 今早被清空 ⇒ 那個 0 沒有判別力
· 那支 cron 現在有沒有真的在跑 —— 本機是 fake cron
· codex 的 20 條我【還沒逐條驗證】—— 上面複查過的是 ① 與 ②(各自獨立跑工具確認過)
  其餘 18 條是照它的敘述折進 v4 的形狀, 而【我沒有為每一條各造一發重現】
```

---

## 7. 要 Sean 拍的,只有一題

```
Q: 匯款那片 —— 你上次說「加兩個資料庫觸發器」。查下去發現第二個(人工退款那個)
   早就有人做好了(2026-08-23), 我再加會變成第二個寫入端, 而兩邊算法不同
   ⇒ 訂單會永遠停在「部分退款」。所以我想只交一個。
A: 甲 只交一個(推薦) | 乙 還是要兩個, 我另外想辦法讓兩邊不打架
```
