# 改地址 / 收件人姓名 / 單號打錯 —— 三條死巷的現況與 plan

> Sean 2026-09-01 拍甲「現在做」。**本檔是 plan, 不是實作** —— 依主視窗 `-0a` 指示先量現況再判範圍。
> 🔴 **而他拍的是【做這件事】, 不是【某一個修法】** ⇒ 修法那一段是提案, 不是既定。
> 產出者:線【帳號】`-7a` · 2026-09-01 18:5x · 工作樹 `/Users/sean_1/pcm-wt-account`

---

## §0 · 先驗尺(不照抄上一份稽核)

上一份稽核在這裡翻過車:它的尺是 `(update|set|edit|patch).{0,25}(shipping_address|recipient)` 印 0,
而**它的正對照(同形狀去撈已知可寫的 order_notes)也印 0** ⇒ 尺沒接上, 那個 0 不算數。

本檔**不用那個形狀**。改用:

```
🟢 正對照 = 挑一個【已知後台改得動】的東西 admin_append_order_note
   ⇒ 實際呼叫端 apps/admin/src/lib/orders/note-repository.ts:93
   ⇒ 我的尺撈到 2 檔 ⇒ 尺會動
🔵 負對照 = 現造欄名 ⇒ 0
```

---

## §1 · 現況表(三件 × 兩個問題, 每格附座標)

| # | 東西 | 後台有沒有入口 | DB 擋不擋 |
|---|---|---|---|
| ① | 改地址 `orders.shipping_address_snapshot` | ❌ **無** | ❌ **不擋** |
| ② | 收件人姓名 `shipments.recipient_snapshot` | ⚠️ **只有建箱當下** | ✅ **出貨後擋得住** |
| ③ | 單號打錯 `shipments.tracking_number` | ❌ **已出貨改不了** | ❌ **不擋** |

### 逐格證據

**① 改地址**
- 後台:`apps/admin/src` 非測試命中 **2 處, 而兩處都是讀** ——
  `components/print/shipping-doc.tsx:849`(註解講來源)、`components/orders/order-search-dimensions.ts:29`(搜尋維度)。
- DB:`orders` 上的 `CREATE TRIGGER` 共 **2 個**, 含 UPDATE 的只有 **1 個** ——
  `pcm_e13_orders_subtotal_guard`(`20260815040000…:319`, `AFTER UPDATE OF subtotal`)⇒ **與地址無關**。

**② 收件人姓名**
- 後台:`apps/admin/src/lib/shipping/shipment-repository.ts:104` 送 `p_recipient_snapshot`
  —— 那是**建箱**那條路, **事後編輯的路不存在**。
- DB:X8 凍結守門 `20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:131-133` 的
  `IS DISTINCT FROM` 清單 = `recipient_snapshot` / `carrier_code` / `carrier_note` ⇒ **出貨後改不了**。

**③ 單號打錯**
- 後台:RPC 帶 `AND shipped_at IS NULL`、已寄出直接 `RAISE`
  (`shipment-actions.ts:376-377` 逐字記載)⇒ **已出貨改不了**。
- DB:X8 那三欄**不含** `tracking_number` ⇒ **直接 UPDATE 過得去**。

### 數法(可重跑)
`CREATE TRIGGER` 那一欄用 python 正規式解析(**跨行, `grep` 抓不到**):全 repo **70 個 trigger / 25 張表**。
🟢 正對照 `shipments` ⇒ 8 個(含 UPDATE 6)· `orders` ⇒ 2 個(含 UPDATE 1)· 🔵 負對照現造表名 ⇒ 0。

### RLS 那一層(補量, 而它改變了 ③ 的措辭)
`orders` / `shipments` 上的 `CREATE POLICY` 共 **4 條, 而 4 條全部是 `FOR SELECT`**
(`20260604120000…:193` · `20260826160000…:98/:636/:765`);🔵 負對照現造表名 ⇒ 0。

⇒ 🔴 **沒有任何一條 RLS policy 管 UPDATE。**而那有兩個方向, **不要只讀一半**:
- 對 `anon` / `authenticated`:RLS 開著而沒有 UPDATE policy ⇒ **它們本來就改不了**(fail-closed, 這是對的)。
- 對 `service_role` 與 owner:**BYPASSRLS** ⇒ **RLS 這一層對它們等於不存在** ⇒ ③ 那個「直接 UPDATE 過得去」成立。

