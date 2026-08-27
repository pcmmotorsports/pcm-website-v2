-- ============================================================
-- M-4b 生命週期 L5a-M:payment_charge_attempts 加「L5 自動裁定讓路」durable 標記(dormant、零行為)
-- ============================================================
-- 真權威:母 plan docs/specs/2026-08-09-l4-l5-settlement-compensation-plan.md §3.1/§3.2/§7-2
--   + 片級 plan P-280-STOP §2/§5 + 主視窗核准 P-282-A(片界照案 3 片、夜間只 commit 不 apply)。
-- 依賴:20260612150000(payment_charge_attempts 表)、20260624120000(R1a1 released 狀態 + 7 生命週期欄)。
-- 鐵則 12③(DB 結構);鐵則 8 由 P-280-STOP + P-282-A 滿足。
--
-- 🔴 這個欄位存在的唯一理由(母 plan §7-2 逐字要求寫在檔頭):
--   L5b 的自動退款**不能只看 `attempt.status = 'released'`**。既有 preflight release CAS
--   (`mark_charge_attempt_released_for_user`,20260624120002)也會把 attempt 寫成 `released`
--   —— 那是**客人自己按重新付款**產生的,不在 Q9 的自動退款授權範圍內(母 plan §6「未涵蓋」、backlog #349)。
--   兩者在 `status` 這一欄上**完全不可分辨** ⇒ 只認 status 的補償邏輯會把客人自己重刷的舊授權也退掉。
--   誤退比雙扣更糟(客人付了錢、訂單成立、貨可能已出,我們卻把錢退回去)。
--   ⇒ 本片加的 `superseded_at` 就是那條分界線:**只有 L5 自動裁定讓路的路徑會寫它**,
--      preflight release CAS 那支一個字都不會動它(該支的 UPDATE 欄位清單見 20260624120002:54-59)。
--
-- 🔴 **provenance:CHECK 證不了「這個標記是誰寫的」**(codex 關卡2 R2 唯一未以 schema 修掉的一條,
--   已上報主視窗待裁;把真實防線寫在這裡,免得下一個人以為約束保證了出處):
--   CHECK ⑤ 只證「這筆確實被 release 過、且 release 不晚於讓路」,**證不到**寫標記的人就是 L5。
--   理論上 preflight CAS 先寫了 `released_at`,之後另一個寫入者補上 `superseded_*`,五條 CHECK 全過。
--   真正擋這條路的**不是約束,是寫入面**:本表零直接寫入權限 —— `REVOKE ALL FROM PUBLIC/anon/
--   authenticated/service_role` + `service_role` 只留 SELECT + RLS enable 零 policy(20260612150000:115-121),
--   ⇒ 唯一寫得進來的是 owner 與 `SECURITY DEFINER` RPC。本片的 harness 對**新三欄**逐項實測了這件事
--   (ACL-UNIVERSAL 格:表級+欄級 ACL **全集**掃描,非枚舉角色名)。
--   ⇒ 因此 provenance 的保證鏈是「零直接權限 + 只有受控 RPC 寫得到」,**不是**「約束擋得住」。
--   🔴 對 L5b 的硬契約:標記是退款授權的**必要非充分**條件 —— L5b 不得只憑本欄退款,
--      必須自己去驗權威的請款證據(母 plan §3.2)。失效條件:若日後出現 L5a-1 以外的第二個
--      superseded_* 寫入者,這條推理立刻失效,屆時要改用 append-only 決策紀錄。
--   🔴 **失效條件要有偵測器,不能只寫在註解裡**(R3 MF-1;memory
--      `feedback_withdrawal-reason-needs-expiry-condition` 的原形:「零可達」是時點觀察、不是恆真):
--      本片自己的 harness 只重放 **TS < 本檔** 的前綴 ⇒ 日後任何 `GRANT UPDATE`、任何新的 SECDEF
--      writer、任何第二寫入者,它**永遠不會紅**。偵測器因此指名放在下游、隨前綴一起長大:
--        · **L5a-1 harness**:斷言「**public 函式面**恰一個本體含 `superseded_`」(= 只有 supersede RPC)。
--          🔴 射程僅止於此(P-290 Q2=A 縮窄):跨 schema 函式、trigger、動態 SQL、migration 直接 UPDATE
--          都寫得到標記而它照樣綠 ⇒ **不得**把它讀成「全庫只有受控 RPC 寫得到」。
--          真正的結構保證(受限 owner 的 append-only 決策紀錄 / writer registry)= **L5b 前置設計題**;
--        · **L5a-1 / L5b harness**:當期 ACL **全稱**斷言(非 owner 者一律只有 SELECT、零 GRANT OPTION),
--          不是枚舉今天想得到的那幾個角色名。
--      ⚠️ 兩者都沒有掛 CI ⇒ 只有「有人跑那支 harness」時才會紅。這是現況、不是設計,寫出來別假裝有 oracle。
--
-- 🔴 為什麼 L5 讓路是走 `released` 而不是 `failed`(語意選擇,寫下來免得下一片改掉):
--   `released` 恰好就是「退出去重 / in-flight 鎖、但真失敗未定、留在對帳集」這個語意
--   (20260624120000:11-13 逐字),而 L5 讓路要的正是這三件事:
--     ① 退出 per-user 閘與 cart dedup(兩者述詞都是 status IN ('pending','charged'))⇒ 新單走得通;
--     ② 留在 per-order UNIQUE index(含 released)⇒ **同一張舊單**不會再被掛新 attempt;
--     ③ 留在 sweeper 低頻對帳(R1c1/R1c2)⇒ 它後來若轉 AUTH/已請款,L5b 盯梢看得到。
--   ⇒ 本片**不新增狀態值**、不動 status CHECK、不動任何 index。整套既有 released 生命週期直接複用。
--
-- 🔴 解除路徑枚舉(lessons §12-40「攔阻/標記是成對不變式」——加標記必須同時說清楚誰解除它):
--   **這個標記沒有解除路徑,因為它不是狀態、是歷史事實**:「這筆 attempt 曾被 L5 自動裁定讓路」
--   一旦為真就永遠為真。所以:
--     · 沒有任何路徑會把 superseded_at 清回 NULL(write-once,COALESCE 不覆蓋);
--     · attempt 的**狀態**照走既有 released 生命週期,三條出口一條都不變:
--         released→charged(R1b1c genesis + anomaly)/ released→failed(R1c3 人工 close)/ 續留 released 對帳;
--     · L5b 的「已補償過 / 用了哪把鍵 / 結果」是**另一組欄**,由 L5b 自己那片加,**不覆寫本標記**
--       (本標記是「該不該補償」的依據,補償帳是「補償做了沒」的紀錄,兩件事不共用欄)。
--   ⇒ 因此**刻意沒有** `CHECK (superseded_at IS NULL OR status = 'released')`:
--      released→charged 與 released→failed 都是既有合法轉移,綁死會在 genesis/close 路徑上炸。
--
-- 🔴 三欄與既有 7 個 released 生命週期欄(20260624120000:51-57)的分工:
--   那 7 欄記的是「released 這個**狀態**的生命週期」(何時 release、何時進人工、觀察到什麼、何時結案);
--   本片 3 欄記的是「**是誰**把它 release 的」。前者對兩條 release 路徑都寫,後者只有 L5 那條寫。
--
-- ⚠️ dormant:本片**零行為**——只加欄與約束,沒有任何寫入者。
--   寫入者是 L5a-1(begin_charge_attempt 三岔的讓路分支),消費者是 L5b(補償盯梢)。
--   在 L5a-1 上線前,三欄恆為 NULL、所有既有查詢一個字都不用改(全 nullable、無 DEFAULT、不回填)。
--   「欄建好但守門還沒上」這個窗口是**刻意**的(P-280-STOP §2:兩邊都能單獨 rollback)。
--   🔴 值班判別法(R3 C-2):L5a-1 上線**之後**,「三欄全 NULL」有三個互不相同的意思 ——
--      ①真的沒有人被讓路過 ②L5a-1 沒 deploy 成功 ③讓路路徑寫壞了。三者在 DB 上長得一樣。
--      分辨法:拿 app 端「讓路」的 log 筆數 對 `count(*) WHERE superseded_at IS NOT NULL` 對帳,
--      兩邊都是 0 = ①;log 有數字而標記列數 0 = ②或③(再看 supersede RPC 存不存在就分得開)。
--      沒有這條,「安靜」會被讀成「一切正常」——而這片最惡的失敗形狀正好就是安靜。
--
-- ⚠️ 既有列全部通過新約束:三欄皆 NULL ⇒ pair CHECK 走「同時 NULL」那支、其餘四條前提為假。
--
-- ⚠️ **鎖與掃表的誠實版**(codex 關卡2 R1-F3 打掉了本檔原本那句「不掃表回填、不長鎖」):
--   · `ADD COLUMN` 三欄全 nullable、無 DEFAULT ⇒ **不重寫表**(這半句本來就對,對齊 20260624120000:31);
--   · 但 **五條 `ADD CONSTRAINT CHECK` 預設會 validate 既有列 ⇒ 要掃表**;
--     五條寫在**同一個 `ALTER TABLE`** 內 ⇒ PG 通常合併成**一次** validation scan,不是五次
--     (codex 關卡2 R2 nit-1 校正了本檔前一版「各掃一次」的說法);
--   · `superseded_by_order_id` 的 inline `REFERENCES public.orders(id)` 會建 FK 並驗證,
--     過程中**對 `public.orders` 取 SHARE ROW EXCLUSIVE 鎖**;
--   · 整段包在單一 `BEGIN … COMMIT` 內 ⇒ 上述所有鎖**持有到 COMMIT**。
--   ⇒ 正確的說法是:成本 = 一次 `payment_charge_attempts` 全表掃(該表為 attempt 級、量小)
--     + 一段對 `orders` 的 SHARE ROW EXCLUSIVE。不是「零掃表零長鎖」。
--   沒有改成 `NOT VALID` + 事後 `VALIDATE CONSTRAINT` 的理由:那要拆成兩次 apply、
--   中間存在一段「欄在、約束沒生效」的窗口,而本片的整個價值就是那些約束;
--   以本表的量,單次掃表的成本遠低於多一個半上線狀態的風險。**apply 仍照慣例由人挑時機執行。**
--
-- ⚠️ ACL:三欄不做任何 column-level GRANT。表層 ACL(20260612150000:118-121)= anon/authenticated 全零、
--   service_role 唯 SELECT,新欄自動繼承表層,權限面零擴張(驗證見 scripts/l5am-verify.sh 的 ACL 格)。
--   三欄內容無 PII、無金額、無卡號,service_role 讀得到不構成洩漏面。
--
-- ⚠️ 沒加索引(YAGNI):L5b 盯梢的查詢還沒寫,現在猜索引形狀會猜錯。
--   既有 sweeper 已經在掃 released 集合(R1c2 predicate),L5b 若證明需要 partial index
--   (`WHERE superseded_at IS NOT NULL`)由它那片加、附上會用到它的那句查詢。
--   同理 superseded_by_order_id 的 FK 反向索引也沒加:orders 不做實體刪除(取消是 soft、A8a 家族)。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**(P-282-A 裁 4:L5a 全片=錢面 ⇒ 夜間只 commit,apply 排早上 Sean 批次)。
-- Rollback(Supabase forward-only;逆序手動執行):見檔尾。
-- ============================================================


BEGIN;

-- ── 1. 三欄(全 nullable、無 DEFAULT ⇒ 不重寫表;掃表與鎖的完整成本見檔頭「鎖與掃表的誠實版」)──
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN superseded_at          timestamptz,  -- L5 自動裁定讓路的時間(write-once;只有 L5 那條路徑會寫)
  ADD COLUMN superseded_reason      text,         -- 讓路當下的新鮮觀察型別(母 plan Q7 兩型)
  ADD COLUMN superseded_by_order_id uuid REFERENCES public.orders(id);  -- 因此被放行的新單(觸發 B 無新單 ⇒ NULL)


-- ── 2. 五條一致性 CHECK(①-④ 為本片原案,⑤ 為 codex 關卡2 R1 補)──
ALTER TABLE public.payment_charge_attempts
  -- ① 值域:母 plan §3.1 Q7「兩型都讓路」——record_not_found(Record 查無)/ stuck_pending(恆 4 PENDING)。
  --    🔴 不收第三個值:讓路的**授權範圍**只有這兩型;新增型別要重新過 plan,不是改 CHECK 就算數。
  ADD CONSTRAINT payment_charge_attempts_superseded_reason_chk
    CHECK (superseded_reason IS NULL OR superseded_reason IN ('record_not_found', 'stuck_pending')),
  -- ② 成對:有時間必有理由、有理由必有時間。
  --    🔴 這條擋的是「標記半套」——只寫 at 沒寫 reason 的話,L5b 認得出「要補償」卻認不出「憑什麼」,
  --       而 §5-7 的觀測性要求每次自動裁定都留得下原因。
  ADD CONSTRAINT payment_charge_attempts_superseded_pair_chk
    CHECK (
      (superseded_at IS NULL     AND superseded_reason IS NULL)
      OR
      (superseded_at IS NOT NULL AND superseded_reason IS NOT NULL)
    ),
  -- ③ by_order 蘊含 at:可以「讓路但沒有新單」(觸發 B 排程歸檔),不可以「有新單卻沒讓路」。
  --    🔴 **方向是單向的,不要寫成 ⇔**(codex 關卡2 R1-F2 打掉了本檔原本那句「⇔ 觸發 B」):
  --       非 NULL ⇒ 觸發 A 沒錯;但 NULL **推不出**觸發 B —— 觸發 A 漏寫這欄也會靜靜落成 NULL。
  --       schema 層看不出差別,因為「這次是誰觸發的」不在這張表的任何一欄裡。
  --    ⇒ 三條義務**明文轉給 L5a-1**(寫入端),並寫成它的驗收條件、不留給它猜:
  --       ① 觸發 A 的讓路路徑必須寫 superseded_by_order_id(負測:漏寫 ⇒ 該片紅);
  --       ② successor 必須與本 attempt 同一個 customer_user_id;
  --       ③ 🔴 **釋鎖與標記必須在同一個 UPDATE**(R3 MF-4)。拆成兩步一旦中間斷掉,會留下
  --          「status=released、superseded_* 全 NULL」的列 —— 那個形狀**完全合法**(五條 CHECK 全過),
  --          而且與「客人自己按重新付款」的 preflight release 產物**逐字不可分辨**
  --          ⇒ 該補償的那筆從此認不出來,**而且沒有任何人會喊**。這是本族最惡的失敗形狀:
  --          壞掉的症狀就是「什麼都沒發生」。L5a-1 要有結構斷言釘住「恰一個 UPDATE 同時寫 status 與 superseded_at」。
  --       ②在這裡做不成 CHECK:歸屬在 public.orders 上,CHECK 不得跨表。做得成的只有
  --       複合 FK(需先給 orders 加 UNIQUE(id, customer_user_id))或 trigger,兩者都要動 orders
  --       或往錢面加 trigger ⇒ 成本與風險都高於「由那支 SECURITY DEFINER RPC 自己擋」,
  --       而 L5a-1 本來就已經零信任地從 orders 讀 customer_user_id(20260809210000:88)。
  --       🔴 這是**刻意的取捨、不是漏掉**:若日後 L5a-1 以外出現第二個寫入者,這個推理就失效,
  --          屆時要回頭補複合 FK(失效條件寫在這裡,免得下一個人以為 schema 保證了同會員)。
  ADD CONSTRAINT payment_charge_attempts_superseded_by_order_chk
    CHECK (superseded_by_order_id IS NULL OR superseded_at IS NOT NULL),
  -- ④ 新單不得是自己:讓路的定義就是「舊 attempt 退位、**另一張**單走得通」。
  --    🔴 母 plan §3.1 不變量逐字:新單 = 新 orderId + 新 attempt。若這裡等於自己,
  --       L5b 追補償時會把同一張單既當受害者又當受益者,整條對帳鏈斷在這裡而且不會有人喊。
  ADD CONSTRAINT payment_charge_attempts_superseded_not_self_chk
    CHECK (superseded_by_order_id IS NULL OR superseded_by_order_id <> order_id),
  -- ⑤ 標記蘊含「這筆真的被 release 過,且 release 不晚於讓路」(codex 關卡2 R1-F1)。
  --    🔴 這條是 R1 抓到的**最貴的一條**:原本四條約束擋不住這一列 ——
  --       `status='charged'`、`released_at IS NULL`(從來沒被 release 過)、卻帶著合法的 superseded 標記。
  --       四條全過 ⇒ L5b 若把「有標記」讀成「可退款」,就會退到一筆**從未被 L5 讓路**的正常交易。
  --       誤退比雙扣更糟(母 plan §3.2 逐字)⇒ 這條必須在 schema 層擋,不能只靠寫入端自律。
  --    為什麼 `released_at` 是對的錨:L5 讓路走 pending→released,而 release CAS 一定會寫
  --       `released_at = COALESCE(released_at, now())`(20260624120002:55)⇒ 合法路徑上恆非 NULL;
  --       先前已被 preflight release 過的列則保留較早的時間 ⇒ `released_at <= superseded_at` 也成立。
  --    🔴 這條**不是**「status 必為 released」——那樣會在 released→charged(genesis)與
  --       released→failed(close)兩條既有合法轉移上炸掉。它釘的是**歷史**,不是**現況**。
  ADD CONSTRAINT payment_charge_attempts_superseded_after_release_chk
    CHECK (superseded_at IS NULL OR (released_at IS NOT NULL AND released_at <= superseded_at));


COMMENT ON COLUMN public.payment_charge_attempts.superseded_at IS
  'M-4b L5a-M:本 attempt 被 L5 自動裁定「讓路」的時間(write-once、COALESCE 不覆蓋;只有 L5 讓路路徑會寫)。🔴 這一欄是自動退款(L5b)的**授權依據**:既有 preflight release CAS(20260624120002,客人自己按重新付款)同樣把 status 寫成 released 但**絕不寫本欄** ⇒ 只認 status=released 的補償邏輯會誤退那些單(誤退比雙扣更糟)。非狀態、是歷史事實:無任何路徑清回 NULL;attempt 狀態照走既有 released 生命週期(→charged genesis / →failed close / 續留對帳),故刻意不加 status 綁定 CHECK —— 改由 superseded_after_release_chk 釘**歷史**:本欄非 NULL ⇒ released_at 非 NULL 且不晚於本欄。這條擋掉「從未 released 卻帶標記」那一列(codex 關卡2 R1-F1 的攻擊列,harness 格 C9/C10 釘死)。⚠️ 標記是退款授權的**必要非充分**條件:L5b 仍須自己驗權威請款證據,不得只憑本欄退款。';
COMMENT ON COLUMN public.payment_charge_attempts.superseded_reason IS
  'M-4b L5a-M:讓路當下那次**新鮮 Record 觀察**的型別(母 plan §3.1 Q7 兩型都讓路)。record_not_found=Record 查無;stuck_pending=恆 4 PENDING 的放棄型。🔴 不得由 last_settle_error 等快取欄推得(L2 檔頭硬契約:該欄只有 sweeper stuck 路徑會寫)——本欄記的是釋鎖前那一次自己打的觀察。與 superseded_at 成對(CHECK)。';
COMMENT ON COLUMN public.payment_charge_attempts.superseded_by_order_id IS
  'M-4b L5a-M:因本 attempt 讓路而被放行的**新單** order id。🔴 方向單向、**不是** ⇔:非 NULL ⇒ 觸發 A(客人當下重新結帳,母 plan §3.1);NULL **推不出**觸發 B(10 分排程歸檔本來就沒有新單,但觸發 A 漏寫也會落成 NULL)。「這次是誰觸發的」不在本表任何一欄裡,schema 層分不出來 ⇒ 兩條義務由寫入端 L5a-1 擔保並寫成它的驗收:①觸發 A 必寫本欄 ②successor 必與本 attempt 同一 customer_user_id(跨表歸屬 CHECK 做不到,見 migration 內註解的失效條件)。CHECK 保證:非 NULL 蘊含 superseded_at 非 NULL,且不得等於自己的 order_id。無反向索引:orders 不做實體刪除(取消是 soft)。';


COMMIT;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   ALTER TABLE public.payment_charge_attempts
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_superseded_after_release_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_superseded_not_self_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_superseded_by_order_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_superseded_pair_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_superseded_reason_chk;
--   ALTER TABLE public.payment_charge_attempts
--     DROP COLUMN IF EXISTS superseded_by_order_id,
--     DROP COLUMN IF EXISTS superseded_reason,
--     DROP COLUMN IF EXISTS superseded_at;
--   🔴 前提:L5a-1 尚未上線(或已先撤)。若已有 superseded_at 非 NULL 的列,DROP COLUMN 會**靜默**
--      銷毀 L5b 判斷「該不該退款」的唯一依據 ⇒ 撤欄前先確認 L5a-1 的寫入路徑已停,
--      且沒有待補償的列(SELECT count(*) ... WHERE superseded_at IS NOT NULL 應為 0)。
-- ============================================================
