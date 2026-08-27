-- ============================================================
-- M-4b E10 第 1 批 · A7-1:order_cancellations + order_cancellation_items(取消真相)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表第 24 列(A7)、
--       §5.1b 資料合約、§5.1c 不變式、§5.1d 原因 allowlist、§1 原則 1/2/3
-- 片級 plan:docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md(v5)
-- 審查:關卡1 四輪 —— codex R1(19+4)/ codex R2(16+5)/ Fable R3 換模型換角度(8+6)/
--       Fable R4 delta(3+4)= 46 must-fix + 19 nit,全數接受、駁回 0
--       逐條裁定:docs/reviews/2026-07-30-e10-a7-k1-codex.md
-- 片型 M(純 schema;**零 trigger、零 DB 函式** —— 那些是 T 型,見 §1 原則 1)
--
-- ── 這張表在答什麼 ──────────────────────────────────────────
-- 「這張單被取消了幾件、為什麼、誰做的」。在它存在之前,系統裡**沒有任何地方**
-- 可以記錄取消這件事(27 項第 19 項實查 = ❌ 動作根本不存在)。
--
-- 🔴 為什麼不是在 orders 加一個 cancel_reason_code 欄(原則 3):
--    orders 對登入客人有表級 GRANT SELECT(`20260604120000:190`)+ orders_select_own RLS
--    ⇒ 客人讀得到**自己那張單的所有欄位**。而內部取消原因含 `internal_error`(我方疏失,
--    §5.1d 明定刻意不對客揭露、Sean 知情核准)⇒ 一個 byte 都不能放 orders。
--    由來逐字:docs/reviews/2026-07-28-e10-k1-findings-triage.md:134
--
-- 🔴 為什麼兩表同片建(R12):部分取消要記「哪個品項幾件」,單表表達不了 1:N;
--    且 A4a 重算 trigger 與 A8a2 的可取消量守門**都需要 items 當來源** ⇒ items 必須有具名落點。
--
-- 🔴 對客欄原封不動:orders.cancelled_at / cancelled_reason(`20260712203000:56-57` 建的、
--    全樹**零 writer**,packages/domain/src/order/types.ts:301 逐字「取消功能留取消片」)
--    由 A8a1 在整單取消時同交易寫入。**本片不碰。**
--
-- 🔴 寫入一律走 owner RPC(A8a1/A8a2),本片不對任何 role 開放寫權。
--
-- ── 沿用既有 pattern,不發明新的 ─────────────────────────────
-- order_refunds + order_refund_items(`20260725130100`)與本片**結構同形**:
-- header + 子表 + 兩道複合 FK 夾住「明細品項 ∈ header 的訂單」。
--   · order_items 的複合唯一鍵 `order_items_order_id_id_key UNIQUE (order_id, id)`
--     **早就存在**(`20260725130100:76-77`,RF2a-2 為同一需求加的)⇒ 本片**不 ALTER 任何 live 表**
--   · header 自帶 UNIQUE (id, order_id) 當子表複合 FK 的目標(同 `order_refunds_id_order_id_key:107`)
--   · 複合 FK 欄序必須對齊被引用唯一約束的欄序 ⇒ (order_id, order_item_id) → order_items (order_id, id)
--
-- ⚠️ **「不 ALTER」不等於「不取鎖」**(codex R1):建立指向 orders / order_items / staff 的 FK
--    需對**被引用表**取 SHARE ROW EXCLUSIVE,與 live 結帳的 INSERT 互斥
--    ⇒ 下面的 lock_timeout 不是樣板抄寫,是這一條的解。
--
-- ── 本片與 A7-2 / A7-t 的分界(鐵則 4 拆片)────────────────────
-- 本檔 = A7-1:建表 + 索引 + ACL + **結構/定義/ACL 驗收**。
--   🔴 **零合成資料、零行為探針、零條件略過** —— 行為驗證全在 A7-2
--      (`scripts/a7-behavior-probe.sql`:環境閘 + trigger inventory 閘 + 合成 fixture + **36 條探針**;
--       可重現驗證 = `scripts/a7-verify.sh`,含 21 條結構突變 + 13 條行為突變 + 兩組零突變對照)。
--   理由:v3 把探針放進 migration,codex R2 判它「探針前提不足時 NOTICE + exit 0」= fail-open 假綠,
--   且會讓 apply 交易持鎖時間跟著探針一起長。⇒ 拆開後本檔的驗收**沒有任何「略過」分支**。
-- A7-t(Sean 2026-07-30 拍 Q1=A 新增、另片):兩支 DEFERRED CONSTRAINT TRIGGER 擋「有 header、零明細」
--   —— 照 order_refunds 的形狀(`20260725130100:182-186` 逐字:只掛子表則空 header 完全擋不住)。
--   本片是 M 型不得放 trigger ⇒ 那個防線在 A7-t 落地才成立(見下方合約債 ④)。
--
-- 🔴 **結構驗收證明什麼、不證明什麼(誠實邊界,codex R1 #8 的教訓)**:
--    本檔的 DO block 證明「約束存在、形狀對、ACL 對」,**不證明語意對**。
--    例:reason_code 的 allowlist 若被寫成只允許 1 個值,單靠「約束存在」是抓不到的
--    ⇒ 那是 A7-2 的 7 條逐值正向探針的責任。兩片缺一，本片不得宣稱「取消原因已鎖對」。
-- ============================================================

BEGIN;

-- 🔴 建 FK 要對 orders / order_items / staff 取 SHARE ROW EXCLUSIVE、與 live 結帳 INSERT 互斥。
--    5 秒等不到就整片回滾、改挑離峰重跑,不賭(同 RF2a-2 `20260725130100:70-74` 的理由)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 1. order_cancellations:取消動作層級(一次取消 = 一列)══════════════════════
CREATE TABLE public.order_cancellations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 🔴 RESTRICT 而非 CASCADE(同 A2/A3):取消是要留存的事實,不得因為刪一張單就無聲消失。
  order_id         uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,

  -- §5.1d 七值 allowlist(Sean 2026-07-28 拍 Q18「照這份」)。未知 code 在 DB 層就擋掉、不靠 RPC 自律。
  reason_code      text        NOT NULL,

  -- `other` 的手寫文字落點(codex 關卡1 R7 抓:原合約無處存放 ⇒ 部分取消不寫 orders.cancelled_reason
  -- 時那段文字會直接遺失)。
  reason_detail    text,

  -- §5.1b 冪等鍵:**使用者開啟取消畫面時產生一次**、寫進表單 hidden field,整段互動(含重試、
  -- 含瀏覽器重新送出)沿用同一個。
  -- 🔴 用 uuid 型別是**本片做的實作決定、不是規格字面**(codex R1 nit):規格只要求「同一個鍵沿用」。
  --    好處 = 垃圾值在型別層就進不來、免形狀 CHECK;**代價 = producer 若改用 ULID 等 text 鍵會被拒**。
  --    先例 = orders.cart_session_id(`20260613130000:93`,同樣是 client 產的 uuid 冪等鍵)。
  idempotency_key  uuid        NOT NULL,

  -- §5.1b:同鍵**不同內容** = RAISE(不是靜默覆寫)⇒ 內容摘要必須存得下來才驗得出。
  -- 🔴 表示法由本片定死 = lowercase sha256 hex(對 A8a1 有約束力、不得改用 base64 / uppercase);
  --    **正規化(取哪些欄、什麼序、NULL 怎麼處理)是 A8a1 的債** ⇒ 見合約債 ①。
  -- 🔴 誠實邊界(codex R2):schema **只能擋外觀**。「這 64 個字元真的是 canonical payload 的 sha256」
  --    物理上無法在 schema 層強制 ⇒ A8a1 必附 golden vector。
  payload_hash     text        NOT NULL,

  -- 誰取消的。對齊 admin_audit_log.actor(`20260712210000:43`)的同一組 staff slug 值。
  -- 🔴 加 FK 到 staff(codex R2 nit 推翻我自己先寫的「不加」理由):實查 staff 停用走
  --    is_active=false、**不物理刪除**(`20260726120000:26-27`)、service_role **無 DELETE 權**、
  --    id **被刻意排除在 UPDATE 欄級授權外**(`:66-72`,理由逐字「改 id 會讓歷史稽核列變孤兒」)
  --    ⇒ **在現行授權合約下** FK 永不擋事,白賺一層防護。
  -- ⚠️ 措辭收斂(Fable R3 F9):不是「物理上永遠不會擋到任何東西」—— table owner / postgres
  --    仍可 DELETE staff,屆時 RESTRICT 會擋住,而那正是**想要**的行為(誤建的員工列不該連歷史一起消失)。
  -- ⚠️ FK 只證明 slug **存在於 staff**,**不證明 is_active** ⇒ 合約債 ⑥。
  -- 🔴 **刻意沒有形狀 CHECK**(第一版寫了、被自己的突變測試打掉):
  --    原本加了 `actor ~ '^[a-z0-9_]{1,64}$'`,理由是「FK 擋不存在的人、CHECK 擋形狀不對的字串」。
  --    實測突變(拿掉那條 CHECK)⇒ **探針照樣綠** —— 因為任何非 slug 值必然也不在 staff 裡,
  --    FK 會先擋下,拿到的是 foreign_key_violation 而不是 check_violation。
  --    ⇒ 兩道約束**互相遮蔽**,而且那條 CHECK **原理上無法被獨立證明**:
  --      FK 要求 actor ∈ staff.id,而 staff 自己有 staff_id_format(`20260726120000:21`)
  --      ⇒ 形狀已被**傳遞性保證**,CHECK 是嚴格被支配的死重。
  --    ⇒ 依「防護不得命名超出它的實際能力」砍掉:留一個測不到的約束比沒有更糟
  --      (它會讓約束總數閘與突變紅名單都出現一格永遠不會被驗到的東西)。
  actor            text        NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,

  created_at       timestamptz NOT NULL DEFAULT now(),

  -- ── 約束 ──────────────────────────────────────────────────
  -- §5.1b 冪等鍵:同一張單同一個鍵只有一列。
  CONSTRAINT order_cancellations_idempotency_key
    UNIQUE (order_id, idempotency_key),

  -- 供 order_cancellation_items 的複合 FK 反向引用(強制明細與 header 同一張訂單)。
  -- ⚠️ 本約束**自身沒有獨立負向探針**(Fable R4 N2 明文記錄、不假裝它被驗過):
  --    它擋的是「同一個 id 掛到不同 order_id」,而 id 是 PK ⇒ 那個情境物理上構不出來。
  --    它的價值全在「讓下面那道複合 FK 有東西可以指」。
  CONSTRAINT order_cancellations_id_order_id_key
    UNIQUE (id, order_id),

  -- §5.1d 七值。🔴 「存在」不等於「值域對」—— 逐值正向證明在 A7-2 探針 1-7(codex R1 #8:
  -- 只測「非法值被擋」的話,一個只允許 customer_request 的 CHECK 也會讓整組驗收通過)。
  CONSTRAINT order_cancellations_reason_code_check
    CHECK (reason_code IN (
      'customer_request',
      'out_of_stock',
      'long_leadtime',
      'price_change',
      'duplicate_order',
      'internal_error',
      'other'
    )),

  -- §5.1d:`other` 必填非空白、其餘六值必 NULL。
  -- 🔴 **單一雙向 CHECK**,不是兩條各管一半 —— 拆兩條的話「兩邊都放寬」不會被任何一條抓到。
  -- 🔴 非空白的判定 —— **刻意不用 `[[:space:]]`**(本片施工時實測推翻了 A2/A3 的做法):
  --    POSIX 字元類是**跟著 locale 走的**。實測(本機 C locale 的 PG17):
  --      `'　' ~ '[[:space:]]'` = **false** ⇒ `[^[:space:]]` 反而命中全形空白
  --      ⇒ 「other 配一格全形空白」**寫得進去**,而那正是這條要擋的東西。
  --    ⇒ 同一條 CHECK 在 C locale 與 UTF-8 locale 行為不同 = **harness 綠、正式站未知**。
  --    ⇒ 改成**明列碼位後比對空字串**:純字元集合運算、與 locale 無關、兩個環境逐字元同行為。
  --    清單 = ASCII 空白與控制字元 + Unicode 空白類 + 零寬類 + 三個「渲染全白但不屬空白類」的碼位
  --    (U+00AD 軟連字號 / U+2800 盲文空白 / U+3164 諺文填充 —— Fable R3 點名的那三個,現已納入)。
  -- ⚠️ **仍不宣稱窮盡**:Unicode 還有其他渲染近乎空白的碼位(組合用字元、變體選擇符…)。
  --    窮舉不完,最後一道歸 A8a1 的輸入正規化(合約債 ⑧)。差別在於:
  --    現在「清單裡的」是**確定擋得住**的,而不是「看 locale 心情」。
  -- 🔴 連帶開出 backlog:A2 / A3 的同款 CHECK 仍用 `[[:space:]]`,且它們的行為探針在隔離庫
  --    因空表而被略過(provision log 逐字「行為探針已略過」)⇒ 那條防護從未被實測。見 #305。
  CONSTRAINT order_cancellations_reason_detail_rule
    CHECK (
      CASE WHEN reason_code = 'other'
        THEN reason_detail IS NOT NULL
             AND pg_catalog.translate(
                   reason_detail,
                   U&'\0009\000A\000B\000C\000D\0020\0085\00A0\00AD\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\2060\2800\3000\3164\FEFF',
                   '') <> ''
        ELSE reason_detail IS NULL
      END
    ),

  -- lowercase sha256 hex。行為探針(長度不足 / 大寫 hex / 非 hex)在 A7-2 探針 14-16。
  -- 🔴 **明列 16 個字元、不用 `[0-9a-f]` range**(關卡2 抓;與 reason_detail 同一個病灶的第二處):
  --    PG 的 regex **range 也是 collation-dependent** —— `[a-f]` 在某些 collation 下可能納入
  --    我沒想到的字元(官方明文警告 range 依 collation 排序解讀)。
  --    本機 C locale 驗綠 ≠ 正式站 en_US.UTF-8 同行為 ⇒ 明列 16 字元後,兩邊逐字元同語意。
  -- 🔴 長度用 `{64}` **且錨定 ^$**:關卡2 抓「改成 `{64,}` 則超長 hash 被接受、而 63 字負測仍紅」
  --    ⇒ 這條的定義字面已納入 A7-1 的**逐字比對**(不只驗存在),放寬會當場被抓。
  CONSTRAINT order_cancellations_payload_hash_shape
    CHECK (payload_hash ~ '^[0123456789abcdef]{64}$')
);

