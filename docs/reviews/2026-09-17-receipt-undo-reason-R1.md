# 2026-09-17 · 撤銷到貨「為什麼」R1 唯讀對抗審查

> 走 `.claude/agents/adversarial-reviewer.md`(codex 額度 09-20 12:12 才回)。
> 派工:主視窗 `pcm-website-v2-fd`。執行:後台窗 `pcm-website-v2-46`。
> 🔴 **審查員唯讀不寫檔** ⇒ 本檔由後台窗代為落地,內容照其回文。
> 🔵 **後台窗自核過的**:MF1 / MF2 / MF3 三條的 檔:行 與逐字我各自開檔核過,**三條都成立**(核法見每條末尾「後台窗複核」)。
> 其餘 consider / nit 與「攻了沒攻破」的部分**我沒有逐條複跑** —— 標為審查員單方陳述。

- 標的:`583b964fa`(worktree `/Users/sean_1/pcm-ops`,branch `agent/ops-17-receipt`)
  \+ `supabase/migrations/20260917120000_m4b_delete_item_receipt_reason.sql`(**未貼**)
- 風險域:access-control / correctness-of-record(SECURITY DEFINER RPC + GRANT/REVOKE + 稽核落地)⇒ 鐵則 12 高風險
- 存取:FULL-REPO 唯讀
- **結論:FAIL · must-fix 3 · consider 2 · nit 7**

---

## 主視窗指定的三個問題(正面回答)

### ① 事後閘⑤ 會不會被自己的註解餵飽而恆綠? ⇒ **不會。**
`NULL, v_reason, v_req, 'admin');` 全檔只出現 2 次:
- `20260917120000...sql:277` — 函式體真碼(前綴 4 空格,`sed -n l` 驗過)
- `:334` — 閘⑤自己的 needle,住在 `DO $post$` 裡

`pg_get_functiondef` 撈的是 `$function$` :94-281,**不含 DO 區塊**;
函式體內的註解 :275-276 逐字是「第 6 欄 `reason` 從硬寫死的 NULL 換成 `v_reason`」——**不含那串字面**。
閘⑥ needle `NULL, NULL, v_req, 'admin');` 全檔只在 :71 / :340(都在 DO 區塊)⇒ 新函式體 0 次。
⇒ `20260916210000` 那個坑**這支避開了**。

### ② `DROP FUNCTION IF EXISTS` 與前置閘有沒有互相遮掩的縫? ⇒ **沒有。**
`DROP ... IF EXISTS`(:292)之前 245 行就有前置閘 :47-50:三參數版 `to_regprocedure` 回 NULL
⇒ `RAISE EXCEPTION` ⇒ `BEGIN`(:38)整個 abort ⇒ **DROP 根本走不到**。

四個相鄰狀態逐個核:
| 狀態 | 結果 |
|---|---|
| 三參數 + 四參數並存 | 前置閘過 → :292 砍三參數 → 事後閘② :316-319 驗只剩一支 |
| 只剩四參數(已貼過) | :49 大聲死 |
| `search_path` 不是 `""` | :59-62 死 |
| 非 SECURITY DEFINER | :63-65 死 |

反過來 ⇒ `IF EXISTS` 是**死碼**(見 nit 2)。

### ③ 檔頭「步 2-5 都不讀摘要」是真的嗎? ⇒ **是真的。**
- 步2 = :173 `order_item_procurement_receipts` / :177 `order_item_receipt_requests`
- 步3 = :195 `SET CONSTRAINTS` 本身
- 步4 = :198、:199-200 `order_item_procurement` / :204 `order_items`
- 步5 = :211 `DELETE`
- `order_item_quantity_summary` 第一次出現在 **:222(步6)**

補:這個排序**不是本片改的** —— `20260810233000:366-374` 已經同位置。

---

## must-fix

### 🔴 MF1 · 「部署兩個方向都叫得動」不成立 —— 碼先推 + 員工填了理由 ⇒ 撤銷失敗

**證據**
- `apps/admin/src/lib/orders/receipt-repository.ts:270` 逐字:
  `// ⇒ 📌 那讓「板貼了而碼還沒推」與「碼推了而板還沒貼」兩個方向都叫得動。`
  緊接 `:271` `...(args.reason !== undefined && args.reason !== '' ? { p_reason: args.reason } : {}),`
