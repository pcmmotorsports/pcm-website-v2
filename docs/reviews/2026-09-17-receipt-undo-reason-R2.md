# 2026-09-17 · 撤銷到貨「為什麼」R2 唯讀對抗審查

> 走 `.claude/agents/adversarial-reviewer.md`(codex 額度 09-20 12:12 才回)。派工:主視窗 `pcm-website-v2-fd`。
> 🔴 **審查員唯讀不寫檔** ⇒ 本檔由後台窗代為落地,內容照其回文。
> 🔵 **後台窗自核過的**:F1 / F3 / F4 的 檔:行 與逐字我各自開檔核過,**三條都成立**(核法附在每條末尾)。
>   F2 是「有沒有機械保證」的跨層結論,我沒有複跑審查員那兩發量測。
> 🔴 **本輪不是跨模型背書 —— R1 與 R2 同一顆模型。** 真正的第二視角仍是 codex(09-20 之後)。

- 標的:`f2b4041c9`(R1 修正)/ `583b964fa`(原片)/ `20260917120000`(**仍未貼**)/ `20260917120000-rollback.sql` / R1 報告
- worktree `/Users/sean_1/pcm-ops` · branch `agent/ops-17-receipt` · working tree clean · 存取 FULL-REPO 唯讀
- 風險域:access-control / correctness-of-record ⇒ 鐵則 12 高風險,track = FULL
- **結論:FAIL · must-fix 4 · consider 4 · nit 2**

---

## R1 那三條到底修好了沒(正面回答,不背書)

| | 判定 |
|---|---|
| **MF1** | 🔴 **沒有。** 行為零改,而「碼先推」那個方向**沒有任何機械保證** ⇒ F2 |
| **MF2** | 🟡 **只修一半。** 同一支檔第二格還是一模一樣的恆綠形狀 ⇒ F3 |
| **MF3** | 🔴 **沒有。** 只改了 `:30`,漏了 `:667` / `:690` ⇒ F4 |

---

## must-fix

### 🔴 F1 · 被推翻的那句話**還活著**,逐字住在測試檔裡

`apps/admin/src/lib/orders/receipt-repository.test.ts:333-334` 逐字:
```
//    RPC 的 `p_reason` 有 `DEFAULT NULL` ⇒ **不送 key** 走的是預設值那條路,
//    與舊版三參數呼叫完全同一條 ⇒ 部署兩個方向都叫得動(CLAUDE.md〈Git〉那條空窗)。
```
全 repo 掃 `兩個方向都叫得動` ⇒ 程式碼裡兩處:
- `receipt-repository.ts:272` — 已改成 `⛔ ~~「兩個方向都叫得動」~~ 是**假的**` ✅
- `receipt-repository.test.ts:334` — **原句原樣還在** ❌

🔴 **為什麼是 must-fix 不是 nit**:R1 給那句話定的罪名逐字是「**它在檔裡當了一整天的通行證**」。
那張通行證**搬到隔壁檔繼續用** —— 而且搬進**測試檔**,那正是下一個人查「這支的契約長什麼樣」時會打開的地方,
還順手引 `CLAUDE.md〈Git〉` 來背書一個**與那條規矩結論相反**的宣稱。
📌 **修一處假字面、留一處同樣的假字面,等於沒修。**

**最小修法**:`:334` 改成與 `receipt-repository.ts:272-283` 對齊的逐字。

> **後台窗複核**:`grep -rn '兩個方向都叫得動' --include='*.ts' apps packages supabase scripts`
> ⇒ 就是上面那兩行,**成立**。

---

### 🔴 F2 · 「板先貼」沒有任何機械保證 —— 兩道部署時序閘對這個形狀**天生失明**