COMMENT ON TABLE public.order_cancellations IS
  'M-4b E10 A7:訂單取消動作的真相表(每次取消一列;同一張單可取消多次 = 部分取消可分次)。🔴 service_role only:內部取消原因(含 internal_error「我方疏失」)絕不進 orders —— 那張表對登入客人開放讀自己的單。寫入一律走 owner RPC(A8a1/A8a2)。🔴 本片是 M 型:表結構就緒 ≠ 取消功能可用,寫入端與畫面在 A8/A13。';

COMMENT ON COLUMN public.order_cancellations.reason_code IS
  '內部取消原因,§5.1d 七值 allowlist(Sean 2026-07-28 拍 Q18)。🔴 對客文字由 A8a1 依 §5.1d 映射表產出、寫進 orders.cancelled_reason;未知 code 一律 RAISE fail-closed。internal_error 對客刻意映射成「依您要求取消」= 不揭露我方疏失(Sean 知情核准)。';
COMMENT ON COLUMN public.order_cancellations.reason_detail IS
  'reason_code = other 時的手寫必填文字;其餘六值必為 NULL(單一雙向 CHECK 強制)。整單取消時由 A8a1 映射為對客文字。🔴 非空白的判定**明列碼位、不用 [[:space:]]** —— 後者跟著 locale 走(本片實測 C locale 下全形空白 U+3000 不被判為 space ⇒ 一格全形空白會被放行);明列後兩個環境逐字元同行為。⚠️ 仍不宣稱窮盡(Unicode 還有其他渲染近乎空白的碼位)⇒ 最後一道在 A8a1 的輸入正規化。';
