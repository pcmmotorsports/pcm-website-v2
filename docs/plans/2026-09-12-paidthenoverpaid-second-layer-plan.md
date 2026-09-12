# plan · ⟦b4-PAIDTHENOVERPAID⟧ 第二層 —— 多匯的客人看得到「多了多少、怎麼拿回去」

> 2026-09-12 · 窗 B(`~/pcm-ops`)· **只寫 plan,零改動、零貼板。**
> 🔴 鐵則 8(動 view = schema,跨 4 檔)⇒ **等 Sean 批才實作**。板列態 `doing`,第一層已上線。
> 板列:`bash scripts/board-row-by-anchor.sh b4-PAIDTHENOVERPAID`

---

## 0. 🧑 給 Sean 的一頁

**第一層已經上線了**(2026-09-06):同一張單匯兩次的客人,打開訂單頁會看到
「這張訂單的款項狀態需要我們人工確認,請與我們聯絡。在我們回覆之前,請不要再匯款。」

**第二層是你 09-06 拍的乙(只講事實型)的完整形狀**:那句話再多兩個數字 ——
**「我們收到 NT$X,這張單是 NT$Y,多的 NT$(X−Y) 會退給您」**。

**而它今天做不出來,理由不是排程是型別**:多出來的那筆錢在程式的型別裡**不允許是負數**,
一路傳到畫面時已經被換成「不知道」⇒ 畫面拿不到那個數字。要補的是**資料來源**,不是文案。

**今天有幾個人受影響 ⇒ 0 人**(正式庫唯讀:有收款的 3 張單,**全部剛好付清**,0 張多匯、0 張短匯)。
⇒ **所以這件事現在做或上線後做,都不會有人在等。** §7 那一題就是問你這個。

---

## 1. 現況(檔:行 + 正式庫唯讀數字)

**正式庫唯讀(2026-09-12,從基表算;`member_order_balance_v` 唯讀角色 permission denied)**
```
有收款列的單        3   · 已收 = 訂單金額 3 · 🔴 已收 > 訂單金額(多匯)**0** · 短匯 0
那 3 張的狀態·管道  refunded·bank_transfer / refunded·tappay
⚪ 負對照 received > total×100 ⇒ 0(尺不亂命中)
🛑 `member_order_balance_v` 我**讀不到**(連 information_schema 都回「讀不到」)⇒ 下面那張 view 的欄位
   依據是 migration `20260906160000`(它自己 `:38` 有一道前置閘斷言線上欄位【恰好】是 `order_id,balance_due`)。
```

**碼(2026-09-12 開檔)**
```
第一層(已上線)   apps/storefront/src/components/account/OrderDetailView.tsx
                  · balanceDue 為 null 或 <= 0 ⇒ 印「請聯絡我們 / 請不要再匯款」
                  · balanceDue > 0        ⇒ 才印帳號與金額
🔴 第二層拿不到數字, 三道都在:
   ① packages/domain/src/shared/types.ts:48-50  `if (n < 0) throw` ⇒ MoneyAmount 不可為負
   ② packages/adapters/src/supabase/SupabaseOrderAdapter.ts:918-924  guard:
      `raw >= 0 且 raw <= orderTotal` 才取 raw, 否則 **null** ⇒ 溢付在元件眼裡 = null
   ③ packages/domain/src/order/types.ts(MemberOrderDetail)**沒有任何「已收金額」欄**
      (板列 `-502` 逐欄看過:金額欄只有 subtotal / shippingFee / discountTotal / taxTotal / total / balanceDue)
   ⇒ 📌 **「多付了」與「算不出來」在畫面那一層是同一個值(null)** —— 那是第二層做不出來的真正原因。
🟢 而 ② 那道 guard 已經有測試釘住(`SupabaseOrderAdapter.test.ts` 的 `⟦b4-PAIDTHENOVERPAID⟧ balance_due guard`,
   四格:正對照 / 溢付 -500 ⇒ null / 超上界 ⇒ null / 非數 ⇒ null;突變拿掉 `raw >= 0` ⇒ 那一格紅)。
```

---

## 2. 改什麼(四步,順序是硬的)

| 步 | 動作 | 檔 / 物件 | 為什麼不能換順序 |
|---|---|---|---|
| ① | `member_order_balance_v` **末尾**加一欄 `paid_total`(已收淨額,非負整數) | 新 migration | 沒有來源,後面三步都是空的 |
| ② | adapter 多 `select` 那一欄,配一道與既有同款的 guard(非整數 / 負 / 超上界 ⇒ `null`) | `SupabaseOrderAdapter.ts` | 型別加了欄而沒人填 = 永遠 undefined |
| ③ | `MemberOrderDetail` 加 `paidTotal: MoneyAmount \| null` | `packages/domain/src/order/types.ts` | 元件讀不到就寫不了文案 |
| ④ | 文案:`balanceDue === null && paidTotal > total` ⇒ 印帶金額那三句 | `OrderDetailView.tsx` | — |

🔴 **為什麼是加 `paid_total` 而不是「讓 balance_due 可以是負的」**:
`balanceDue` 那條路上有**兩道**已經在線上的非負保證(①②),而它們**保護的是別的東西**
(把「算不出來」與「多付了」都收斂成 null,避免元件拿一個可能錯的數去叫客人再匯款)。
⇒ 改它 = 動一條已上線的安全線;加一欄 = 只增不改。
🔵 而 `paid_total` 本身**永遠非負** ⇒ 不撞 `MoneyAmount` 那道 throw。「多了多少」由元件算 `paidTotal − total`。