**① `scripts/view-apply-before-wire-gate.py` 射程完全不涵蓋本片**
`:139-141` 的 `TARGETS` 表**只有一列**:
```python
TARGETS = [
    ('pcm_shipped_email_pending', 'enqueueOrderShippedEmails', 'enqueueOrderCreatedEmails'),
]
```
`:2` 檔頭逐字「**它守 TARGETS 表, 不守 apply 這件事本身**」;`:33` 逐字「**表外的同型缺口它一個都看不到**」。
⇒ 它是 view 專用、單一具名對 ⇒ `admin_delete_item_receipt` 不在表裡。

**② `scripts/deploy-order-gate.sh`(掛 `.husky/pre-push`)對這一發是綠的 —— 審查員實測**
判準 `:54` / `:905-923`:對 pending migration 抽到的函式名,在 `apps/**`/`packages/**` 的**新增行**裡找命中。
而 `:818` `git diff -U0` + `:824` `ADDED="$(… | grep '^+' …)"` ⇒ **只看 `+` 行、沒有上下文**。
```
git diff -U0 origin/dev f2b4041c9 -- apps packages | grep '^+' | grep -v '^+++' | grep -c admin_delete_item_receipt
⇒ 0
```
⇒ `.rpc('admin_delete_item_receipt'` 那一行**這一發根本沒動到**(動的是它上面的註解)⇒ 三種命中全 miss ⇒ **放行**。

🔴 **CLAUDE.md〈Git〉那條「改既有函式的簽章」落在第三格:**
| 形狀 | 閘的反應 |
|---|---|
| 新函式 / 新 view | **擋**(名字會出現在新增的 `.rpc(` / `.from(`) |
| 新欄位 | 只印警告(`deploy-order-gate.sh:1070` `COL_WARN`) |
| **既有函式改簽章** | **連警告都沒有** —— 呼叫端那一行根本不用改,而閘只看新增行 |

📌 **⇒ 不是「擋不擋得住」,是【對這個形狀天生失明】。答案:純靠人記得,沒有任何閘。**

**觸發**:有人(或夜跑)把 `agent/ops-17-receipt` 合進 `dev` ⇒ 「推 dev = 後台上線」
⇒ 員工看到 `placeholder='為什麼撤銷?可不填'` ⇒ 打字 ⇒ 送 `p_reason` ⇒ 活庫只有三參數 ⇒ `PGRST202`
⇒ `receipt-repository.ts:73-76` 的 `isCallerBugRaise` 只認 `P0001`/`P2B02` ⇒ 不認 ⇒ throw
⇒ `receiptUndoFailure('error')` ⇒ 籠統的「撤銷失敗」而**東西沒撤**。
🔴 **沒填的人成功、填的人失敗** ⇒ 間歇性,錯誤訊息跟真因無關。

**最小修法(二選一,🛑 要 Sean 拍)**
- **甲(4 行,程式自己 fail-soft;審查員推薦)**:`deleteItemReceipt` 的 `error` 分支最前面加一格 ——
  `errorCode(error) === 'PGRST202'` 且這次**有送** `p_reason` ⇒ **不帶 `p_reason` 重打一次**,
  server log 留一行「板還沒貼,理由沒存進去」。
  ⇒ 東西撤得掉(員工的主要目的達成),只是理由沒落地 —— 而理由本來就是**選填**的輔助資訊。
  ⇒ 🎯 **這樣兩個方向就真的都叫得動,那句註解也不用停在半句實話。**
- **乙(純程序)**:合 dev 之前先貼板 + `NOTIFY pgrst, 'reload schema'`,當同一次動作,並事先知會用那條路的人。
  ⚠️ 選乙要認:**沒有閘在守它**,靠的是那一次人記得。

---

### 🔴 F3 · MF2 只修了第一格;第二格是一模一樣的恆綠形狀,而且有**全綠的斷線**

`apps/admin/src/lib/orders/undo-reason-wiring.test.ts:56-61` 逐字:
```ts
  it('🔴 action 那一層真的去讀那個欄位', () => {
    const src = readFileSync(join(SRC, 'lib/orders/receipt-actions.ts'), 'utf8');
    expect(
      src.includes('RCPT_UNDO_REASON_FIELD'),
      'action 沒讀那個欄位 ⇒ 兩條入口都填得進去, 而它一路被丟掉',
    ).toBe(true);
```
而 `receipt-actions.ts` 裡那個字**恰好兩次**:`:22`(import 清單)、`:374`(真的用)。