COMMENT ON COLUMN public.order_cancellations.idempotency_key IS
  '§5.1b 冪等鍵:使用者開啟取消畫面時產生一次、寫進表單 hidden field,整段互動(含重試、含瀏覽器重新送出)沿用同一個。🔴 不可由 server action 每次呼叫時產生 —— 那等於沒有防護(codex 關卡1 R4)。🔴 型別選 uuid 是本片的實作決定、非規格字面:代價是 producer 改用 ULID 等 text 鍵會被拒。';
COMMENT ON COLUMN public.order_cancellations.payload_hash IS
  '取消請求內容的摘要,用來判「同鍵不同內容」(§5.1b:該情形必 RAISE、不得靜默覆寫)。表示法由 A7 定死 = lowercase sha256 hex;🔴 正規化算法(取哪些欄、什麼序)由 A8a1 定死並附 golden vector。⚠️ schema 只能擋外觀 —— 「真的是 canonical payload 的 sha256」在 schema 層物理上無法強制。';
COMMENT ON COLUMN public.order_cancellations.actor IS
  '執行取消的 staff slug(FK 到 public.staff)。⚠️ FK 只證明這個 slug 存在,**不證明 is_active**(那條在 A8a1)。🔴 更重要的誠實邊界:E8-B 上線前操作者是使用者**自己從下拉挑的、系統未驗證**(apps/admin/src/lib/session/actor.ts:7 自陳非授權邊界)⇒ 本欄不得當責任歸屬的證據。';

