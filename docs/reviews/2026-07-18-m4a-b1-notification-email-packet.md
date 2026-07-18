# Codex Review Packet — M-4a 通知線 B-1:orders.notification_email 加欄

Mode: **唯讀審查,不要修改檔案。** 只回 findings / 風險 / 是否可 commit。

Repo: /Users/sean_1/pcm-website-v2 — **你無需 repo 存取**:本包 §6 自帶該 migration 的**逐字全文**(唯一 code 改動),另附規則摘錄與驗證輸出。

## 1. Slice / 目標

**B-1** = M-4a 通知線「訂單真 email」B 線第一片:對 `orders` 表 **additive 加一個 nullable 欄** `notification_email` + 格式 CHECK + COMMENT + fail-closed DO 斷言。
**零 backfill、零 RPC 接觸、零 RLS 改動、零 .ts 改動。**

- **真權威 plan**:`docs/specs/2026-07-18-b0-order-notification-email-prd.md`(B-0 PRD v3,**經三輪雙審**:codex R1 18 + R2 11 + R3 4 條、Fable R1 8 + R2 2 條,全數修畢;R3 判定 Fable PASS / codex FAIL(4 條部分落地已修);Sean 2026-07-18 拍 Q3=A 收案動工)。
- **內容分級**:鐵則 9 **不適用**(欄位存使用者 PII、非策展文案;UI 文案分級屬後續 B-3、PRD 已定 L2)。
- **重大改動判定**:命中 **鐵則 8**(schema → PRD 已由 Sean 批)+ **鐵則 12**(orders = 金流表 + migration/schema 硬觸發 → 即本包)。
- **本片為何 nullable**(關鍵設計約束,請重點審):B-1 當下 `create_order` RPC 尚未帶此參數(B-2 才改)→ 若此刻 NOT NULL,**每筆新單 23502 = 結帳全斷**。收緊成必填是 B-6 獨立片,且**不得用裸 `SET NOT NULL`**(會驗全部存量列;而回填合成值又撞本檔禁合成域 CHECK = 自相矛盾)→ B-6 採 cutoff 式 CHECK(`created_at >= 切換時戳`)。

## 2. 目前狀態(**已 commit、未 push、未 apply**)

```
branch      : dev
HEAD        : 5d90762  feat(schemas): B-1 orders 加 notification_email 快照欄+格式 CHECK [m-4a]
origin/dev  : 9694561  (本地領先 1 個 commit、未 push)
遠端 migration history 最新 = 20260717020000 → 本片 20260718120000 **尚未 apply**

本 commit 四檔:
  supabase/migrations/20260718120000_m4a_b1_orders_notification_email.sql   ← 唯一 code 改動
  docs/specs/2026-07-18-b0-order-notification-email-prd.md                   ← B-0 PRD v3(真權威)
  docs/reviews/2026-07-18-m4a-b1-notification-email-packet.md                ← 本包
  STATUS.md                                                                  ← 7 欄同 commit
(其餘 untracked/modified 為 Sean ownership 凍結檔,未混入本 commit)
```

⚠️ **時序誠實揭示(第一輪 Codex 指出、已更正)**:本包依鐵則 12 在 commit **前**產出,但第一輪 Codex 審查是在 commit **後**才回來 → 「是否可 commit」的 checkpoint 效力確實被弱化。commit **未 push、可 amend/追加**,故仍可修正;**本版審查問題已改為「是否可 `db push`」**。

⚠️ **本版為第二版(v2)**:第一輪 Codex 判 FAIL、3 條 must-fix,皆已修:
1. **PRD CHECK 合約未同步**(PRD §3.1 仍是舊版等值比對、與 migration 現行述詞不符 → B-3 若照 PRD 實作會放行 DB 拒絕的值 → 結帳 500)→ **已將 PRD §3.1 改為與 migration 逐字對齊的六條件全文,並在 §3.4 補齊逐條語意 + B-3 app 層鏡像義務(列為 B-3 驗收條件)**。
2. **本包狀態失真**(稱未 commit)→ 見上方。
3. **本包稱附「模擬 SQL 全文與原始輸出」實際只有摘要** → **§7 已補上兩段可重現的完整 SQL 與逐字輸出**。

## 3. 已完成的驗證(請核實這些宣稱與 §6 全文是否一致,不要照單全收)

| 項 | 結果 |
|---|---|
| 三綠 | typecheck **8/8**、lint **10/10**、build **N/A**(純 .sql + .md) |
| 交易模擬 ×3 | 單一 DO block(套 DDL → 斷言 → 結尾無條件 RAISE 回滾)。①10 條 PASS(述詞修正前)②**15 條 PASS**(現行述詞)③**`SIM_ALL_PASS_V3`**(加入 3b2 述詞內容核對後、四子項全過且未誤報) |
| 🔴 突變驗證 ×1 | 故意套**弱化版 CHECK**(移除 `^[!-~]+$`)→ DO 3b2 正確 RAISE `MUTATION_CAUGHT` = **證明該斷言真的殺得死「CHECK 被弱化但斷言仍過」的假綠**,非只是寫在那裡 |
| 零留痕(三輪皆查) | `residual_column=0` / `residual_check=0` / orders 仍 **30 筆 30 欄**;遠端 `schema_migrations` 最新仍 `20260717020000`(本片確實未 apply) |
| CHECK 表達式矩陣 | 純唯讀 SELECT **共 35 樣本、35/35 符合預期**(含 12 個重音/類 ASCII 對抗樣本) |
| 零接觸實證 | `create_order` 與 `confirm_order_payment` 定義**皆不含本欄字面**;orders 無使用者 trigger(0)、不在 realtime publication(0) |

