# B2 v5.2 · 施工前可實作性自檢(**不是審查輪**;`B-109-A` 建議的等待期自查)

> 執行者:視窗B 主對話(不是 subagent)。方法 = **把三片的 DDL 真的寫出來、在拋棄式 PG17.10 跑一遍**。
> 角度 = plan §10.3 指定的「這三片真的施工時做不做得出來」——**兩輪 Fable 審查都沒碰過這一面**。
> 拋棄庫已收、`git status --porcelain` 與開工前逐項相同(僅多本報告檔)。
> 原型 SQL 留在本 session scratchpad,**未進 repo**(本片尚未開工,不放 `supabase/migrations/`)。

---

## ①結論

**三片的 DDL 全部建得起來,20 個行為格全部如 v5.2 設計預測。**
**沒有發現「寫不出來」的東西** —— 但抓到 **1 條 must-fix(驗收層)** 與 2 條要寫進 plan 的事實。

## ②實跑過的格(全部一次通過,無需改設計)

| # | 測項 | 結果 |
|---|---|---|
| DDL-1 | S1a-1:9 條具名 CHECK + partial unique + `customer_user_id` index | ✅ 建得起來 |
| DDL-2 | S1a-2:四支 BEFORE UPDATE 守門 + 名稱序 `frozen < immutable < touch < write_once` | ✅ catalog 實查序如設計 |
| DDL-3 | S1b:表 + `NOT DEFERRABLE` parent guard + **`DEFERRABLE INITIALLY DEFERRED` + `WHEN` 的 constraint trigger** | ✅ 建得起來(**`WHEN` 與 constraint trigger 可併用,v5 的假設成立**) |
| T1 | X1 **INSERT 面**(F12):INSERT 直接帶 `shipped_at`、零品項 | ✅ commit 當下 `P0001` |
| T2 | X1 送單面 `submitted`、零品項 | ✅ `P0001` |
| T3 | X1 **`failed` 面**(v5.2 項 30c 新增) | ✅ `P0001` |
| T4 | X1 **判別序正測**:先 `submitted` 零品項 → 再加品項 → commit | ✅ 成功(**DEFERRED 確實生效**) |
| T5 | X1 **暫態正測**:`submitted` → 改回 `draft`、零品項 | ✅ 成功(**重讀現況的寫法確實救得回來**) |
| T6 | 主流程:草稿 → 加品項 → 設 `shipped_at` + 單號 → commit | ✅ 成功 |
| T7 | X8 **已出貨面**:改 `carrier_code` | ✅ `P0001` |
| T8 | X8 正測:改 `tracking_number` | ✅ `UPDATE 1` **且回查新值 = `T-NEW`**(項 16b 的 oracle 抓得到東西) |
| T9 | X8 **已作廢面**(v5.1 新增的那半) | ✅ `P0001` |
| T10 | 歸因序:同時違反 X8 + A2 | ✅ 紅在 `frozen_after_ship`(**與 §3.3 的預測一致**) |
| T11 | X2:已出貨清空 `shipped_at` | ✅ `P0001` |
| T14 | 真實寫入形狀:**owner 的 SECDEF RPC 被非 owner 呼叫**、跨客人 | ✅ `P0001` 併箱只認同客人(**守門在該路徑下讀得到 parent**) |
| T15 | 同形狀、同客人 | ✅ 成功 |
| T19 | **非 superuser owner** + zero-policy RLS(不 FORCE) | ✅ 成功 ⇒ **owner 豁免成立**(§3.2-C-2 前提① 確認) |
| T20 | 同上但 **FORCE RLS** | ✅ `42501` ⇒ **前提② 倒了的症狀是 loud 不是靜默**(§3.2-C-2 前提② 確認) |

## ③突變(證明格子有判別力)

| 突變 | 預期 | 實測 |
|---|---|---|
| **M3**:parent guard 改 `INITIALLY DEFERRED` | 項 21 正測應被誤殺 | 🔴 **確認**:主流程 commit 當下紅在「包裹已寄出或已作廢,不可再加品項」⇒ **誤設 deferrability 會把整條合法出貨流程殺掉**。好消息 = 症狀 loud,dev 期就會發現 |

(突變①②⑤ 前兩輪已實測;③④⑥ 仍是推理,留待實作時補。)

## ④🔴 must-fix(驗收層):**§4 的 RLS 斷言在本機 harness 上零判別力**

**證據鏈**:
1. `scripts/d1t2-rehearsal.sh:40` —— 拋棄庫的 **owner = superuser `postgres`**。
2. 本次實測:該 owner `rolsuper=true` 且 **`rolbypassrls=true`** ⇒ **RLS 對 owner 路徑整個被繞過**。
3. 實證:同一筆寫入,在 superuser owner 之下 **FORCE RLS 開與不開都回 `ok`**(T17/T18 = 兩個假綠);
   換成 **NOSUPERUSER owner** 之後才分得出來(T19 `ok` / T20 `42501`)。
4. repo 早已記過這個坑但當成「做不到」:`scripts/a6-verify.sh:288`/`:1425-1428`
   逐字寫「has_table_privilege 對本機 superuser 恆 true = 零判別力」,且把
   「正式站 role 屬性(owner 是否 superuser / BYPASSRLS)」列為 **未驗**;`s1a-verify.sh:264` 同型。
5. 而正式站的 `postgres` **不是 superuser**(memory `reference_supabase-postgres-not-superuser-cannot-revoke`)
   ⇒ **本機與正式站在這一面的行為根本不同**。

**⇒ v5.2 §4 項 9 / 項 33 現行字面(「RLS zero-policy + ACL 正反面」)在本機是恆真的,測不到任何東西。**

🔴 **修法(而且是便宜的)**:本次實測證明**拿得到判別力** —— 在 harness 內
`CREATE ROLE <x> NOSUPERUSER NOBYPASSRLS` + `ALTER TABLE … OWNER TO <x>`(兩張表與守門函式一起),
就能讓 RLS 斷言變成真的有紅有綠。**這件事 repo 之前列為未驗,現在有可複製的做法。**

## ⑤兩條要寫進 plan 的事實

1. **`WHEN` + `DEFERRABLE INITIALLY DEFERRED` constraint trigger 可以併用**(v5 只是假設,現已實跑)。
   附帶確認:`WHEN` 在**列操作當下**求值 —— T5 的暫態格能過,靠的是**函式重讀現況**,不是 `WHEN`。
2. **parent guard 的 `NOT DEFERRABLE` 是主流程能不能跑的先決條件**,不是風格選擇(M3 實證)。

## ⑥本自檢**沒有**涵蓋的面(誠實列)

- `d1t2-rehearsal.sh provision` 的**真實相容性**(本次用的是自建 initdb,不是該腳本的 provision 流程)。
- 與既有 harness 的互動(§4 項 34「既有 harness 全綠」仍未跑)。
- A4/A7 的完整 fixture(本次用**極簡 stub** 的 `customers`/`orders`/`order_items`,不是 repo 真 schema)。
- `shipment_reference` 產號(N3a helper 不在本片)。
- **§5.1 Q-a 若拍備選②**,X1 要改雙支 —— 本次原型是單支,那個形狀**未驗**。

— 視窗B(a4a-chain),2026-08-05
