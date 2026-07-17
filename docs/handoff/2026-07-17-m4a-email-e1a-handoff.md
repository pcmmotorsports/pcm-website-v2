# M-4a Email 片 E1a 收工交接(2026-07-17,實作視窗)

> 寫者:E1a 實作視窗(Claude Code)。**下一個視窗的完整開工依據。**
> 入口鏈:`STATUS.md` → 本檔 → **plan v3.1**(真權威)→ migration 檔本體。
> ⚠️ **值班審查台目前沒開**(Sean 07-17 明說)→ 硬閘的驗證步驟**沒有人接**,見 §3。

---

## 1. 一句話現況

E1a(`email_outbox` migration)**code 已收工 commit `a240fe7`**;**未 push、migration 未 apply**。
Sean 已要 db push 指令(§4)。**下一片=E1b(port/adapter)**,但 E1b 依賴 E1a 已 apply。

## 2. 真權威(順序,不可跳)

| 檔 | 內容 |
|---|---|
| **`docs/specs/2026-07-16-m4a-email-notify-plan.md`** | **plan v3.1 = 唯一真權威**。🔴 **E1b/E2a/E4 開工前必讀 §3.4 / §3.5-1 / §3.5-3 / §3.6 / §4 / §7 / §9**。⚠️ **未標 v3.1 的段落 = v2/v3 原字面、僅供追溯決策脈絡**;凡與 v3.1 節次或 migration 衝突 → **以後者為準** |
| **`supabase/migrations/20260717020000_m4a_email_outbox.sql`** | schema 真權威(plan §4 的 SQL 區塊**已被它超越**)。頭註 §①-§⑧ 是設計決定;**§⑦ = REQUIRED-E2a 硬合約**;檔尾 = 總則 A/B + 斷言 0-13 |
| `~/.claude/.../memory/project_m4a-email-e1a-decisions.md` | Sean 07-17 四拍板 + schema 決定 + REQUIRED 合約 + 模擬陷阱 |
| `~/.claude/.../memory/project_m4a-email-notify-decisions.md` | Sean 07-16 拍板(Q1/Q2/Q4 + S1/S2/S3/S4) |
| `~/.claude/.../memory/feedback_claimed-sync-but-only-patched-touched-lines.md` | 🔴 本片實錘教訓,**動合約前必讀** |
| `docs/handoff/2026-07-16-m4a-email-notify-plan-r2-kickoff.md` | ⚠️ **§5 拆片表與 §7 部分字面已被 E1a 實作超越**,不可直接照做 |

## 3. 🔴 E1a 放行三步 + 值班台缺位問題

**原定硬閘**:①Sean `db push` → ②值班台 prod 交易模擬 → ③才准推。
🔴 **但值班台視窗現在沒開** → **步驟 ② 沒有人接**。下個視窗**必須先向 Sean 確認**要走哪條:
- (a) 下個視窗自己跑 prod 驗證(**但這違反「驗證不自驗」**——E1a 是本視窗寫的;不同視窗=fresh context,可視為獨立,需 Sean 認可)
- (b) 等值班台開再驗(E1b 卡住不動工)
- (c) Sean 自己在 SQL Editor 跑 §5 的驗證清單
**不得因為「值班台沒開」就默默跳過 ②**(kickoff 檔曾把「審查台在線」當事實而誤判,同一個坑)。

### 3.1 db push 本身的安全性(可放心的部分)
migration 內建 DO 4a-4g fail-closed 斷言。Fable 以拋棄式 PG 實測:**故意加第三方角色 defacl → 4e 準確 RAISE → 整個 txn 中止、表零留痕**(不是留半套)。
→ **db push 的最壞情況 = 當場乾淨失敗、補一句 REVOKE 重跑**,不會留下半套 schema。

### 3.2 🔴 驗證的兩個致命陷阱(檔尾總則 A/B;照舊字面跑會出事)
1. **本檔自帶行首 `BEGIN;`/`COMMIT;`** → **不可外包一層 `BEGIN … ROLLBACK`**:內部 COMMIT 會把外層交易**真的提交**、最後 ROLLBACK 退不了 = **prod 留痕**。
   - 路徑① apply 前模擬 = 須**手動剔除自帶 BEGIN/COMMIT**(保留 `SET LOCAL lock_timeout`)。
   - 路徑② **db push 後驗收**(= 本次走這條)= 表已存在;寫入型斷言用合成資料包 `BEGIN…ROLLBACK`,**ROLLBACK 後表必須仍在**;「零留痕」只指**資料**。