**🔴 誠實標記(未驗,非宣稱通過)**:
1. 表級 ACL 套檔前後**逐項比對未做**(ADD COLUMN 依規格不改表級 ACL、風險低,但未實證)
2. 「套檔後真建一張新單」**未測**(需合成 auth.users + 地址 + FK 鏈)→ 併入 B-2 模擬
3. `lock_timeout='3s'` **實際超時行為未測**(未製造長交易競爭情境)

## 4. 前序審查(本包前已跑兩輪 code-reviewer)

**R1 = FAIL**,唯一 must-fix = 鐵則 12 Packet 未產(SQL 本體 0 must-fix)。其 8 個 nit 中**兩個是真縫,已修並重驗**:
- 🔴 **尾點 FQDN / 子網域繞過**:舊述詞等值比對 → `x@line.pcmmotorsports.local.` 與 `x@sub.line.pcmmotorsports.local` **會放行** → 改 `rtrim(lower(...),'.')` + `NOT LIKE '%.line.pcmmotorsports.local'`
- 🔴 **Unicode 空白繞過**:`btrim()` 只去 ASCII space、`[[:cntrl:]]` 不含 U+00A0/U+3000 → NBSP/全形/零寬空格**會放行** → 改 `~ '^[!-~]+$'`(只允許可列印 ASCII)

**R2 = FAIL**,3 條已修(即本包此版):
- Critical:前一版 Packet 宣稱「自帶全文」卻只貼核心段 → **本版 §6 貼逐字全文**
- Important:前一版 Packet **寫死了 migration 行數且與實際不符** → **本版一律不寫死自指行數**(自指數字每改一次檔就當場變假 = 結構性假字面來源;本專案已有多次前科。**實測補記:寫這條修正時我又寫死了一次新數字,改完 SQL 後它再度失效 —— 同款前科當場復發、已拿掉**)
- Important:硬拷貝座標目錄錯(`lib/email/` 應為 `lib/auth/`)→ **已改,並用全樹 grep 覆核「三處」計數成立**
- 另 R2 要求補的**重音對抗樣本已實測**:é/á/ü/ø/ß/西里爾 а/軟連字號/組合附加符號 **全擋**;`~`(0x7E)與 `!`(0x21)邊界**全過** → 關閉「`[!-~]` 在非 C collation 可能放行重音字母」疑慮。
- R2 對述詞本體覆核:**0 must-fix、新述詞正確**,並指出前導點 `x@.line.…` 已被 `NOT LIKE`(% 吃空字串)順帶擋下。
- R2 對誠實標記覆核:**標記跟上述詞改動、未見膨脹**。

## 5. 規則摘錄(PCM 鐵則,供你判斷是否違反)

- **鐵則 8**:重大改動(跨 3+ 檔 / 動 schema·API·共用元件 / 影響部署或資料遷移)前先提 plan 等 Sean 批准。
- **鐵則 9**:內容分級 L1(年改 0-1 次可 hardcode)/ L2(季改)/ L3(週改必後台 CRUD)。
- **鐵則 11**:commit 前三綠(typecheck+lint,動 .ts/.tsx 加 build),不繞道/disable/skip。**字面 vs 事實:commit 訊息與檔內宣稱須對應實際內容**。
- **鐵則 12**:動 security/RLS/GRANT/migration/schema/金流 → commit 前產本包、提醒 Sean 貼 Codex、**不 push**。
- **PCM migration 慣例**(鏡像 `20260714120000_m4a_order_workflow_status.sql`,同樣對 orders 加欄):
  - 🔴 **刻意無顯式 `BEGIN;`/`COMMIT;`** —— supabase CLI(pkg/migration ExecBatch)把整檔 statement + `schema_migrations` 登記跑在同一隱式交易;檔內顯式 COMMIT 會提早結束它,使「schema 落地」與「history 登記」出現斷線窗(斷線 = 下次 db push 重跑撞 CREATE 卡死)。無顯式 COMMIT 時 DO 斷言 RAISE 連 history 一起回滾 = fail-closed。
  - migration 一律 **Sean 手動 db push**(Claude 被 deny 碰 .env*),apply 前需交易模擬。
- **PII / 經銷價紅線**:經銷價絕不進 client bundle;log/告警禁帶 email 原值。

## 6. 本片唯一 code 改動 —— migration 逐字全文

檔案:`supabase/migrations/20260718120000_m4a_b1_orders_notification_email.sql`
(以下為 `cat` 原樣輸出,含全部註解區塊 —— 請一併審其宣稱是否與事實相符)

