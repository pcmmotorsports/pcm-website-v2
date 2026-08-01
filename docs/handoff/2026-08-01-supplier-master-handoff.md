# 供應商主檔線 — 交接檔(2026-08-01 傍晚改寫)

> **接手入口。開工前整份讀完。** 前身版本(下午、S1a 之前)已被本檔取代;
> 更前身 = `docs/handoff/2026-08-01-a7c-applied-handoff.md`(A7c 線,已完成)。

---

## §0 一句話現況(2026-08-01 晚更新)

**S1a + S1b 已 apply 到正式站、型別已重 gen;S2 owner RPC 已 code 收工並 commit,🔴 未 apply、未 push。**
🆕 **下一片 = `S2-C` 併發 harness**(Sean 2026-08-01 晚拍 **B**「現在就補」;規格見 §3-0)。其後才是 S3a。

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -3 && git status --porcelain
```
預期:branch=`dev`、HEAD = S2(`e21a0b6`)、工作樹乾淨、**未推 1 筆**。
(hash 若不符,以 `git log` 當場結果為準 —— 本檔不寫死可達性,見 STATUS「最近 3 commit」欄的政策。)

🔴 **另有一個視窗在做前台(`apps/storefront/src/**`)。** 我的領域 =
`supabase/migrations/` / `scripts/` / `docs/specs/2026-08-01-e10-supplier-*`。
**`STATUS.md` 與 `docs/handoff/CURRENT.md` 是唯一真衝突點,改之前先問 Sean。**
一律 `git add <精確路徑>`,禁 `git add .` / `-A`;`--amend` 前先 `git log -1` 確認 HEAD 是自己那筆。

---

## §1 🔴 開新視窗第一件事:重排今晚的提醒

**今晚 22:04 的 TapPay 探測 cron 是 session-only —— 上一個視窗關掉就死了。**
✅ **2026-08-01 晚已在本視窗重排**(one-shot `4 22 1 8 *`)。
🔴 **但它一樣綁在這個視窗上** —— 本視窗若在 22:04 前關掉,**下一個視窗仍要再排一次**。
這是第三次因為同一個原因重排;`CronCreate` 沒有持久化選項(工具自陳 session-only、不寫磁碟)。
內容(逐字):

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
| **S1a** 供應商主檔 + 26 家 seed + 不可刪除 | `b5d918d` | 已 push、**已 apply**(08-01 傍晚) |
| **S1b** 採購表供應商欄改 FK | `3af433d` | 已 push、**已 apply**(08-01 傍晚) |
| 型別重 gen + 貼回三處人工校正 | `ff1347e` | 已 push |
| **S2** `admin_upsert_supplier` owner RPC | `e21a0b6` | **未 push、未 apply** |

**S2 做的事**:`suppliers` 的**寫入路徑到本片才存在**(S1a 對 service_role 只開 SELECT
⇒ 在此之前那張表沒有任何 app 層寫得進去的方法)。一支 `SECURITY DEFINER` owner RPC 吃三種動作:
`p_supplier_id` 為 NULL = 新增;有值時 `p_label` / `p_is_active` 各自 NULL = 該欄不動。
回固定碼 `CREATED / UPDATED / NO_CHANGE / NOT_FOUND / DUPLICATE_LABEL`;同交易寫 `admin_audit_log`。
驗證 harness = `scripts/s2-verify.sh`(**77 PASS / 0 FAIL**)。

**S2 的審查**:三輪、共 **42 條**、逐條親驗全成立、**駁回 0**、已全折 ——
R1 Claude opus `code-reviewer` FAIL 13(逐行正確性)→ R2 codex `gpt-5.6-sol` xhigh NO-GO 18
(結構與宣稱判別力)→ R3 Fable `adversarial-reviewer` FAIL 11(換角度質疑框架本身)。
🔴 **三輪 findings 幾乎零重疊** —— 每輪都打在前一輪看不到的層,**直到 R3 才收斂**。

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

### §3-0 🆕 `S2-C` 併發 harness(**下一片**;Sean 2026-08-01 晚拍 B「現在就補」)

**要證的事**:`admin_upsert_supplier` 裡的 `SELECT … FOR UPDATE` **真的把同一家的並行改動序列化**。
現況只有**文字層**斷言(`prosrc` 裡那個字還在)—— 拿掉 `FOR UPDATE`,S2 的 77 條裡
**除了那一條之外一條都不會紅**,而兩個員工同時改同一家會 lost update + 稽核 before/after 鏈斷。

**三格**(產物建議 = `scripts/s2c-concurrency.sh`,別塞回 `s2-verify.sh`,那支已 700+ 行):

1. **擋得住**:連線 A `BEGIN` → 呼叫 RPC 改 X → **不 commit**;連線 B 對**同一家** X 呼叫 RPC
   → 必須**卡住**(不是失敗、是等)。A commit 後 B 才動。
2. **無 lost update**:B 解鎖後讀到的 `before` 必須是 **A 改完的新值**,不是 A 改之前的舊值;
   兩筆稽核的 `before/after` 首尾相接(A.after = B.before)。
3. **突變**:拿掉 `FOR UPDATE`(`CREATE OR REPLACE` + ROLLBACK,沿用 `s2-verify.sh` 的 `mut_block()`)
   ⇒ 第 1 格不再卡住、第 2 格讀到 stale before、鏈斷 ⇒ **兩格都必須轉紅**。沒有這格就沒證到承重。

🔴 **必須用 barrier,不准用 sleep/賽跑** —— memory `feedback_race-test-without-barrier-proves-nothing`
逐字:「沒有 barrier 的競賽測試綠了不代表任何事」。可重用的形狀 = `scripts/lib/a7bt-barrier-migration.py`
與 `scripts/a7bt-acl-rollback-lock.sh` 的鎖探針(那支的教訓:**「沒探到」若靜靜算過就是永久假綠**,
判準要正向看到 `PROBE-OK` 之類的字面,不能只看「沒出錯」)。

🔴 **開工前先讀**:memory `feedback_race-test-without-barrier-proves-nothing`(含 PG17 `MAINTAIN` 與
PUBLIC 斷言順序兩個附帶坑)、`reference_bash-background-kill-and-mutation-restore-traps`
(`kill -9 $!` 可能殺到子 shell;突變還原**別用** `git checkout`)。

**片型**:高風險片(鐵則 12 ②權限的延伸驗證)⇒ 收工前照樣走 code-reviewer + codex 關卡2。
**估時**:15-45 分鐘寫 + 審查另計。**零 migration 改動**(只加 harness)⇒ 不影響 apply 順序。

---

1. **S3a** 讀模型 + server action(`listSuppliers`:預設只回 `is_active=true`、`ORDER BY label`)。
   🔴 驗收 14 明文要求「拿掉 active 過濾**必須有測試轉紅**」——只證明 inactive 列 JOIN 得到不算數。
   🔴 S3a **只做讀**;寫入呼叫端在 S3b(R3 更正片界,plan §5-11b)。
2. **apply**(Sean 手動 `supabase db push`;跑前移開 `.env.local`、跑完還原)。
   🔴 **push 之前先跑這行 preflight**(S2 的「零欄級 ACL」閘是第一次對正式站執行,S1b 只查過採購表):
   ```sql
   SELECT count(*) FROM pg_attribute
    WHERE attrelid='public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
   ```
   預期 **0**;非 0 先查是誰授的,不要直接 push。
   🔴 **apply 後必重 gen 型別**(新增一支 RPC ⇒ `Functions` 區塊會變)+ 貼回 `create_order.Args`
   三處人工校正,**以 typecheck 轉綠為證**。這是 **S3b 的硬前置**(S3b 要 typed `.rpc()`)。
3. **S3b** `/settings/suppliers` 設定頁(列表字母序 + 新增 typeahead + 改名 + 停用開關)。
   🔴 **S3b 揹三條 S2 交下來的契約債,全在 plan §6**:
   ① 改名/停用 action **必須斷言回傳碼 ∈ `{UPDATED, NO_CHANGE}`** —— 收到 `CREATED` 表示呼叫端
   把 id 弄丟了,會靜默多一筆**刪不掉**的垃圾列且零錯誤(R3 實測)
   ② 撞到**已停用**的同名供應商也回 `DUPLICATE_LABEL`,而 `listSuppliers` 預設不回停用的
   ⇒ 需要「顯示停用同名 + 一鍵重新啟用」的出口,否則是 UI 死路
   ③ 逐檔 ≤400 行(鐵則 6),附 file manifest。

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

## §5b 🔴 S2 的誠實邊界(2026-08-01 晚新增)

- 🔴 **併發完全沒測**:`FOR UPDATE` 只有**文字層**斷言(prosrc 裡那個字還在)。
  拿掉它,77 條裡除了那一條之外**一條都不會紅**。兩個員工同時改同一家 ⇒ lost update
  + 稽核鏈斷。要真的關掉需要兩連線 + barrier 的併發 harness(`a7bt` 那套形狀)。**本片未做,已 raise 給 Sean。**
- 🔴 **近似重複三種形狀都不擋**:內部空白 / **大小寫**(`akoso` 與 `AKOSO` 並存是實測)/ 標點。
  防線一律是 S3b 的 typeahead(人眼)。**這是「已知不擋」清單,不是窮舉。**
- 🔴 **稽核 `actor` 不是經過驗證的身分** —— `apps/admin/src/lib/session/actor.ts:6-7` 逐字
  「以 cookie 承載、內容來自使用者自行選擇……**不是**登入 / 授權邊界」。
  S2 保證的是「稽核列一定有一個非空 actor 字串」,不是「那個字串是真的操作者」。真身分屬 E8-B。
- 🔴 **稽核不能反過來當「真的有寫入」的證據**:service_role 對 `admin_audit_log` 有 INSERT
  ⇒ 同一把 service key 可不碰 `suppliers` 就寫一列假稽核。既有權限模型、非 S2 引入。
- 🔴 **全部 ACL / SET ROLE 結論跑在 `scripts/d1-supabase-shim.sql` 手造的角色圖上**
  (三角色皆 NOLOGIN、零 membership、**沒有 PostgREST 那一層**)⇒ 證的是「PG 角色層擋得住」,
  **不等於**「拿 anon key 打 `/rest/v1/rpc/` 擋得住」。
- 🔴 `[[:cntrl:]]` 隨 `lc_ctype` 變 ⇒ 本機 C locale 的控制字元結論**不外推**正式站(#305 同族)。
- 🟡 **相鄰缺口不修**:S1a 對兩支 trigger 函式的 `REVOKE` 沒涵蓋 anon/authenticated/service_role
  (**無可利用性** —— trigger 函式直呼必炸 `can only be called as triggers`),
  修它要動已 apply 物件的 ACL = 另一支 migration 的決定,不夾帶。

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
7. **送審 = 凍結**。S1b session 違反過一次(codex 審查中改了受審檔的檔尾),已還原後才續。
   S2 這輪三次送審全程未動受審檔。

### S2 這片新增的坑(2026-08-01 晚)

8. **表級 ACL 攤平看不到欄級 GRANT** —— `pg_class.relacl` **只存表級授權**,欄級在
   `pg_attribute.attacl`。實測 `GRANT UPDATE (is_active) ON suppliers TO service_role` 之後,
   一條寫得很細的表級斷言(八權限 + `is_grantable` + PUBLIC 單查)**照樣全綠**,
   而 service_role 已經可以直接停用供應商、零稽核。
   ⇒ 「某表對某角色只該有 X 權限」這種守門**一定要兩條**。落檔 = memory
   `reference_pg-table-acl-flatten-blind-to-column-grants`。
   🔴 附帶教訓:`s1a-verify.sh` **本來就有**這條,但 S2 自己的 harness 沒抄過去 ——
   **兄弟 harness 有的斷言不會自動繼承**。
9. **靠參數 NULL 分流的 upsert RPC 會靜默降級** —— `p_supplier_id` 掉成 NULL 的改名回 `CREATED`、
   多一筆刪不掉的垃圾列、零錯誤。訊號在回傳碼裡,**但沒有人去看它就等於沒有**。
   落檔 = memory `feedback_null-dispatch-rpc-silently-downgrades`;🔴 **A5a 是同一個 upsert 形狀,
   開工時先決定要不要拆兩支**。
10. **兩條修法組合出第三個問題** —— 關卡2 要我「補 actor 長度/控制字元檢查」與「寫入前剝空白」,
    兩條各自都對,合起來變成「先驗**原值**、後剝空白」⇒ 同一支函式裡 label / note / actor
    **三種順序**,而 cookie 帶一個尾隨 CR 就整包拒收。R3 才抓到。
    ⇒ **逐條折 findings 之後要回頭看「這幾條改動彼此有沒有打架」**,不是折完就算。
11. **自我測試不能抄一份簡化版** —— `mutate_fn` 的三道自檢原本在 §0 有一份自己的複本,
    而複本的檢查順序與本尊不同 ⇒ 證明的是複本會發火。已抽成 `mut_block()` 唯一一份、
    §0 與 §C 共用,並重排順序讓三道**各自都有「只有它會發火」的形狀**。
12. **codex 的沙箱連不上 localhost DB** —— 這輪 codex 明說「TCP 與 Unix socket 均被唯讀沙箱拒絕,
    故未重跑 77/0」⇒ 它的 18 條全是 source-level 推論。**主對話必須逐條親驗**
    (本輪親驗結果:全部成立、駁回 0,但那是驗過才知道的)。Fable 那輪反而連得上、自己重跑了。

— END —