**突變(審查員自己設計,不照抄 R1)**:`:374` 改成
`reason: readSingleString(formData, 'undo_reason') ?? undefined,`,**`:22` 不動**。
| 格 | 結果 |
|---|---|
| 第一格(兩條入口 `.tsx`) | 與本突變無關 ⇒ 綠 |
| 第二格前半 `includes('RCPT_UNDO_REASON_FIELD')` | `:22` 還在 ⇒ 綠 |
| 第二格後半 `includes('reason:')` | `:374` 還有 `reason:` ⇒ 綠 |
| typecheck / lint | `noUnusedLocals` 0 行、eslint 無 `unused` ⇒ 不會紅 |
⇒ **四邊全放行。**

🔴 **而它就是這支檔宣稱要擋的那個病本人**(`:5-12` 檔頭逐字為 `#450`「一條接線沒接上,而它的兩端各自都測過了」而存在)。
常數一旦改名,`:374` 那個手打字串不會跟著改 ⇒ FormData 的 key 與元件送出的 key 分家
⇒ **兩條入口都填得進去,理由一路被丟掉,畫面上一切正常。**
📌 R1 MF2 的罪名「**一道為了擋接線沒接上而寫的閘, 自己就沒接上**」,在 `f2b4041c9` 之後
**對同一支檔的 20 行以下仍然成立** —— 而 commit body 宣稱 MF2 已修完。

**最小修法**:第二格比照第一格比對**用法**:
`expect(src.includes('readSingleString(formData, RCPT_UNDO_REASON_FIELD)')).toBe(true)`
(順手把 `includes('reason:')` 換成 `includes('reason: readSingleString(')` —— 現行 needle 連註解裡的 `reason:` 都吃。)

> **後台窗複核**:`grep -n 'RCPT_UNDO_REASON_FIELD' apps/admin/src/lib/orders/receipt-actions.ts`
> ⇒ **只有 :22 與 :374 兩行**,與審查員說的一致 ⇒ 拿掉 :374 之後 :22 仍在 ⇒ 恆綠**成立**。

---

### 🔴 F4 · `352a2-verify.sh` 還有**兩處寫死三參數**,而修正自己的註解逐字宣稱那幾塊「不受影響」

`scripts/352a2-verify.sh:667`(M3 突變靶)與 `:690`(M7 突變靶)逐字:
```
EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(p_receipt_id uuid, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', …);
```
而上一行 `:664` / `:687` 取的是**四參數**那支的 `prosrc`。

**貼板之後逐步**(`d1t2-rehearsal.sh:76` 套全部 migration,而 `20260917120000` 不在 pg_cron 跳過名單裡):
1. `s` = 四參數版 body(含 `p_reason` / `v_reason`)
2. `EXECUTE` 建出一支**三參數**函式 —— 而舊三參數版已被 `20260917120000:292` DROP
   ⇒ 🛑 **兩支並存**,正是 migration `:314` 自己逐字警告的 ambiguous 狀態;那支三參數 body 還會去讀不存在的 `p_reason`
3. `landed` 斷言 `:669-670` 讀的是四參數那支(沒被突變)⇒ 斷言不成立 ⇒ `MUT_BAD++`
4. M7 同一條路 ⇒ 再一發
5. `:840` `[ "$MUT_BAD" -eq 0 ] || … GATE_FAIL=1` ⇒ `:846` `exit 1`

🔵 `mut()` `:108/:117` 全程 `BEGIN … ROLLBACK` ⇒ 那支多出來的函式**不會留痕毒害後面的格**(審查員特地核過)。
🔴 而 **A4(`SET CONSTRAINTS`)與 A6(`v_zw` 字元集)兩道守門的判別力證明就這樣沒了** —— A6 正是 codex 當初逼出來的那一格。