```sql
-- ============================================================
-- M-4a 通知線 B-1:orders.notification_email — 訂單層通知信箱快照欄(nullable 先行)
-- ============================================================
-- 真權威:docs/specs/2026-07-18-b0-order-notification-email-prd.md(B-0 PRD v3、經三輪雙審收案)
--   · 欄位設計 §3.1 / 長度單位 §3.4 / 拆片 §4 / rollback §5。
-- 鐵則 8(schema 改動、需 plan 先批 → PRD 已由 Sean 07-18 拍 Q3=A 收案動工)
--   + 鐵則 12(orders 為金流表 + migration/schema → **Codex Review Packet 已產**:
--     docs/reviews/2026-07-18-m4a-b1-notification-email-packet.md)。
-- 鐵則 9 內容分級:本片**無內容軸**(欄位存使用者 PII、非策展文案)→ 分級不適用;
--   UI 文案分級屬 B-3(PRD 已定 L2)。
-- 依賴:20260604120000(orders 建表)。**本檔不碰 create_order / confirm_order_payment / RLS / 既有欄。**
--
-- 🔴 為何是獨立欄、不塞 shipping_address_snapshot(PRD F8):
--   該 jsonb 有 exact-key 白名單 CHECK {name,phone,line},多一鍵 → **所有 INSERT 直接被拒**。
--   且「收件地址」與「通知信箱」語意不同(同一地址可用不同通知信箱)。
--
-- 🔴 為何 nullable(Sean 拍 D2=A 兩階段;R2 雙審 must-fix):
--   B-1 當下 create_order 尚未帶此參數(B-2 才改)→ 若此刻設 NOT NULL,**每一筆新單都會 23502 失敗
--   = 結帳全斷**。收緊成必填是 B-6 獨立片,且**不得用裸 SET NOT NULL**(會驗全部存量列、舊單全 NULL
--   必炸;回填合成值又撞下方禁合成域 CHECK = 自相矛盾)→ B-6 採 cutoff 式 CHECK(created_at >= 切換時戳)。
--
-- 🔴 既有 30 筆訂單全部保持 NULL = 預期狀態(本檔零 backfill、零 UPDATE)。
--   舊 cohort 依 PRD §5 R3 明文排除於通知保證;cutoff = flag 實際開啟時戳(非本 migration 時戳)。
--
-- 🔴 長度單位 = UTF-8 octet(PRD §3.4,codex R2 抓的三方不一致):
--   DB 用 octet_length()、JS 側用 Buffer.byteLength()、TapPay String(40) 保守視為 octet。
--   **禁用 PG length()(字元數)與 JS .length(UTF-16 code unit)** —— 對非 ASCII 三者不等值,
--   會產生「DB 收下、TapPay 靜默改成預設值」的邊界縫(TapPay 對不合規值不報錯、只轉預設值)。
--   本欄上限 254 octet = 通知欄自身上限(RFC 5321 forward-path 推導之業界慣用值);
--   **與 TapPay 的 40 刻意解耦**(Sean 拍 D4=A′ 分開存、條件帶入,>40 不帶入而非截斷)。
--
-- 🔴 只允許可列印 ASCII(`^[!-~]+$`;code-reviewer R1 抓出的 Unicode 空白縫、已補):
--   btrim() 只去 ASCII space、[[:cntrl:]] 不含 U+00A0/U+3000 → 舊述詞會放行 NBSP / 全形空白 /
--   零寬空格(本專案儲值金 RPC 踩過同款 Unicode 空白繞過)。`[!-~]` 一舉擋掉所有空白類、
--   控制字元與非 ASCII。代價 = **不支援 IDN/UTF-8 國際化 email**(如 用戶@例子.tw);
--   與 TapPay 要求 RFC 5322 相容,實務可接受(誠實揭示、非零代價)。
--
-- 🔴 禁合成域(fail-closed):LINE 登入用合成假信箱 line_{sub}@line.pcmmotorsports.local
--   (不可投遞;`.local` 為 RFC 6762 保留給 mDNS)。**三重防繞過**(後兩者為 code-reviewer R1 抓出、已補):
--     ① 大小寫不敏感(lower)
--     ② **尾點 FQDN**:rtrim(...,'.') → 'x@line.pcmmotorsports.local.' 亦擋
--     ③ **子網域**:NOT LIKE '%.line.pcmmotorsports.local' → 'x@sub.line.pcmmotorsports.local' 亦擋
--   實測「相似但不同域」(ok@notline.pcmmotorsports.local2.com)**未被誤擋**。
--   🔴 **域名字面 = `apps/storefront/src/lib/auth/line.ts:38`(權威常數)的硬拷貝**(SQL 無法 import);
--   同族硬拷貝另有 **`apps/storefront/src/lib/auth/field-validation.ts:53`**(該檔自帶「⚠️ 必與
--   lib/auth/line.ts 同步」註解、因 line.ts 為 server-only 不可進 client 驗證)。
--   → **改域名須此三處同改並另開 migration**,否則本 CHECK 靜默失效。
--   (全樹 grep 核實:其餘 **production** 命中皆為註解非字面常數 —— account/page.tsx:58、
--    cardholder.ts:4、20260717020000:28。⚠️ Codex 第一輪補正:**測試檔另有字面值**
--    `apps/storefront/src/lib/email/composition.test.ts:27`,屬測試注入值、非 production 真權威,
--    但改域名時**一併 grep 全樹**才不會漏。)
--   ⚠️ 本 CHECK 為 **backstop、非唯一防線**:真防線在 server 端 canonical 正規化(B-3/B-4)。
--   🔴 **B-3 驗收必含(app 層須鏡像本 CHECK 的兩條規則,否則 app 放行、DB 才擋 = 使用者看到
--   無意義的 500 而非欄位驗證訊息)**:
--     ① canonical 須「去尾點 + 以 domain **後綴**比對(非等值)」,與本 CHECK 同語意;
--     ② **同時鏡像上述「只允許可列印 ASCII」規則** —— 它有完全相同的失敗模式
--        (會員 email 含重音字母/非 ASCII → app 層放行、DB 層擋 → B-2/B-4 結帳 500)。
--
-- 🔴 會員可見性(既有事實、非本片新開):orders 對 authenticated 有表級 SELECT(own-only RLS)
--   → 會員可讀自己單的本欄。本欄存的就是他自己填的信箱 = 無外洩面(對照 workflow_status 先例)。
--
-- 🔴 交易邊界:**本檔刻意無顯式 BEGIN;/COMMIT;**(鏡像 20260714120000 的 Fable must-fix 結論)
--   —— supabase CLI(pkg/migration ExecBatch)把整檔 statement + schema_migrations 登記本就跑在
--   同一隱式交易;檔內顯式 COMMIT 會提早結束它,讓「schema 落地」與「history 登記」之間出現斷線窗。
--   無顯式 COMMIT 時 DO 斷言 RAISE 連 history 一起回滾 = fail-closed 更乾淨。
--
-- 動手前真 DB 交易模擬:✅ **PASS ×3 + 突變驗證 ×1(2026-07-18,project bmpnplmnldofgaohnaok)**
--   手法 = **單一 DO block**(套本檔 DDL → 逐條斷言 → 結尾無條件 RAISE 強制回滾)→ 單語句原子性,
--   MCP 縱使 autocommit 亦零留痕(沿用 E1a 手法)。
--   · 第一輪(述詞修正前):10 條斷言 PASS。
--   · **第二輪(code-reviewer R1 兩個 nit 修正後、即本檔現行述詞):15 條斷言 PASS**
--     ——含尾點 FQDN / 子網域 / NBSP / 全形空白四縫實測被擋,且「相似但合法域」實測未被誤擋。
--   · **第三輪(Codex 第一輪 consider 後新增 3b2 述詞內容核對):`SIM_ALL_PASS_V3`**
--     ——3b2 四子項全過**且未誤報**,另加測重音 `usér@example.com` 實測被擋。
--   · 🔴 **突變驗證(證明 3b2 不是假綠)**:故意套**弱化版 CHECK**(移除 `^[!-~]+$` 那條)→
--     3b2 正確 RAISE `MUTATION_CAUGHT`。**寫了斷言 ≠ 斷言抓得到,故實跑突變確認。**
--   · 🔴 3b2 的比對字面**取自 `pg_get_constraintdef` 實測輸出**(非憑記憶):PG 將 `NOT LIKE`
--     正規化為 **`!~~`**、regex 加 `::text` cast → 斷言若照原始 SQL 字面寫會永遠命中不到。
--   · 三輪事後零留痕實查皆為:residual_column=0 / residual_check=0 / orders 仍 30 筆 30 欄;
--     遠端 `schema_migrations` 最新仍為 `20260717020000`(本檔確實未 apply)。
--   · 另以**純唯讀 SELECT 表達式矩陣共 35 樣本:35/35 符合預期**(見檔尾;含 code-reviewer R2
--     要求補的 12 個**重音/類 ASCII 對抗樣本**,實測關閉「`[!-~]` 在非 C collation 可能放行
--     重音拉丁字母」的疑慮)。
--   ⚠️ 誠實標記:檔尾第 5(表級 ACL 前後逐項比對)、6 後半(套檔後真建新單)、9(lock_timeout
--     實際行為)**未驗** —— 見檔尾標註,非宣稱已驗。
--   模擬 SQL 全文與輸出 → 併入 Codex Packet(docs/reviews/2026-07-18-m4a-b1-notification-email-packet.md)。
--   **尚未 apply(等 Sean db push)。**
-- ============================================================

-- ── 0. 鎖面:ADD COLUMN(nullable、無 DEFAULT)在 PG 11+ 為 metadata-only;
--    但 ADD CONSTRAINT CHECK 會取 ACCESS EXCLUSIVE 並掃描既有列驗證(現 30 筆全 NULL → 瞬時)。
--    設 lock_timeout 防「意外撞上長交易而卡住真實結帳建單」。
--    ✅ **指定執行路徑下確定生效**(Codex 第一輪查證 supabase CLI **v2.98.1** `pkg/migration/file.go`
--    的 `ExecBatch` 原始碼:以隱式交易執行 SQL 並在同一批登記 migration history)→ 經
--    `supabase db push` 執行時,本 `SET LOCAL lock_timeout='3s'` **會生效**。
--    🔴 **本檔僅允許經 `supabase db push` 執行;非交易路徑不具鎖超時保護。**
--    ⚠️ **前一版註解「非交易時 no-op 也安全,因為 30 筆小表是毫秒級」是錯的(Codex 已駁)**:
--    取得 ACCESS EXCLUSIVE lock 可能被**長交易無限阻擋**,與本表資料量無關 —— 資料量只決定
--    「拿到鎖之後」的掃描時間,不決定「要等多久才拿得到鎖」。
--    檔尾第 9 標「未實測」= 未製造長交易競爭情境實測超時行為,非對上述 CLI 查證存疑。
--    鏡像檔 20260714120000 未用此手法 = 本檔刻意偏離、理由如上。
SET LOCAL lock_timeout = '3s';

-- ── 1. 加欄(nullable、無 DEFAULT)────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN notification_email text;

-- ── 2. 格式 CHECK(IS NULL OR 全條件;PRD §3.1)───────────────────────────────
--   · = btrim(...)              前後無 ASCII 空白(冗餘防線;主力為下一條)
--   · ~ '^[!-~]+$'              **只允許可列印 ASCII**:一舉擋空白類(含 NBSP/全形/零寬)、
--                               控制字元(CR/LF header injection 面)、非 ASCII;順帶擋空字串
--   · octet_length ≤ 254        UTF-8 octet 上限(**非字元數**)
--   · ~ '^[^@]+@[^@]+\.[^@]+$'  單一 @、兩側非空、domain 含點(完整 RFC 5322 在 server 層,DB 只做形狀)
--   · rtrim/lower <> 合成域     禁 LINE 合成域:大小寫不敏感 + 去尾點 FQDN
--   · rtrim/lower NOT LIKE …    禁其任何子網域
ALTER TABLE public.orders
  ADD CONSTRAINT orders_notification_email_valid
  CHECK (
    notification_email IS NULL OR (
          notification_email = btrim(notification_email)
      AND notification_email ~ '^[!-~]+$'
      AND octet_length(notification_email) <= 254
      AND notification_email ~ '^[^@]+@[^@]+\.[^@]+$'
      AND rtrim(lower(split_part(notification_email, '@', 2)), '.') <> 'line.pcmmotorsports.local'
      AND rtrim(lower(split_part(notification_email, '@', 2)), '.') NOT LIKE '%.line.pcmmotorsports.local'
    )
  );

COMMENT ON COLUMN public.orders.notification_email IS
  '訂單通知信箱快照(B-0 PRD v3;客人結帳當下填寫、凍結於訂單層,不隨會員檔變動)。NULL=B-3/B-4 上線前的舊單或過渡窗單(見 PRD §5 R3 舊 cohort)。🔴 長度上限 254 **octet**(非字元);與 TapPay cardholder.email 的 40 octet 刻意解耦(D4=A′ 分開存、條件帶入,>40 不帶入而非截斷)。🔴 只收可列印 ASCII(不支援 IDN);禁 LINE 合成域(含尾點 FQDN 與子網域)。此 CHECK 為 backstop,真防線在 server canonical 正規化。🔴 不保證可投遞——投遞真相須由 Resend bounce/suppressed webhook(C-2)得知。';

-- ── 3. fail-closed 斷言:欄型態 / CHECK 存在 / 既有列未被動到 / 無意外欄級 ACL ──
--    ⚠️ 誠實定性:3a/3b/3d 在本檔 DDL 未被竄改的前提下**近乎恆真**(ADD CONSTRAINT 不加 NOT VALID
--    必然 convalidated;ADD COLUMN 必然無 attacl)= **結構守衛**、非行為驗證(行為驗證在交易模擬)。
--    實質防呆價值:**3c**(零 backfill,擋日後有人在本檔加 UPDATE/DEFAULT)與
--    **3b2**(🔴 Codex 第一輪 consider 後新增 —— **述詞內容**核對,擋「CHECK 被弱化但 3b 仍過」的假綠;
--    比對字面取自 `pg_get_constraintdef` 實測輸出)。
DO $$
DECLARE
  v_cnt      integer;
  v_nullable text;
  v_type     text;
  v_def      text;
BEGIN
  -- 3a. 欄存在、型別 text、nullable(NOT NULL 會在 B-2 前弄斷結帳)。
  SELECT data_type, is_nullable INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'notification_email';
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'B-1 異常 — orders.notification_email 未建立;拒繼續';
  END IF;
  IF v_type <> 'text' THEN
    RAISE EXCEPTION 'B-1 異常 — orders.notification_email 型別應為 text、實為 %;拒繼續', v_type;
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'B-1 異常 — orders.notification_email 必須 nullable(B-2 前 create_order 不帶此參數、NOT NULL 會使每筆新單 23502);拒繼續';
  END IF;

  -- 3b. CHECK 約束存在且為 v(alidated)。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.orders'::regclass
     AND conname  = 'orders_notification_email_valid'
     AND contype  = 'c'
     AND convalidated;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'B-1 異常 — orders_notification_email_valid CHECK 不存在或未驗證(count=%);拒繼續', v_cnt;
  END IF;

  -- 3b2. 🔴 CHECK **述詞內容**核對(Codex 第一輪 consider:3b 只驗「存在且 convalidated」,
  --      日後若有人把述詞弱化成寬鬆版,3b 仍會通過 = 假綠)。
  --      比對字面取自 `pg_get_constraintdef` **實測輸出**(非憑記憶):PG 會把 NOT LIKE 正規化為
  --      `!~~`、regex 加 `::text` cast。用 position() 而非 LIKE(述詞本身含 `%` 字元)。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_notification_email_valid';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'B-1 異常 — 取不到 CHECK 述詞定義;拒繼續';
  END IF;
  IF position('^[!-~]+$' IN v_def) = 0 THEN
    RAISE EXCEPTION 'B-1 異常 — CHECK 述詞缺「只允許可列印 ASCII」成分 → NBSP/全形空白/零寬空格/非 ASCII 繞過面重開;拒繼續';
  END IF;
  IF position('octet_length' IN v_def) = 0 OR position('254' IN v_def) = 0 THEN
    RAISE EXCEPTION 'B-1 異常 — CHECK 述詞缺 octet_length 254 上限 → 單位若退回字元數即與 TapPay/JS 側不一致;拒繼續';
  END IF;
  IF position('rtrim' IN v_def) = 0 THEN
    RAISE EXCEPTION 'B-1 異常 — CHECK 述詞缺 rtrim 去尾點 → 合成域尾點 FQDN 繞過面重開;拒繼續';
  END IF;
  IF position('!~~' IN v_def) = 0 OR position('%.line.pcmmotorsports.local' IN v_def) = 0 THEN
    RAISE EXCEPTION 'B-1 異常 — CHECK 述詞缺子網域阻擋(NOT LIKE 正規化為 !~~) → sub.line.… 繞過面重開;拒繼續';
  END IF;

  -- 3c. 本檔零 backfill:既有列必須全部仍為 NULL(有值 = 本檔被誤加 UPDATE/DEFAULT)。
  SELECT count(*) INTO v_cnt FROM public.orders WHERE notification_email IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'B-1 異常 — 本檔應零 backfill,但已有 % 筆 notification_email 非 NULL;拒繼續', v_cnt;
  END IF;

  -- 3d. 新欄不得有任何欄級 ACL(繼承 orders 表級即可;意外欄級 grant = 權限面漂移)。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.orders'::regclass
     AND attname  = 'notification_email'
     AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'B-1 異常 — orders.notification_email 出現欄級 ACL(應為空、繼承表級);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   ⚠️ PRD §5 明訂:DROP COLUMN **不是日常 rollback**(永久刪除已收集的 PII,且撤不回已送 TapPay
--      的 payload)。incident 時正確做法 = 切回相容的 app/RPC 路徑並**保留本 nullable 欄**。
--      下列僅供「本片剛 apply、尚無任何真實資料」時的緊急復原:
-- BEGIN;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_notification_email_valid;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS notification_email;
-- COMMIT;
-- ============================================================

-- ============================================================
-- 交易模擬結果(2026-07-18 執行 ×2;第二輪 = 本檔現行述詞)
-- 【標記】✅=實測通過 / 🟡=部分驗證 / ⚠️=未驗(誠實揭示,非宣稱通過)
-- 【註】下方「模擬斷言 N」指的是**模擬用 DO block** 的編號,非本檔 §3 的 3a-3d(本檔僅 4 條)。
--       模擬 SQL 全文與原始輸出 → Codex Packet(docs/reviews/2026-07-18-m4a-b1-notification-email-packet.md)。
--
-- ✅ 0. **DO 3b2 述詞內容核對有效性(突變驗證)**:套弱化版 CHECK(移除 `^[!-~]+$`)→ 3b2 正確
--    RAISE `MUTATION_CAUGHT`;套正確版 → 四子項全過且未誤報(`SIM_ALL_PASS_V3`)。
--    = 證明此斷言**真的殺得死「CHECK 被弱化但斷言仍過」的假綠**,非僅寫在那裡好看。
-- ✅ 1. 欄存在:orders.notification_email text、is_nullable=YES。(模擬斷言 1)
-- ✅ 2. CHECK 生效 —— 兩層互補驗證(兩者證明的事情不同、缺一不可):
--    · **DO block 內真 UPDATE**(模擬斷言 6-13)= 證明「CHECK 真的作用在 orders 表上」:
--      前導空白 / 合成域大寫 / 255 octet / 無@ / **尾點 FQDN** / **子網域** / **NBSP** / **全形空白**
--      八種壞值全被 check_violation 擋。
--    · **純唯讀 SELECT 表達式矩陣共 35 樣本、35/35 符合預期**(模擬外)= 證明「述詞判定正確」:
--      〔第一批 23〕合法:一般 / 長域名 44 octet / plus 標籤 / **相似但不同域**
--        (ok@notline.pcmmotorsports.local2.com)/ 254 octet 邊界 → 全過;
--        擋下:前導·尾隨空白、CRLF、NBSP、全形空白、零寬空格、非 ASCII 中文、無@、domain 無點、
--        雙@、內含空白、空字串、合成域(小寫/大寫/**尾點**/**子網域**/**子網域大寫**)、255 octet。
--      〔第二批 12 — code-reviewer R2 要求的**重音/類 ASCII 對抗樣本**〕
--        **全部實測被擋**:é(本地部)、á(域名)、ü、ø、ß、**西里爾 а(視覺近似 ASCII a)**、
--        軟連字號 U+00AD、組合附加符號 U+0301;
--        **對照全過**:純 ASCII、`a.b-c_d+e@f-g.example.com`、波浪號 `~`(0x7E 上邊界)、
--        驚嘆號 `!`(0x21 下邊界)→ 證明 `[!-~]` 邊界精準、且**非 C collation 下未放行重音字母**
--        (關閉 R2 點名的 locale 疑慮)。
-- ✅ 3. 合法值可寫:'sim@example.com'、'user+tag@example.co.uk' UPDATE 成功;NULL 可寫。(模擬斷言 5)
-- ✅ 4. 零 backfill:套檔後 count(notification_email IS NOT NULL)=0(既有 30 筆全 NULL)。(模擬斷言 3)
-- ✅ 4b. 合法相似域未被誤擋:'ok@notline.pcmmotorsports.local2.com' 寫入成功。(模擬斷言 14)
-- 🟡 5. ACL:新欄 attacl IS NULL(無欄級 grant)已驗(模擬斷言 4);
--    ⚠️ **表級權限套檔前後逐項比對未做** —— ADD COLUMN 依規格不改表級 ACL、風險低,但本次未實證。
-- 🟡 6. create_order 零接觸:pg_get_functiondef 不含 'notification_email' 字面 ✅(模擬斷言 15);
--    ⚠️ **「套檔後真建一張新單」未測**(需合成 auth.users+地址+FK 鏈,成本高)→ 併入 B-2 交易模擬。
-- ✅ 7. confirm_order_payment 零接觸:函式存在(1)且定義不含本欄字面(0)。(唯讀實查)
-- ✅ 8. orders 無使用者 trigger(pg_trigger NOT tgisinternal=0);且不在 realtime publication(0)。
-- ⚠️ 9. 鎖面:lock_timeout='3s' 已寫入,但**實際超時行為未測**(需製造長交易競爭;30 筆小表 ALTER
--    為毫秒級,實務風險極低;且非交易 block 時該語句為 no-op)——誠實揭示,非宣稱已驗。
-- ✅ 10. ROLLBACK 零留痕(兩輪皆查):residual_column=0 / residual_check=0 / orders 仍 30 筆 30 欄。
-- ============================================================
```

