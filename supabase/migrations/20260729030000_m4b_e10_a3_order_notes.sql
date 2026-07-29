-- ============================================================
-- M-4b E10 第 1 批 · A3:order_notes(內部備註 / 聯絡紀錄 / 已告知客人)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表第 23 列(A3)、
--       §1 原則 3、§4 折入表的 U6(缺貨只做告知義務)與 UX §3 #12/#13(人工登記統一進時間軸)。
-- 片型 M(純 schema;零 trigger、零 DB 函式)。
--
-- 這張表承載三件在時間軸上長得一樣、但語意不同的事:
--   ① internal          —— 純內部備註(第 3 項「訂單寫備註」)
--   ② contact_log       —— 用 LINE / 電話 / Email 聯絡過客人的紀錄(UX §3 #13 人工登記)
--   ③ customer_notified —— 🔴 **已告知客人**(U6 缺貨告知義務的證據:時間 / 管道 / 摘要)
--
-- 🔴 為什麼 U6 要獨立成一種 note_type 而不是塞進 contact_log:
--    U6 是**告知義務**,將來要回答「我們到底有沒有通知客人他的貨要等」。
--    那是一個要能被查詢、被統計、被稽核的事實,不能混在一般聯絡紀錄裡靠人讀文字判斷。
--
-- 🔴 原則 3:本表是內部資料(含內部備註),`orders` 對登入客人整表開放 SELECT
--    (`20260604120000_m3_s2a_orders_order_items.sql:190`)⇒ 這些內容一個 byte 都不能放 orders。
--    ⇒ service_role SELECT only + RLS zero-policy;寫入一律走 owner RPC(A6)。
--
-- 🔴 append-only:本表只增不改不刪。DB 層的保證**僅止於**「應用 role(anon / authenticated /
--    service_role)沒有 UPDATE / DELETE 權」,寫入唯一入口是 A6 這支 owner RPC(它只做 INSERT)。
--    ⚠️ 誠實邊界:**table owner 與 superuser 仍可直接改**,而且就算加了 trigger,owner 也能停用它。
--    真正的 append-only 強制需要 trigger(屬 T 型、不在本片,見 §1 原則 1 的 R6 修正)。
--    ⇒ 本片不宣稱「物理不可改」,只宣稱「應用路徑改不到」。
-- 🔴 另一個誠實邊界:表層 ACL 擋得住直接查表,擋不住**日後某支 SECURITY DEFINER RPC
--    誤把本表內容授給 authenticated** —— 讀取入口(A9a)自己要守,不能只靠這張表的 GRANT。
--
-- 🔴 2026-07-29 Sean 拍板 A3-1=A:加 `corrects_note_id`(更正鏈)。
--    病灶:append-only 之下,員工把備註誤選成「已告知客人」就再也改不掉,
--    U6 的告知義務稽核會永遠把那筆算成已履行 —— 一筆點錯的下拉,變成一筆假的法律證據。
--    修法**不破壞 append-only**:後補一筆新紀錄指向前一筆,舊列原封不動保留,
--    「現行有效」由讀取端排除被指向的列推導。⇒ 見下方 corrects_note_id 與 §稽核合約。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.order_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔴 RESTRICT 而非 CASCADE(同 A2 的理由):聯絡紀錄與告知義務是要留存的事實,
  --    不得因為刪一張單就無聲消失。
  -- 🔴 **順序更正(Fable F5)**:原註解寫「D1c 刪假單排在本片之前」—— 那是 §5.0 DAG 的序,
  --    但**實際 apply 序是 D0 → A2 → A3 先落地、D1c 之後才跑**(D1 線 07-29 早上才解封)。
  --    ⇒ 若 A6 在 D1c 之前落地、且有人對待刪 cohort 的單寫了備註,
  --      D1c 的 DELETE 會被本條 RESTRICT 中途擋掉(fail-closed、不會誤刪,但會炸在半路)。
  --    **D1c runbook 前置必須加一條斷言:本表與 order_item_procurement 對 cohort 零引用。**
  order_id     uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,

  note_type    text        NOT NULL,
  body         text        NOT NULL,

  -- 聯絡管道與發生時間:contact_log 與 customer_notified 必填(U6 要的「時間 / 管道 / 摘要」)
  channel      text,
  occurred_at  timestamptz,

  -- 誰寫的。對齊既有稽核慣例:staff slug 寫進 admin_audit_log.actor 的同一組值。
  -- ⚠️ 目前操作者仍是使用者自己下拉挑的(session/actor.ts 自陳非授權邊界)⇒
  --    這一欄現階段是「他說他是誰」,不是經過驗證的身分。E8-B 上線後才會變成真的。
  author       text        NOT NULL,

  -- 🔴 更正鏈(Sean 2026-07-29 拍板 A3-1=A)。NULL = 這是一筆原始紀錄。
  --    非 NULL = 這筆是用來更正它指到的那一筆(舊列保留、只是不再是現行有效值)。
  corrects_note_id uuid,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- 複合 FK 的目標鍵。id 已是 PK,本條唯一的用途是讓下面那支
  -- (corrects_note_id, order_id) → (id, order_id) 的 FK 有東西可以指。
  CONSTRAINT order_notes_id_order_id_key UNIQUE (id, order_id),

  -- 🔴 只能更正【同一張單】的紀錄。單欄 FK 做不到這件事(它只驗 id 存在),
  --    複合 FK 才會連 order_id 一起比對 ⇒ 拿 B 單的更正紀錄去蓋 A 單的告知義務,
  --    在 DB 層就被擋掉,不必仰賴應用層自律。
  --    corrects_note_id 為 NULL 時 MATCH SIMPLE 直接略過整條 FK(order_id 是 NOT NULL,
  --    唯一可能為 NULL 的就是 corrects_note_id)⇒ 原始紀錄不受影響。
  CONSTRAINT order_notes_corrects_same_order_fk
    FOREIGN KEY (corrects_note_id, order_id)
    REFERENCES public.order_notes (id, order_id) ON DELETE RESTRICT,

  -- 自己更正自己 = 無限迴圈的起點,直接擋掉
  CONSTRAINT order_notes_corrects_not_self
    CHECK (corrects_note_id IS DISTINCT FROM id),

  CONSTRAINT order_notes_type_check
    CHECK (note_type IN ('internal', 'contact_log', 'customer_notified')),

  -- 內容必須有實質字元(全空白 = 一筆看起來有、其實沒有的紀錄)。
  -- 擋掉兩類最常見的「肉眼全白卻通過」:
  --    ① btrim 只剝 U+0020 ⇒ 用 [[:space:]](涵蓋全形空白 U+3000、tab、換行)
  --    ② [[:space:]] **不涵蓋零寬字元**(U+200B/200C/200D/FEFF,實測 confirmed)
  --       ⇒ 先 translate 掉再判,否則一整串零寬空白會被當成有內容
  -- ⚠️ **不宣稱窮盡**(Fable F7 修正原本「三層都擋、少一層就有破口」的過寬說法):
  --    渲染成全白的碼位沒有邊界(U+2800 盲文空白、U+3164 Hangul filler、U+00AD 軟連字號…),
  --    既不在上面的 translate 清單、也不屬 [[:space:]] ⇒ **照樣入得了庫**。
  --    CHECK 窮舉不完,最後一道歸 A6 writer(正規化 + 拒收);本條只擋常見四種零寬 + 標準空白。
  CONSTRAINT order_notes_body_nonempty
    CHECK (pg_catalog.translate(body, U&'\200B\200C\200D\FEFF', '') ~ '[^[:space:]]'),

  -- occurred_at 必須是有限且合理的時間:'infinity' 或 1900 年的「已告知客人」是假證據。
  -- ⚠️ 「不得晚於現在」擋不進 CHECK(now() 非 IMMUTABLE)⇒ 那條是 A6 owner RPC 的責任,
  --    此處只擋掉 infinity 與明顯荒謬值。
  CONSTRAINT order_notes_occurred_at_sane
    CHECK (
      occurred_at IS NULL
      OR (occurred_at > TIMESTAMPTZ '2020-01-01' AND occurred_at < TIMESTAMPTZ '2100-01-01')
    ),

  CONSTRAINT order_notes_author_nonempty
    CHECK (author ~ '^[a-z0-9_]{1,64}$'),

  -- 🔴 聯絡類紀錄必須帶管道與時間,否則 U6 的告知義務證據不成立
  --    (「我通知過他了」但答不出何時、用什麼管道 = 等於沒有證據)。
  CONSTRAINT order_notes_contact_fields_required
    CHECK (
      note_type = 'internal'
      OR (channel IS NOT NULL AND occurred_at IS NOT NULL)
    ),

  -- 純內部備註不該帶管道/時間(帶了代表分類挑錯,寧可當場擋下)
  CONSTRAINT order_notes_internal_fields_absent
    CHECK (
      note_type <> 'internal'
      OR (channel IS NULL AND occurred_at IS NULL)
    ),

  CONSTRAINT order_notes_channel_check
    CHECK (channel IS NULL OR channel IN ('line', 'phone', 'email', 'in_person', 'other'))
);

