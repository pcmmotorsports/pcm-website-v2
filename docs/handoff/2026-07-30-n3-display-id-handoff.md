# 交接:訂單編號改 6 碼亂碼(N2 / N3a / N3b)—— 2026-07-30 中午

> **狀態:🎉 端到端完成。三片 code 收工 + 兩關審查走完 + 兩支 migration 已 apply production
> + Sean 真刷驗證通過(訂單 `PTNGY2`,6 碼新格式、`paid`)+ 已推 `origin/dev = 4f91a8a`。**
> **下一片(Sean 2026-07-30 拍板)= 修 backlog #301(TapPay Record API 三處欄位重查)**,
> 它是退款線 RF2b-RF8 的硬前置。**建議開新視窗做** —— 領域完全不同。
> 權威 = `docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md`(628 行;§9 關卡1 / §10 關卡2 詳錄)。

---

## 1. 這條線做完了什麼(一句話)

`create_order` 的產號器從「順序號 `PCM-2026-0105`」換成「6 碼亂碼」,
**既有 30 張舊格式訂單完全不動、兩種格式永久並存**。動機 = 客人不能從編號推測年營業量。

| commit | 片 | 內容 |
|---|---|---|
| `828cf5f` | **N2** | domain `display-id.ts` 驗證改新舊兩收、刪 TS 側產號能力(`formatDisplayId`/`parseDisplayId`) |
| `24f0b63` | **N3a** | 新 DB 函式 `public.pcm_generate_display_id()` + apply-time 探針 3 條;shim +2 行(pgcrypto) |
| `946b837` | **N3b** | `create_order` 段 8 改呼它 + 上限 5 次有界重試;兩支驗證腳本 |
| `30e6986` | docs | STATUS 7 欄、plan §9/§10 審查詳錄、master-plan v2 標註、backlog #300/#301 |
| `518ffdd` | docs | 本交接檔 + CURRENT 入口 |
| `27fb117` | docs | 待決策三條 |
| `4f91a8a` | docs | 真刷 PTNGY2 驗證紀錄 + backlog #302(1 元商品免運缺口) |

前置 `96a813f`(plan 初版 + 筆數更正)。**全部已推,`origin/dev = 4f91a8a`。**

---

## 2. ✅ Sean 手動三件**已全部完成**(2026-07-30)

1. ✅ **`supabase db push`** —— 兩支 migration 已 apply production。
   用 `--workdir /tmp/pcm-dbpush`(supabase 目錄副本)繞開 `.env.local`,**零碰 `.env*`**。
   三行 NOTICE 全部符合預期,其中一行是關卡1 F4 那條 must-fix 的直接證據:
   `N3b 守門通過:狀態 A(首次 apply;現況 = 20260719120000 版)`
   🔴 若當初照抄 20260719120000 的「用參數個數判狀態」,這裡會判成「重跑」而中止 ⇒ **db push 會撞紅**。
2. ✅ **1 元商品真刷 smoke** —— 訂單 **`PTNGY2`**(6 碼、`paid`)。這是 master-plan v2 §5.4b
   對 N3b 明文要求的、也是**唯一能證明結帳沒壞的證據**。
3. ✅ **push** —— `origin/dev = 4f91a8a`、未推 0。

### apply 後獨立驗證 13 項全對(唯讀、不採信 migration 自述)
- 產號函式:`secdef=true / vol=v / par=u / strict=false / search_path="" / owner=postgres`
- 產號函式 ACL = `{postgres=X/postgres}` = **零對外授權**;anon/authenticated/service_role 皆不可 EXECUTE
- `create_order` 完整指紋 = **`5a04e67df5d7cd1c18c5ae2a634e544a`**
  🔴 **與本機隔離庫算出的常數逐字元相符 ⇒ 自指指紋守門跨環境成立、非本機巧合**
- 新產號器接線 `true` / 舊 `order_display_seq` `false` / 約束名核對在 / 用盡 token 在
- 既有五項行為字面全在(運費 CASE / consent / vehicle_snapshot / availability / 溢位守門)
- 資料零異動:訂單 30 張、`legacy_display_id` 全 NULL、`order_display_seq` 仍 105/true
  ⇒ **舊單一張都沒被碰、回滾前提仍成立**
- 正式站實產 6 碼:`MGZ5JF DD6D6S Q3HCN9 6TZG6R P4CS97`;200 抽全符合 §5.4a
- migration ledger 兩支皆登記、零漂移

## 3. 接手第一件事

```bash
git log --oneline -3 && git status --porcelain
```
本線已全部推上去 ⇒ 預期未推 0(**當場查、不看本檔寫死的數字**)。
工作樹若有 `CascadeFilterTop` / `dev-preview` / `docs/superpowers` 等未追蹤檔,
那是**另一個並行 session** 的,不是本線殘留(見 §10)。

