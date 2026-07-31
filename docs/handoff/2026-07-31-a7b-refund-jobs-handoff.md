# A7b「退款工作表 + 狀態機合約」交接 — 2026-07-31 早上

> 🔴 **讀法**:本檔把三種東西分開標,**不要混著信**。
> **【事實】** = 可當場用 grep / 實跑複驗的。
> **【我的判斷】** = 上一個 session 的推論,**可能是錯的,請自己重新想一次**。
> **【未驗證】** = 還沒有人證明過。
>
> 🔴 **為什麼要這樣標**:本 repo 有前科 —— 2026-07-30 A7-t 的交接檔寫了
> 「回頭改 A7-1 的 trigger=0 斷言」,後來由**兩個模型各自獨立確認那個指示是錯的**。
> **交接檔的指示不是權威,可驗證的事實才是。**

---

## 1. 現在在哪(【事實】)

- **A1 已收工**:`e1491e6`,未 apply、未 push。驗證 `scripts/a1-verify.sh all` = **61/0**。
- **A7b plan v2 已 commit**:`docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md`。
- **兩輪關卡1 都 FAIL**:
  - R1 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`(約 35 must-fix + 5 nit,**已全折入 v2**)
  - R2 = **尚未落檔**(見下方 §5,必須先做這件事)
- **Sean 已拍板四題**(全文 = memory `project_m4b-a7b-refund-jobs-decisions`):
  Q1=A A7-t 先單獨 apply / **Q2=A 拆 A7b-M + A7b-T** /
  **Q3=B 結案走「鎖列 + `reviewed_at IS NULL` CAS」** / **Q4=B 帳本快照另開子表**
- **Sean 2026-07-31 早上再拍**:**繼續折(A 案)**,不縮範圍、不擱置。
- 未推 7 筆;**零 apply、零 deploy、零 push**。
- ⚠️ 工作樹另有**並行 session** 在動 `apps/storefront/src/lib/products.ts` 與
  `vehicle-facet-counts.ts`(#306 分類數字片)—— **不要碰,`git add` 一律用精準路徑**。

---

## 2. 下一步(照順序)

1. **把 R2 findings 落檔**(§5)
2. **重新設計「原子消耗」那一段**(§3,這是唯一需要重新想的設計題)
3. 折入 R2 其餘 17 條(§4 有清單)
4. 跑關卡1 R3 —— 🔴 **依 Sean 的紀律,第三輪起要換角度或換模型**

---

## 3. 🔴 唯一需要「重新想」的設計題:原子消耗自相矛盾

### 【事實】v2 的設計走不通
plan v2 §5.1-2 要求:開 `generation+1` 時,鎖住最大世代列、驗它是
`dead` + `resolution='retry_authorized'` + `retry_consumed_at IS NULL`,**同交易戳 `retry_consumed_at`**。

但 v2 §5.2-3 同時規定:`dead` 只允許 E13(結案),且 **`OLD.reviewed_at IS NULL`**。
而「可以被消耗的前代」必然**已經結案** ⇒ `reviewed_at` 非 NULL
⇒ **那個「戳 `retry_consumed_at`」的 UPDATE 會被自己的守門拒絕**
⇒ **合法的第二次退款開不了。**

### 【我的判斷】codex 提的方向可行,但沒被驗證
codex R2 建議:另定一條精確 edge「已複核 dead 的授權消耗」,
**AFTER INSERT 新世代之後才戳前代**,UPDATE guard 同時驗「新世代已存在、直接相鄰、payload 相同」。

⚠️ **我沒有驗證過這個方向**。接手時請自己想一次,至少確認:
- `AFTER INSERT` trigger 內對前代做 UPDATE,會不會又觸發 UPDATE guard 的其他規則
- 兩個 session 同時開下一代時,誰被擋、擋在哪一道(U1 的 `(cancellation_id, generation)` 唯一?
  還是前代的 `FOR UPDATE`?)——**兩者擋的時機不同,要想清楚**
- 「payload 相同」要比哪些欄(R2 另一條 finding 要求:除 `id`/`generation`/`bank_refund_id`/
  `request_id` 外,業務 payload 必須逐欄等於前代,**子表 item set 也要相等**)

---

## 4. R2 的 18 條(【事實】:findings 內容;【我的判斷】:分類)

**A. 我的修法自己捅的洞(最該優先看)**
1. 原子消耗走不通(§3 上面)
2. `generation > 1` 沒要求新列必須是乾淨 `queued` ⇒ 拿到重試授權後仍可直接 INSERT 成 `completed`;
   也沒要求金額/`rec_trade_id`/payload/子表明細等於前代 ⇒ **可以拿「重試授權」去退另一筆錢**
3. 第六次失敗**沒有原子進 dead**:submit 路徑先 `processing→failed` 把 count 加到 6,中間仍可 `failed→queued`;
   **Record 路徑更糟 —— 根本沒有 `submitted→dead` 這條 edge**

**B. 前一輪沒真的關掉(我宣稱關了)**
4. lease 時間條件仍未寫死(五分鐘、`claimed_at < claim_expires_at`、重領三欄全換新、
   `5min × 2^retry`、E4 的隔日 `next_check_at`)
5. 「逐狀態完整 CASE」只是施工指令,**沒有真的列出七態 × 各欄的 truth table**;
   `dead` 沒有結構化的失敗原因欄(dead-review 畫面可能沒東西可顯示)
6. §7.2 不是一對一矩陣,只是「要求未來再列矩陣」⇒ R1 的 M30 未銷案
7. ACL 段被我從 v1 刪掉了 ⇒ 兩表 RLS zero-policy、`service_role` SELECT-only、
   PG17 `MAINTAIN`、trigger 函式的 SECURITY INVOKER/`search_path`/EXECUTE revoke 全部沒寫
8. **master plan 沒有真的同步** —— 我只在 row 25 前面加更正,**尾巴的舊字面還在**
   (結案 token CAS、四道唯一性),DAG 也還是單一 `A7b (M)` 且排在 A1 前面
   ⇒ 🔴 **這是我今晚第二次犯「只改碰到的行」**

**C. 新發現的設計缺口**
9. `order_id` 沒有綁定 `cancellation_id` 的訂單 ⇒ cancellation A 的 job 可以宣稱屬於 order B
   ⇒ 需複合 FK `(cancellation_id, order_id) → order_cancellations(id, order_id)`
10. R9 的「等值由 immutable + U5 關閉」是錯的 —— U5 只防兩 job 共用一張帳本,
    **完全不證明** order/bank ID/金額/運費/actor/reason/request_id/item set 相等
11. 子表只搬了欄位,**沒搬既有帳本的核心不變式**(至少一列、`items_amount = Σline_amount`、
    數量不超原品項、單價等於訂單快照),也**沒擋子表的 UPDATE/DELETE/TRUNCATE**
    ⇒「凍結快照」目前只是文字
12. 唯一性字面仍寫「四道」但實際列了 U1-U5;且 U4 只在 job 表 unique,
    **擋不住新 job 重用既有 `order_refunds.bank_refund_id`**
13. E3 分不出「上一個 worker 還沒呼 Refund」與「外部成功了但寫 `submitted` 前 crash」
    ⇒ 需定死 uncertain-submit recovery(同鍵重送 / Record 查證 / duplicate 回應映射)
14. **兩片同批 apply ⇒ 風險窗為零」不成立**(兩支各自 COMMIT)
    ⇒ codex 建議:A7b-M 加具名 dormant `CHECK(false)` 擋所有 INSERT,
    A7b-T 在守門全部裝好並驗證後才同交易移除它
15. Q3=B 的併發還沒被證明:沒寫 RPC 必須鎖後重驗、UPDATE 必帶 `reviewed_at IS NULL`、
    rowcount 必為 1、audit 同交易恰一筆;也沒有兩人同時結案 / 結案撞 worker 的雙連線測試
16. R9-R19 矩陣仍把 R13-R16 推給「第 3 批」而未具名 ⇒ 不能叫「關閉矩陣」,
    應標成「未關閉、第三批 hard release gate」並現在就定 RPC 名稱、輸入、CAS、SQLSTATE、測試 ID
17. 🔴 **我又用了 locale-dependent 的字元範圍** `[0-9a-f]` —— A7 已實測過這種寫法會隨 locale 改語意
    (backlog **#305** 就是它)⇒ 必須改成逐碼位 `[0123456789abcdef]{64}`;
    另 `rec_trade_id` 的 `[A-Za-z0-9_-]` **沒有 TapPay 官方依據**(官方只寫 String(20))
    ⇒ 可能拒絕合法的外部 ID
18. rollback 不可執行:沒寫 child-first 順序(先 DROP parent 會被 child FK 擋)、
    沒列 A7b-T 的函式清理

**D. nit 4 條**:唯一性/lease 欄數計數錯誤(五道、三欄)、掃描用 partial index 仍無具名落點、
master 引用 `tappay-reference.md:100` 應為 §2.3、「A1 骨架已證明有效」應改成「本機已證明、正式站未 apply」、
CURRENT 仍寫 v1 不可施工(已過期)。

---

## 5. 🔴 接手第一件事:把 R2 findings 落檔

**【事實】** R2 的完整輸出在 `/tmp/codex-a7b-k1r2-msg.txt`(**臨時檔,重開機就沒了**)。
R1 已經落檔成 `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`,**R2 還沒有**。

```bash
cd /Users/sean_1/pcm-website-v2 && test -f /tmp/codex-a7b-k1r2-msg.txt && cp /tmp/codex-a7b-k1r2-msg.txt docs/reviews/2026-07-31-e10-a7b-k1r2-codex.md && wc -l docs/reviews/2026-07-31-e10-a7b-k1r2-codex.md
```
若檔案已不在,上面 §4 是它的完整條列(我逐條抄的),**可以直接用,但要標明來源是轉述不是逐字**。

---

## 6. 跑審查的方式(【事實】,今晚實測可用)

```bash
codex exec -s read-only -m gpt-5.6-sol -c model_reasoning_effort="xhigh" \
  -o /tmp/out-msg.txt "$(cat /tmp/prompt.txt)" < /dev/null > /tmp/out-full.txt 2>&1