- commit body 逐字:「沒填 ⇒ 整個 p_reason key 不送(…)⇒ **部署兩個方向都叫得動**。」
- migration `:28-32` 只證到「板先貼 ⇒ 舊碼叫得動」,**沒有證反向**;plan `:71-72` 同。

**觸發(逐步)**
1. 本 commit 合進 `dev` = 後台上線(CLAUDE.md〈Git〉逐字「推 dev = 後台上線」),而 commit body 明寫「🛑 migration 不貼」。
2. 員工看到 `receipt-undo-bar.tsx:74` / `receipt-delete-button.tsx:107` 那格 `placeholder='為什麼撤銷?可不填'`,**打了字**。
3. `receipt-actions.ts:373` `reason: readSingleString(...) ?? undefined` ⇒ 非空字串。
4. `receipt-repository.ts:271` 條件成立 ⇒ **送 `p_reason`** ⇒ PostgREST 對只有三參數的活庫回 **PGRST202**。
5. `receipt-repository.ts:274-286`:是 `P4A03`?否。`isCallerBugRaise`(`:73-76` 只認 `P0001` / `P2B02`)?否。⇒ `throw error`。
6. `receipt-actions.ts:375-392` catch ⇒ `receiptUndoFailure('error')` ⇒ 員工看到籠統的「撤銷失敗」,而**東西沒撤**。

**為什麼這條最痛**:不填的人成功、填的人失敗 ⇒ **間歇性**,而且錯誤訊息跟真正的原因一點關係都沒有。
📌 這正是 CLAUDE.md〈Git〉那條「兩個方向都有空窗」裡**沒被 `DEFAULT NULL` 買到的那一半** ——
**`DEFAULT` 只救「少送」,救不了「多送」。**

**最小修法(二選一,要 Sean 拍)**
- 甲:合 dev 之前**先貼板** + `NOTIFY pgrst, 'reload schema'`,兩件當同一次動作;
  並把 `receipt-repository.ts:270` 與 commit body 那句改成逐字「**只有板先貼這個方向**叫得動;碼先推會 PGRST202」。
- 乙:碼要先推的話,兩格 `<input>` 先不掛(或走旗標),貼完板再開。

> **後台窗複核**:`sed -n '265,275p' apps/admin/src/lib/orders/receipt-repository.ts`
> —— :270 那句逐字宣稱與 :271 的送 key 條件**都在**,成立。

---

### 🔴 MF2 · `undo-reason-wiring.test.ts` 是恆綠變形 —— 它守不住它宣稱要守的欄位名

**證據** `apps/admin/src/lib/orders/undo-reason-wiring.test.ts:31-38`
```
expect(src.includes('RCPT_UNDO_REASON_FIELD'), `${rel} 沒有掛撤銷理由那一格`).toBe(true);
expect(
  src.includes(`name='${RCPT_UNDO_REASON_FIELD}'`) ||
    src.includes(`name="${RCPT_UNDO_REASON_FIELD}"`),
  `${rel} 把欄位名手打成字串了 ⇒ 常數改名時它不會跟著改, 而且不會紅`,
).toBe(false);
```

**突變(具體)**:`receipt-undo-bar.tsx:73` 的 `name={RCPT_UNDO_REASON_FIELD}` 改成 `name='undo_reasonX'`,**import 那行不動**。
- 第一格:`src.includes('RCPT_UNDO_REASON_FIELD')` 仍 **true**(`:11` import 還在)⇒ 綠
- 第二格:找的是 `name='undo_reason'` 這個字面 ⇒ false ⇒ `.toBe(false)` ⇒ 綠
- 三綠也不會叫:`noUnusedLocals` 全 repo 0 命中;eslint 無 `no-unused-vars` / `unused-imports`

⇒ **一條入口靜靜送不出理由,而這個檔頭逐字說它就是為了擋 `#450` 那個形狀而存在的。**

**最小修法**:第一格改成比對屬性本身
`expect(src.includes('name={RCPT_UNDO_REASON_FIELD}')).toBe(true)`