COMMENT ON TABLE public.order_notes IS
  'M-4b E10 A3:訂單的內部備註與聯絡紀錄(append-only)。三種 note_type:internal 內部備註 / contact_log 聯絡紀錄 / customer_notified 已告知客人(U6 缺貨告知義務的證據)。🔴 service_role only:內部備註絕不進 orders(該表對登入客人整表開放 SELECT)。寫入唯一入口 = A6 owner RPC,只 INSERT 不 UPDATE 不 DELETE。';

COMMENT ON COLUMN public.order_notes.note_type IS
  'internal 純內部備註 / contact_log 已聯絡客人的紀錄 / customer_notified 已履行告知義務(U6)。🔴 customer_notified 獨立成一類是刻意的:告知義務要能被查詢與稽核,不能混在一般聯絡紀錄裡靠人讀文字判斷。';
COMMENT ON COLUMN public.order_notes.occurred_at IS
  '聯絡實際發生的時間(不是寫入時間)。員工可能隔天才補登記,created_at 會晚於 occurred_at,這是預期的。';
COMMENT ON COLUMN public.order_notes.corrects_note_id IS
  '這筆是用來更正哪一筆(Sean 2026-07-29 拍板 A3-1=A)。NULL = 原始紀錄。🔴 舊列永遠保留、只是不再是現行有效值;U6 稽核查詢必須排除「已被指向」的列,否則點錯的「已告知客人」會永遠算成已履行。🔴 只能指向同一張單的紀錄(複合 FK 強制);一筆最多被更正一次(partial unique);要再更正就去更正那筆更正。';
