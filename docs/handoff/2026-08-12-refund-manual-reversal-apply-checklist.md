# 沖銷片 `20260812140000` apply 檢查表(交 Sean 的第二核准點)

> P 九代 2026-08-12。**apply 是 Sean 的停點,我只交這張表。**
> 標的:`supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql`
> 規格:`docs/specs/2026-08-11-refund-manual-reversal-plan.md`(v13)

---

## 一、Sean 要先知道的三件事(白話)

### 1. 🔴 這片一旦有人用了「修改判定」,**就再也退不回來**

員工按下第一次「修改判定」的那一刻起,這片的回退**永久關閉**。

**為什麼不是政策問題,是真的做不到**:沖銷會讓同一筆退款上出現兩筆人工判定(舊的 + 改過的)。
回退必須把舊的唯一索引建回來,而那顆索引不允許同一筆退款有兩筆判定 ⇒ **物理上建不起來**。
唯一解法是刪掉那兩筆紀錄,但退款帳本是「只能新增、不能刪改」的稽核帳,刪不掉(也不該刪 —— 那正是
「誰在什麼時候改了哪一筆判定」的證據)。

**實測值**(拋棄式資料庫,不是推論):重建索引 ⇒ `23505` / `pre_one_terminal_uniq`。

⚠️ 但**這不是死路**:要改判定邏輯不需要回退 —— view 與 trigger 都可以直接換述詞(`CREATE OR REPLACE`),
不動任何資料。「回退關閉」關的是「把這片整個拆掉」,不是「以後不能改」。

### 2. 🔴 有一類訂單會從「要人工看」變成「系統自動結清」

這片修掉了一個**既存的**判定落差(不是這片造成的,但這片必須處理它)。

具體:同一筆退款如果有「送出成功」+「後來對帳判定失敗」兩個紀錄,
**舊邏輯**把「送出成功」當成錢已經動了 ⇒ 卡人工;
**新邏輯**認「送出成功 ≠ 錢真的退出去」(這是 2d 已經拍板的語意)⇒ 有效結論是「失敗」⇒ **可自動結清**。

**方向是變寬鬆的**(從保守變自動),所以單獨列出來給你點頭。
今天正式庫 `payment_refund_events` 是 0 列,所以**沒有任何既有訂單會被這條影響**;
但 2e/2f/2g 上線之後就會有。

### 3. 一個判斷口徑的落實(你 08-12 拍的 Q-425=B)

「人工判定寫了『錢沒退』」現在會讓訂單**可以自動結清**(以前永遠卡人工)。
配套的安全網=員工可以用「修改判定」改回來,改回「錢有退」之後訂單**立刻**變回要人工看。
這條回頭路已經實測過,是這片最重要的一格測試。

---

## 二、apply 前 preflight(照順序;任一不過就停)