---

## §2 · 🔴 這一發最重的發現 —— ③ 早就被報過了, 而那個 backlog 不存在

`apps/admin/src/lib/shipping/shipment-actions.ts:374-377` **逐字**:

> 🔴 而 X8 明文不凍結 `tracking_number`、註解寫「單號可改」——
> **DB 層允許改、RPC 層不給改, 兩層意圖不一致。** 那個落差本片不修(要新 RPC ⇒ migration),
> **已回報主視窗立 backlog。不要以為這裡漏做。**

而板上查無那一列(ref `cf6cef3a`):
```
grep -c 'tracking_number'   docs/launch-todo.md ⇒ 1   ← 而那一次是 ⟦b4-SHIPSNAP1⟧, 出貨信快照一致性, 不同的問題
grep -c '單號可改'          docs/launch-todo.md ⇒ 0
grep -c '兩層意圖不一致'    docs/launch-todo.md ⇒ 0
```

📌 **⇒ 所以「沒有任何一份稽核報過它」要改寫成:【有人報過, 而那個報告沒有落地】。**

🔴🔴 **而那句註解的作用不是記錄, 是【關掉下一個人的尋找動作】** —— 它逐字接著寫「**不要以為這裡漏做**」。
⇒ ⇒ **一個誠實的、正確的、而且確實上報過的缺口, 因為那句話而變得沒有人會再去找它。**

🔵 **同族**:`⟦b4-UNRERUNNABLE1⟧` 講「分母不可重跑」;**這一格是【交接不可查證】** ——
**「我報過了」與「它落地了」是兩個宣稱, 而碼裡只寫得下前者。**

⚠️ 而那段註解自己還有一個漂掉的座標:它引 X8 在 `:94-96`, **實際在 `:131-133`**。

---

## §3 · 🔵 一個差點騙到我的檔名(留著給下一個人)

`supabase/migrations/20260725120000_rf2a0_orders_freeze_shipping_rule.sql` ——
**檔名寫著 freeze shipping**, 我一度以為那就是地址的凍結守門。

🔴 **開檔才看到**:它凍的是 `shipping_method_at_checkout`(結帳當下的運送方式), 而且是 **`BEFORE INSERT`**,
**與 `shipping_address_snapshot` 完全無關**。

📌 **⇒ 兩個東西的名字都有 `shipping`, 而只有開檔分得出來。**

---

## §4 · 三件事的形狀不一樣 ⇒ 它們大概不是同一片

```
① 兩邊都沒有(入口沒有 · DB 不擋)
② 入口沒有 · 而 DB 有
③ 入口沒有 · 而 DB 沒有   ← 而它已經被報過一次
```

⇒ 主視窗 `-0a` 自己提的那句是對的:**「我們在補【後台入口】, 還是在補【DB 守門】?那是兩件事。」**

### 而要 Sean 拍的是這個, 不是修法
```
甲 只補【後台入口】—— 員工改得到, 而 DB 層維持現狀
乙 只補【DB 守門】 —— 擋住繞過後台的直接寫入, 而員工仍然改不了
丙 兩個都補
```
🔴 **而三件事可以有不同的答案** —— ② 的 DB 已經有守門了, 它缺的只有入口;
③ 兩邊都缺, 而它是唯一一個【今天有人已經在用 SQL Editor 補救】的。

---

## §5 · 這一發證不到什麼

```
① 我沒有實際跑一發 UPDATE 去證明它過得去 —— 那要連正式庫寫入, 不做
② 「後台沒有入口」我量的是 apps/admin 的 TS 原始碼
   ⇒ 若有人透過 Supabase Studio 或別的 app 改, 不在我的分母裡
③ RLS 我讀的是 migration 裡的 CREATE POLICY, 不是正式庫的 pg_policies
   ⇒ 若正式庫有手動加過的 policy, 我看不到
④ 我沒有量【客人自己那一側】能不能改地址(顧客站有沒有入口)—— 未查, 而它可能改變範圍
```

## §6 · 下一步

**本檔到此為止, 不動手。** 等主視窗 / Sean 決定 §4 那三個字母, 以及三件事各自要哪一個。
