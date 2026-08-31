# 券片 3b — 把兌換接進結帳(解除 3a 的封鎖)

> **本片解除 3a 的封鎖。** 3a(`20260901003000`)讓 `create_order` 收得下 `p_coupon_code`,
> 但帶券碼會被一道 `RAISE EXCEPTION` 擋掉 —— **那道 RAISE 是 3a 刻意留的門栓,本片的第一件事就是拆掉它。**
> 兩片的關係在碼上看得見:3b 的 diff 會刪掉 3a 那五行。
>
> · 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構與不可逆寫入)⇒ 全 9 步、**codex 不降級**、plan 交主視窗批。
> · 內容分級 = **L1**(券的規則由後台 CRUD 管,本片不 hardcode 任何券)。
> · 上游:片1 `20260829150000`(表)、片2 `20260831160000`(`redeem_coupon`)、
>   predicate `20260831155000`(2026-09-01 由 `20260831150000` 改號,見那支檔頭)、3a `20260901003000`。

---

## 0. 🔴 開工前量到的那一格 —— 本片真正的難題不是「拆 RAISE」

```
量法(2026-09-01,worktree /Users/sean_1/pcm-wt-account,HEAD efb5c7de):
  awk '/^CREATE TABLE orders \(/,/^\);/' 20260604120000_….sql  ⇒ 抽出 40 行
    🟢 正對照 discount_total ⇒ 2      🟢 正對照 subtotal ⇒ 2
    🔴 coupon                ⇒ 0      🔵 負對照 zzq9137  ⇒ 0
  grep -riE 'alter table (public\.)?orders.*coupon' migrations/  ⇒ 0
    🟢 正對照 'alter table … orders' 任何               ⇒ 76(尺會動)
```

⇒ **`orders` 上沒有任何一欄記得住「這張單用了哪張券」。**

而兩支函式的簽章是這樣:

| 函式 | 拿得到券碼嗎 | 何時跑 |
|---|---|---|
| `create_order(…, p_coupon_code text)` | ✅ 客人送來的 | 下單那一刻 |
| `confirm_order_payment(p_order_id, p_amount, p_rec_trade_id)` | ❌ **三個參數都不是券** | 收到款那一刻 |

而 `redeem_coupon(p_code, p_user_id, p_subtotal, p_order_id)` **要券碼**才找得到券。

📌 **⇒ 券的身分在【下單】與【收款】之間會消失,而 Sean 拍的是「收款成功才寫 redemption」。**
   本片必須先決定那個身分住在哪裡 —— **這是 schema 決定,不是接線決定**,所以它排在第 1 節。

🛑 **而這一格不是我在 3a 沒想到** —— 3a 的範圍是「收得下券碼且不讓它生效」,
   身分保存是 3b 的事。**寫出來是為了讓審的人看得出這是接續、不是補洞。**

---

## 1. 券的身分住哪裡(三案,我推甲)

| | 做法 | 代價 | 風險 |
|---|---|---|---|
| **甲(推薦)** | `orders` 加一欄 `coupon_id uuid REFERENCES public.coupons(id) ON DELETE RESTRICT`,`create_order` 寫入 | 動 schema、一支 migration | FK RESTRICT ⇒ 用過的券刪不掉(**這是要的**) |
| 乙 | `confirm_order_payment` 加參數收券碼 | 不動 schema | 🔴 **券碼變成客人端可控** —— 與 3a 剛修掉的 `p_discount_total` **同款洞**;客人可以拿 A 券下單、用 B 券兌換 |
| 丙 | `create_order` 當下就寫 redemption 列(pending) | 不動 orders | 🔴 撞兩道既有約束:`CHECK (discount_applied > 0)` 與 predicate 要求 `payment_status='paid'` ⇒ 未付款的單也會佔掉券的名額 |

**推甲的理由**:乙把剛封起來的那個洞用另一個參數再開一次;丙讓「還沒付錢的單」吃掉券的庫存。
甲讓那張單**自己說得出自己用了哪張券**,而 `discount_total` 已經在 orders 上了 —— **金額在、身分不在,本來就是半套。**

🔵 甲同時解掉一個沒有人問的問題:**後台看一張單,現在看不出它用過券。**

