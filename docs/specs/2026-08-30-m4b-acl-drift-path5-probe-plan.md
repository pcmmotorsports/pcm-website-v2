# ACL 漂移「路⑤」探針 — plan **v3(乙:只看對外那一面)**

> ## ⛔ **本方案【已否決,不是現行做法】**
>
> ```
> 2026-08-30，三輪對抗審查共 59 條 finding ⇒ 判定：這條路不通
> ✅ 現行做法在 docs/specs/2026-08-30-m4b-anon-reachability-probe-plan.md
> ```
> 📌 **而本檔留著的理由:它記著【為什麼這條路不通】——**
> **而那份現行的 plan 只寫了結論,沒有寫推導。**
>
> 🔴 **⇒ 下一個人若想「我們何不監看 ACL 目錄就好」—— 這 231 行就是答案。**
>
> ⚠️ **⇒ 而一個沒有留下否決紀錄的隊伍,會定期重新提出同一條路,**
> **而每一次都覺得自己想到了新東西。**

> 線A `-e9` · 2026-08-30 · 對應 `docs/launch-todo.md` ⟦b4-ACL1⟧
> 🔴 命中鐵則 12②③ ⇒ 🛑 **migration 一律不 apply。**
> 🔴 時刻是 sandbox 的 `date`,不是 Sean 那台的鐘。

## 🔴 第一行:**乙不是甲的縮水版**

> **分母小到可以窮舉 ⇒ 驗收可以要求【精確集合】,而不是「印出它」。**

而甲(全量對等)的第一版仍然可能因為分母沒對齊而漏報 ——
📌 **⇒ 而一個會漏報的 ACL 探針,比沒有探針糟:它會讓人以為有人在看。**

## 🛑 審查史(射程,先讀)
```
v1 152 行 → codex R1：21 條（20 must-fix / 1 nit）⇒ FAIL
v2 236 行 → codex R2：18 條 ⇒ FAIL，頭條逐字
   「『第一次快照全部 approved=false』造成的全庫告警洪水是 must-fix；
     目前不是可用告警」
🔴 兩輪 39 條【不重複】：R1 是「分母不夠」、R2 是「規格不夠」
   ⇒ 每一輪都在更外面一層 ⇒ 那不是收斂，是還沒觸底
   ⇒ ⇒ 依 00-work-rules 判停條件：不開 R3 補洞，【換範圍】
v3（本檔）= 換範圍後的重寫。需要新一輪審查（v3 尚未經任何對抗審查）。
```

---

## §1 範圍(**這一節就是這份 plan 的全部價值**)

```
只看三個 grantee：anon / authenticated / PUBLIC
只看一個 schema：public
```
⇒ **它答的問題是:「有沒有人把東西開給【外面】了?」** —— 那正是 `:313` 存在的理由。