-- A9g 的歷次取消歷程投影、A13b 的時間軸(依單取最近幾次)。
CREATE INDEX order_cancellations_order_created_idx
  ON public.order_cancellations (order_id, created_at DESC);

-- ── ACL:service_role only + RLS zero-policy ──────────────────
-- 樣板 = A2/A3(`20260729020000:162-168`);寫入一律走 owner RPC(SECURITY DEFINER 由表擁有者執行、
-- 不需要 role 權限)。
ALTER TABLE public.order_cancellations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_cancellations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_cancellations TO service_role;

-- ══ 2. order_cancellation_items:逐品項取消量 ═══════════════════════════════════
CREATE TABLE public.order_cancellation_items (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),

  cancellation_id  uuid    NOT NULL,
  -- 🔴 冗餘欄,存在的唯一理由 = 讓下方兩道複合 FK 能夾住「明細品項 ∈ header 的訂單」
  --    (逐字沿用 order_refund_items,`20260725130100:147`)。
  order_id         uuid    NOT NULL,
  order_item_id    uuid    NOT NULL,

  -- 🔴 **只有 > 0、無上限**(codex R1 #4 更正我的第一版):
  --    §5.1b 逐字只要求「> 0」;而 order_items.quantity 本身**也沒有上限**(`20260604120000:146`
  --    只有 quantity > 0)⇒ 加一個 100000 常數會造出「這張單合法存在、卻永遠無法被完整取消」的洞。
  -- ⚠️ **與 A2 的 allocated_quantity BETWEEN 1 AND 100000 刻意不同** —— 那條是 R6 對採購量的要求,
  --    不是本片的權威。真正的上界來自跨列不變式(A1 的 CHECK + A4a 重算 + A8a2 守門)⇒ 合約債 ②。
  -- 🔴 **這條修法本身需要守護**(Fable R3 F2):施工時手滑照抄 A2 的上限,32 條行為探針與結構斷言
  --    會**全綠**、R1 專門刪掉的錯原樣回歸 ⇒ 下方 DO block 對本約束做**定義字面比對**
  --    (必須恰為 `CHECK ((cancelled_quantity > 0))`),A7-2 另配一條大數量正向探針。
  cancelled_quantity integer NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),

  -- 🔴 兩道複合 FK 合力封死跨單串接(沿用 order_refund_items `:157-165` 的註解語意):
  --    cancellation_id 決定 order_id(來自 header)、order_id 又必須與 order_item_id 同屬一單
  --    ⇒ order A 的取消 header 無法掛 order B 的品項。
  --    單靠兩個獨立單欄 FK 做不到 —— A 的 header 掛 B 的品項,兩個 FK 各自都合法。
  -- 🔴 兩道必須**各自**被獨立證明(Fable R3 F3 / codex R2):單一「跨單」探針可能只觸發其中一道
  --    ⇒ A7-2 探針 26 / 27 各自 assert 精確的 CONSTRAINT_NAME。
  CONSTRAINT order_cancellation_items_cancellation_fk
    FOREIGN KEY (cancellation_id, order_id)
    REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT order_cancellation_items_order_item_fk
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id) ON DELETE RESTRICT,

  -- §5.1b:同一次取消不得重複列同一品項。
  -- 🔴 **跨次不受此限** —— 那正是「部分取消可分次」的基礎(同一品項可以在第二個 header 再被取消幾件);
  --    行為證明在 A7-2 探針 22(Fable R4 N6 要求寫死該探針必須讓同一 order_item_id 跨 header 重複出現)。
  CONSTRAINT order_cancellation_items_cancellation_item_key
    UNIQUE (cancellation_id, order_item_id),

  CONSTRAINT order_cancellation_items_quantity_positive
    CHECK (cancelled_quantity > 0)
);

COMMENT ON TABLE public.order_cancellation_items IS
  'M-4b E10 A7:逐品項取消量。同一次取消涵蓋幾個品項就有幾列;同一品項可跨多次取消累積(部分取消分次)。🔴 order_items.cancelled_quantity 的真相來源 = 本表 SUM(cancelled_quantity),那條等式由 A4a 重算 trigger 維護,本片(M 型、零 trigger)沒有 DB 層強制。🔴 service_role only。';

COMMENT ON COLUMN public.order_cancellation_items.order_id IS
  '冗餘欄,唯一理由 = 讓兩道複合 FK 夾住「明細品項必須屬於 header 那張訂單」。單靠兩個獨立單欄 FK 擋不住跨單串接(A 單的 header 掛 B 單的品項,兩個 FK 各自都合法)。';