**🛑 而更該記一筆的是修正自己新寫的那句**,`:29` 逐字:
```
#    ⇒ 下次再動這支的簽章, **這一行要跟著動**(`:136/:140/:430/:653/:663/:680` 讀 `prosrc`, 不受影響)。
```
- **「不受影響」是假的** —— 真正會壞的 `:667` / `:690` **不在那串號碼裡**,而它們不是讀 `prosrc`,是**寫**一支三參數函式。
- 那串號碼本身也對不上:`:136` 是 A2 的 `aclexplode`、`:140` 是 A3 的標籤行。

📌 **一句「不受影響」的白名單,比沒有白名單更糟** —— 下一個動簽章的人會照著它跳過那兩行。
🔴 **這與本片 MF1 抓到的是同一種病:在檔裡寫一句安撫下一個人的話,而那句話沒被核過。**
而寫下它的正是**修 MF1 的那一手**。

**最小修法**:`:667` / `:690` 簽章改四參數;`:29` 那句白名單改成逐字列出**要跟著動的行**(`:30` / `:667` / `:690`),而不是列「不用動的行」。

> **後台窗複核**:`grep -n 'admin_delete_item_receipt(p_receipt_id uuid, p_actor text, p_request_id text)' scripts/352a2-verify.sh`
> ⇒ **:667 與 :690 兩行**,逐字就是三參數的 `CREATE OR REPLACE`。
> `sed -n '136p;140p'` ⇒ `:136` = `aclexplode` 那段、`:140` = `sql_cell "A3 取鎖序…"` 標籤。
> ⇒ **我自己寫的那句白名單是錯的,成立。**

**那 7 處引用逐處核**(主視窗點名的):`:130 :134 :137 :143 :147 :222 :437 :439 :660 :664 :670 :680 :687 :693`
—— 全部是 `::regprocedure` 解析或讀 `prosrc`,改四參數後**全數照常成立**。**唯二會壞的就是 `:667` 與 `:690`。**

**`EXPECTED_TOTAL=39` 還對嗎 ⇒ 對。** 實數 `sql_cell` 6 + `cell` 33 = 39;`mut` 9 = `EXPECTED_MUT`。本次修正沒加減任何一格。

---

## consider

### C3 · 接線守門看不到「`name` 對了但那格根本不會送出」
`undo-reason-wiring.test.ts` 是純字面比對。`<input disabled>` 或 `<input>` 掉到 `<form>` 外
⇒ 瀏覽器不會把那欄放進 FormData ⇒ `readSingleString` 回 `null` ⇒ 理由靜靜不見,而三格全綠。
🔵 檔頭 `:14-17` 已自承「這一格證不到『按下去真的會送』」⇒ **寫明的天花板不是隱瞞** ⇒ 不升 must-fix。
⚠️ 但它交棒給的 `receipt-repository.test.ts` 那三格是**從 `args.reason` 開始的**,同樣接不到「FormData 裡有沒有那個 key」
⇒ **這一段目前沒有任何測試**。最便宜的補法:`receipt-actions` 那層餵一份**沒有** `undo_reason` key 的 FormData,斷言 `reason` 是 `undefined`。

### C4 · 那兩個突變靶會把 `search_path` 寫回 `public, pg_temp`,而 A1 **在貼板之前就已經是紅的**
`352a2-verify.sh:129-131`(A1)要求兩支都是 `search_path=public, pg_temp`;
而 `20260905110000_m4b_definer_searchpath_lock_m1b.sql:38-39` 的清單裡**兩支都在**,`:171` 把它們鎖成**空字串**。
⇒ replay-from-zero 上 A1 **早在 2026-09-05 就會紅**,與本片無關。
🔴 **但它推翻了 MF3 修法的宣稱**:commit body 說改四參數之後那支 harness 就活了 —— **不會**,它會 A1 紅一格、M3/M7 紅兩發。
📌 **「開場不再死」≠「跑得過」。這兩個宣稱要分開講。**

