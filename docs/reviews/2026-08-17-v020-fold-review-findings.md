# `V-020` 折後版 · 兩份獨立審查 findings + 一次我自己的假紅自證

> 🔴🔴 **引用前必讀:三方看過的是【論證】,不是【數字】。**
> 本檔出現的 `32 格`、`30/1`、`31/1` 等突變數字,**目前是 B 窗單方面的量測** ——
> codex R1/R2 自標「唯讀環境建不了叢集,未重新採信」;V 窗 R3 明說「不進 B 的樹撞叢集」。
> ⇒ **報告若寫成「經 codex 兩輪 + V 窗 R3」,讀的人會以為數字也被驗過了。沒有。**
> 📎 這是今晚母題的近親:**「什麼都沒有」被讀成「檢查過了」/「很多人看過」被讀成「都驗過了」。**
> **要用那些數字請自己重跑**:`sh scripts/run-rc.sh 25 -- bash scripts/b1b-acceptance-harness.sh`

- **日期**:2026-08-17 02:xx(`date` 實跑,交叉源見下)
- **靶**:`pcm-products` 分支 `products` 的**未 commit** diff
  (`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql` + `scripts/b1b-acceptance-harness.sh`)
- **兩份審查**:
  | 來源 | 性質 | verdict |
  |---|---|---|
  | `~/pcm-mailbox/V-023-STOP.md` | V 窗 Fable 讀碼 + 拋棄式 PG 17.10 實測 | **FAIL 2 must-fix** |
  | codex `gpt-5.6-sol` xhigh `-s read-only` | 獨立模型 + PG17 官方文件查證 | **FAIL 9 must-fix / 2 nit** |
- 🔴 **狀態:兩份都 FAIL ⇒ 這批【不 commit】。** 檔案留在工作區,未推、未 apply。

---

## ✅ 三方獨立吻合的一條(本輪寫得出「已驗」的就這 1 條,比例見下)

> **數法**:本檔標 `must-fix` / 待折的條目 `grep -c '^| [0-9]' docs/reviews/2026-08-17-v020-fold-review-findings.md` ⇒ **10**
> (A 表 7 + B 表 3);而寫成「已驗」的只有本節這 1 條。**10 : 1 是本輪的真實比例,不要只讀這一節。**

**移除本體的 `has_table_privilege(…,'UPDATE')` 那一行是安全的** —— `has_any_column_privilege` 嚴格蘊含它。

| 來源 | 方法 | 結論 |
|---|---|---|
| codex | PG17 官方 `functions-info.html` / `ddl-priv.html` 逐字 | 整表持權或任一欄持權都回 `t` ⇒ 蘊含成立 |
| V 窗 | 拋棄式 PG **17.10** 實測 **4 個世界**(含零欄位表邊界 W4) | 表級授權全回 `t` ⇒ 蘊含成立 |
| B 窗(我) | ~~A14u 那一格~~ | 🔴 **作廢,見下方「我自己的假紅」** |

⚠️ **三方裡有一方(我)的證據是壞的,而結論仍成立** —— 這正是「理由錯而結論對」。
**引用時請引前兩者,不要引 A14u。**

---

## 🔴 我自己的假紅(本輪最該被記住的一條,codex `b1b:382` 抓到、我實測確認)

我加了 A14u/A14d/A14t 三格(授**表級** UPDATE/DELETE/TRUNCATE 給可達角色 ⇒ 期望本體報紅),
三格都紅了,我據此對主視窗宣稱「**A14u 是那次移除的實測依據**」。

**實測推翻**:把 DELETE / TRUNCATE 兩臂**整個改成 `false`** 重跑
⇒ **A14d / A14t 仍然全紅、33 格全綠**。
⇒ 它們紅的原因是斷言**後面**的 `v_extra` 白名單段,**不是那三臂**。

**機制**(這半值得記,它解釋了為什麼 A13 家族沒事):
```
表級授權 → 寫進 relacl → v_extra 看得到 → 永遠紅 → 測什麼都紅(假紅)
欄級授權 → 寫進 attacl → v_extra 看不到 → 紅確實來自欄級臂(兩發突變各只紅一格,已驗)
```
⇒ **三格已拆除**,原地留說明。**拆掉而不是標「已知假紅」的理由:假紅格比沒有格更糟**
—— 它讓下一個人以為那兩臂有負測覆蓋,而它連一次都沒真的測過那兩臂。