## 7. 交易模擬與矩陣 —— 可重現的完整 SQL 與逐字輸出

> 第一輪 Codex must-fix #3:前一版只給摘要卻宣稱「全文」。本版補上兩段**可直接重跑**的 SQL 與其**逐字輸出**。
> 兩段皆對 prod(project `bmpnplmnldofgaohnaok`)執行:第一段為**寫入型但原子回滾**(結尾無條件 RAISE),第二段為**純唯讀 SELECT**。

### 7.1 交易模擬 DO block(第二輪、對應 §6 現行述詞)—— 完整 SQL

```sql
DO $$
DECLARE
  v_type text; v_nullable text; v_cnt integer; v_id uuid; v_def text;
BEGIN
  ALTER TABLE public.orders ADD COLUMN notification_email text;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_notification_email_valid
    CHECK (
      notification_email IS NULL OR (
            notification_email = btrim(notification_email)
        AND notification_email ~ '^[!-~]+$'
        AND octet_length(notification_email) <= 254
        AND notification_email ~ '^[^@]+@[^@]+\.[^@]+$'
        AND rtrim(lower(split_part(notification_email, '@', 2)), '.') <> 'line.pcmmotorsports.local'
        AND rtrim(lower(split_part(notification_email, '@', 2)), '.') NOT LIKE '%.line.pcmmotorsports.local'
      )
    );

  SELECT data_type, is_nullable INTO v_type, v_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='orders' AND column_name='notification_email';
  IF v_type IS DISTINCT FROM 'text' OR v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'SIM_FAIL 1 欄型態錯 type=% nullable=%', v_type, v_nullable; END IF;

  SELECT count(*) INTO v_cnt FROM pg_constraint WHERE conrelid='public.orders'::regclass
    AND conname='orders_notification_email_valid' AND contype='c' AND convalidated;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'SIM_FAIL 2 CHECK 未建立或未驗證'; END IF;

  SELECT count(*) INTO v_cnt FROM public.orders WHERE notification_email IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'SIM_FAIL 3 應零 backfill 實 %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM pg_attribute WHERE attrelid='public.orders'::regclass
    AND attname='notification_email' AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'SIM_FAIL 4 出現欄級 ACL'; END IF;

  SELECT id INTO v_id FROM public.orders LIMIT 1;

  UPDATE public.orders SET notification_email='sim@example.com' WHERE id=v_id;
  SELECT count(*) INTO v_cnt FROM public.orders WHERE notification_email='sim@example.com';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'SIM_FAIL 5 合法值寫入失敗'; END IF;
  UPDATE public.orders SET notification_email='user+tag@example.co.uk' WHERE id=v_id;
  UPDATE public.orders SET notification_email=NULL WHERE id=v_id;

  BEGIN UPDATE public.orders SET notification_email='  a@b.com' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 6 前導空白未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email='X@LINE.PCMMOTORSPORTS.LOCAL' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 7 合成域大寫未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email=rpad('a',243,'a')||'@example.com' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 8 255octet 未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email='noatsign' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 9 無@未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email='x@line.pcmmotorsports.local.' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 10 合成域尾點FQDN未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email='x@sub.line.pcmmotorsports.local' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 11 合成域子網域未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email=e' a@b.com' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 12 NBSP前導未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.orders SET notification_email=e'　a@b.com' WHERE id=v_id;
    RAISE EXCEPTION 'SIM_FAIL 13 全形空白未被擋'; EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE public.orders SET notification_email='ok@notline.pcmmotorsports.local2.com' WHERE id=v_id;
  SELECT count(*) INTO v_cnt FROM public.orders WHERE notification_email LIKE 'ok@notline%';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'SIM_FAIL 14 相似但合法域被誤擋'; END IF;
  UPDATE public.orders SET notification_email=NULL WHERE id=v_id;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order' LIMIT 1;
  IF v_def IS NULL OR v_def LIKE '%notification_email%' THEN
    RAISE EXCEPTION 'SIM_FAIL 15 create_order 查無或竟含本欄字面'; END IF;

  RAISE EXCEPTION 'SIM_ALL_PASS 15 條斷言全通過(含 reviewer 抓的尾點/子網域/NBSP/全形空白四縫),本 RAISE 為刻意回滾';
END
$$;
```