COMMENT ON COLUMN public.order_notes.author IS
  '寫這筆的 staff slug(對齊 admin_audit_log.actor)。⚠️ E8-B 上線前,操作者是使用者自己下拉挑的、系統未驗證 ⇒ 本欄是「他說他是誰」,不是經過驗證的身分。';

-- 時間軸查詢:一張單的所有紀錄依時間排(A9a 的讀取路徑、A10a 的明細頁時間軸)
CREATE INDEX order_notes_order_id_created_at_idx
  ON public.order_notes (order_id, created_at DESC);

-- 告知義務稽核:「哪些單通知過客人」要查得快(U6)
CREATE INDEX order_notes_notified_idx
  ON public.order_notes (order_id, occurred_at DESC)
  WHERE note_type = 'customer_notified';

-- 🔴 一筆紀錄最多只能被更正一次(兩筆都說「前面那個錯了」= 誰才算數答不出來)。
--    要再更正 = 去更正那筆更正(A ← B ← C 的鏈是合法的、也是預期用法)。
CREATE UNIQUE INDEX order_notes_corrects_note_id_key
  ON public.order_notes (corrects_note_id)
  WHERE corrects_note_id IS NOT NULL;

-- ── 🔴 U6 告知義務稽核的合約(消費端 A9a / A10a 必須照做)────────────
-- 「這張單有沒有告知過客人」**不得**寫成 `EXISTS (… note_type = 'customer_notified')`,
-- 那會把已經被更正掉的誤選也算成已履行 —— 正是本次拍板要修的病。正確形狀:
--
--   SELECT EXISTS (
--     SELECT 1 FROM public.order_notes n
--      WHERE n.order_id = $1
--        AND n.note_type = 'customer_notified'
--        AND NOT EXISTS (SELECT 1 FROM public.order_notes c WHERE c.corrects_note_id = n.id)
--   )
--
-- 明細頁時間軸同理:被指向的列要標成「已更正」,不是直接不顯示
-- (append-only 的價值就在於看得到原本寫了什麼、以及誰在什麼時候更正的)。
--
-- ⚠️ 誠實邊界:本片沒有 DB 層強制消費端照這個形狀查 —— 那是查詢寫法,DB 管不到。
--    ⇒ 列為 A9a 的驗收條件,並附「被更正的 customer_notified 不得算已履行」負測
--       (🔴 該負測必須**兩個方向都測**:更正前斷言算 1 筆、更正後才斷言算 0 筆。
--        只測後者的話,一個「永遠回 0」的壞查詢照樣全綠 —— 本檔探針原本就犯了這個錯,已修)。
--
-- 🔴 **更正不可撤回**(合約,消費端照做):`NOT EXISTS` 只看【直接指向】。
--    A ← B ← C 的鏈裡,C 更正了 B **並不會**讓 A 重新算成有效 —— A 仍被 B 指著、仍被排除。
--    ⇒ 誤把一筆【有效的】 `customer_notified` 更正掉之後,**沒有還原路徑**
--      (partial unique 不准對 A 再掛第二筆更正)。唯一正解 = **重登一筆新的
--      `customer_notified` 原始紀錄**把證據重述一次(型別要含本體,不是寫一筆 internal 說明)。
--    這條要寫進 A10a 的 UI 文案與 A9a 的驗收條件,不能讓員工以為「更正的更正」會還原。
--
-- 🔴 **更正鏈可以成環 —— 我原本寫「物理上形不成」是錯的**(Fable 關卡2 F1 抓到,
--    主對話同時獨立實測命中,production 交易模擬確認成環成功)。
--    真正的語意:PG 的非 deferrable FK 是在**整條 statement 結束後**才驗,
--    所以**單一多列** `INSERT ... VALUES (a,…,corrects=b), (b,…,corrects=a)`
--    兩列互指時,FK 都找得到目標、partial unique 不擋(兩個 corrects 值相異)、
--    `corrects_not_self` 也不擋 ⇒ **A↔B 成環成立**,不需要 UPDATE、不需要 deferred。
--    後果:A10a 若天真地走鏈會無限迴圈;環內的 `customer_notified` 會被稽核全數排除。
--    ⇒ 正確說法是「**單列 INSERT 紀律下不可達**」,而那個紀律必須寫成驗收條件:
--      **A6 一次只准 INSERT 一列**(禁多列 VALUES / 禁 `INSERT ... SELECT` 回多列);
--      **A10a 走鏈必帶 visited 集合與深度上限**,不得假設鏈一定會終止。
--    擋在 DB 層需要 constraint trigger = T 型,不屬本片(§1 原則 1)。

