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
--   (全樹 grep 核實:其餘命中皆為註解非字面常數 —— account/page.tsx:58、cardholder.ts:4、
--    20260717020000:28。)
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
-- 動手前真 DB 交易模擬:✅ **PASS ×2(2026-07-18,project bmpnplmnldofgaohnaok)**
--   手法 = **單一 DO block**(套本檔 DDL → 逐條斷言 → 結尾無條件 RAISE 強制回滾)→ 單語句原子性,
--   MCP 縱使 autocommit 亦零留痕(沿用 E1a 手法)。
--   · 第一輪(述詞修正前):10 條斷言 PASS。
--   · **第二輪(code-reviewer R1 兩個 nit 修正後、即本檔現行述詞):15 條斷言 PASS**
--     ——含尾點 FQDN / 子網域 / NBSP / 全形空白四縫實測被擋,且「相似但合法域」實測未被誤擋。
--   · 兩輪事後零留痕實查皆為:residual_column=0 / residual_check=0 / orders 仍 30 筆 30 欄。
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
--    ⚠️ **效力取決於執行路徑是否包在交易內**:依上方「交易邊界」段的推論(supabase CLI ExecBatch
--    把整檔跑在同一隱式交易)**此處應會生效**;但若某執行路徑非交易 block,SET LOCAL 退化為
--    WARNING **no-op**(兩態皆安全:生效=超時即失敗 fail-closed;no-op=回退預設無限等待,
--    而 30 筆小表 ALTER 為毫秒級)。**標「未實測」是因未製造長交易競爭情境**,非對前述推論存疑
--    (檔尾第 9)。鏡像檔 20260714120000 未用此手法 = 本檔刻意偏離、理由如上。
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
--    實質防呆價值最高者為 3c(零 backfill,擋日後有人在本檔加 UPDATE/DEFAULT)。
DO $$
DECLARE
  v_cnt      integer;
  v_nullable text;
  v_type     text;
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