| # | 動作 | 期望 |
|---|---|---|
| 1 | 確認 `20260811110000`(2d)與 `20260811120000`(#412)都已 apply | migration ledger 尾端 ≥ `20260811120000` |
| 2 | 🔴 **全形狀盤點**(plan §11-4 要求放在 apply 當下、不是寫 plan 當下):對每顆 refund 算它的 `event_type` 集合、`GROUP BY` 列出每種組合各幾顆 | 逐一確認翻面 A/B/C 影響到的組合各幾筆;**不只數 `success+failed` 一種** |
| 3 | 主視窗側:W 線 `record all` preflight(36 條釘值過期) | 由主視窗負責 |
| 4 | `git status --porcelain` | 乾淨(或只有已知 ownership 的 dirty) |

**第 2 步的查詢**(唯讀):

```sql
SELECT string_agg(DISTINCT e.event_type, '+' ORDER BY e.event_type) AS 事件組合,
       count(DISTINCT e.refund_id)                                  AS 幾顆refund
FROM public.payment_refund_events e
GROUP BY e.refund_id
ORDER BY 1;
```

> 2026-08-11 實查:該表 **0 列** ⇒ 今天跑出來會是空的。**但這條要在 apply 當下重跑**,
> 因為「今天 0 列」是時點觀察,不是恆真。

## 三、apply 本身

migration 內建**前置閘**,不需要人工判斷前提:
- 隔離層級必須 `read committed`(否則 `P8C01`)
- `payment_refund_events` 的 CHECK 集合必須**逐字**等於 2d post-image(否則停下)
- `pre_one_terminal_uniq` 的定義必須**逐字**等於 2d post-image(否則停下)
- 現有列數只印不擋(apply 的人要看)

apply 成功的判準=看到這行 NOTICE:

```
沖銷片 後置斷言:七組全過(trigger 效力/索引換手/view 方向與零直權/op6a 已換吃 view/RPC ACL/欄與約束)
```

**沒看到這行就是沒成功**(整片單一交易,任一斷言紅 = 全部回滾、不留半套)。

## 四、apply 後必做

| # | 動作 | 為什麼 |
|---|---|---|
| 1 | `database.types.ts` regen(F7) | 三新欄 + 新 view;**必須 apply 後才做**,apply 前產的型別會缺新欄 |
| 2 | PostgREST 具名參數 smoke:呼叫一次 `admin_correct_refund_manual_verdict`(可用不存在的 refund_id,期望 `P8C03`) | memory `feedback_app-layer-must-not-ship-before-migration-apply`:應用層看不到 schema 漂移,這道是唯一的觀測點 |
| 3 | APPLIED.tsv 追加 + commit | 主視窗義務 |

## 五、過渡期操作程序(Fable F5;開燈前的「修改判定」怎麼用)

員工後台按鈕還沒做 ⇒ 這段期間要改判定,只能由**有 service_role 的人**呼叫 RPC。

**誰**:主視窗 / Sean 授權的人(RPC 只開 `service_role`,一般會員與後台匿名角色都呼叫不到)。

**怎麼取 `p_expected_event_id`**(這是必填的第二參數,防兩人同時改):

```sql
SELECT refund_id, event_id, event_type, indicates_refund
FROM public.payment_refund_effective_terminal
WHERE refund_id = '<那筆退款的 id>';
```

`event_id` 就是要填進 `p_expected_event_id` 的值。

**怎麼呼叫**:

```sql
SELECT public.admin_correct_refund_manual_verdict(
  '<refund_id>'::uuid,
  '<上面查到的 event_id>'::uuid,
  '<員工代號,必須在 staff 且 is_active>',
  '<為什麼要改,不能空白>',
  <true 或 false:錢到底有沒有退出去>
);
```

**會被拒的情況**(每種都有具名錯誤碼,不會靜默失敗):

| 情況 | 錯誤 |
|---|---|
| 員工代號不存在或已停用 | `P2B42` / `pcm_prmr_actor_invalid` |
| 理由空白 | `P2B42` / `pcm_prmr_reason_required` |
| 新判定填 NULL | `P2B42` / `pcm_prmr_verdict_missing` |
| 你看到的判定已經不是現行判定(有人先改了) | `P2B44` / `pcm_prmr_cas_mismatch` ⇒ **重查再送** |
| 那筆退款沒有人工判定可改 | `P2B44` / `pcm_prmr_no_effective_terminal` |
| 現行結論是系統寫的(不是人工) | `P2B44` / `pcm_prmr_target_not_manual` |
| 交易開成 REPEATABLE READ | `P8C01` / `pcm_prmr_isolation` |
| refund_id 或 expected_event_id 填 NULL | `P2B42` / `pcm_prmr_identity_missing` |
| 那筆退款查不到(打錯 id) | `P8C03` / `pcm_prmr_parent_row_required` |
| 🔴 同一筆退款竟有**兩個**有效結論 | `P2B20` / `pcm_prmr_multiple_effective_terminal` ⇒ **上游守門已破,停下來找人** |

> 這張表逐條對過實作。數法:
> `grep -oE "ERRCODE = '[A-Z0-9]+', CONSTRAINT = '[a-z_]+'" supabase/migrations/20260812140000_*.sql | sort -u`
> → 共 **16** 條:RPC 側(`pcm_prmr_*`)**12** 條、trigger 側(`prl_*`)**4** 條。
> 本表列了 RPC 側 **10** 條;另 2 條(`pcm_prmr_row_count_reversal` / `pcm_prmr_row_count_manual`)
> 是**內部不變量守門**——它們只在「寫入落的列數不等於 1」時開火(代表有別的 trigger 把列吃掉了),
> 操作者正常呼叫碰不到;真的碰到就是系統壞了,停下來找人。
> trigger 側 4 條是繞過 RPC 直接寫入才會遇到,不在操作程序射程內。

⚠️ **沒有冪等**:同一筆改兩次 = 兩次沖銷 + 兩筆新判定(第二次會因為 CAS 不符被擋,除非你重查了 event_id)。
按錯了就再改回來,不要重送同一個指令。

## 六、這片**沒有**做的事(知情缺口)

1. **員工後台按鈕**不在本片射程(本片只到 DB 層 RPC)。
2. **結清執行器上線後**,「已依錯誤判定執行的動作」不會被沖銷恢復 —— 沖銷只恢復**判定**。
   兩條硬約束已交 ④ 線(E 窗):①執行器須在執行當下重算、不吃快取判定 ②「執行後才被改回」要有自己的補償機制。
3. view 的型別防禦(`COALESCE(…, true)` + `jsonb_typeof`)**只有定義層測試、沒有行為層測試** ——
   因為 2c 的 CHECK 讓那條路徑不可達。它擋的是「有人改掉方向」這個編輯,**不是**「fail-open 已被執行面擋住」。
4. 🔴 **`actor` 欄不是稽核依據**(關卡2 codex 抓到,已立案 **#436**):RPC 只驗「這個員工代號存在且在職」,
   **沒有**驗「呼叫的人真的是他」⇒ 拿得到 `service_role` 的人可以填別人的代號,而帳本 append-only 改不掉。
   這**不是本片引入的**——同一形制在全線 5 支 migration 上一模一樣(先例=`admin_reverse_manual_payment`)。
   ⚠️ 上面 §五的操作程序要你填「員工代號」,**別把那一欄當成「誰做的」的證據**;
   員工上工前要先把 #436 解決(身分來源是 E8-B 真認證線的射程,要 Sean 拍板)。

---

— P 九代,2026-08-12