**逐字輸出**:
```
ERROR:  P0001: SIM_ALL_PASS 15 條斷言全通過(含 reviewer 抓的尾點/子網域/NBSP/全形空白四縫),本 RAISE 為刻意回滾
CONTEXT:  PL/pgSQL function inline_code_block line 71 at RAISE
```

**設計說明(供你判斷是否假綠)**:
- 每個壞值用 `BEGIN … EXCEPTION WHEN check_violation THEN NULL; END;` 子區塊包住。子區塊內的 `RAISE EXCEPTION 'SIM_FAIL …'` 是 `raise_exception`(P0001)、**不會**被 `WHEN check_violation` 捕捉 → 若壞值沒被擋,失敗訊息會往外拋、整段中止。這是「擋不住就一定看得到」的設計。
- 最末 `RAISE` **無任何條件包裹**,位於所有斷言之後 → 只要前面全過就必然執行 → 整個 DO block 失敗 → **單語句原子回滾**(MCP 縱使 autocommit,單一語句仍原子)。

**事後零留痕實查 SQL 與輸出**:
```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='notification_email') as residual_column,
  (select count(*) from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_notification_email_valid') as residual_check,
  (select count(*) from public.orders) as orders_total,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='orders') as orders_column_count;
```
```
[{"residual_column":0,"residual_check":0,"orders_total":30,"orders_column_count":30}]
```

