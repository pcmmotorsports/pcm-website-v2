# R2 對抗審查 · `20260917010000_m4b_pcm_readonly_grant_four_tables.sql`

> 2026-09-17 · 設計窗(session `pcm-website-v2-36`,worktree `/Users/sean_1/pcm-design`)
> 引擎:專案 `.claude/agents/adversarial-reviewer.md`(opus)。
> **codex 額度用完到 09-20 12:12 ⇒ 本輪走 adversarial-reviewer 替身**(鐵則 12 / 記憶 `project_0911-codex-quota-fable-as-second-review`)。
> R1 = FAIL 4 條(M1 / M2 / M3 / M4,已修)。本檔記 R2。

## 結論

**R2 FAIL(must-fix 4 條)** ⇒ 四條**已全部修完**(修法全在檔頭註解,**零行 SQL 變動** —— `git diff` 新增 50 行全是 `--` 開頭,刪 1 行是被更正的引用)。

🛑 **鐵則 12:R2 還有 must-fix ⇒ 不跑 R3,停下端 Sean。**
而 **M-B 那一題本來就要 Sean 拍**(他沒被問過那一張)⇒ 兩條路同一個出口:**端 Sean**。

## must-fix 四條(每條附修完的檔:行)

| | findings | 為什麼是真問題 | 修在哪 |
|---|---|---|---|
| **M-A** | 貼完漏了 **ACL 漂移帳本**那一步 | `20260909060000…:133` 把 `pcm_readonly` 加進 REL 族偵測射程 ⇒ 本片四發 GRANT **必定**改變 digest ⇒ 當晚 cron 冒出一筆沒人認領的漂移;而未批准訊號**第三天自己消失**(view 只取最新兩列)⇒ 帳本從此顯示「沒漂移」,那筆變更永遠沒被批准過。並牴觸 Sean 2026-09-14 拍甲。 | 本檔 `:79-91`〈貼完要做的事〉第二步:`pcm_acl_digest_record()` → `pcm_acl_approve_latest(...)` → 看 `pcm_acl_drift_status`,**順序不能反** |
| **M-B** | 四張裡的 `pcm_net_exposure_snapshot` **自己帶著 `no-grant-needed` 標記**,而檔頭一個字沒提 | 檔頭花一整段用「`no-grant-needed`」的理由拒絕動 `pcm_incident`,**同一把尺對第四張沒套上去**。貼完之後 `20260908030000:105-107` 那三行字面在活的庫裡就是假的。 | 本檔 `:65-84` 新增一整段,**標成待 Sean 拍** |
| **M-C** | 行號引用錯一處 | `:40-43` 其實是 `supplier_sync_runs` 的欄位清單;真正記那件事的是 `:33-35`。**兩段我開檔逐字核過**。本檔全部價值就在「引的行號可以核」,錯一個會連帶讓人不信旁邊真的核得動的那幾條。 | 本檔 `:98-100`(改成 `:33-35`,並把更正過程留著) |
| **M-D** | M2 那段缺一個**承重的事實:誰拿得到 `pcm_readonly`** | 讀完 `:1-27` 只會得到「自由文字 + 外人寫的 + Sean 說要看得到 ⇒ 給」,看不出承重腳是「鑰匙只在施工窗手上」⇒ 三個月後有人會把**客人 PII** 的題目套進同一個結論。 | 本檔 `:28-37`(④ 誰拿得到鑰匙 · ⑤ 這一次不涵蓋什麼) |

## 🛑 要 Sean 拍的那一題(M-B)

```
Q:板 20260917010000 要 GRANT 的四張裡,pcm_net_exposure_snapshot 這一張
  自己在 20260908030000:105-107 帶著「刻意不給任何人 / 不該有 GRANT」的標記。
  而同一支檔的表 COMMENT :102-103 又說「pcm_readonly 是否讀得到【未確認】」
  ⇒ 作者留成未決,不是禁止。你 09-17 只被問過 supplier_inbound_emails 那一張。

A: 甲 = 這一張【不給】,四張砍成三張(最保守,而首頁大圖那條路不受影響)
   乙 = 這一張【照給】,四張不變 + 同一顆 commit 順手更正 20260908030000 那三行
        過期字面(推薦 —— 它本來就是「量曝露面」用的,而讀它的人正是稽核者)
```

## nit(沒修,留給下一輪或下一個人)

- `:284`(原號)NOTICE 把事後閘③ 算成「有判別力」,而它在本檔四行具名 GRANT 的形狀下也是恆綠絆線 —— 分類跟旁邊自己立的那把尺不一致。
- 事後閘④ 的 EXCEPTION 訊息沒列「grantor 猜錯」這一種,猜錯時操作者會去找一個不存在的多餘授權。
- 還原前置閘 `<> 4` 只數 `SELECT`,射程比它自己宣稱的窄(有人給 INSERT 不會停);後果良性。
- 「不在分母裡」那份清單漏了**角色屬性變更**(`ALTER ROLE … BYPASSRLS`)與 **RLS policy 變更**——該段自帶「不保證完整」免責。
- 檔頭把 NOTICE 當「唯一的人眼證據」,而 `docs/runbooks/2026-08-18-apply-sheet-for-sean.md:189` 已記「不知道 Supabase SQL Editor 會不會顯示 NOTICE」。
- `:1-27` 那句「這一段不是通行證」**擋不住下一個人** —— 證據就在本檔:`:49-55` 同一族的純文字警告,11 天後沒擋住同一個作者。沒有便宜的機制可用,所以只記 nit,但別高估它。