### 分母(**窮舉,不是「等等」**)
```
① pg_class.relacl      relkind ∈ {r, p, v, m, S}   ← 明列，不留給實作者猜
② pg_attribute.attacl  欄級 GRANT
③ pg_proc.proacl       函式/程序 ← 身分含【完整參數簽章】（overload 不互吞）
④ pg_namespace.nspacl  只看 public 這一個 schema 的 USAGE
⑤ pg_default_acl       只看「會授予那三個角色」的預設權限
⑥ pg_auth_members      只看【那三個角色拿到誰的成員資格】
   （不是全表 —— 三個角色的 membership 是個位數，窮舉得完）
```
🔴 **NULL 語意(R1 #20,本片的主閘)**
```
relacl / proacl / nspacl 為 NULL ⇒ 【沿用內建預設】，不是「沒有權限」
⇒ 直接展開 NULL 得到零列 ⇒ 探針把「真正開放」印成「乾淨」
✅ 一律先用 acldefault(objtype, ownerid) 展開再比
📎 CLAUDE.md 路由表逐字「ACL 欄是 NULL 時 PUBLIC 看不見」—— v1 還是走進去了
```

### 🛑 明說答不出的(不假裝涵蓋)
```
· service_role 之間 / postgres 與其他內部角色之間的權限漂移
· public 以外的 schema（含系統 schema）
· 「這個 GRANT 是【誰】下的」（那要 pgaudit）
⇒ 這三樣列為後續，各自是獨立的一片
```

## §2 為什麼路⑤ 現在沒有人守(量到的)
```
scripts/acl-drift-gate.py --selftest ⇒ 82 PASS / 0 FAIL（我實跑）
  檔頭 :44 自列第一條盲區逐字：「路⑤:Supabase dashboard / SQL Editor
  / MCP apply_migration 手動 GRANT」—— 它讀 repo 的 index，路⑤ 不經過 repo
acl_snapshot ⇒ 全 repo 0 檔（沒有基準線 ⇒ 沒有東西比得出「變了」）
relacl 61 / has_table_privilege 76 / role_table_grants 30 檔
  ⇒ 逐一看落點：全是 migration 內的 apply 當下斷言（只響一次）或
    scripts/*-verify.sh（要人手動跑）⇒ 沒有一個是【持續在看】的
負對照 zzz_acl_e9 ⇒ 0
```
⚠️ 實錘:`product_fitments_effective` 七物件就是這樣進線上的,repo 零紀錄。

## §3 與 `:312` 的關係(v1 說錯,已改)
```
🔴 閘只擋【repo 新增的】ALTER DEFAULT PRIVILEGES 那一行；
   【既存的】default privileges 在單純 CREATE TABLE 時自動套用
   ⇒ 那支 migration 文字裡一個 GRANT 都沒有 ⇒ 閘全盲（codex R1 #12）
⇒ :312 與 :313 不是「有守 vs 沒守」，是【同一個盲區的兩個入口】
✅ 緩解（量到的）：20260817060000_e683_1_public_default_privileges_revoke.sql
   在，APPLIED.tsv 命中 1，內容 REVOKE ALL ON TABLES FROM anon / authenticated
   ⚠️ 同檔 :94 那行 GRANT ALL … TO anon 是【Rollback 段的註解】，不可執行
🛑 而「帳本說 apply 了」≠「正式庫現在真的是那樣」⇒ 本片的探針正好答這一格
```

## §4 客人踩得到嗎(分母六格,而我只有機制、沒有現況)
```
① 表級 GRANT ② 欄級 GRANT ③ schema USAGE ④ 角色繼承
⑤ RLS 開沒開 + policy 的【內容】 ⑥ view 的 security mode
🛑 這六格都在正式庫，我沒有存取也不該有
```
> **⇒ 寫法:「機制上踩得到,而【現在有沒有一張表真的這樣】未確認。」不升級成「所以會漏」。**

## §5 設計

### §5.1 baseline = **快照那一刻的實況**(不是「什麼是對的」)
```
🔴 這一句解掉 v2 的自相矛盾（R1 #1/#2）：
   baseline 不需要知道「什麼是對的」，它只需要知道「當時是什麼」
   ⇒ migration 不需要任何線上輸入，也不需要「先盤現況」當前置
```
```
表 pcm_acl.baseline
  主鍵：(catalog, object_identity, grantee, privilege)   ← R2：定主鍵與唯一鍵
  canonical identity 各目錄各自定義（函式含簽章、欄級含欄名）
  另存：owner / grantor / grant_option
  approved boolean NOT NULL DEFAULT false   ← 🔴 只是【給人看的註記】
  note text / captured_at timestamptz
```

### §5.2 告警 = **只噴差異**(解掉 R2 頭條的洪水)
```
第一天：baseline 剛建 ⇒ 差異 = 0 ⇒ 🔇 安靜
之後  ：有人在 dashboard 手改 ⇒ 差異 = 那一列 ⇒ 只噴那一列
```
🔴 **而「安靜」不等於「靜音」—— 那七個物件不准被吃掉:**
```
每日告警固定帶一行：preexisting = <approved=false 的列數> + 一個查詢指標
⇒ 不逐列（不吵），但每天都在（不靜音）
📌 「不吵」與「不靜音」看起來對立，而【一個數字 + 一個指標】同時買到兩邊
```

### §5.3 函式硬化(R1 #16/#17)
```
· 放私有 schema pcm_acl —— 🔴 不放 public（Data API 會曝露它，
  而日後 ACL 漂移會把 owner 權限重新暴露成遠端 RPC）
· SECURITY DEFINER + 釘 owner + SET search_path = ''（全名限定）
· 只 GRANT EXECUTE 給呼叫它的那一個角色；其餘兩道 REVOKE
  （照 docs/patterns/revoking-function-execute-in-supabase.md）
```

### §5.4 baseline 自身防竄改(R1 #14)
```
🔴 量具與被量的住在同一個世界：若平台預設給那三個角色對新表 UPDATE/DELETE,
   攻擊者可以【改基準線讓漂移消失】
✅ 表級 + 欄級 REVOKE 到只剩 owner，並在自帶斷言裡驗它
✅ 而 baseline 自己也進分母（探針監看它自己的 ACL）
```

### §5.5 交付切成兩片(R1 #3:v1 說「只動 3 檔」低估契約面)
```
片 A（本 plan）：migration —— schema + 表 + RPC + 自帶斷言
片 B（另開、另估）：App —— reader port / adapter+parser / domain metric /
                    anomaly use-case 告警判定 + 各自測試
🛑 ⇒ §6 的驗收【只涵蓋片 A】。片 B 的驗收在它自己的 plan（R2 指出 v2 兩片
   只在文字上拆開而驗收仍混在一起）
```

## §6 驗收(片 A;**精確集合,不是「印出它」**)

```
🛑 移除 v1 那條恆真格（R1 #7）：「acl-drift-gate.py --selftest 仍 82 PASS」
   —— 探針做對與探針【根本沒實作】兩個世界都印 82 PASS ⇒ 對本片零判別力
   （「沒弄壞既有的閘」是另一個宣稱，列在 §7 未回歸）

前置：每一發突變【各自一個交易，跑完 ROLLBACK】（R2：不得互相污染）
      每一發的期望值寫成【完整集合】，比對用集合相等，不是「有沒有印出來」

☐ migration 自帶斷言在拋棄式 PG 跑過（🔴 apply 成功 ≠ 斷言通過，兩者分開報）
☐ 主閘 · NULL：造一個 proacl IS NULL 而 PUBLIC 有 EXECUTE 的函式
   ⇒ 期望集合 = {該函式 × PUBLIC × EXECUTE}，一項不多一項不少
   （不做 acldefault 展開的實作在這裡會【綠】⇒ 這是本片最重要的一格）
☐ 表級 added：GRANT SELECT ON t TO anon        ⇒ 期望集合恰好一項
☐ 表級 removed：撤掉 baseline 有的一項          ⇒ 期望集合恰好一項
☐ 欄級：GRANT SELECT(col) ON t TO anon          ⇒ 期望集合恰好一項
☐ sequence：GRANT USAGE ON SEQUENCE s TO anon   ⇒ 期望集合恰好一項
☐ schema：GRANT USAGE ON SCHEMA public TO anon  ⇒ 期望集合恰好一項
☐ default：ALTER DEFAULT PRIVILEGES … TO anon   ⇒ 期望集合恰好一項
☐ 角色成員：GRANT <某角色> TO anon               ⇒ 期望集合恰好一項
☐ overload：同名不同簽章兩支，只動其中一支      ⇒ 只印被動的那一支
☐ 🔴 範圍負對照（乙的核心）：對 service_role 下一發 GRANT
   ⇒ 期望集合 = 空集合（本片明說不看它 —— 這一發證明「不看」是設計不是漏）
☐ 🔴 schema 範圍負對照：在 public 以外的 schema 下一發 GRANT TO anon
   ⇒ 期望集合 = 空集合
☐ 每一發都有【不做的世界】⇒ 期望集合 = 空集合
☐ baseline 防竄改：以 anon / authenticated 身分試改 baseline ⇒ 必須被拒
☐ 函式權限：anon / authenticated 的 has_function_privilege ⇒ false
   🔴 同一發【必須有負對照】：拿【該有權限】的角色去問 ⇒ 必須印 true
   —— 否則那個 false 可能只是【函式名打錯了】，兩個世界印同一個字
☐ 🔴 角色切換繞路：SET ROLE 後再試 ⇒ 仍不可執行（R1 #16）
☐ preexisting：baseline 有 N 列 approved=false ⇒ 摘要回的數字【= N】
☐ 三綠（片 A 只動 .sql ⇒ 依 slice-checkpoint §2.2a 走 SQL 語法守門）
☐ 新一輪 codex 對抗審查 findings 全清（v3 尚未經任何審查）
```

## §7 影響面
```
DB：新增 1 私有 schema + 1 表 + 1 函式；不改既有表/函式；零資料寫入既有表
排程：片 A 不新增 cron（片 B 才接既有 pcm-anomaly-alert）
客人：客人路徑無直接讀寫
  ⚠️ 而【營運告警的回歸】待驗（R2 #4）：新 RPC 若使共用 reader fail-closed，
     可能把既有付款異常告警一起打成 503 ⇒ 列進【片 B】的驗收
未回歸：「本片沒弄壞既有 acl-drift-gate」要另外驗，
        🛑 不得用它的 --selftest 當本片驗收
```

## §8 Rollback(R1 #5/#6)
```
🔴 不是「乾淨可逆」：DROP 會永久刪除 baseline + 人工 note + captured history
🔴「無其他物件依賴」是在物件尚未建立前的推論；未來若有 view/function 依賴它，
   DROP 會被 RESTRICT 擋住 ⇒ 不能預先寫成事實
✅ 順序（反序會先炸既有 anomaly cron）：
   ① 先回退片 B ⇒ ② 用【具名量具】確認 anomaly cron 仍綠
      （量具＝那支 cron 的最近一次執行紀錄有新的成功列，不是「看起來沒事」）
   ⇒ ③ DROP 前先匯出 baseline 並【驗匯出可還原】（R2：不能只寫「有匯出」）
   ⇒ ④ 再 DROP
```

## §9 🛑 邊界

### 🔴 之首:片 B 的「出口」押在一個【轉述、未量測】的旗標上
```
片 B 搭既有 pcm-anomaly-alert 送告警，而那條鏈的閘是 ANOMALY_ALERT_ENABLED
⇒ 該旗標為 true 是【Sean 回報】，不是我方量到的
   （apps/storefront/src/app/api/cron/anomaly-alert/route.ts:49 自陳
     出處是一份 mailbox 檔）
⇒ 旗標若是假的 ⇒ 做完一整片、驗收全綠、而它從第一天起就沒有出口
   ⇒ ⇒ 而它會在板子上被記成【做完了】
```
> **⇒ 上線前要有人量它一次;在那之前,本案只完成【偵測】那一半。**

### 其餘
```
· 🛑 migration 一律【不 apply】—— apply 是 Sean 的動作
· 本片選擇【偵測】，不處理【預防】；預防要改 Supabase 的角色設計，
  那是另一個量級的決定（R1 #10：不寫「路⑤ 在資料庫層擋不住」——
  角色權限【正是】資料庫層，那句話與下一句自相矛盾）
· 效度限制：本片在拋棄式 PG 驗；正式庫行為未驗（我沒有存取）
· 🔴 v3 尚未經任何對抗審查 —— R1/R2 審的是 v1/v2，範圍已經換過
```