### 7.2 述詞矩陣(純唯讀 SELECT)—— 第二批 12 個重音/類 ASCII 對抗樣本

> 第一批 23 樣本結構相同(篇幅計僅列第二批;第一批涵蓋空白/CRLF/無@/雙@/空字串/合成域五變體/254·255 octet 等,全數符合預期)。

```sql
with samples(label, v) as (values
  ('重音拉丁-é本地部',      'usér@example.com'),
  ('重音拉丁-á域名',        'user@exámple.com'),
  ('變音-ü',                'ünicode@test.com'),
  ('北歐-ø',                'jørgen@example.com'),
  ('德文-ß',                'straße@example.com'),
  ('西里爾-а(看似a)',       'usа@example.com'),
  ('軟連字號-U+00AD',       e'us­er@example.com'),
  ('組合附加符號-U+0301',   e'usér@example.com'),
  ('對照-純ASCII',          'user@example.com'),
  ('對照-ASCII特殊字元合法','a.b-c_d+e@f-g.example.com'),
  ('對照-波浪號~(0x7E)',    'a~b@example.com'),
  ('對照-驚嘆號!(0x21)',    'a!b@example.com')
)
select label, octet_length(v) as octets, char_length(v) as chars,
       (v ~ '^[!-~]+$') as ascii_only_passes,
       ( v = btrim(v)
         and v ~ '^[!-~]+$'
         and octet_length(v) <= 254
         and v ~ '^[^@]+@[^@]+\.[^@]+$'
         and rtrim(lower(split_part(v, '@', 2)), '.') <> 'line.pcmmotorsports.local'
         and rtrim(lower(split_part(v, '@', 2)), '.') not like '%.line.pcmmotorsports.local'
       ) as full_check_passes
from samples;
```