### 留下來的真問題(需要設計決定,B 窗不自己拍)
任何持有表級 DELETE/TRUNCATE 的角色都會被 `v_extra` 抓到
⇒ **那兩臂可能被 `v_extra` 嚴格蘊含**(與我剛移除的表級 UPDATE 行同一形狀)。
要嘛冗餘、要嘛守的是「`v_extra` 被改掉之後」的防禦深度 —— **兩個答案導向不同動作,我沒有證據選邊。**

---

## FINDINGS(未折,逐條保留;分成「我這次引入的」與「既有債」)

### A. 我這次 fold 引入的 —— **歸我折**

| # | 位置 | 一句 | 來源 |
|---|---|---|---|
| 1 | `b1b:392` | migration 註解把**已證偽的 `label` 情境**寫成永久立論;harness 已改 `created_at` 而 migration 沒跟上 ⇒ **同一顆 fold 兩份檔互相矛盾** | V-023 F1 / codex `nit` |
| 2 | `harness:269` | `A13b` 停在 **REFERENCES 世界**卻查表級 UPDATE ⇒ **恆綠格**、對照失去配對 | V-023 F2 / codex(**兩方獨立抓到同一條**) |
| 3 | `harness:210` | dollar tag **可合法重複**;來源若先出現另一個同名 block,awk 會抽錯段,而尾行檢查與所有 A13 格**仍可全綠** | codex |
| 4 | `harness:262` | 欄級前提**可被表級冒充**(`has_column_privilege` 對整表持權也回 `t`)⇒ 三個 grant 漂成表級仍過前提 | codex |
| 5 | `harness:221` | 註解宣稱「四臂由行為格守」而實際只有 UPDATE/UPDATE/REFERENCES ⇒ **DELETE/TRUNCATE 零專屬負測** | codex |
| 6 | `harness:249` | 第三種三格都抓不到的退化:**刪掉 `v_extra` 白名單段** ⇒ 三個欄級世界仍紅,而任意其他角色的表級授權不再受擋 | codex |
| 7 | `harness:232` | `A13e` 只證「抽出物可執行 + 乾淨世界不誤報」;**合法但缺斷言的片段仍綠** | codex `nit` |

### B. 既有債(**不是這次 fold 引入的**,b1b migration 本體既有)—— 建議立案,不混進這顆

| # | 位置 | 一句 |
|---|---|---|
| 8 | `b1b:343` | 🔴 **`MAINTAIN` 漏列** —— PG17 已把它列為 table privilege,而「恰好 `{SELECT,INSERT}`」的清單沒有它 ⇒ 直接授 `service_role MAINTAIN` 會通過斷言 |
| 9 | `b1b:291` | `authenticated` 只有欄級 `UPDATE(created_at)`/`INSERT`/`REFERENCES` 時,表級迴圈與只查 `SELECT` 的欄級迴圈**都會放過** |
| 10 | `b1b:315` | 非 `service_role` 且不可由它切換到的角色若只有欄級權限,`:456` 只讀 `relacl` 看不到 `attacl` ⇒ **違反「任何角色」的白名單宣稱** |

---

## 誠實邊界

- **13 條 findings 一條都還沒折。** 本檔只是把它們從一次性 CLI 輸出與信件落進 repo。
- codex 自標未確認:**唯讀環境不能建拋棄式叢集 ⇒ 第三發突變沒有實跑**(`bash -n` 與 `git diff --check` 已過)。
- 本輪所有綠都是**拋棄式 PG 樁**,不是 Supabase;`has_any_column_privilege` 在 Supabase 端**未實跑=未確認**。
- ~~現況 30 格~~ **已過期,見下方 R2 段的現況(32 格)。**

---

# 🔴 R2(2026-08-17 04:xx,codex `gpt-5.6-sol` xhigh `-s read-only`)—— **仍 FAIL**

**8 must-fix + 4 nit。** 我折了 9 條之後跑的第二輪,而**它打掉我兩個主張**。

## 逐條核對(codex 自己給的,比 findings 更值錢)

```
1＝部分折錯   2＝窄義成立   3＝有自己的世界但前提不足   4＝【不成立】
5＝成立       6＝三格確已拆,但「構造不出」【不成立】   7／8／9＝成立
```

### 🔴 被推翻的主張一:「A13b 守得住欄級前提被表級冒充」⇒ **不成立**(第 4 項)
> 只讓 A13c 或 A13d 漂成表級授權時,欄級前提仍為真、本體由 `v_extra` 紅、獨立 A13b 照綠,**整支仍全綠**。

📎 **形狀:我用「既有格守得住」取代了「新增一格」,而那個既有格的射程比我以為的窄。**
⇒ 待補:A13c / A13d **各自**需要「這個世界真的是欄級」的守門,不能共用 A13b。