🛑 **文案只在【三個世界裡的第一個】印**(板列 09-06 記的三態):
① 多付(paid_total > total)⇒ 帶金額 · ② 剛好付清 ⇒ 維持第一層那句 · ③ 有退款(view 回 null)⇒ 維持第一層那句。

---

## 3. migration:版本號 · 42P16 · 授權

```
版本號   20260912060000_m4b_overpaid_balance_view_paid_total.sql
         (09-12 已用 010000/020000/030000;040000 與 050000 已被另兩份 plan 預定 ⇒ 取 060000。
          🔴 貼之前重新 grep 一次 —— 版本號撞號是 ⟦db-VERSIONGATECROSSBRANCH⟧ 那一列的病)
形狀     CREATE OR REPLACE VIEW(**欄位只能加在末尾**)
🔴 42P16 `20260906160000:9` 逐字:「`CREATE OR REPLACE VIEW` 改到欄名或欄序 ⇒ 42P16(貼板 39 踩過那個坑)」
   ⇒ 本片**照抄它那道前置閘的形狀**:先斷言線上欄位【恰好】是 `order_id,balance_due`,
     不是就 RAISE(不要盲改)。
ACL      `CREATE OR REPLACE VIEW` **不重設 ACL**(同檔 `:74` 逐字)⇒ 本片零 GRANT 變動。
         ⚠️ 而「零變動」要用貼後唯讀複驗證明,不是用「我沒寫 GRANT」宣稱。
DEFINER  不適用(view 不是函式)。🔵 而它是 **invoker view** ⇒ RLS 照舊由讀的人身分決定。
冪等     可重跑(CREATE OR REPLACE + 前置閘)⇒ 檔頭標 `-- pcm:idempotent: yes` 並附理由。
```

---

## 4. 客人 / 員工看得到什麼差別

```
多匯的客人(今天 0 人)  訂單頁那句話後面多兩個數字:收到多少、這張單多少、多的那筆會退。
                        🔵 而「請不要再匯款」那句**留著**(Q6 量過, 它是唯一擋得住下一次匯款的東西)。
剛好付清 / 有退款的客人  **零差別** —— 仍是第一層那句(而那正是 §2 最後那段要守的)。
員工 / Sean              零差別。本片不動後台、不動信、不動狀態。
```

---

## 5. 驗收(寫死)

```
① 好世界  已收 1200 / 訂單 1000 ⇒ 頁面印「收到 NT$1200、訂單 NT$1000、多的 NT$200」
② 壞世界  把 ④ 那個條件改成恆真 ⇒ 剛好付清那格必須紅(否則文案會對沒多付的人講多付)
③ 三態    剛好付清 ⇒ 第一層那句 · 有退款(view 回 null)⇒ 第一層那句 · 多付 ⇒ 帶金額
④ guard   paid_total 餵 -1 / 非整數 / 超過 total×10 ⇒ 元件拿到 null, 不得 throw
          🔴 ④ 是 ② 那道既有 guard 的鏡像 —— 新欄位不繼承舊欄位的保護, 要自己寫一份
⑤ 安全句  三個世界都要有「請不要再匯款」(突變:拿掉它 ⇒ 紅)
```

---

## 6. rollback / 影響

```
影響   1 支 migration(view 加末欄)+ 3 支 TS。零資料改動、零 GRANT、不動後台與信。
rollback  順序與貼的順序【相反】:先把 TS 三支 revert(前台不再讀那一欄),再把 view 換回兩欄。
       🔴 反過來做 ⇒ 前台 select 一個不存在的欄 ⇒ 那一頁整個查詢失敗(客人看到錯誤頁)。
       回捲檔 supabase/rollbacks/20260912060000-rollback.sql **內含完整的兩欄 view 定義**
       (不可寫「去某檔複製」—— Sean 2026-09-11 Q4 甲)。
曝險   貼 view 到前台上線之間:**零**(多一欄沒有人讀)。
```

---

## 7. ❓ 要 Sean 回的(一題)

```
Q:多匯的客人今天是 0 人(正式庫實查)。這個「多了多少」的第二層要現在做, 還是排到真的有人多匯之後?
A:甲 = 排到有人多匯之後再做(推薦)——今天做完也沒有人看得到, 而它要動一支 view(schema)。
       代價:真的有人多匯的那一天, 他看到的是第一層那句「請與我們聯絡」, 沒有金額。
       🛑 而那一天【不會有訊號】—— 沒有人會來說「第一個多匯的客人出現了」。
   乙 = 現在做 —— 好處是那一天到來時客人直接看得到數字、不用等我們改碼。
       代價:現在動一支線上 view(而它有 42P16 那個坑), 為 0 個觀眾。
🔵 我推甲的理由只有一個:**第一層已經擋住最壞的事**(他不會被叫去再匯一次錢)。
   第二層加的是「省一次客服往返」, 不是「防止再損失」。
```

---

## 8. 🛑 這份 plan 證不到什麼

1. **`member_order_balance_v` 我讀不到**(唯讀角色 permission denied,連欄位都讀不到)⇒ 那張 view 今天的欄位我引的是 migration `20260906160000` 的前置閘,**不是線上實查**。
2. **「0 張多匯」是從基表算的**(`order_payments` 扣掉 `reverses_payment_id` 非空的列),**不是問那張 view**;若 view 的應收算法與我的算法不同,兩者會得到不同的 0。
3. **我沒有跑過任何一步** —— 四步的可行性來自讀碼與板列既有量測(型別 throw、adapter guard 那兩格是 `-502` 2026-09-06 實測的,我沒有重跑)。
4. 讀數是 2026-09-12 那一發;**匯款開著,隨時可能多一張**。