---

## 2. 驗收條(第 1 條是主視窗指定的)

```
🔴 1. 帶券碼真的建出【折扣單】+ redemption 那一列真的寫進去
      · create_order(p_coupon_code:'X') ⇒ orders.discount_total > 0 且 = 試算值
      · orders.coupon_id = 那張券的 id
      · confirm_order_payment(那張單) ⇒ coupon_redemptions 多一列, discount_applied = 同一個值
      🟢 而這一條要【兩個世界印不同的東西】:不帶券碼 ⇒ discount_total = 0 且 redemptions 零列
 2. 🟢【放行】那一格 —— 一張合格的券真的折得到
      (少了它, 一個「永遠擋」的實作會讓其餘驗收全綠)
 3. 3a 那道 RAISE 在 pg_get_functiondef 裡【找不到了】
      🟢 正對照:同一發去找 'v_discount_total', 必須找得到
 4. 券失效(predicate 回非 NULL)⇒ 收款【仍然成功】+ 告警 + 人工旗標(丙, 見 §3)
 5. 同一張單重送 confirm ⇒ redemption 不會變成兩列(UNIQUE (order_id) 已擋, 但要有一格證明它擋到了)
 6. 三綠 TURBO_FORCE=1 全 rc=0, 0 cached
 7. 我餵幾條 vs vitest 跑幾支 —— 兩個數字都印出來, 對不上就是紅
```

---

## 3. 兌換失敗時怎麼辦(Sean 已拍【丙】)

`redeem_coupon` 在收款那一刻可能失敗(券過期了 / 用完了 / predicate 說這張單有問題)。
Sean 拍的是 **丙:收款照樣成功 + 告警 + 標人工處理** —— 錢已經進來了,不能因為券的問題把收款回捲。

```
實作:confirm_order_payment 裡把 redeem_coupon 包在 BEGIN … EXCEPTION WHEN OTHERS
     ⇒ 失敗不 re-raise, 改寫一筆 anomaly + 標記那張單要人工看
```

🔴 **而驗收要有一格【把 `ANOMALY_ALERT_ENABLED` 關掉】再跑一次** ——
   證明降級是**看得見的**,不是安靜地掉在地上。
   📌 一道告警在「沒有東西要告警」與「告警自己壞了」印同一個安靜。

---

## 4. ✅ Sean 那兩題【2026-09-01 已答】—— 標 🔴 的格結算

> 原本這一節寫「不先假設,標出哪幾格會被答案改變」。答案來了,逐格結算。
> 🔴 **兩張表的原內容一字不刪** —— 下一個人要看得出當初標的格與最後走的路對不對得上。

### ✅ Q1 券可不可以吃運費 ⇒ **不可以**
```
Sean 2026-09-01 逐字:「不可以」(主視窗 -24 轉)
落檔逐字:「2026-09-01 Sean 拍【不可以】—— 券的上限 = 商品金額,運費照付」
```
**為什麼**(我當時給的理由,現在是這條規則的為什麼):
低消比的是小計、百分比乘的是小計 ⇒ 讓它吃運費 = **同一張券兩個基準**,而客人與員工算不出同一個數字。

⇒ **下表「若答【不可以】」那一欄全部成立:三格都不動。**
⇒ `redeem_coupon:218` `least(v_calc, p_subtotal)` 已經是這個行為。
🛑 而這條**不涵蓋免運券**（它折運費、不折小計,是另一種東西,今天沒有）。
   免運券那天會撞上甲那支的雙向 CHECK —— 已寫進 `20260901020000` 檔頭。

### ✅ Q2 0 元單成不成立 ⇒ **成立**(他答「都可以,看你建議」⇒ 主視窗裁【成立】)
```
理由(端給他的原話):客人拿全額券 + 門市取貨,結帳時會看到「付款失敗,請稍後再試」
              —— 而再試一百次都不會成功。那比讓 0 元單成立糟得多。
做法:金額 0 ⇒ 跳過刷卡那一步,直接算已付款。
```
🛑 **而它【不是 3b】** —— 它動的是結帳/付款那條路,不是券的兌換 ⇒ **另開一列,不塞進本片。**
🔵 上一代 `create_order` 的 `IF v_total <= 0` 那道閘,錯誤訊息**自己預告了它**:
   逐字「若這是合法的 0 元單(全額折價券/儲值金),本閘需重議」⇒ **前人寫下了觸發條件,而它到了。**