### C5 · `database.types.ts` 還是三參數,而**型別層對 `p_reason` 天生看不見**
`packages/adapters/src/supabase/database.types.ts:4389-4392` 逐字只有三個 Args。
而 `client.ts:87` `createSupabaseServiceClient(): SupabaseClient<Database>` ⇒ 這支 `.rpc()` 是有型別的。
🔬 那為什麼 typecheck 9/9 綠?因為送 key 用的是**展開**:`...(cond ? { p_reason } : {})`
—— TypeScript 的 excess-property check **不作用在 spread 進來的屬性上**。
**代價兩層**:貼板後型別檔要重 gen,否則契約副本長期與活庫不一致;
🔴 更實際的:**現在把 key 打錯成 `p_resaon`,沒有任何一道閘會叫** ——
幸好 `receipt-repository.test.ts:353` 那格 `expect(payload.p_reason).toBe(raw)` 咬得到 ⇒ 所以是 consider。
**修法**:貼板尾註加一步「重 gen `database.types.ts` 並併進貼板那顆 commit」(與 C2 同一步)。

### C6 · 同意 R1 的 C1 / C2 維持 consider —— 而 C1 另有支持不升級的證據
- **C1(COMMENT 隨 DROP 消失)** 掃過全 repo 的 `obj_description` / `pg_description` 使用者
  (`a6-verify.sh:351,1371`、`a8c1-verify.sh:129`、`w7d3-verify.sh:402`、`b2s2b-verify.sh:2575-2579`、`refund-manual-reversal-rollback.sql:409`)
  ⇒ **沒有任何一支在驗 `admin_delete_item_receipt` 的 COMMENT** ⇒ 掉了不會讓任何閘變紅、不改變任何行為。
  損失純粹是「下一個照 `docs/specs/2026-08-14-e10-18-return-line-recon.md:126` 去讀的人會讀到空的」⇒ **consider 是對的分級**,而補它很便宜。
- **C2(acl-snapshot 基線會漂)** `supabase/acl-snapshot.tsv:50-53` 與 `:724` 逐字就是三參數的 identity 簽章 ⇒ 貼完 5 列全變。
  它是**貼板之後**才成立、而且是**大聲的 drift 不是靜默的洞** ⇒ 不升 must-fix;但要寫進貼板尾註,
  否則下一個跑 `acl-drift-gate` 的人會照 `check-anomaly-alerts.ts:1891` 去查一件不存在的資安事件。

---

## nit
**N1** · `352a2-verify.sh:29` 那串行號對不上實際內容。行號白名單會隨檔案漂,**寫特徵比寫行號耐久**。
(與 F4 同一處,分開記是因為就算 F4 修了,這種寫法本身還會再壞一次。)
**N2** · `undo-reason-wiring.test.ts` 對 JSX 空白 / 折行敏感(`name={ X }`、折行都不通過)⇒ 手動折行會**假紅**。
🔬 而 prettier 折行是**不存在的風險**,不是「推論不會」:
`.prettierrc*` / `prettier.config*` **0 個檔**、`printWidth` **0 行**、`package.json` 無 `prettier` 依賴、
lint-staged 對 `*.{ts,tsx}` 只跑 `eslint --max-warnings 0` **沒有 `--fix`**;
現行兩行各 41 字元(`receipt-undo-bar.tsx:73` / `receipt-delete-button.tsx:109`,`awk length` 量過)。
⇒ 方向是**假紅(大聲死)**不是假綠 ⇒ 留著即可。

---

## 重攻了一次而沒攻破的(不沿用 R1 的結論)