> **後台窗複核**:`receipt-undo-bar.tsx` grep `RCPT_UNDO_REASON_FIELD` ⇒ **:11(import)與 :73(name=)兩處**
> ⇒ 拿掉 :73 之後 :11 仍在 ⇒ 第一格照樣 true。
> 另實查:`grep -rn 'noUnusedLocals' --include='tsconfig*.json' .` ⇒ **0 行**;`grep -rn unused eslint.config.*` ⇒ **0 行**
> ⇒ 那個沒用到的 import **不會被任何一道閘叫** ⇒ 恆綠成立。**這一格是我自己量的,不是沿用審查員的。**

---

### 🔴 MF3 · 貼板之後 `scripts/352a2-verify.sh` 一格都跑不到

**證據**
- `scripts/352a2-verify.sh:23` `FN_DELETE="public.admin_delete_item_receipt(uuid,text,text)"`
- `:50-55` 身分閘:`count(*) FROM pg_proc WHERE oid = '$FN'::regprocedure` != 1
  ⇒ `🔴 RPC 不在:$FN ⇒ 拒跑、不吐綠` + `exit 1`
- `scripts/d1t2-rehearsal.sh:76` `for f in supabase/migrations/*.sql; do` ⇒ provision **套全部** migration
  ⇒ 20260917120000 的 `:292` 把三參數版 DROP 掉
- 另有 7 處引用同一個變數(`:123 :127 :130 :136 :215 :430 :673 :686`)

⇒ 這支 RPC **唯一的行為 harness**(39 格、9 個突變靶)從此在 replay-from-zero 上開場就死。
🔵 它是**大聲死**不是假綠,但等於沒有了。

**最小修法**:`:23` 改成 `public.admin_delete_item_receipt(uuid,text,text,text)`
(`:136/:140/:430/:653/:663/:680` 讀的是 `prosrc`,改簽章後照常成立。)

> **後台窗複核**:`sed -n '23p' scripts/352a2-verify.sh` ⇒ 逐字就是三參數版,成立。

---

## consider(審查員陳述,後台窗未逐條複核)

### C1 · `COMMENT ON FUNCTION` 隨 DROP 一起沒了,而有文件指著它
`20260810233000:456-462` 有六行 COMMENT(唯一守門、fail-closed、rowcount、request_id 不參與冪等)。
本片 `:292` DROP 三參數版 ⇒ COMMENT 一起消失,`:82-281` 的新版與還原檔 `:34` 都沒補。
而 `docs/specs/2026-08-14-e10-18-return-line-recon.md:126` 逐字:
「第二版已讀它的 `COMMENT ON FUNCTION`(`20260810233000:458-459`)」⇒ **下一個照著讀的人會讀到空的**。
修法:migration 與 rollback 各補 `COMMENT ON FUNCTION ...(uuid,text,text,text) IS ...`(舊六行原樣搬 + 一句 `p_reason` 選填)。

### C2 · `acl-snapshot.tsv` 基線會漂,而貼板尾註沒寫怎麼收
`supabase/acl-snapshot.tsv:50-53`(anon / authenticated / payment_confirmer / service_role 四列)
與 `:724`(FNCFG)存的都是三參數的 identity 簽章 ⇒ 貼完之後這 5 列全變。
而 migration 尾註 `:357-358` 只寫了 `pcm_acl_approve_latest` 與 `NOTIFY pgrst` ——**沒寫重寫 repo 基線**。
`scripts/acl-snapshot.sh:29` 逐字:`--write 重寫基線(= 你在宣告那些差是【被批准的】)`。
不做的話下次有人跑它會看到 drift,而 `check-anomaly-alerts.ts:1891` 逐字說
「沒有貼板卻出現這一行 ⇒ 有人直接在 Supabase 網頁上改了權限 ⇒ 要查」。
修法:尾註加第三步 `bash scripts/acl-snapshot.sh --write`,tsv 併進貼板那顆 commit。

---

## nit(審查員陳述,後台窗未逐條複核)

