# plan · ⟦b4-PAIDTHENOVERPAID⟧ 第二層 —— 多匯的客人看得到「多了多少、怎麼拿回去」

> 2026-09-12 · 窗 B(`~/pcm-ops`)· ⛔ ~~只寫 plan,零改動、零貼板。~~ ⇒ **2026-09-12 已實作**。
> 🔴 **授權強度要分開講**(Fable 審 C2;不要讀寬):
>    · **Sean 批的是「§7 那一題答甲 = 現在做」** —— 他批的是【要不要現在做這件事】,
>      而他當時看到的做法是 §2(動 view 加 `paid_total`)。
>    · **改走 §1-bis(零 migration)這個決定是【主視窗 `pcm-website-v2-ba` 批的】, 不是 Sean。**
>      ⇒ 📌 **Sean 沒有看過「不動 view」這個版本** —— 而它比他看過的那版保守(零 schema 改動)。
>      要不要回頭跟他說一聲, 由主視窗決定。
> 🔴🔴 **先讀 §1-bis** —— 本份 §2 那四步的**第一步(動 view 加 `paid_total`)被推翻了**:
>    它多餘(資料早就在 `balance_due` 的負數那一側、後台今天就這樣印),而且**會對客人說假話**
>    (`paid_total` 不扣退款 ⇒ 「多付後又退款」的單會被印成「多的會退給您」)。
>    ⇒ 實作走 §1-bis 那一版:**零 migration、只動 TS**、貼板 137 不排。
> ⛔ ~~鐵則 8(動 view = schema,跨 4 檔)⇒ 等 Sean 批才實作~~ —— 實作版不動 schema ⇒ 鐵則 8 不適用。
>    板列態 `doing`,第一層已上線。
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

## 🔴 1-bis. 2026-09-12 訂正:**§2 那四步的第一步被推翻了**(留痕,不靜改)

> 下面 §2 到 §6 **是原推薦,保留原文**。它錯在哪、為什麼,寫在這一節。
> 實作走的是本節這一版:`docs/` 這份 plan 的結論 = 本節。

```
⛔ 原推薦(§2 步①②③)  在 member_order_balance_v 末尾加一欄 paid_total(已收淨額),
                        adapter 多 select 一欄, 再用 `balanceDue === null && paidTotal > total` 判多付。
🔴 它有兩個問題, 第二個會對客人說假話:

① **多餘** —— 那個數字【早就在了】。`order_balance_base_v.balance_due` = `total − 帳本已收淨額`
   ⇒ **負數就是多付**, 多付的金額 = `-balance_due`。
   📌 而**後台今天就是這樣印的**:`apps/admin/src/components/orders/order-overpaid-notice.tsx`
      檔頭逐字「`balanceDue < 0 ⇒ 多付了, 多的金額 = -balanceDue`」。
   ⇒ 前台之所以看不到, 只因為 adapter 自己那道 guard 把負數夾成 null(`raw >= 0`)。
   ⇒ 🎯 **要做的是把被夾掉的那一側接起來, 不是去開一個新的資料來源。**

② 🔴🔴 **會印出假話** —— `paid_total` 的來源 `order_paid_totals_v` 是
   `SUM(order_payments.amount)`,**它不扣退款**(退款住在 `order_refunds` 與
   `order_manual_refunds` 兩本【別的】帳)。
   ⇒ 構造:訂單 10,000、客人匯了 12,000、我們已 confirmed 退他 2,000。
     `paid_total` = 12,000 > 10,000 ⇒ 照 §2 步④那個條件 ⇒ 畫面印「多的 NT$2,000 會退給您」
     ⇒ 🛑 **那筆錢早就退出去了。** 而客人會再來問一次、或以為我們還欠他。
   ✅ 走 `balance_due` 沒有這個洞:那支 view 只要看到**任何有效退款**就回 NULL
     ⇒ `overpaidTotal` 為 null ⇒ 自動落回第一層那句「請與我們聯絡 / 請不要再匯款」。

🔬 **這一格是量出來的, 不是讀碼推的**(拋棄式 PG 17.10;`order_balance_base_v` 的本體
   從 `20260906150000` **原樣抽出**,只拿掉 WITH 選項;七個情境):
   ① 多付 2,000 沒退款              ⇒ balance_due = -2000  ⇒ 印「多付 2000」
   ② 多付後【全退】(卡軌 confirmed) ⇒ **NULL** ⇒ 落回第一層
   ③ 多付後【部分退】(卡軌 confirmed)⇒ **NULL** ⇒ 落回第一層
   ④ 多付後部分退(匯款軌 未作廢)    ⇒ **NULL** ⇒ 落回第一層
   ⑤ 退款【已作廢】(卡軌零列)       ⇒ -2000 ⇒ 印「多付 2000」(作廢的不算 —— 負對照)
   ⑥ 退款 status=processing          ⇒ -2000 ⇒ 印「多付 2000」(Sean 09-05 拍甲:processing 還算已收)
   ⑦ 剛好付清                        ⇒ 0
   🟢 ⑤⑥ 是負對照:它們證明那道述詞認的是**有效退款**, 不是「那兩張表裡有列」。

⇒ **實作版(零 migration)**:
   ① adapter 在【同一發查詢的同一個 raw】上多導一個 overpaidAmount(`parsed < 0 ⇒ -parsed`),
      **既有那道 `raw >= 0` 的 guard 一個字都不動**(它擋的是 toMoneyAmount 對負數 throw ⇒ 整頁 500)
   ② `MemberOrderDetail` 加 `overpaidTotal: Money | null`
   ③ 文案:`overpaidTotal !== null` ⇒ 帶三個數字那一句, 而「請不要再匯款」兩條分支都留著
   🔵 上界:多付金額 > 訂單總額 ⇒ 當算不出來(落回第一層)。失敗方向安全。
   ⇒ 📌 **零 migration、零 GRANT、不碰線上 view** ⇒ §3 整節(42P16 那個坑)與貼板 137 都不需要。
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
