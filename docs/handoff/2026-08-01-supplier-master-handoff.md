# 供應商主檔線 — 交接檔(2026-08-01 傍晚改寫)

> **接手入口。開工前整份讀完。** 前身版本(下午、S1a 之前)已被本檔取代;
> 更前身 = `docs/handoff/2026-08-01-a7c-applied-handoff.md`(A7c 線,已完成)。

---

## §0 一句話現況

**S1a + S1b 兩片皆 code 收工並已推上 `dev`;🔴 兩支 migration 都還沒 apply 到正式站。**
下一片 = **S2**(`admin_upsert_supplier` owner RPC)。

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -3 && git status --porcelain
```
預期:branch=`dev`、HEAD = S1b(`3af433d`)、工作樹乾淨。

🔴 **另有一個視窗在做前台(`apps/storefront/src/**`)。** 我的領域 =
`supabase/migrations/` / `scripts/` / `docs/specs/2026-08-01-e10-supplier-*`。
**`STATUS.md` 與 `docs/handoff/CURRENT.md` 是唯一真衝突點,改之前先問 Sean。**
一律 `git add <精確路徑>`,禁 `git add .` / `-A`;`--amend` 前先 `git log -1` 確認 HEAD 是自己那筆。

---

## §1 🔴 開新視窗第一件事:重排今晚的提醒

**今晚 22:04 的 TapPay 探測 cron 是 session-only —— 上一個視窗關掉就死了,這是第二次。**
新視窗開起來**立刻**用 `CronCreate` 重排(one-shot、當天 22:04),內容:

> TapPay sandbox 部分退款探測,交易 `D202607314b3cIL`(2026-08-01 18:00 送批):
> 1. `python3 scripts/tappay-sandbox-refund-probe.py plan`(零 API 呼叫)
> 2. `python3 scripts/tappay-sandbox-refund-probe.py query`(唯讀)
> 🔴 **第 2 步若 `is_captured` 仍是 false 就停下回報**,不繞過、不改腳本
>    (未請款做部分退款必回 `10024`,測了沒意義)
> 3. 只有 `is_captured=true` 才跑 `python3 scripts/tappay-sandbox-refund-probe.py refund 10`
>
> 要回答:①API 支不支援多次部分退款 ②超額退款會不會被 API 拒。
> 🔴 Portal 按鈕消失只證明**介面**擋住、不證明 API 會拒,而 API 才是我們要走的路。
> 金鑰在 `.env.tappay-sandbox`,**值絕不貼進對話**。細節見 `2026-08-01-a7c-applied-handoff.md` §3。

---

## §2 已完成(可驗證的事實,不是宣稱)

| 片 | commit | 狀態 |
|---|---|---|
| **S1a** 供應商主檔 + 26 家 seed + 不可刪除 | `b5d918d` | 已 push、**未 apply** |
| **S1b** 採購表供應商欄改 FK | `3af433d` | 已 push、**未 apply** |

**S1b 做的事**:`order_item_procurement` 的 `supplier_name` + `supplier_canonical_key`
→ **`supplier_id` uuid FK → `suppliers(id)`**(ON DELETE / ON UPDATE 皆 RESTRICT);
business key 換軸為 `(order_item_id, supplier_id)`(**約束名 `order_item_procurement_business_key` 不變**);
補回 `(supplier_id)` 索引;三段 COMMENT 同步;A2 `:123-126` 的合約債①明文結案。

**驗證數字**(本機 PG17.10、C locale、`d1t2-rehearsal.sh provision` 從零套完全部 migration):

| 輪次 | 結果 |
|---|---|
| s1a | **41 PASS / 0** |
| s1b | **47 PASS / 0** |
| s1a **再跑一次** | **41 PASS / 0** ← 這輪才是「s1b 不污染兄弟 harness」的證據 |
| 把 S1b 檔移開、重放成**只有 S1a** 的庫 | **40 PASS / 0**,走單片模式分支 |
| 三綠 | typecheck 0 / lint 0(未動 `.ts/.tsx` ⇒ 不需 build) |

**六道 fail-closed 閘已對正式站唯讀實查全部通過**:索引定義對稱差 0 / 無繼承子表 /
無欄級 ACL / ACL 攤平恰 `service_role:SELECT:false` / 兩表 0 列
⇒ **`db push` 不會被自己的閘誤擋**。

---

## §3 下一步(依序)

1. **S2** — `admin_upsert_supplier` owner RPC(新增 / 改名 / 切停用 + 同交易 audit)。
   驗收見片級 plan §5-11~13:`SECURITY DEFINER` + `SET search_path` + `REVOKE ALL FROM PUBLIC`
   + 只 GRANT service_role / 稽核原子性(成功多一列、失敗零留痕)/ 輸入白名單(不得改 id、不得寫時間欄)。
   🔴 **S2 不需要先 apply** —— 它是新 RPC、不動既有形狀。
2. **apply**(Sean 手動 `supabase db push`;跑前必須先移開 `.env.local`,跑完還原)。
   實務上排在 S2 之後、S3a 之前最順(S3a/S3b 的驗收需要真資料)。
3. **S3a** 讀模型 + server action(`listSuppliers`:預設只回 `is_active=true`、`ORDER BY label`)。
4. **S3b** `/settings/suppliers` 設定頁(列表字母序 + 新增 typeahead + 改名 + 停用開關)。

---

## §4 🔴 apply 時必須知道的三件事

1. **會一次套兩支**。正式站 ledger 最後一筆 = `20260801120000`(A7c);目錄裡有
   `20260801140000`(S1a)+ `20260801150000`(S1b)**兩支未登記** ⇒ `db push` 依序套兩支、
   **各自一個交易**(CLI 正常行為,不是整批回滾)。兩支都有 fail-closed 前置閘,
   順序錯或半批狀態會**當場擋下而不是寫壞資料**。
2. **apply 後必做型別重 gen**,而且 🔴 **重 gen 會沖掉 `create_order.Args` 內的三處人工校正**
   (`p_client_ip` / `p_client_ua` / `p_notification_email` 的 `| null`,PostgREST 表達不了
   「必填但可為 null」)⇒ 重 gen 後必須貼回,**以 typecheck 轉綠為證**。這坑已復發過一次。
3. **apply 之前不得宣稱型別已對齊**。現況安全的理由 = 全樹只有 `packages/adapters/src/supabase/database.types.ts`
   一個檔提到 `order_item_procurement`、**零 app code 消費**(本線實 grep 確認,非轉述)。

---

## §5 🔴 誠實邊界(不得對外說滿)

- **沒跑第三輪換模型**。關卡2 跑了 **codex `gpt-5.6-sol` xhigh 兩輪**(鐵則 12 按字面滿足),
  但 codex 只設定一個模型,Fable / adversarial-reviewer 那條路依規則需 **Sean 指名**才動用
  ⇒ **兩輪同模型的共同盲點未被覆蓋**。兩輪都明說 DDL 未被擊破。
- **COMMENT 的驗收是 presence gate 不是語意守門** —— 把整段理由反過來寫、關鍵字還在就會全綠。
- **rollback 只在採購表 0 列時成立**;一旦 S2/A5a 開始寫入就**不可照抄**
  (舊兩個 NOT NULL 文字欄沒有值可以補;下游要逆序先撤 S3b → S3a → S2)。
- **`docs/handoff/CURRENT.md` 仍是過期的**(還寫「code 零行、等批准」)。Sean 拍板本輪只動 STATUS,
  避免與並行 session 撞車 ⇒ 留給前台那輪或下一個 session 補。
- **本機 C locale ≠ 正式站 `en_US.UTF-8`**(#305);字母排序屬 S3a/S3b,本線尚未測。
- **`MEMORY.md` 已 25.6 KB、超過 24.4 KB 讀取上限**(STATUS 上次記錄 22.6 KB)。
  撤條目需 Sean 拍板,未自行處理。

---

## §6 這條線今天踩到、值得後人對照的坑

1. **新 FK 會把既有守門降級成「觀察不到」** —— S1b 的 FK 讓 `TRUNCATE suppliers` 在 S1a 的
   `BEFORE TRUNCATE` trigger **之前**就被 PG 擋掉(`0A000`);刪供應商則相反(trigger 先炸 `P0001`,
   FK 的 `23503` 要停用 trigger 才看得到)⇒ **plan 原本要求的 `23503` 物理上不可達**,已更正。
   兩支 harness 都已改成兩層各自驗。落檔 = memory
   `feedback_new-fk-can-demote-an-existing-guard-to-unobservable`。
2. **harness 不得污染兄弟 harness** —— s1b 的一次合法改名把 `updated_at` 推進,
   害 s1a 的 touch 突變格轉紅。收尾要跑 **A → B → A 再一次**才證得了零污染。
3. **關卡2 兩輪 35 條,零條打在 DDL 上** —— 全部打在驗收判別力與文件同步。
   同款形狀今天出現第二次(A5b 是 37 條全打在 plan)。
   最丟臉的一條:我寫的「約束集合比對」只有一半(只擋多的、不擋少的),
   而 S1a 的 commit body **當天上午才自稱修掉同一個錯**。
4. **`indexrelid::regclass::text` 隨 search_path 變化**(實測:public 不在路徑時輸出帶 `public.` 前綴)
   ⇒ 拿它當結構閘的比較基準會在正式站誤擋。`pg_get_indexdef()` 實測與 search_path 無關,用它。
5. **`aclexplode` 不帶 `is_grantable` 等於漏一個洞** —— 實測 `GRANT SELECT … WITH GRANT OPTION`
   攤平後與普通 SELECT **字串完全相同**。
6. **codex 背景跑必加 `< /dev/null`**(hook 已擋);判活看**輸出有沒有長**,不是 `pgrep`。
   本次兩輪各 938s / 595s,都有 `tokens used` 完成標記。
7. **送審 = 凍結**。本 session 違反過一次(codex 審查中我改了受審檔的檔尾),已還原後才續。

— END —