1. `receipt-actions.ts:369` 逐字「員工沒打字 ⇒ `readSingleString` 回 `undefined`」,而四行後 `:372` 自己更正成「沒有那個欄位時回 `null`」;實際是 `apps/admin/src/lib/forms/single-value.ts:55-58` 回 `string | null`。留著會讓下一個人以為有兩種「沒填」。
2. migration `:292` 的 `IF EXISTS` 是死的(前置閘 `:47-50` 已把該狀態變成 hard abort)。留著會被讀成一道容錯。
3. migration `:317` `v_old <> v_oid` 是死條件:`to_regprocedure` 拿三個型別查不到四參數版,兩者不可能相等。
4. 本片不可重跑:貼成功後再跑,前置閘 `:49` 吐「不是庫不對, 就是本片已經貼過」—— 兩種狀態同一句話,而下一步完全相反。
5. `v_reason` 正規化(`:160-167`)插在 `v_req` 形狀閘(`:168-170`)**之前**,讀起來像 request_id 的驗證中間夾了別的東西。行為零差,純可讀性。
6. `docs/plans/2026-09-05-remove-service-role-bypassrls-plan.md:111` 仍寫 `admin_delete_item_receipt [search_path=public, pg_temp]` —— 09-05 之後就不是了,過期字面。
7. 前端無 `maxLength`(`receipt-delete-button.tsx:104-110` / `receipt-undo-bar.tsx:71-76`,註解明說刻意):超大 reason 會整包走完 PostgREST 才在 RPC 截成 500。呼叫端是 SSO 後台 + service_role ⇒ 影響很小,但「單一標準」的代價要認列。

---

## 攻了而沒攻破的(審查員附了具體形狀)

- **稽核落地的空 / 空白 / 零寬**:`:160-167` `btrim(p_reason, v_ws||v_zw)`;`btrim(NULL,…)` 回 NULL、`''` 走 `:161` 歸 NULL、純零寬被 `v_zw`(含 `U+200B/200C/200D/FEFF/2800/3164/00AD`)剝光 ⇒ **四種都 NULL**。前端側 `receipt-repository.test.ts:333-352` 兩格守「不送 key」。四條對得起來。
- **權限放寬**:`:297-300` vs 舊 `20260810233000:468-473`。新版少了 `FROM service_role` 那一項,但緊接就 GRANT 回去 ⇒ 淨結果相同。新函式出生自帶的 PUBLIC EXECUTE 被 `:297` 收掉 ⇒ `payment_confirmer`(靠 PUBLIC)仍拿不到,與 `acl-snapshot.tsv:52` 的 `-|DEF` 一致。事後閘⑦ `:345-351` 正反兩面都驗。**沒有放寬。**
- **`search_path` 加固被解開**:`:93` `SET search_path TO ''`,前置閘 `:59` 與事後閘③ `:322` 兩端都比 `proconfig @> ARRAY['search_path=""']`,與 `acl-snapshot.tsv:724` 逐字相符。**保住了。**
- **還原檔還原得回去**:`:34-38` 建回三參數且自帶 `SET search_path TO ''`、`:207` DROP 四參數、`:210-213` 權限照舊、`:227` 事後閘驗 search_path。唯一缺 COMMENT(C1)。
- **測試是不是複述實作**:`receipt-repository.test.ts` 那三格驗的是**契約**(送不送 key)—— 把 `!== ''` 拿掉、或改成 `p_reason: args.reason ?? null`,各有一格會紅。**這三格是活的。**(而 `undo-reason-wiring.test.ts` 不是 ⇒ MF2。)

## 🔴 審查員自己說證不到的(照抄,不要讀寬)

1. **正式庫的活定義一行都沒讀。** 「函式本體是 `pg_get_functiondef` 從正式庫撈的原文」這句只用
   `20260810233000` 的 repo 副本 + `acl-snapshot.tsv:724` 側面對,兩份一致,**但那不等於核過活庫**。
2. commit body 那五行「拋棄式 PG 實跑」的結果,**一發都沒複跑**。
3. PostgREST 對「板已貼、舊碼只送三個 key」的解析**沒實跑**(推論:會命中 DEFAULT ⇒ 成立)。**標:推論,未核。**

---

## 收尾(鐵則 12)

R1 **FAIL**(3 must-fix)⇒ 照鐵則 12:**must-fix 修完才 commit;R1 有 must-fix 才 R2。**
🛑 **MF1 的修法是二選一,那是 Sean 的題(先貼板 vs 先拆輸入格)** ⇒ 停下端 Sean,不自行選邊。