COMMENT ON COLUMN public.order_cancellation_items.cancelled_quantity IS
  '這一次取消這個品項幾件。🔴 只有 > 0、刻意無上限:§5.1b 只要求 > 0,而 order_items.quantity 本身也無上限 ⇒ 加常數會造出「合法存在卻永遠無法完整取消」的訂單(codex 關卡1 R1)。真正的上界 = A1 的跨欄 CHECK + A4a 重算 + A8a2 的可取消量守門。';

-- 🔴 A8a2 的可取消量守門與 A9g 的「逐品項剩餘可取消量」都要**對單一品項跨多次取消聚合**
--    (同 order_refund_items_order_item_idx `:174` 的理由)。
CREATE INDEX order_cancellation_items_order_item_idx
  ON public.order_cancellation_items (order_item_id);

-- (cancellation_id, …) 的前導欄已被 UNIQUE (cancellation_id, order_item_id) 的索引覆蓋 ⇒ 不另建。

ALTER TABLE public.order_cancellation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_cancellation_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_cancellation_items TO service_role;

-- ══ 3. 結構驗收(fail-closed;任一條不成立 = 整片回滾)═══════════════════════════
-- 🔴 **本段沒有任何條件略過分支** —— 它只驗「結構、定義字面、ACL」,這些在任何環境都成立。
--    需要真實資料的行為探針全在 A7-2(codex R2:探針的資料前提不足時 NOTICE + exit 0 = fail-open 假綠)。
DO $$
DECLARE
  v_cnt   integer;
  v_def   text;
  v_tbl   text;
  v_code  text;
  v_cp       integer;
  v_cp_seen  integer := 0;