2. **建 FK 會對 `orders` 取 SHARE ROW EXCLUSIVE、鎖到交易結束** → **不可開著 txn 人工逐條核**(會擋住真實結帳建單)。已加 `SET LOCAL lock_timeout='3s'` fail-fast(每次取鎖各自計時、非整支上限;Fable 實測 3.03s 砍掉)。
3. **雙 session CAS(斷言 7/7c)在 rollback-only 腳本內物理不可行**(未提交列對另一 session 不可見)→ 移 disposable DB。
4. **FK 不可用「DELETE order 預期 foreign_key_violation」驗**(orders 另有 5+ 張表 FK → **假通過**)→ 查 `pg_constraint.confdeltype='r'`。
5. **預期報錯型斷言各自包 SAVEPOINT / DO…EXCEPTION**(否則第一個錯誤即 25P02,其後全回 aborted = 驗證結果全是垃圾)。

## 4. Sean 手動指令(db push)

⚠️ `.env.local` 存在 → 撞已知阻擋(memory `reference_supabase-cli-reads-env-local-blocker`)→ 須暫移開、**跑完務必還原**。

**步驟 1(可選但建議)— SQL Editor 唯讀探針(= 斷言 0)**:見 §5.0。
**步驟 2 — Terminal db push**、**步驟 3 — 還原 .env.local**:見對話中給 Sean 的 code block(本檔不重複,避免字面漂移)。
指令原則:zsh 環境、**命令內禁 `#` 註解、禁全形標點**、多步驟 `&&` 串接。

## 5. db push 後的驗證清單(路徑②;權威版在 migration 檔尾斷言 0-13)

> 下列為**摘要**;逐條字面與 SQL **以 migration 檔尾為準**(本檔不複製,避免兩處漂移)。

- **5.0 斷言 0(建議 db push 前先跑,唯讀)**:`pg_default_acl` 探針(含 `defaclobjtype='r'` + namespace 過濾 + `aclexplode` 展開)。
  🔴 **判讀 carve-out**:**defacl 定義者自身的 self-entry 是正常的、不要對 owner 補 REVOKE**(Fable 實測 `defaclacl` 幾乎必含 `postgres=arwdDxtm/postgres`)。真正要看的是「扣掉定義者自身後,被授權者是否只有 anon/authenticated/service_role」。
- **5.1** 表存在、16 欄、`next_retry_at` NOT NULL 生效。
- **5.2** 10 CHECK(含 **6 態全可寫**〔⚠️ 寫 `sending` 必須連帶 `claimed_at=now()`,否則撞雙向 CHECK = **預期行為**、不是 status_check 壞掉〕、雙向 claimed_at 兩個方向、`last_error_code` 格式)。
- **5.3/5.4** RLS enabled + zero-policy;ACL 終態(anon/authenticated 7 權限全 false;service_role 恰 INSERT/SELECT/UPDATE;aclexplode 全 allowlist;欄級 attacl 全空)。**建議再獨立查一次**(DO 與斷言共用假設,獨立查才抓得到「DO 本身寫錯」)。
- **5.6** 唯一鍵:同 `(order_created, <order_id>)` 第二筆 → unique_violation;**但** `(order_shipped,'批A')` 與 `(order_shipped,'批B')` **兩筆皆須落地**(= S2=B 不被誤擋)。
- **5.8** FK:查 catalog `confdeltype='r'`(**不要用 DELETE 測**)。
- **5.9/9b** 5 支具名索引 + PK = 6;indexdef **語意等價**比對(⚠️ 不可逐字:pg_indexes 會 render 成正規化形)。9b = failed 雙義實證。

## 6. 下一片 E1b 的硬合約(**不是建議,漏做會出事**)

