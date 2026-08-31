# ⟦b4-SHIPUNVOID1⟧ plan · 箱子作廢後再復原 ⇒ 出貨信永遠不寄

線【DB 金流】2026-08-31 · **本檔是提案,尚未動任何碼。**

## 0. 前提驗證(開工前跑,四格全中)

| # | 宣稱(板 `:731`) | 我量到的 | 判 |
|---|---|---|---|
| ① | 掃描 view 的 anti-join **不分 status** | `20260822010000` 該處**自己的註解逐字**:「這個 anti-join 只看『那一列存不存在』,**不分 status**」;SQL 本體 `NOT EXISTS (… WHERE e.event_type='order_shipped' AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))` ⇒ **零 status 條件** | ✅ |
| ② | 那一列**永久佔住**去重鍵 | `20260717020000:377` `CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key)` ⇒ **同鍵插不進第二列** | ✅ |
| ③ | `admin_unvoid_shipment` 不清那一列 | 該函式所在檔 `email_outbox` 命中 **0** | ✅ |
| ④ | **沒有任何東西會叫** | 🔴 **比板上說的更強**:今天才建的 `20260831020000` 缺口告警,`:120` 的 `COMMENT` **自己逐字寫著**:「已知盲區:那支 view 的 anti-join 不分 status ⇒ 一列 `skipped_shipment_voided` 會讓那一格永久離開分子(板上 `b4-SHIPUNVOID1`)⇒ **本量具在那個漏信面上恆印 0**」 | ✅ |

🔴 **④ 值得單獨講**:**為這個面蓋的那支量具,對這個面恆印 0,而它自己知道並寫下來了。**
⇒ 📌 那不是盲點,是**具名的盲區** —— 而它的作用是:**下一個看那支告警的人會看到全綠,而全綠是真的、只是不涵蓋這一格。**

## 1. 症狀(對客人)
員工把箱子作廢 → 出貨信落 `status='skipped_shipment_voided'`(**這是對的**,那是正常業務動作)
→ 員工**復原**同一個箱(`admin_unvoid_shipment`,同一個 shipment id)
→ 去重鍵 `(shipment_id, order_id)` 沒變 ⇒ view 的 anti-join 仍命中那一列
⇒ **那位客人的出貨通知永遠不會排進去,而狀態是「跳過」不是「失敗」** ⇒ 不進 due、不被任何 dead-man 命中。

## 2. 三個修法(**我不自己拍,列代價**)

### 甲 · `admin_unvoid_shipment` 把那一列清掉
- 動作:unvoid 時 `DELETE FROM email_outbox WHERE event_type='order_shipped' AND dedup_key=… AND status='skipped_shipment_voided'`
- ✅ **時點最準**:unvoid 就是「那個 skip 從對變錯」的那一刻
- 🔴 **代價**:那一列是**證據**(我們曾經因為作廢而跳過)⇒ 刪掉就沒了
  ⇒ 要補:同一交易寫一筆 `admin_audit_log`,否則我們把一個**沉默的漏信**換成一個**沉默的刪除**

### 乙 · 改 view 的 anti-join 忽略該 status
- 🔴 **單獨做會壞**:UNIQUE 擋住新 INSERT ⇒ view 每輪都回同一列而排不進去 ⇒ **從「不寄」變成「每輪空轉」**
- ⇒ 必須同時把入列路徑改成 `UPDATE` 既有列回 `pending` ⇒ **動 view + 入列邏輯兩處**

### 丙 · 寫入 skip 時就把去重鍵綁在「這一次作廢」上
- 動作:`skipped_shipment_voided` 那一列的 `dedup_key` 加上一個作廢世代(例如 `voided_at` 或 void 事件 id)
- ✅ 語意最正:**skip 是針對那一次作廢,不是針對這箱這單的永遠**
- 🔴 **代價**:改的是 `dedup_key` 的語意 ⇒ 影響面最大,而去重鍵是這張表的**核心不變式**

## 3. 我的推薦 = **甲 + 稽核**
理由:③ 已量到 unvoid **完全沒碰** outbox ⇒ 甲是**加一段**不是改語意;乙 會製造空轉;丙 動核心不變式。
🛑 而甲的那個代價要一起做,不能之後補:**把沉默的漏信換成沉默的刪除,不算修好。**

## 4. 命中的鐵則(自評,不降級)
- **12⑤ 對外不可回收(寄信)** —— 本片的失敗方向是**寄出不該寄的信**(例如箱又被作廢了卻寄了)
- **12③ 動 RPC** · **鐵則 8**(動 RPC ⇒ 先提 plan 等批)
⇒ **codex 對抗審查不降級。**

## 5. 驗收(每條可 yes/no)
1. 拋棄式 PG:作廢 → 出貨信落 skip → **unvoid** → 掃描 view **回得到那一列**(現況:回不到)
2. **反向**:作廢 → skip → **不 unvoid** ⇒ view **仍然回不到**(否則我們把靜默漏信換成錯誤寄信)
3. 🔴 **必死正對照**:把修法拿掉重跑,第 1 條**必須紅** —— 否則整發零判別力
4. `admin_audit_log` 有那一筆(甲的代價那一格真的落地)
5. 連跑兩發:**檔數 / 測項 / 紅格 / 我餵幾條 vs 它跑幾支** 四個數皆相同
6. 三綠 + codex(12⑤③ 不降級)

## 6. 🛑 我還答不出來的(寫下來,不假裝已知)
- **同一箱被作廢/復原兩次以上**時,甲 的行為對不對:我沒有演過那個世界
- 正式庫**現在有沒有這種列**(`status='skipped_shipment_voided'` 而箱已 unvoid)⇒ 那要唯讀查正式庫,**我查不到**
  ⇒ 🔴 **這一格會改變本片的急迫度**:若已經有客人中招,那是「現在就在漏」不是「未來會漏」