```
- **必須從 main session 跑**(subagent 會被 classifier 擋)
- **`-m gpt-5.6-sol` 要顯式帶**(預設是別的模型)
- 跑前後各取 `git status --porcelain` 比對零留痕
- 🔴 **會跑超過 10 分鐘** ⇒ 用 `run_in_background: true`,不要用前景 Bash(會被 10 分鐘上限砍掉)
- 🔴 **`codex exec resume` 不吃 `-s` 旗標**,要用 `-c sandbox_mode="read-only"`

---

## 7. 今晚學到、對這片直接有用的(【事實】,皆實測)

1. **`CHECK` 遇到 NULL 是放行**:`A IS NOT NULL ⇒ A = B + C` 在 `B` 為 NULL 時整式求值為 NULL ⇒ 通過。
   成對欄位一律寫成「兩欄同 NULL 或同非 NULL 且等式成立」。
2. **trigger 的 `RAISE` 不帶 `USING CONSTRAINT` ⇒ `CONSTRAINT_NAME` 是空的**
   ⇒「負測一律斷言 SQLSTATE + constraint 名」這條紀律在 trigger 上會失效。
3. **PG17 有第八種表權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` **仍為 false**
   ⇒ 七格 ACL 矩陣對它完全無感。正式站也是 PG17。