## 4. 驗證怎麼重跑(全部可重複)

```bash
# 需 PG17 在 PATH(Homebrew postgresql@17);port 54329 必須是空的
scripts/n3-verify.sh all            # 6 個 N3a 改檔突變 + §4.1d + 行為段(約 12 分鐘、7 次 fresh provision)
scripts/n3-verify.sh n3a-mutations  # 只跑突變矩陣
scripts/n3-verify.sh n3b-verbatim   # 只跑 654 行機械比對(需已 provision 的庫)
```
🔴 **port 前置閘**:殘留 postmaster 會讓每個突變死在 bind 失敗、而不是死在該紅的探針
= 整輪沒有證據。閘會擋下並印出清理指令。本 session 它擋下兩次,都是真的。

**清理殘留**:
```bash
for p in $(lsof -nP -iTCP:54329 -sTCP:LISTEN -t); do
  D=$(ps -o command= -p $p | grep -oE '\-D [^ ]+' | cut -d' ' -f2)
  pg_ctl -D "$D" stop -m immediate
done
```

---

## 5. 誠實邊界(**不得放寬,收工報告也不得改寫**)

- 全部驗證跑在**本機 PostgreSQL 17,不是 Supabase**。
- `auth.uid()` 是 shim(平常寫死回 NULL)、商品價格是手動塞的、序號要手動推進
  ⇒ **harness 的建單段是煙霧測試**,它證明的是「產號接線與重試邏輯對」,
  **不是**「結帳真的能用」。後者由下一條的真刷獨立提供。
- ✅ **1 元真刷已完成**(`PTNGY2`)⇒ 「結帳沒壞」現在**有一手證據**,不再是待驗項。
  ⚠️ 但真刷只證明了**一條 happy path**(單品項、home、personal 發票、無碰撞重試)——
  重試路徑、非本約束上拋、產號用盡都只有隔離庫證據。
- 🔴 **鐵則 12 未按字面滿足**:它要求高風險片過 **codex** 對抗審查;
  實際是 **Fable**(codex 今天三次同款逾時,三次皆驗零留痕、最小測試證實 CLI 本身正常)。
  **是否接受此替代 = Sean 判斷,已於對話提出、尚未回答。** 接手者不得自行宣告「已滿足」。
- 本 session 對正式站**只跑過唯讀 catalog 查詢**(擴充套件 / 約束名 / 函式指紋 / 訂單筆數),
  **零寫入、零 DDL**。

---

## 6. 這片留下的守門與它們**擋不住什麼**

| 守門 | 擋得住 | 🔴 擋不住 |
|---|---|---|
| N3a 探針 1 regex | 長度錯、字母表誤植 | 取樣偏差 |
| N3a 探針 2 不退化 | 回傳常數、熵不足 | 偏差、格式錯 |
| N3a 探針 3 卡方 ≤82 | **取樣偏差**(門檻 off-by-one、拿掉 rejection) | 字母表變長但取模數不動 |
| N3a 段 3.5 字母表字面 | 字母表被改(含變長) | 行為層任何問題 |
| §4.1d 域外逐字比對 | 搬 654 行時弄壞域外任何一行 | **段 8 內部的邏輯對不對** |
| §4.1d INSERT 塊嚴格比對 | 金額/tier/身分欄被動 | 縮排以外的結構重排(會 die 要人工覆核) |
| N3b 指紋守門 | 覆寫未知版本 | 「我抄對了」(那是 §4.1d 的事) |
| 行為段 B/C/D | 產號接線、重試上限、非本約束不被吞 | **真實結帳**(fixture 是假的) |
| #216 drift gate | 運費常數 TS↔RPC 漂移 | 其他任何常數 |

🔴 **卡方探針有 p≈1e-6 的偽陽性率** —— 紅了**先原封重跑一次**,連續兩次紅才代表演算法真的偏了。
migration 註解內已逐字寫明。

---

## 7. 這片踩過、下次別再踩的(全文見 plan §10 與 memory)

1. 🔴 **審查啟動後不要改檔** —— 我為了清 nit 在審查中改檔,那個動作本身製造了
   「N3a 每次 apply 必死」的 BLOCKER(`%%` 轉義只在 RAISE 格式字串裡成立)。
   memory `feedback_freeze-artifact-before-adversarial-review` 已補此實錘與論證升級。
2. 🔴 **突變表達式要加錨點** —— 被突變的字面若也出現在斷言的期望值裡,無錨點取代會
   把兩邊一起改掉 ⇒ 恆相等。字母表字面在 N3a 檔內出現 **8 次**。