- **稽核落地**:`20260917120000:265-277` 的 INSERT **具名列出八欄**,不是靠位置 ⇒「第 6 欄數錯」這個攻擊面**不存在**。
  全檔 `INSERT INTO public.admin_audit_log` 只有這一處 ⇒ 不存在「兩條稽核路徑只接了一條」。
  正規化 `:159-167` `pg_catalog.btrim(p_reason, v_ws||v_zw)` ⇒ NULL / `''` / 純空白 / 純零寬**四種都收斂成 NULL**;
  >500 用 `pg_catalog.substr(v_reason,1,500)` 按**字元**截 ⇒ 不會切壞多位元組字。
  唯一挑得出的:截斷後可能留下尾端空白 —— 純畫面問題,不記 finding。
- **權限**:`:297-300` 四行 REVOKE(PUBLIC / anon / authenticated)+ GRANT service_role;
  新函式出生自帶的 PUBLIC EXECUTE 被 `:297` 明確收掉 ⇒ `payment_confirmer` 仍拿不到,與 `acl-snapshot.tsv:52` 的 `-|DEF` 一致。
  特別找了「REVOKE 漏一個角色」這個形狀:**四個角色對得上快照那四列,沒有漏。**
- **`search_path`**:`:93` `SET search_path TO ''` 與 `20260905110000` 鎖的字面同一個;
  函式體 `:96-281` 所有物件都帶 `public.` / `pg_catalog.` 前綴,**沒有裸名**。**保住了。**
- **還原檔**:`:15 BEGIN;` … `:240 COMMIT;` **整支一個交易** ⇒ `:34` 建回三參數、`:207` DROP 四參數,
  中間「兩支並存」的瞬間**外面看不到**。`:210-213` 權限與正片對稱 ⇒ **還原後不會多一個可執行的角色**。唯一缺 COMMENT(C1)。
- **DROP 與前置閘互相遮掩**:另外試了「先手動建一支四參數版再貼」——
  前置閘找的是**三參數**,它還在 ⇒ 過閘 ⇒ `:82` `CREATE OR REPLACE` **蓋掉**那支手建的 ⇒ 收斂到同一結果。**沒有縫。**

## 🔴 R1 標「證不到」的三件 —— 哪一件推得動

1. **正式庫活定義** ⇒ **推不動**(需 `readonly-prod-sql.sh`,唯讀審查員沒有)。**標:未核。**
2. **拋棄式 PG 五行實跑** ⇒ **推不動**(要真的起 PG 套 migration)。**標:未核。**
3. **PostgREST 對「板已貼、舊碼只送三個 key」的解析** ⇒ **往前推了一步,仍非實跑。**
   `20260917120000:30-33` 檔頭逐字把它當作 `DEFAULT NULL` 的**設計理由**;
   而 `CLAUDE.md`〈Git〉逐字記著**反向那半的實錘事故**(「2026-09-16 板 199 出貨五支 RPC 改簽章 … 必填參數沒送,PGRST202」)
   ⇒「必填參數沒送 ⇒ PGRST202」在本 repo 是**量過的**;`DEFAULT` 把它變成「有得填」,
   那是 **PostgreSQL 的函式解析**而不是 PostgREST 的自由心證。
   ⇒ **標:推論,佐證增強,未核。**

---

## 收尾

**FAIL · must-fix 4(F1 / F2 / F3 / F4)· consider 4(C3~C6)· nit 2**
🛑 `20260917120000` **仍未貼**。
🔴 **鐵則 12 逐字:「R2 還有 must-fix ⇒ 不跑 R3,停下端 Sean」⇒ 本輪到此為止,由主視窗端 Sean。**
🔴 R1 與 R2 是**同一顆模型**。F2 那條(改既有函式簽章對兩道部署時序閘都隱形)是**跨層結論**,
建議 09-20 codex 額度回來之後**拿這一片當第一發**去複核 —— 那才是真的第二視角。

**WOULD-CHANGE-MY-VERDICT**:F2 選甲(PGRST202 fail-soft)+ F1/F3/F4 三處字面與斷言改掉
⇒ 四條都清 ⇒ 可翻 PASS-with-comments(C3~C6 留在貼板尾註)。