- **REQUIRED-E1b**:
  - `payload` 走**顯式 key/型別 allowlist 組裝**、**禁任意 DTO spread / 禁 `...order`**。
  - `subject` 只由**固定模板 + display_id** 組,不夾客戶欄。
  - `last_error_code` 走**有限內部錯誤碼 allowlist**,未知一律映射 `provider_error`;**禁由任意 `.message` 轉碼**。DB 的 regex 只是**格式 backstop、不是 PII 物理閘**(小寫英數底線的 email local-part 仍可通過)。
  - 負向測試:塞含 email/phone 的物件必須被**組裝層**擋掉(不是靠 DB)。
- **假信箱 gate**:import `LINE_SYNTHETIC_EMAIL_DOMAIN`(`apps/storefront/src/lib/auth/line.ts:38`)**單一來源比對 + 正規化**;**禁複製字串字面**;**否決 MX 即時查詢**。命中 → `status='skipped_no_real_email'`、不呼 Resend。
- **storefront service_role 邊界**:走 **line-admin 式 server-only 模組**(檔內鎖死 + 受控 eslint 例外註解 + client bundle grep 驗證),**禁裸 import**(`packages/adapters/src/supabase/client.ts:56` 字面正是禁令)。
- **Resend adapter**:`Idempotency-Key = <event_type>/<outbox_id>`(官方保留 24h < 重試總跨度 → **DB 唯一鍵 + `sent` 狀態不可省**)。現有 `EmailAlertNotifierAdapter.ts:35-47` headers 只有 Content-Type+Authorization = 尚無此 header。
- **env**:`ORDER_EMAIL_FROM=orders@pcmmotorsports.com` → ⚠️ **storefront + admin 兩個 Vercel project 都要設**;新信箱是否免重驗網域 = **未確認**,實測後才寫死。

## 7. E2a 的硬合約(先記著,E1b 時不要衝突)

- **REQUIRED-E2a**(全文見 migration §⑦ + plan §3.6):
  1. due 述詞**與 CAS 述詞都**須含 `attempts < max_attempts`(**CAS 才是原子決策點**;plan §3.5-1 引的 CAS 字面**不含 guard、照抄即踩**)。
  2. 認領必寫 `claimed_at = pg_catalog.now()`。
  3. 🔴 **每一句離開 sending 的 UPDATE(mark-sent / mark-failed / lease 回收)必須同時 `claimed_at = NULL`** —— Fable 實測:漏這條 → **每次 mark-sent 都 check_violation** → 信已由 Resend 送出、列卻卡 sending → 回收 → 重認領 → **系統性重複寄信**。
  4. 轉入 `skipped_order_ineligible` 必寫 `last_error_code='order_ineligible'`(該態零訊號零對帳補救,誤判即無聲漏信)。
- **dead-man = 四訊號**(跑**獨立管道** anomaly-alert daily cron、**不可放進 sweeper 自己**):
  ①pending 堆積(排程死;**須排除死列**)②dead letter `status IN ('pending','failed') AND attempts >= max_attempts`(**必須含 pending** = 回收後隱形死列;**必須排除 sent** 否則第 5 次才成功的列永久假告警)③stale sending ④🔴 **paid 但無列**(直接查 orders 的 `NOT EXISTS`;前三者共同盲區)。
- ⚠️ ~~**E2a 定案「attempts 遞增時機」與「回收落 pending 或 failed」時,必須回頭過訊號表**(兩者交互決定第四種死法是否存在)。~~
  ✅ **本義務已由 E2a-a 履行(2026-07-17)、本行為歷史**:定案=attempts **認領時 +1** × 回收落 **`failed`**(Sean Q2=A)→ **零盲區**、第四種死法 `pending@max` **不可達**(訊號 2 仍保留 `pending` 分支當縱深)。**權威=migration `20260717020000` 頭註 §⑩**(⚠️ 本檔上方「四訊號」字面亦已被 §⑨ 超越為五訊號)。

## 8. E3 / E4 前置(別忘)