3. 🔴 **計次器不能用表** —— 被測路徑最後 `RAISE` 會讓整句 rollback、計次一起回滾,
   讀到 0 長得像「沒被呼叫」。改用 sequence。
4. 🔴 **註解不要寫死隨機數字** —— 卡方每跑一次都不同;我把它改成「範圍 101-166」,
   下一次實跑就出現 180.8。改成只記下界 + 實測樣本。
5. 🔴 **文字斷言不要排在行為探針之前** —— 會讓所有突變死在字面那道,行為探針從此
   沒有任何突變到得了它。**行為先於字面**。
6. 🔴 **先問「這道守門能不能被單獨觸發」** —— 不能就是被遮蔽、無法證明,刪掉。
   N3a 原 5 條探針砍到 3 條就是這樣來的。
7. 🔴 **不要寫死筆數** —— 隔離庫 31 張(29 cohort + 2 誘餌)、正式站 30 張;
   寫死任何一個都會在另一個環境假紅。基準要**事前抓**。

---

## 8. 下一片:修 backlog #301(Sean 拍板 C)

**內容**:TapPay Record API 三處欄位假設經 2026-07-30 對真正式商戶實測**證明為誤**,
而 `packages/adapters/src/tappay/wire.ts:68` **逐字宣稱「以官方 Record API reference 核實」**:
1. 已**全額退款**的紀錄 `amount` 回 **0**,原額在 `original_amount`
2. `refunded_amount` 放的是**原本金額**(= `orders.total`),非「已退金額」
3. 🔴 **`transaction_time_millis` 這個欄位根本不存在** ——
   實有 `time` / `cap_millis` / `transaction_complete_millis` / `bank_transaction_*_millis`

**為什麼先做它**:退款線 RF2b-RF8 的判定就建立在這三個欄位上 ⇒
不先修就做,等於在錯的假設上算錢(而且會**靜默算錯**,不會拋錯)。

**做法要點**(backlog #301 有完整版):先親讀官方文件並與 07-30 實測逐格對照 →
改 `wire.ts` 欄名與宣稱(改成「實測 + 官方文件雙來源」,不一致處以實測為準並明寫)→
補以**真實回應形狀**為 fixture 的測試(未退款 / 全額已退款兩種)→
連帶檢查 `scripts/d1-readback.ts` 的判定矩陣(它要求 `refunded_amount = amount`,
在全額退款情境下永遠不成立)。
**屬鐵則 12 ①錢 ⇒ 需對抗審查。**

---

## 9. 開放項

- 🟡 **#302 待 Sean 拍板**:1 元補差額商品仍被收 NT$100 運費(真刷 `PTNGY2` = 1 / 100 / 101)。
  🔴 **不是 bug** —— 運費規則照設計運作(1 < 免運門檻 5000);缺的是「該商品免運」這條
  **從未實作**的例外。三案已列:A 商品層免運旗標(動 654 行金流函式 + 需回答「免運品混車誰付運費」)/
  **B 改走後台手動建單(傾向;零金流 code 改動、E10 本來就要做)** / C 維持現狀+對客說明。
  ⚠️ 這條 2026-07-24 首刷就發現、但只記在 memory 沒開編號 ⇒ 六天後 Sean 又講一次才補上。
  **只靠 memory 存活的事情會弄丟。**
- 🟡 **提案檔 Q2 未答**:舊 30 張測試單要不要在後台列表隱藏(不擋任何片)。
- 🟡 **鐵則 12 的 Fable 替代是否接受**(見 §5)。
- 🟡 **STATUS 主表 76 行,規則是 ≤30 行嚴守** —— 接手前就有的漂移(接手時 69 行),
  本線加 7 行。刻意不在這條線裡順手壓縮(那是判斷很重的事,塞在別的片裡偷偷做更糟)。
  應**獨立成片**。
- 🟡 **MEMORY.md 109 行 / 24.8KB**,超過「>100 行或近 17KB 要精簡」的觸發值。
  🔴 但 memory `reference_memory-index-trim-ceiling` 已量測:**64% 是索引本體不可壓、
  壓字無槓桿;唯一有效手段 = 撤下 `project_*`,而那需要 Sean 拍板** ⇒ 未自行處理。

---

## 10. 並行 session 注意

本 session 期間另有一個 session 在同一 repo 工作(11:32 起,mobile-catalog-ux 預覽 /
`CascadeFilterTop` / `docs/superpowers/`)。**其檔案全程未觸碰、未納入本線任何 commit**
(commit 一律精準 `git add <路徑>`、從不 `git add .`)。
接手時工作樹若仍有那些未追蹤檔,**那不是本線的殘留**。