4. **`GRANT … TO PUBLIC` 會讓 anon/authenticated 因繼承轉紅**
   ⇒ PUBLIC 那條斷言若排在角色矩陣後面,**把它整個刪掉仍然全綠**。順序是正確性的一部分。
5. **查詢自己語法錯誤時,base 與 after 會是同一則 ERROR 文字 ⇒ diff 為空 ⇒ 判成「零漂移」**
   ⇒ 任何當基準的快照都要 fail-closed(驗 psql 退出碼 + stderr 空 + 補 sentinel),
   並加一條「故意弄壞快照 SQL,harness 必須當場中止」的自我測試。
   可直接抄 `scripts/a1-verify.sh` 的 `snapshot()`。
6. **守門絕不可讀惰性建立的衍生快取**(memory `feedback_guard-reads-non-authoritative-cache`)。
7. `scripts/a1-verify.sh` 是目前最完整的 harness 骨架,**A7b 的 harness 直接沿用它**
   (外層 oracle / 結構與行為突變分開 / 每個 mutant 指定唯一預期第一失敗 ID / 對照組)。
   🔴 另必須承接 A7-t 已實證的七條假綠路徑(`tgenabled` / `tgqual` / `tgrelid` / `tgfoid` /
   `md5(prosrc)` 指紋 / owner / ACL allowlist)—— 本片核心是 trigger,那七條全部適用。

---

## 8. 【未驗證】的東西,不要當事實用

- plan v2 的整份狀態機**沒有對任何資料庫跑過**(零 migration、零 code)
- 「兩片同批 apply 風險窗為零」**已被 R2 證偽**,dormant gate 是**尚未驗證的替代方案**
- R9-R19 矩陣裡標「第 3 批」的那幾格,**現在等於沒有落點**
- TapPay duplicate 回應的行為**只有官方文字,沒有實測**

---

## 9. 起手指令

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain && git log --oneline -3
```
預期:branch=`dev`、未推 7 筆、HEAD = A7b plan v2 那筆;
工作樹只有並行 session 的 storefront 檔案與兩個未追蹤資料夾。
