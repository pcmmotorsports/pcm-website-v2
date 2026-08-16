# `V-020` 折後版 · 兩份獨立審查 findings + 一次我自己的假紅自證

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
- 現況 `bash scripts/b1b-acceptance-harness.sh` ⇒ **通過 30 格 / 失敗 0 / rc=0**(A14 三格拆除後)。
  ⚠️ **這個 30 格全綠【不代表這批可以 commit】** —— 上面 13 條就是它看不到的東西。