- **E3 前置**:🔴 **親驗全部 paid transition 發生地**(不只一處;**3DS late-success / settle-sweep 補結 = 實際存在的晚翻 paid 路徑**)。plan §3.3 已代偵察出三處(`charge-actions.ts:272-286` / `settle-charge.ts:271-291` / `confirm_payment_rpc.sql:177-184`)**但仍須親驗、不得憑 plan 字面直接寫**。文案 = L2,**寄出前字面給 Sean 過目**。
- **E4 前置**:偵察「一批」定義(讀 admin 出貨 UI 與 action 本體,確認能否一次出多項)+ 定 `dedup_key` 算法。
  🔴 **算法硬約束**:唯一鍵是 `(event_type, dedup_key)`、**不含 order_id** → dedup_key 必須在同 event_type 內**全域唯一**(用 per-order 序號會跨訂單誤擋 = 漏信)。`request_id` **不可直接當 key**(雙擊 = 兩 id 兩封)。候選 = item id 集合排序後 hash(item id 全域唯一 → 天然滿足)。
  ⚠️ `order_shipped` 亦須有**對等的訊號 4**,否則同一個洞在出貨線重演。

## 9. Sean 手動項全清單

①db push E1a(§4)②(E2b 時)Dashboard 啟用 `pg_cron`+`pg_net` ③(E2b 時)SQL Editor 跑 `vault.create_secret`(**值不進 git 不進對話**)④Vercel 設 sweeper secret(與 Vault 同值)⑤**兩個 project** 設 `ORDER_EMAIL_FROM` ⑥E3 文案字面過目 ⑦肉眼驗 E3/E4 ⑧手動 push。
**部署順序(不可調)**:E2a 先部署 → Vercel 設 secret → Vault 寫同值 → db push E2b → 驗 cron/Vercel/ACL/無 header 回顯 → 才准 E3。

## 10. Sean 待決策(現存)

- **③ Email S4 ACL**(非必拍):採 GRANT service_role(Fable 裁)而非 RPC-only(codex 裁)。**Sean 未否決 → 照 Fable 執行**;⚠️ **這不是「Sean 主動選了 GRANT」**,他隨時可否決。
- **① Vercel 升 Pro?**(與本片無因果):Hobby 禁商業用途、PCM 賣場已命中、$20/月 = 既存合規風險。Sean 已知悉未拍。
- **④ LINE 補資料獨立線動工前**:真實 email 存哪、如何與 auth.users 同步、如何不破壞既有 LINE 防冒登入設計。
  🔴 **Q1 線紅線**:兩個 `skipped_*` 態語意相反 → Q1 的 UPDATE **必須寫死 `status='skipped_no_real_email'`,嚴禁 `LIKE 'skipped%'`**(否則把已退款訂單的付款成功信寄出去)。

## 11. 本片教訓(下個視窗別再犯)

- 🔴 **「已同步 plan」我講錯三次**(memory `feedback_claimed-sync-but-only-patched-touched-lines`):根因 = 只改剛動到的那幾行就宣稱同步。**動合約前先 grep 全檔建舊字面清單、逐條銷完才准說已同步。**
- **自指行號不要寫死**(8 輪增補漂移三次)→ 用 `grep -n` 當場取。
- **寫「已在 backlog」前先驗編號真的存在**(本片踩過:引用了不存在的 #281;補開時又把 LINE 補資料錯標成 #284,read-back 才抓到)。
- **我對「怎麼驗」的把關明顯弱於「怎麼寫」**:8 輪裡 SQL 本體幾乎沒被推翻,但我寫的驗證步驟被抓出「會留痕 / 物理做不到 / 假通過」三次。**驗證步驟出錯比 code 出錯更危險 —— 它讓錯誤帶著「已驗證」的標籤過關。**

## 12. Working tree / 紀律

- 本片 commit = `a240fe7`(3 檔:migration + backlog #281-#284 + STATUS 7 欄)。**未 push**、**migration 未 apply**。
- 既有凍結 dirty(`.gitignore` / `*.png` / docs 群 / `docs/superpowers/`)**未動,接手不得 reset/stash/混入 commit**。
- plan v3.1 在 **pcm-tools repo**(不在本 repo)→ 該 repo 的改動**未 commit**,下個視窗若要 commit 它須另外處理。
- codex 五輪全程 `-s read-only`,跑前後 porcelain 比對**零留痕 PASS**;Fable 三輪皆用拋棄式 PG、跑完銷毀、repo/prod 零接觸。

— E1a 實作視窗(Claude Code),2026-07-17