BEGIN
  -- ── 3.1 兩張表存在、PK 存在、逐欄 NOT NULL 與型別 ────────────
  FOREACH v_tbl IN ARRAY ARRAY['order_cancellations', 'order_cancellation_items'] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 不存在', v_tbl;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_constraint
     WHERE conrelid = ('public.' || v_tbl)::regclass AND contype = 'p';
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 的 PK 應為 1 支,實 % 支', v_tbl, v_cnt;
    END IF;
  END LOOP;

  -- 每一欄都必須 NOT NULL,除了 reason_detail(它就是要能為 NULL)。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_cancellations'::regclass
     AND attnum > 0 AND NOT attisdropped
     AND attname <> 'reason_detail'
     AND NOT attnotnull;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_cancellations 有 % 個非預期的 nullable 欄', v_cnt;
  END IF;
  IF (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'public.order_cancellations'::regclass AND attname = 'reason_detail') THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — reason_detail 竟是 NOT NULL(非 other 的 code 必須能留 NULL)';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_cancellation_items'::regclass
     AND attnum > 0 AND NOT attisdropped AND NOT attnotnull;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_cancellation_items 有 % 個 nullable 欄(應全部 NOT NULL)', v_cnt;
  END IF;

  -- 型別:idempotency_key 必 uuid(型別本身就是第一道守門 —— 它是「免形狀 CHECK」的理由,
  -- 被改成 text 的話那個理由就消失了、而且不會有任何行為探針轉紅)。
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.order_cancellations'::regclass AND attname = 'idempotency_key')
     <> 'uuid' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — idempotency_key 型別不是 uuid(垃圾值會從型別層漏進來)';
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.order_cancellation_items'::regclass AND attname = 'cancelled_quantity')
     <> 'integer' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — cancelled_quantity 型別不是 integer';
  END IF;
  -- 🔴 關卡2 must-fix:payload_hash 的型別原本沒驗 ⇒ 改成 varchar(64) 時 A7-1 與 36 條探針全綠,
  --    而 plan 指定的是 text 合約(varchar 的長度上限會與 CHECK 的 {64} 形成兩個真相)。
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.order_cancellations'::regclass AND attname = 'payload_hash')
     <> 'text' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — payload_hash 型別不是 text(varchar 會多出一個長度真相)';
  END IF;

  -- ── 3.2 default 的算式字面(換成別的函式要被抓)────────────────
  FOREACH v_tbl IN ARRAY ARRAY['order_cancellations', 'order_cancellation_items'] LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = ('public.' || v_tbl)::regclass AND a.attname = 'id';
    IF v_def IS DISTINCT FROM 'gen_random_uuid()' THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — %.id 的 default 不是 gen_random_uuid(),實 [%]',
        v_tbl, COALESCE(v_def, '(無)');
    END IF;
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = ('public.' || v_tbl)::regclass AND a.attname = 'created_at';
    IF v_def IS DISTINCT FROM 'now()' THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — %.created_at 的 default 不是 now(),實 [%]',
        v_tbl, COALESCE(v_def, '(無)');
    END IF;
  END LOOP;

  -- ── 3.3 索引定義字面(漏建無任何行為異常、只會慢 ⇒ 沒守門就永遠不會被發現)──
  -- 🔴 **逐字比對、不用 LIKE**(關卡2 nit:`%(order_id, created_at DESC)` 這種尾綴比對會讓
  --    「同欄序但加了 WHERE false」的無效部分索引照樣通過 ⇒ 驗收綠而索引實際上撈不到任何列)。
  SELECT pg_get_indexdef('public.order_cancellations_order_created_idx'::regclass) INTO v_def;
  IF v_def IS DISTINCT FROM 'CREATE INDEX order_cancellations_order_created_idx ON public.order_cancellations USING btree (order_id, created_at DESC)' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 歷程索引定義不符(欄序錯、或被加上 WHERE 條件),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;
  SELECT pg_get_indexdef('public.order_cancellation_items_order_item_idx'::regclass) INTO v_def;
  IF v_def IS DISTINCT FROM 'CREATE INDEX order_cancellation_items_order_item_idx ON public.order_cancellation_items USING btree (order_item_id)' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 逐品項聚合索引定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- ── 3.4 約束總數閘(先擋總數再撈定義)────────────────────────
  -- 🔴 Fable F6 + R3 F2:裸 contype 的 SELECT INTO 在多支同型約束時會**靜默取任一支**,
  --    斷言就變成隨機通過。⇒ 每一類都先數,數不對就停。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass AND contype = 'f';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_cancellations 的 FK 應為 2 支(order_id / actor),實 %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass AND contype = 'u';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_cancellations 的 UNIQUE 應為 2 支,實 %', v_cnt;
  END IF;
  -- 🔴 恰 3 支 —— **不是 4 支**:`actor` 的形狀 CHECK 已被刻意移除(它被 actor FK 嚴格支配、
  --    原理上無法獨立證明;見上方欄位註解)。若有人「順手補回來」,這一條會當場擋下。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass AND contype = 'c';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_cancellations 的 CHECK 應恰為 3 支(reason_code / reason_detail / payload_hash),實 %(若是 4,很可能有人補回了被支配的 actor 形狀 CHECK)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass AND contype = 'f';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — items 的複合 FK 應為 2 支,實 %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass AND contype = 'u';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — items 的 UNIQUE 應為 1 支,實 %', v_cnt;
  END IF;
  -- 🔴 這一條是 Fable R3 F2 的守門:CHECK 恰好 1 支 ⇒ 偷偷多加一條上限 CHECK 會當場被抓。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass AND contype = 'c';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — items 的 CHECK 應恰為 1 支(只有 cancelled_quantity > 0),實 %(多出來的很可能是照抄 A2 的數量上限 —— 那條會讓 quantity > 上限的單永遠無法完整取消)', v_cnt;
  END IF;

  -- ── 3.5 逐支約束的定義字面 ────────────────────────────────
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass
     AND conname = 'order_cancellations_idempotency_key' AND contype = 'u' AND convalidated;
  IF v_def IS DISTINCT FROM 'UNIQUE (order_id, idempotency_key)' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 冪等鍵定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass
     AND conname = 'order_cancellations_id_order_id_key' AND contype = 'u' AND convalidated;
  IF v_def IS DISTINCT FROM 'UNIQUE (id, order_id)' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 複合 FK 的目標鍵定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- header 的 order_id FK 必須是 RESTRICT(codex R1 #11:v1 完全沒驗這支)。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass AND contype = 'f'
     AND conname = 'order_cancellations_order_id_fkey';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'ON DELETE RESTRICT') = 0 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — header 的 order_id FK 非 ON DELETE RESTRICT(取消事實會被靜默 CASCADE 掉),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- 🔴 **逐字比對、含 ON DELETE RESTRICT**(關卡2 must-fix:原本只 strpos 'REFERENCES staff(id)'
  --    ⇒ 改成 `ON DELETE CASCADE` 全部驗收仍綠,而那會讓「刪一個誤建的員工」把取消歷史一起帶走)。
  --    字面格式已對正式站(PG 17.6)實查同形約束確認一致,非本機 17.10 獨有渲染。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass AND contype = 'f'
     AND conname = 'order_cancellations_actor_fkey';
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (actor) REFERENCES staff(id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — actor FK 定義不符(必須含 ON DELETE RESTRICT),實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- 🔴 **reason_code:逐字比對整條 allowlist、不是「七值有出現」**(關卡2 must-fix)。
  --    原寫法只 strpos 七個值 ⇒ **加入第八個值不會被抓到**(只要別剛好是探針用的那個字串);
  --    而探針 9 只試一個非法值,兩邊合起來仍有洞。逐字比對把值域鎖死。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass
     AND conname = 'order_cancellations_reason_code_check' AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM
     'CHECK ((reason_code = ANY (ARRAY[''customer_request''::text, ''out_of_stock''::text, ''long_leadtime''::text, ''price_change''::text, ''duplicate_order''::text, ''internal_error''::text, ''other''::text])))' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — reason_code allowlist 定義不符 §5.1d 七值(多一個值或少一個值都算不符),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- 🔴 **payload_hash:逐字比對**(關卡2 must-fix:原本只驗存在 ⇒ 改成 `{64,}` 讓超長 hash
  --    被接受,而 63 字/大寫/非 hex 三條負測仍紅、64 字正向仍綠 ⇒ 整套驗收看不出來)。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass
     AND conname = 'order_cancellations_payload_hash_shape' AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM 'CHECK ((payload_hash ~ ''^[0123456789abcdef]{64}$''::text))' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — payload_hash 形狀定義不符(必須是明列 16 字元 + 恰 64 碼 + 錨定),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- 🔴 **reason_detail:逐碼位斷言**(關卡2 must-fix:原本只驗存在 ⇒ 從 translate 清單拿掉
  --    U+180E 這類沒被探針覆蓋的碼位,36 條探針與結構驗收會全綠)。
  --    ⚠️ 為什麼不逐字比對整條:它的定義字面裡是**真正的不可見字元** ——
  --    寫進 migration 原始碼會變成一串隱形 byte,沒有人看得懂、也沒人改得動。
  --    ⇒ 改成「清單裡每一個碼位都必須出現在定義裡」,語意等價且可讀。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellations'::regclass
     AND conname = 'order_cancellations_reason_detail_rule' AND contype = 'c' AND convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — reason_detail 雙向規則不存在或未 validated';
  END IF;
  -- 34 個碼位:ASCII 空白與控制 / Unicode 空白類 / 零寬類 / 三個「渲染全白但不屬空白類」
  FOREACH v_cp IN ARRAY ARRAY[
      x'0009'::int, x'000A'::int, x'000B'::int, x'000C'::int, x'000D'::int, x'0020'::int,
      x'0085'::int, x'00A0'::int, x'00AD'::int, x'1680'::int, x'180E'::int,
      x'2000'::int, x'2001'::int, x'2002'::int, x'2003'::int, x'2004'::int, x'2005'::int,
      x'2006'::int, x'2007'::int, x'2008'::int, x'2009'::int, x'200A'::int,
      x'200B'::int, x'200C'::int, x'200D'::int, x'2028'::int, x'2029'::int,
      x'202F'::int, x'205F'::int, x'2060'::int, x'2800'::int, x'3000'::int,
      x'3164'::int, x'FEFF'::int] LOOP
    IF pg_catalog.strpos(v_def, pg_catalog.chr(v_cp)) = 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — reason_detail 的剝除清單缺少碼位 U+%(有人從清單拿掉了它;那個字元會變成合法的「手寫文字」)',
        upper(to_hex(v_cp));
    END IF;
    v_cp_seen := v_cp_seen + 1;
  END LOOP;
  IF v_cp_seen <> 34 THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 碼位斷言只跑了 % 次,預期 34', v_cp_seen;
  END IF;

  -- items 的兩道複合 FK:**欄序**與 RESTRICT 都要對。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass
     AND conname = 'order_cancellation_items_cancellation_fk' AND contype = 'f';
  IF v_def IS DISTINCT FROM
     'FOREIGN KEY (cancellation_id, order_id) REFERENCES order_cancellations(id, order_id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — cancellation 複合 FK 定義不符(單欄 FK 或欄序錯都擋不住跨單),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass
     AND conname = 'order_cancellation_items_order_item_fk' AND contype = 'f';
  IF v_def IS DISTINCT FROM
     'FOREIGN KEY (order_id, order_item_id) REFERENCES order_items(order_id, id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — order_item 複合 FK 定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass
     AND conname = 'order_cancellation_items_cancellation_item_key' AND contype = 'u' AND convalidated;
  IF v_def IS DISTINCT FROM 'UNIQUE (cancellation_id, order_item_id)' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — 同次取消不重複列同品項的 UNIQUE 定義不符,實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- 🔴 Fable R3 F2 的核心守門:必須**恰為** `> 0`,不得有上限。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_cancellation_items'::regclass
     AND conname = 'order_cancellation_items_quantity_positive' AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM 'CHECK ((cancelled_quantity > 0))' THEN
    RAISE EXCEPTION 'A7-1 驗收失敗 — cancelled_quantity 的 CHECK 必須恰為 (cancelled_quantity > 0)、不得加上限(§5.1b 只要求 > 0,而 order_items.quantity 本身無上限 ⇒ 加常數會造出永遠無法完整取消的單),實 [%]',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- ── 3.6 兩張新表零 user trigger(Fable R4 N6)──────────────
  -- 🔴 M 型「零 trigger」是本片的自我約束,先前沒有任何 DB 層驗收。
  --    沒有這條,一支偷偷加上的 clamp trigger 可以讓 A7-2 的大數量正向探針看起來綠、實際值被改掉。
  -- ⚠️ **A7-t 落地後這條必須改成「恰好 2 支、且是預期的那兩支」**(A7-t 的驗收條件)。
  FOREACH v_tbl IN ARRAY ARRAY['order_cancellations', 'order_cancellation_items'] LOOP
    SELECT count(*) INTO v_cnt FROM pg_trigger
     WHERE tgrelid = ('public.' || v_tbl)::regclass AND NOT tgisinternal;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 有 % 支 user trigger(本片是 M 型、應為 0;主從一致 trigger 屬 A7-t)',
        v_tbl, v_cnt;
    END IF;
  END LOOP;

  -- ── 3.7 RLS / ACL(兩張表逐條重驗,不假設「跟上面一樣」)──────
  -- 🔴 誠實說明(沿用 A2 `20260729020000:248-254` 完整版):service_role 具 BYPASSRLS,policy 對它
  --    根本不執行 ⇒ RLS 在這張表**擋不住 service_role**,真正的防線是 ACL(它只有 SELECT)與金鑰保密。
  --    RLS 的價值是縱深:日後有人誤 GRANT 給 anon/authenticated 時,zero-policy 仍然全拒。
  --    ⚠️ table owner 同樣不受 RLS 擋(刻意不加 FORCE ROW LEVEL SECURITY —— 加了會把 A8a1 這支
  --       owner RPC 自己弄斷)。
  --    ⚠️ **本段斷言的天花板**:role 繼承(某 role 被加進 service_role)與 pg_read_all_data 這類
  --       叢集層授權**不在 relacl 裡**,表層斷言物理上看不到 —— 不要誤以為這是完備證明。
  FOREACH v_tbl IN ARRAY ARRAY['order_cancellations', 'order_cancellation_items'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_tbl)::regclass) THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % RLS 未啟用', v_tbl;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tbl;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 應為 zero-policy,實 % 條', v_tbl, v_cnt;
    END IF;

    -- 三個 role 一律無寫權(寫入一律走 owner RPC)
    SELECT count(*) INTO v_cnt
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
     WHERE pg_catalog.has_table_privilege(r.role_name, 'public.' || v_tbl, p.priv);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 的表級寫權應為 0 個組合,實 %', v_tbl, v_cnt;
    END IF;

    IF pg_catalog.has_table_privilege('anon', 'public.' || v_tbl, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 客人讀得到表 %(原則 3 破口:內部取消原因含 internal_error)', v_tbl;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — service_role 讀不到表 %', v_tbl;
    END IF;

    -- grantee allowlist:整張表的 grantee 只准 owner 與 service_role
    -- (codex R1:只點名三個已知 role 不夠 —— production 的 default privileges 可能授給我們沒想到的
    --  custom role,而 REVOKE 只收回我們寫出來的那幾個)。
    SELECT count(*) INTO v_cnt
      FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
     WHERE c.oid = ('public.' || v_tbl)::regclass
       AND a.grantee <> 0
       AND a.grantee <> c.relowner
       AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role';
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 上有 % 筆非預期 grantee 的授權', v_tbl, v_cnt;
    END IF;

    SELECT count(*) INTO v_cnt
      FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
     WHERE c.oid = ('public.' || v_tbl)::regclass AND a.grantee = 0;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 的 PUBLIC 竟有 % 筆授權', v_tbl, v_cnt;
    END IF;

    -- service_role 除 SELECT 外不得持有任何權限(只檢查四種寫權會漏掉 TRIGGER / REFERENCES)
    SELECT count(*) INTO v_cnt
      FROM pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
     WHERE c.oid = ('public.' || v_tbl)::regclass
       AND pg_catalog.pg_get_userbyid(a.grantee) = 'service_role'
       AND a.privilege_type <> 'SELECT';
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 的 service_role 除 SELECT 外還持有 % 種權限', v_tbl, v_cnt;
    END IF;

    -- 欄級 ACL 必須完全不存在(has_table_privilege 抓不到只授到單欄的 grant)
    SELECT count(*) INTO v_cnt FROM pg_attribute
     WHERE attrelid = ('public.' || v_tbl)::regclass
       AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-1 驗收失敗 — 表 % 有 % 個欄位帶欄級 ACL', v_tbl, v_cnt;
    END IF;
  END LOOP;

  RAISE NOTICE 'A7-1 結構驗收全數通過(結構 + default 算式 + 索引定義 + 約束總數與字面 + 零 trigger + ACL/RLS)。🔴 行為未驗 —— 跑 scripts/a7-behavior-probe.sql(A7-2)。';
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
-- 執行程序 = `docs/runbooks/2026-07-30-a7-rollback.md`
--   🔴 **該檔目前尚未撰寫**(關卡2 must-fix:原註解寫得像它已存在)。
--      承接時點 = **A8a1 開工前置**(第一個 writer 出現之前必須存在);現在本表零寫入 GRANT ⇒ 風險窗未開。
--      在它存在之前,下列程序就是唯一依據,**不得視為已有可執行的 runbook**。
--   🔴 承接時點 = **A8a1 開工前置**(Fable R4 N7):runbook 必須在**第一個 writer 出現之前**存在。
--      現在還沒有 writer(本表零寫入 GRANT)⇒ 風險窗未開;A8a1 一落地,窗就開了。
--      實際執行者是**某個有 context 的 AI session**,不是 Sean 本人(他無法核 diff)。
--
-- ── 前置守門(破壞性指令之前,不是之後)──────────────────────
-- 1. 資料守門:兩張表任一有列 ⇒ 拒絕執行。
--    🔴 **但必須帶 escape**(Fable R3 F6):壞資料入表**正是**回滾動機
--       ⇒ 絕對拒絕會在它唯一被需要的那天擋死自己,半夜出事只剩「現場即興繞過守門」= 守門歸零。
--    明文 escape(三步,runbook 逐字):
--      ①資料整表搬進 order_cancellations_archive_YYYYMMDD
--        🔴 archive 表的 ACL 必須**逐字複製**本檔的三件套(Fable R4 N3):
--           Supabase 對**新建的表會自動 re-grant default privileges**
--           (`20260726120000` 的 staff migration 明文「先撤 default-privilege re-grant」才精準補權)
--           ⇒ 照 runbook 隨手 CREATE TABLE 會**繼承 anon/authenticated 授權且無 RLS**
--           ⇒ internal_error「我方疏失」透過 PostgREST **對客可讀** = 原則 3 在回滾路徑上破口。
--           ⇒ ENABLE ROW LEVEL SECURITY + REVOKE ALL FROM PUBLIC, anon, authenticated, service_role
--             + GRANT SELECT TO service_role,搬完**當場斷言** anon/authenticated 零權限。
--      ②Sean 拍板覆核筆數與內容
--      ③守門才放行
-- 2. 依賴守門(只寫現在可驗證的實名):
--      · order_items.cancelled_quantity 欄存在 ⇒ 拒絕(A1 未回滾)
--      · 掛在這兩張新表上的任何 trigger 存在 ⇒ 拒絕(A7-t 未回滾)
--
-- 🔴 **DB 守門擋不到的,誠實列成人工核對清單**(不假裝 DB 涵蓋得到):
--    · admin_cancel_order(A8a1/A8a2)—— 現在還不存在,查存在無意義
--    · begin_charge_attempt / confirm_order_payment 的**取消守門版本**(A8c1/A8c2)
--      —— 🔴 兩支現在就存在、且守門版本**沒有不同的物件名** ⇒ 查存在會讓回滾從第一天就被擋死。
--         只能人工確認「已改回不查取消表的版本」(讀 prosrc 判版本)。
--    · A8b 的退款 enqueue RPC —— master plan 只有描述、**無實名**;猜名字的守門 = 永遠通過的守門
--    · 應用層:A9g / A9d2 / A13a-b / A11a-c / A2b1-A2b2 / A9c / A9d1 —— 需在**部署版本**層面確認
--
-- ── DROP 順序(不可換)──────────────────────────────────────
--   DROP TABLE public.order_cancellation_items;   -- 先子表
--   DROP TABLE public.order_cancellations;        -- 反了會被 FK RESTRICT 直接擋
-- ============================================================