✅ **而它會不會撞甲那條 CHECK ⇒ 實測過,不會**(拋棄式 PG,不是推的):
```
形狀1 全額券 + 門市取貨(subtotal 1000 / discount 1000 / shipping 0 / total 0) ⇒ UPDATE 1
形狀2 沒有券的 0 元單(四欄皆 0)                                              ⇒ UPDATE 1
🔵 負對照 一個真的會撞的形狀(有券而折 0)                                      ⇒ ERROR 23514
```
⚠️ 主視窗問的時候引的是**舊版單向** CHECK,而 R2 已經改成雙向 `(discount_total > 0) = (coupon_id IS NOT NULL)`
   ⇒ 上面量的是**現在這一版**。

---

### Q1 券可不可以吃運費
| | 現在的碼 | 若 Sean 答【可以吃】 | 若答【不可以】 |
|---|---|---|---|
| `redeem_coupon:218` `v_calc := least(v_calc, p_subtotal)` | 上限 = 小計(**運費吃不到**) | 🔴 改成 `least(v_calc, p_subtotal + p_shipping_fee)` ⇒ **`redeem_coupon` 要多收一個參數** | ✅ 不動 |
| `create_order` 傳給 `redeem_coupon` 的參數 | 只傳 subtotal | 🔴 要多傳 shipping_fee | ✅ 不動 |
| 驗收 §2-1 的期望值 | `discount ≤ subtotal` | 🔴 `discount ≤ subtotal + shipping` | ✅ 不動 |

⚠️ **設計稿那一側說可以吃** —— 而現在的碼不吃。**兩邊不一致這件事本身就是要他答的理由。**

### Q2 0 元單成不成立
| | 現在的碼 | 若答【成立】 | 若答【不成立】 |
|---|---|---|---|
| `create_order` 的 `IF v_total <= 0 THEN` 閘 | 擋掉 ⇒ **全額券 + 門市自取會被拒** | 🔴 要放寬成 `< 0`,而**那道閘的錯誤訊息自己預告了本片** | ✅ 不動,但客人會撞到一個看不懂的錯 |
| 3DS / 金流 | 未查:0 元要不要送金流 | 🔴 **要另外查**,可能是另一片 | ✅ 不動 |

🛑 **這兩題都不先假設。** 甲(身分欄)與 §3(丙)**不受這兩個答案影響** ⇒
   **本片可以先做那兩塊,兩題的答案回來再補上表格裡標 🔴 的格。**

---

## 5. 會動哪些檔(要發給哨兵的那一句)

```
supabase/migrations/2026090100XXXX_m4b_coupon_p3b_order_coupon_id.sql        (新, 甲)
supabase/migrations/2026090100YYYY_m4b_coupon_p3b_create_order_redeem.sql    (新, create_order 第 11 代)
supabase/migrations/2026090100ZZZZ_m4b_coupon_p3b_confirm_writes_redemption.sql (新)
apps/admin/src/lib/orders/subtotal-writers-allowlist.test.ts                 (登記新的 writer)
docs/plans/2026-09-01-coupon-slice3b-redemption-wiring-plan.md               (本檔)
```

⚠️ **`create_order` 是第 11 代** ⇒ 動手前跑 `bash scripts/latest-definition-of.sh create_order`
   確認 `newest` 與 `live` 現值,**不要抄一個舊代**(抄錯一代 = `CREATE OR REPLACE` 把後面幾代整個回捲,而三綠不會紅)。

---

## 6. 不做什麼(明寫)

```
· 券的 UI / 文案 / .cart-coupon CSS  ⇒ 3c
· 券的使用上限(每人幾次 / 全站幾次)⇒ 3d
  🔵 而 Sean 拍過「券上限接兌換前先做成真的閘」⇒ 本片會在 §5 那支 migration 留一行 TODO 錨,
     讓 3d 找得到落點。**留錨不等於做了。**
· 退款時把券還回去(coupon_redemptions.reverted_at)⇒ 未排片, 本片不碰
```