### 🔴 被推翻的主張二:「DELETE/TRUNCATE 構造不出來」⇒ **構造得出來**(第 6 項)
> 讓一個 **SET-only 可達的普通角色成為表 owner**,撤掉一般權限後只授其中一項;
> `v_extra` **排除 owner** ⇒ **只有指定臂會紅**。(官方:owner 可撤自己的普通權限)

📎 **這是本 repo `feedback_unconstructible-negative-test-means-noop-guard` 的反向坑**:
**宣告「構造不出」之前要窮舉維度** —— 我只想到「授權給誰」,**沒想到「誰是 owner」**。
A14 之所以假紅,正是因為我把角色留在 `v_extra` 的射程內,而 **owner 恰好在射程外**。

## R2 findings(未折,逐條)

| # | 位置 | 一句 | 級 |
|---|---|---|---|
| 1 | `harness:~300` | A13c/A13d 的世界漂成表級 ⇒ 欄級前提仍真、A13b 照綠、整支全綠 | must-fix |
| 2 | `harness:314` | A13b 缺 `pg_has_role(...,'SET')=t` 前提;移除 membership 後表級查法因不可達而照綠 | must-fix |
| 3 | `harness:326` | A15 只守 **service_role 那一份**清單;anon/authenticated 那份漏 `MAINTAIN` 它不會發現 | must-fix |
| 4 | `b1b:394` | `pg_maintain` 以 **SET-only** 授給 service_role ⇒ 無 `relacl`、有效權限為假,而可達角色段**漏查 MAINTAIN/TRIGGER** | must-fix |
| 5 | `harness:242` | DELETE/TRUNCATE **可各自構造**(owner 法,見上)⇒「構造不出」不成立 | must-fix |
| 6 | `b1b:309` | `authenticated` 只有欄級 INSERT/UPDATE/REFERENCES 時,表級迴圈為假、欄級迴圈只查 SELECT ⇒ 放行(**R1 就有,仍未折**) | must-fix |
| 7 | `b1b:476` | 不可切換的 outsider 只有**欄級**權限時 ACL 在 `attacl`,A16 的**表級**世界抓不到(**R1 就有**) | must-fix |
| 8 | `b1b:360` | service_role 的 SELECT/INSERT 若帶 **`WITH GRANT OPTION`**,八項有效權限仍完全符合且 `v_extra` 排除它,**而它已能轉授** | must-fix |
| 9 | `b1b:318` | 漏掉任一函式對 service_role 的 REVOKE,函式迴圈只查 anon/authenticated ⇒ 仍綠 | nit |
| 10 | `b1b:63` | 版本斷言的錯誤訊息說 PG16「少查且沒人發現」不準:`MAINTAIN` 查詢**會直接報不支援** ⇒ 新斷言改善的是**錯誤位置與說明** | nit |
| 11 | `b1b:358` | 清單已是八項,**註解仍寫「七種權限」** | nit |
| 12 | `harness:56` | harness 未自行先擋 PG16 ⇒ 預期紅的格可能因**版本錯誤**而假裝命中,直到綠格才失敗;應 fail-fast | nit |

## ✅ R2 標為打不破的(5 項)

- `b1b:60` 版本斷言門檻正確,會**先於** `MAINTAIN` 查詢觸發(核對 PG16/PG17 官方權限表)
- `harness:214` 錨點唯一性:插入第二組同名錨點會在 `awk` **之前**中止
- `harness:334` A15 的 service_role MAINTAIN 世界**不會被 `v_extra` 代打**(但只守第二份清單)
- `harness:345` A16 的窄義紅**確實只能來自 `v_extra`**
- `b1b:410` / `harness:259` `created_at` 情境與 A13e 能力界限**均已如實更正**

## R2 自標未確認

> `30/1`、`31/1` 的實跑數字**未重新採信**;唯讀限制下未建立暫存 PG 叢集,
> 缺 fresh PG17 的逐突變執行與錯誤來源核對。已驗 `bash -n`、`git diff --check`、錨點 1／1。

⇒ **我的突變數字它沒有復現過** —— 引用時要知道那幾個 `30/1`、`31/1` 是**我單方面的量測**。

## 現況

```
sh /Users/sean_1/pcm-website-v2/scripts/run-rc.sh 20 -- bash scripts/b1b-acceptance-harness.sh
  ⇒ 通過 32 格 / 失敗 0 格 / rc=0
```
⚠️ **32 格全綠【不代表可以 commit】** —— 上表 12 條正是它看不到的東西。
🔴 **下一輪是 R3 ⇒ 依輪次紀律必須換角度、換模型**(同模型只會在同一個框架內找更細的問題)。