-- ── ACL:service_role only + RLS zero-policy(樣板 = A2 / order_refunds)──
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_notes TO service_role;

-- ── 收工驗收(fail-closed)──────────────────────────────────
DO $$
DECLARE
  v_cnt        integer;
  v_def        text;
  v_cname      text;
  v_probe_ord  uuid;
  v_probe_ord2 uuid;
  v_probe_id   uuid;
BEGIN
  -- 1. RLS zero-policy
  --    🔴 誠實說明(同 A2):service_role 具 BYPASSRLS、table owner 亦不受 RLS 擋
  --    (刻意不加 FORCE,加了會弄斷 A6 這支 owner RPC)。RLS 在這張表的價值是縱深:
  --    日後有人誤 GRANT 給 anon/authenticated 時,zero-policy 仍然全拒。
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_notes'::regclass) THEN
    RAISE EXCEPTION 'A3 驗收失敗 — RLS 未啟用';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_notes';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'A3 驗收失敗 — 應為 zero-policy,實 % 條', v_cnt; END IF;

  -- 2. ACL allowlist(不只點名已知 role;理由見 A2 的 codex R1 第 1 條)
  SELECT count(*) INTO v_cnt
    FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_notes'::regclass
     AND a.grantee <> 0 AND a.grantee <> c.relowner
     AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A3 驗收失敗 — 表上有 % 筆非預期 grantee 的授權', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_notes'::regclass AND a.grantee = 0;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'A3 驗收失敗 — PUBLIC 竟有 % 筆授權', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_notes'::regclass AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'A3 驗收失敗 — 有 % 個欄位帶欄級 ACL', v_cnt; END IF;

  -- 🔴 append-only 的 DB 保證 = 沒有任何 role 有 UPDATE / DELETE
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE pg_catalog.has_table_privilege(r.role_name, 'public.order_notes', p.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A3 驗收失敗 — 表級寫權應為 0 個組合,實 %(append-only 靠這個守)', v_cnt;
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.order_notes', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.order_notes', 'SELECT') THEN
    RAISE EXCEPTION 'A3 驗收失敗 — 客人讀得到內部備註(原則 3 破口)';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_notes', 'SELECT') THEN
    RAISE EXCEPTION 'A3 驗收失敗 — service_role 讀不到本表';
  END IF;
  -- 🔴 精確證明 service_role 是「SELECT only」:只檢查四種寫權會漏掉 TRIGGER / REFERENCES
  --    這類誤授(codex R1)。改成把它實際持有的權限集合列出來比對。
  SELECT count(*) INTO v_cnt
    FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_notes'::regclass
     AND pg_catalog.pg_get_userbyid(a.grantee) = 'service_role'
     AND a.privilege_type <> 'SELECT';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A3 驗收失敗 — service_role 除了 SELECT 還持有 % 種其他權限', v_cnt;
  END IF;

  -- 3. FK 是 RESTRICT(聯絡紀錄與告知義務不得被靜默 CASCADE 掉)
  -- 🔴 加了更正鏈之後本表有【兩支】FK ⇒ 不能再用 `contype='f'` 撈(SELECT INTO 會靜默取
  --    任一支、斷言變成隨機通過)。逐支具名驗,而且先斷言總數。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_notes'::regclass AND contype = 'f';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A3 驗收失敗 — FK 應為 2 支(order_id + 更正鏈),實 % 支', v_cnt;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_notes'::regclass AND conname = 'order_notes_order_id_fkey';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'ON DELETE RESTRICT') = 0 THEN
    RAISE EXCEPTION 'A3 驗收失敗 — order_id FK 非 ON DELETE RESTRICT,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- 3b. 更正鏈:必須是【複合】FK(單欄 FK 擋不住跨單更正 —— 那正是這條要防的)
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_notes'::regclass
     AND conname = 'order_notes_corrects_same_order_fk';
  IF v_def IS DISTINCT FROM
     'FOREIGN KEY (corrects_note_id, order_id) REFERENCES order_notes(id, order_id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A3 驗收失敗 — 更正鏈 FK 定義不符(必須連 order_id 一起比對),實 [%]', COALESCE(v_def, '(不存在)');
  END IF;
  -- 一筆最多被更正一次
  SELECT pg_get_indexdef(indexrelid) INTO v_def FROM pg_index
   WHERE indexrelid = 'public.order_notes_corrects_note_id_key'::regclass;
  IF v_def IS NULL OR NOT (v_def LIKE '%UNIQUE%' AND v_def LIKE '%corrects_note_id IS NOT NULL%') THEN
    RAISE EXCEPTION 'A3 驗收失敗 — 更正鏈 partial unique 索引定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- 4. 行為探針
  SELECT id INTO v_probe_ord FROM public.orders ORDER BY id LIMIT 1;
  IF v_probe_ord IS NOT NULL THEN
    -- 正向:三種 note_type 各寫一筆
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author)
      VALUES (v_probe_ord, 'internal', '客人說下週再確認顏色', 'sean') RETURNING id INTO v_probe_id;
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'contact_log', '打電話確認地址', 'sean', 'phone', now());
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'customer_notified', '已告知缺貨需等三週', 'sean', 'line', now());
      IF v_probe_id IS NULL THEN RAISE EXCEPTION 'A3 驗收失敗 — 合法列寫不進去'; END IF;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation OR foreign_key_violation OR not_null_violation THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 合法列竟被拒(%)', SQLERRM;
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 負向:聯絡類缺管道 → 擋(U6 告知義務證據不成立)
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, occurred_at)
      VALUES (v_probe_ord, 'customer_notified', '已告知', 'sean', now());
      RAISE EXCEPTION 'A3 驗收失敗 — 已告知客人竟可不填管道';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_contact_fields_required' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:聯絡類缺時間 → 擋
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel)
      VALUES (v_probe_ord, 'contact_log', '打過電話', 'sean', 'phone');
      RAISE EXCEPTION 'A3 驗收失敗 — 聯絡紀錄竟可不填時間';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_contact_fields_required' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:內部備註帶管道 → 擋(分類挑錯)
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'internal', '備註', 'sean', 'line', now());
      RAISE EXCEPTION 'A3 驗收失敗 — 內部備註竟可帶管道';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_internal_fields_absent' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:全空白內容 → 擋(含全形空白 U+3000)
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author)
      VALUES (v_probe_ord, 'internal', U&'\3000  ', 'sean');
      RAISE EXCEPTION 'A3 驗收失敗 — 全空白備註竟被接受(含全形空白)';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_body_nonempty' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:非法 note_type → 擋
    -- 🔴 必須同時給 channel 與 occurred_at:否則「非 internal 卻缺聯絡欄」也會違反
    --    order_notes_contact_fields_required,兩條同時違反時 Postgres 報哪一條不保證,
    --    這條探針就會變成隨機紅(我第一版就是這樣被自己的 CONSTRAINT_NAME 斷言抓出來的)。
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'bogus', 'x', 'sean', 'line', now());
      RAISE EXCEPTION 'A3 驗收失敗 — 非法 note_type 竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_type_check' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:非法 channel → 擋
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'contact_log', 'x', 'sean', 'carrier_pigeon', now());
      RAISE EXCEPTION 'A3 驗收失敗 — 非法 channel 竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_channel_check' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:author 形狀不符 → 擋(對齊 staff slug 格式)
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author)
      VALUES (v_probe_ord, 'internal', 'x', 'Sean Hung');
      RAISE EXCEPTION 'A3 驗收失敗 — 非 slug 形狀的 author 竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_author_nonempty' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- ── 更正鏈探針(A3-1=A)──────────────────────────────
    -- 正向:誤選的「已告知客人」可以被後補的一筆更正掉,且稽核查詢看得出來
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'customer_notified', '誤選:其實還沒通知', 'sean', 'line', now())
      RETURNING id INTO v_probe_id;
      -- 🔴 **正向那一半**(Fable F3 抓到本探針原本缺這段 = 半條假綠):
      --    先斷言「還沒被更正時,稽核查詢算得到它」。少了這行,一個「永遠回 0」的
      --    壞查詢形狀(例如關聯條件寫錯)照樣通過,A9a 照抄樣板就會把全部訂單報成未告知。
      SELECT count(*) INTO v_cnt
        FROM public.order_notes n
       WHERE n.order_id = v_probe_ord
         AND n.note_type = 'customer_notified'
         AND NOT EXISTS (SELECT 1 FROM public.order_notes c WHERE c.corrects_note_id = n.id);
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 未被更正的「已告知客人」應算 1 筆,實 % 筆(稽核查詢形狀壞了)', v_cnt;
      END IF;
      INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
      VALUES (v_probe_ord, 'internal', '上一筆選錯類別,實際上沒有通知客人', 'staff_1', v_probe_id);
      -- 🔴 稽核合約的可執行版本:被更正的那筆不得算成已履行告知義務
      SELECT count(*) INTO v_cnt
        FROM public.order_notes n
       WHERE n.order_id = v_probe_ord
         AND n.note_type = 'customer_notified'
         AND NOT EXISTS (SELECT 1 FROM public.order_notes c WHERE c.corrects_note_id = n.id);
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被更正的「已告知客人」竟仍算成已履行(實 % 筆)', v_cnt;
      END IF;
      -- 原始列必須還在(append-only 的重點:看得到原本寫了什麼)
      SELECT count(*) INTO v_cnt FROM public.order_notes WHERE id = v_probe_id;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 更正後原始列竟不見了(append-only 被破壞)';
      END IF;
      -- 鏈可以延長:更正那筆更正
      INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
      SELECT v_probe_ord, 'internal', '更正的更正', 'sean', id
        FROM public.order_notes WHERE corrects_note_id = v_probe_id;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation OR foreign_key_violation OR not_null_violation OR unique_violation THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 合法的更正鏈竟被拒(%)', SQLERRM;
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 負向:同一筆被兩筆更正 → 擋(誰才算數答不出來)
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
      VALUES (v_probe_ord, 'customer_notified', '原始', 'sean', 'line', now())
      RETURNING id INTO v_probe_id;
      INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
      VALUES (v_probe_ord, 'internal', '更正一', 'sean', v_probe_id);
      BEGIN
        INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
        VALUES (v_probe_ord, 'internal', '更正二', 'sean', v_probe_id);
        RAISE EXCEPTION 'A3 驗收失敗 — 同一筆竟可被兩筆更正';
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 負向:更正別張單的紀錄 → 擋(複合 FK 的重點)
    SELECT id INTO v_probe_ord2 FROM public.orders WHERE id <> v_probe_ord ORDER BY id LIMIT 1;
    IF v_probe_ord2 IS NOT NULL THEN
      BEGIN
        INSERT INTO public.order_notes (order_id, note_type, body, author, channel, occurred_at)
        VALUES (v_probe_ord, 'customer_notified', 'A 單的告知', 'sean', 'line', now())
        RETURNING id INTO v_probe_id;
        BEGIN
          INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
          VALUES (v_probe_ord2, 'internal', 'B 單想蓋掉 A 單', 'sean', v_probe_id);
          RAISE EXCEPTION 'A3 驗收失敗 — 竟可拿別張單的紀錄去更正(跨單汙染)';
        EXCEPTION WHEN foreign_key_violation THEN NULL;
        END;
        RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
      EXCEPTION
        WHEN SQLSTATE 'PC001' THEN NULL;
      END;
    END IF;

    -- 負向:自己更正自己 → 擋
    BEGIN
      v_probe_id := gen_random_uuid();
      INSERT INTO public.order_notes (id, order_id, note_type, body, author, corrects_note_id)
      VALUES (v_probe_id, v_probe_ord, 'internal', '自我更正', 'sean', v_probe_id);
      RAISE EXCEPTION 'A3 驗收失敗 — 竟可自己更正自己';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_notes_corrects_not_self' THEN
        RAISE EXCEPTION 'A3 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:指向不存在的紀錄 → 擋
    BEGIN
      INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
      VALUES (v_probe_ord, 'internal', '指向幽靈', 'sean', gen_random_uuid());
      RAISE EXCEPTION 'A3 驗收失敗 — corrects_note_id 竟可指向不存在的列';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- 🔴 **已知破口的固定探針**(不是驗收、是把事實釘住):
    --    單一多列 INSERT 兩列互指【可以】成環 —— 上面那段註解原本宣稱「物理上形不成」是錯的。
    --    本探針斷言的是【現況確實會成環】。若哪天 PG 改變 statement-end FK 語意而這裡開始擋,
    --    探針會紅、逼人回來重讀合約,而不是讓一句過期的註解繼續躺在檔案裡。
    --    真正的防線 = A6「一次只准 INSERT 一列」+ A10a「走鏈帶 visited 與深度上限」。
    DECLARE
      v_cyc_a uuid := gen_random_uuid();
      v_cyc_b uuid := gen_random_uuid();
    BEGIN
      INSERT INTO public.order_notes (id, order_id, note_type, body, author, corrects_note_id)
      VALUES (v_cyc_a, v_probe_ord, 'internal', '環 A', 'sean', v_cyc_b),
             (v_cyc_b, v_probe_ord, 'internal', '環 B', 'sean', v_cyc_a);
      SELECT count(*) INTO v_cnt FROM public.order_notes WHERE id IN (v_cyc_a, v_cyc_b);
      IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'A3:多列 INSERT 成環的既知行為改變了(實 % 列)—— 請回頭重讀更正鏈合約', v_cnt;
      END IF;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 探針零殘留
    SELECT count(*) INTO v_cnt FROM public.order_notes;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'A3 驗收失敗 — 探針殘留 % 列', v_cnt; END IF;

    RAISE NOTICE 'A3 驗收全數通過(約束定義 + 行為探針 + ACL/RLS)';
  ELSE
    RAISE NOTICE 'A3 驗收通過(約束定義 + ACL/RLS);⚠️ orders 為空表,行為探針已略過';
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
-- ⚠️ DROP 之前必須先確認消費端已回滾:A6(append note owner RPC)、
--    A9a(明細投影)、A9d2(server action)、A10a(明細頁時間軸 UI)。
--
--   前置守門(破壞性指令之前):
--     DO $$ BEGIN
--       IF EXISTS (SELECT 1 FROM public.order_notes) THEN
--         RAISE EXCEPTION '已有聯絡紀錄/告知義務證據,DROP 會永久遺失 — 拒絕執行';
--       END IF;
--     END $$;
--     DROP TABLE public.order_notes;
-- ============================================================