**逐字輸出**(節錄關鍵欄):
```
é本地部      octets=17 chars=16  ascii_only=false  full=false
á域名        octets=17 chars=16  ascii_only=false  full=false
ü            octets=17 chars=16  ascii_only=false  full=false
ø            octets=19 chars=18  ascii_only=false  full=false
ß            octets=19 chars=18  ascii_only=false  full=false
西里爾 а     octets=16 chars=15  ascii_only=false  full=false
軟連字號     octets=18 chars=17  ascii_only=false  full=false
組合附加符號 octets=18 chars=17  ascii_only=false  full=false
純ASCII      octets=16 chars=16  ascii_only=true   full=true
ASCII特殊    octets=25 chars=25  ascii_only=true   full=true
波浪號~      octets=15 chars=15  ascii_only=true   full=true
驚嘆號!      octets=15 chars=15  ascii_only=true   full=true
```
→ `octets > chars` 證明樣本確實含多位元組字元;`[!-~]` 在此 PG 實例的 collation 下**未放行任何重音/非 ASCII 字元**,且 0x21/0x7E 兩端邊界精準。

## 8. 請你重點審查(**本版問題已改為:是否可 `db push`**)

1. **CHECK 述詞還有沒有可繞過的縫?** 尤其 `^[!-~]+$` 與 email 形狀 regex 的交互、`split_part`/`rtrim`/`NOT LIKE` 的邊界。(第一輪你已確認未發現新繞過,本版述詞未再更動 —— 請確認我沒在別處改壞。)
2. **§7 的模擬設計是否可能假綠?**(子區塊例外捕捉的語意、最末 RAISE 的無條件性、單語句原子回滾的成立性)
3. **PRD 契約同步是否真的補齊**(第一輪 must-fix #1):`docs/specs/…-b0-…-prd.md` §3.1 六條件全文、§3.4 逐條語意、B-3 app 層鏡像義務 —— 是否仍有 app 層會放行而 DB 拒絕的殘留缺口?
4. **additive 安全性**與 `SET LOCAL lock_timeout` 的註解修正是否正確(第一輪你查證 CLI 2.98.1 `ExecBatch` 以隱式交易執行 → 我已把「非交易時 no-op 也安全」的錯誤論述改掉)。
5. **字面 vs 事實**:§6 全文的檔頭/檔尾 ✅🟡⚠️ 標記、以及本包各節宣稱,是否仍有與事實不符之處?
6. **DO 斷言定性**:我把 3a/3b/3d 誠實定性為「結構守衛、近乎恆真」、3c 才是實質防呆。你上一輪建議加 `pg_get_constraintdef` 述詞核對 —— 我的處置見 §6 檔內,請覆核是否足夠。
7. **是否可 `db push`?** 若可,請列出 apply 後必須立即覆核的項目。