## 🔴 核不到的(一筆都沒核,不當成通過)

檔頭所有**正式庫唯讀讀數**:存在 4/4 · 表級全 `f` · 欄級 0 筆 · `rolbypassrls=t` · `pg_auth_members` 0 筆 · `orders`=`t` · `pcm_incident`=`f` · `public` 72 張 / 讀不到 11 張(9+2)· 全庫 9 筆欄級 · RLS 7/7 · 86 筆。
審查者在 worktree 沒有連線也不該連。📌 **這些數字目前只有作者的記述,`docs/evidence/` 底下沒有 2026-09-17 的存檔。**
⇒ 建議貼之前把那一發查詢的輸出存成 `docs/evidence/2026-09-17-…`,不然三個月後的人仍然核不動。(**推薦,而不是 must-fix。**)

> ✅ **2026-09-17 後記:主視窗批了,已補。** `docs/evidence/2026-09-17-pcm-readonly-four-tables-before.md`
> —— 用 `pcm_readonly` 本人那把鑰匙唯讀實撈,**檔頭 13 條帶數字的宣稱逐條對過,13 條全對**,原始輸出逐字留著,
> 重跑命令與 `.sql` 都在同一個資料夾。⇒ 📌 **上面那段「一筆都沒核」從此有解:核得動了。**
> 🔴 而那一發順手撈到檔頭沒寫的一件:`pcm_incident` 與 `pcm_settle_retry_attempts` 的 policy 數**也是 0**
> ⇒ 那三張今天讀得到列**都只靠 `rolbypassrls`**,不只 `pcm_net_exposure_snapshot` 一張(已補進檔頭)。

## 試著擊破而沒破的(下一輪不必重攻)

- **R1 M1(還原帶閘)真修**:還原前置閘要求「四張上剛好本片那四列、零欄級」⇒ **繞開**了「表級 REVOKE 會不會連帶收欄級」那個未核問題;還原事後閘抓得到「REVOKE 靜默無效、離開碼 0」。
- **R1 M3(裁掉 9 筆閘)方向對**:三條理由逐條攻過都站得住(count≠組成 / 假紅定時器 / 四行表級 GRANT 物理上改不了 attacl)。⚠️ 而 `:235`「已經完全涵蓋它」是**過度宣稱** —— 事後閘④ 是交易內差集,證「本片沒動欄級」;被裁那道是對絕對基線。**不建議加回來**(那是 M-A 那道帳本的工作)。
- **事後閘④ fail-closed 是真的**:grantor 猜錯 ⇒ 差集非空 ⇒ RAISE ⇒ 整筆回滾。
- **型別在 `EXCEPT` 兩邊對得上**;**還原閘 `acldefault('r')` 與正向 `CASE relkind` 的不一致不會咬人**(四張都是 `relkind='r'`,逐張開檔核過)。
- **前置閘順序正確**:角色在 → 表在 → 才用 `::regrole` / `has_table_privilege`。
- **`WITH GRANT OPTION` 與「別的 grantor 也給一份」兩條路,還原前置閘都擋得住**。
- **PG 版本沒有不吻合**:`aclexplode` / `acldefault` / `regrole` / `to_regclass` / `pg_auth_members` / `rolbypassrls` 在 Supabase PG15/17 全在;`pg_parameter_acl` 只出現在註解沒被呼叫。
- **`:82-83`「被包在外層交易裡原子性是假的」宣稱正確**,而檔頭「單獨貼」已把剩下風險關掉。
- **另外兩張目標沒有 M2 那族問題**:`shipment_order_ship_clearances` 只有 uuid/enum/timestamptz,零自由文字零 PII;`pcm_net_exposure_snapshot` 的 `details` 是自家 probe 寫的 ACL 讀數。
- **`:7` 與 `:42-43` 兩處行號引用逐字正確**(`20260916150000…:97` 的 status CHECK、`20260905290000…:146` 的 `no-grant-needed`)。

## 跑過的驗證

```bash
bash scripts/migration-static-checks.sh supabase/migrations/20260917010000_m4b_pcm_readonly_grant_four_tables.sql
# ⇒ 八道全過(2026-09-17 實跑)
git diff -U0 -- supabase/migrations/20260917010000_… | grep '^+' | grep -v '^+--'   # ⇒ 0 行(零 SQL 變動)
```
⚠️ **靜態檢查不驗行為**;而本輪修的全是註解 ⇒ 行為本來就沒動。
