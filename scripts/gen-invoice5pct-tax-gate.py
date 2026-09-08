#!/usr/bin/env python3
"""gen-invoice5pct-tax-gate.py — 產生 `admin_create_manual_order` 第 7 代的 migration。

⟦b4-INVOICE5PCT⟧:Sean 2026-09-04 逐字「**那如果我沒有勾選開發票價錢都不加**」。
而第 6 代(`20260905360000:443`)的 `v_tax :=` 是**無條件**的 ⇒ 沒勾也加 5%。

🔴 **為什麼要產生器而不是手抄**:函式本體 693 行。手抄一次 = 一次無聲改動的機會,
   而 `CREATE OR REPLACE` 對「我不小心改到別的地方」**沒有任何訊號**。
   ⇒ 本檔從第 6 代那支檔【切出本體】,只做兩處具名替換,每一處都 `assert count == 1`。

🛑 **它證不到什麼**:它保證「我沒有手滑改到別處」,**保證不了**我切出來的那一版
   就是正式庫現在跑的那一版。⇒ 那要靠產出檔裡的**前置閘**(比 live prosrc 的 md5)。
"""
import hashlib
import io
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'supabase/migrations/20260905360000_m4b_pricecopytax_p2_manual_order_computes_tax.sql'
OUT = ROOT / 'supabase/migrations/20260909030000_m4b_invoice5pct_tax_only_when_requested.sql'

src = io.open(SRC, encoding='utf-8').read()

def slice_body(text, head, delim):
    """把 `CREATE … AS <delim>` 與 `<delim>` 之間那一段切出來 —— 它就是 Postgres 的 `prosrc`。

    🔴 **結尾那個換行【屬於本體】** ⇒ `+1`。少了它,md5 在本機算得出來、機械證明照樣通過,
       **而它永遠對不上正式庫** —— 只有真的貼下去才會紅。
    """
    i = text.index(head)
    op = '\nAS ' + delim
    j = text.index(op, i) + len(op)
    k = text.index('\n' + delim, j) + 1
    return text[i:j], text[j:k]


def selftest():
    """🟢 **正對照:拿一支【正式庫 prosrc md5 已知】的函式來驗這條切法。**

    已知值出處 = `supabase/migrations/20260906500000_..._paid_cart_guard.sql:99` 逐字
    `'8cb6104ecb8b462bbdd75e23246cf51a'`(2026-09-06 唯讀量正式庫的 `create_order` 11 參)。
    🎯 **它答的是「我對 prosrc 邊界的理解對不對」** —— 而那正是本檔唯一無法在本機直接驗的那一格。
    ⚪ 負對照:少掉結尾那個換行必須算出**不同**的值, 否則這把尺不會動。
    """
    known = '8cb6104ecb8b462bbdd75e23246cf51a'
    t = io.open(ROOT / 'supabase/migrations/20260904020000_m4b_create_order_payment_channel.sql',
                encoding='utf-8').read()
    _, body = slice_body(t, 'CREATE FUNCTION public.create_order(', '$function$')
    got = hashlib.md5(body.encode('utf-8')).hexdigest()
    bad = hashlib.md5(body[:-1].encode('utf-8')).hexdigest()
    ok = got == known and bad != known
    print(f'🟢 正對照 create_order(11 參) prosrc md5 = {got}  期望 {known}')
    print(f'⚪ 負對照 少結尾換行            = {bad}  ⇒ 必須不同')
    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if '--selftest' in sys.argv:
    sys.exit(selftest())


# ── 切出「CREATE OR REPLACE FUNCTION … $fn$;」那一整段(第一支,不是 e13 那支)──
HEAD = 'CREATE OR REPLACE FUNCTION public.admin_create_manual_order('
i = src.index(HEAD)
OPEN = '\nAS $fn$'
j = src.index(OPEN, i) + len(OPEN)
CLOSE = '\n$fn$;'
k = src.index(CLOSE, j) + 1     # 🔴 **+1 把那個換行【留給本體】** —— 見下方那句
create_head = src[i:j]          # CREATE … AS $fn$
# 🔴🔴 **`prosrc` 是兩個 `$fn$` 之間的【全部字元】** —— 含開頭那個換行, **也含結尾那個換行**。
#    ⛔ ~~`src[j:k]`(k 指向 '\n$fn$;' 的開頭)~~ ⇒ 少了結尾那個換行
#    ⇒ 📌 算出來的 md5 **永遠對不上正式庫**, 而它在本機看起來完全合理:
#       兩個 md5 都算得出來、機械證明照樣通過、檔案照樣產得出來 —— **只有真的貼下去才會紅。**
#    ✅ 下面 `assert` 用**原檔逐字重組**當正對照:重組不回去就是我又切歪了。
body_old = src[j:k]
assert 'DECLARE' in body_old and 'END;' in body_old.rstrip()[-40:], '本體切歪了'
assert 'admin_update_order_item_amount' not in body_old, '切到第二支函式了'

# ── 替換 A:常數 → 變數 ────────────────────────────────────────────────
A_OLD = """  -- 🔴 **這個值出現在兩個地方**(INSERT 的值列 + audit payload)⇒ 收成一個常數。
  --    兩份字面會分岔, 而分岔時**沒有東西會叫** —— audit 說 inclusive 而資料是 exclusive。
  --    🔵 順帶:寫成常數之後, `audit-field-label` 那道閘掃到的是欄名 `price_tax_mode`
  --       而不是值 `'exclusive'`(它上一版把值當成欄名報紅, 而那個紅是【我寫法】造成的)。
  v_price_tax_mode constant text := 'exclusive';"""
A_NEW = """  -- 🔴 **這個值出現在兩個地方**(INSERT 的值列 + audit payload)⇒ 收成一個變數。
  --    兩份字面會分岔, 而分岔時**沒有東西會叫** —— audit 說 inclusive 而資料是 exclusive。
  -- 🔴🔴 **第 7 代:它不再是 `constant`**(⟦b4-INVOICE5PCT⟧, Sean 2026-09-04 逐字
  --    「那如果我沒有勾選開發票價錢都不加」)⇒ 由 `v_invoice_requested` 決定, 見下方稅那一段。
  --    🛑 **拿掉 `constant` 這件事本身沒有守門** —— 它只是讓賦值合法;
  --       真正釘住「兩個世界各是什麼」的是那一段 `IF`, 與事後斷言③。
  v_price_tax_mode text;"""
assert src.count(A_OLD) == 1 and body_old.count(A_OLD) == 1, '替換 A 的錨不唯一'
body_new = body_old.replace(A_OLD, A_NEW)

# ── 替換 B:無條件算稅 → 依勾選分岔 ────────────────────────────────────
B_OLD = """  v_tax := pg_catalog.round(((v_subtotal + p_shipping_fee - 0)::numeric) * 0.05)::bigint;
  v_total := v_subtotal + p_shipping_fee + v_tax;"""
B_NEW = """  -- ══ 第 7 代:**稅只有在「這張單要開發票」時才加**(⟦b4-INVOICE5PCT⟧)══════════
  -- 🔴 **Sean 2026-09-04 16:2x 逐字**(`~/pcm-mailbox/Sean拍板-20260904-七題.md:363`):
  --    「我們傾向於我輸入單價，然後勾選開發票自己幫我+5 %上去，
  --      **那如果我沒有勾選開發票價錢都不加**」
  --    ⇒ 同一份檔 `:367-369` 已整理成規格:勾了 ⇒ +5%;**沒勾 ⇒ 價錢都不加**。
  -- 🛑 **第 6 代的 `v_tax :=` 是無條件的** ⇒ 沒勾也加了 5%, 而那顆勾選**預設不勾**
  --    (`manual-order-form-body.tsx:234` 逐字「預設不勾選,也就是預設不開發票」)
  --    ⇒ 📌 **不加稅才是常態路徑, 而它一直在加。** 本段就是那一格。
  -- 🔴 **沒勾那一邊為什麼是 `inclusive` 而不是 `exclusive` + 稅 0**:
  --    Sean 同段逐字「**沒勾就是他打的數字即總額**」⇒ 那張單沒有另計的稅
  --    ⇒ `inclusive` 正是 `orders.price_tax_mode` 的 DEFAULT、也是第 6 代之前每一張單的語意
  --    ⇒ 🎯 **沒勾那條路 = 回到第 6 代之前的行為, 一個位元都沒有多。**
  --    🛑 **而寫成 `exclusive` + 稅 0 會有一個看不見的副作用**:
  --       `admin_update_order_item_amount` 的 `pcm_e13_no_edit_when_taxed`(本檔下游, 未改)
  --       判準逐字是 `price_tax_mode = 'exclusive' OR tax_total <> 0`
  --       ⇒ 一張**沒有稅**的單會被擋著不給改金額, 而員工看到的是一句在講稅的錯誤訊息。
  -- ⚠️ **這一格是【判斷】不是拍板** —— Sean 說的是「價錢都不加」, 沒有說欄位填什麼。
  --    理由寫在上面兩點, 而 `⟦b4-INVOICE5PCT⟧` 那一列要記著它可翻。
  -- 🔵 **負稅基閘與溢位閘刻意留在 IF 外面** —— 它們是這張單的不變式, 不是稅的附屬品;
  --    沒勾那一邊 `v_tax = 0`, 兩道閘照樣成立而且零成本。
  IF v_invoice_requested THEN
    v_tax := pg_catalog.round(((v_subtotal + p_shipping_fee - 0)::numeric) * 0.05)::bigint;
    v_price_tax_mode := 'exclusive';
  ELSE
    v_tax := 0;
    v_price_tax_mode := 'inclusive';
  END IF;
  v_total := v_subtotal + p_shipping_fee + v_tax;"""
assert body_new.count(B_OLD) == 1, '替換 B 的錨不唯一'
body_new = body_new.replace(B_OLD, B_NEW)

# ── 替換 C:DECLARE 多兩個工作變數(稽核用) ────────────────────────────
C_OLD = """  v_items       jsonb := '[]'::jsonb;"""
C_NEW = """  v_items       jsonb := '[]'::jsonb;
  -- 🔴🔴 **第 7 代新增:員工在每一列選的「未稅 / 含稅」—— 只為了記進稽核。**
  --    codex R3(2026-09-09 換模型換角度)打出來的那一條:沒勾開發票時兩種稅基**都不換算**
  --    ⇒ 「填 1,050 選含稅」與「填 1,050 選未稅」在資料庫裡**長得一模一樣**
  --    ⇒ 📌 三個月後退款爭議, 查不到他當初的意思。🛑 **不是 log 難找, 是那個資訊沒有被存下來。**
  --    ✅ Sean 2026-09-09 拍甲逐字:「先上, 而同一片多做一件:把他選的『未稅/含稅』記進稽核紀錄」。
  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;"""
assert body_new.count(C_OLD) == 1, '替換 C 的錨不唯一'
body_new = body_new.replace(C_OLD, C_NEW)

# ── 替換 D:迴圈裡收集它 ───────────────────────────────────────────
D_OLD = """      'unit_price', v_unit_price,
      'line_total', v_line_total);
  END LOOP;"""
D_NEW = """      'unit_price', v_unit_price,
      'line_total', v_line_total);

    -- ══ 第 7 代:把這一列的稅基收起來, 等一下寫進 audit ═══════════════════════
    -- 🔵 **缺鍵 ⇒ NULL, 不是報錯** —— 部署順序是「先貼 migration、再上碼」
    --    ⇒ 中間那段窗口裡, **舊版表單不會送這個鍵**。報錯的話那段窗口所有手動單都建不出來。
    --    ⇒ 📌 而 NULL 在 audit 裡是誠實的:它的意思是「這一筆沒有人告訴我」。
    -- 🛑 **已知未關的缺口**:窗口過後「舊呼叫端沒送」與「真的缺」仍然都是 NULL, 分不出來。
    --    要關掉需要**之後另一支 migration** 把缺鍵改成 RAISE ⇒ 那支還沒有人排, 所以寫在這裡。
    -- 🔴 **第三種值一律拒** —— 同本函式對 order_source / payment_channel 的做法:
    --    「看不懂就當未稅」會讓一個壞掉的表單靜默送出一個**沒有人宣告過**的稅基。
    -- 🔴🔴 **「缺鍵」與「送了一個空的」要分得開**(codex R4 2026-09-09 must-fix ④, 它對)。
    --    ⛔ ~~`v_line_basis := NULLIF(v_line ->> 'tax_basis', '');`~~ —— 那一版有兩條路悄悄變成 NULL:
    --      `{"tax_basis": ""}` 被 `NULLIF` 轉成 NULL · `{"tax_basis": null}` 經 `->>` 也是 NULL
    --      ⇒ 📌 **兩者都跳過下面那道 RAISE, 留下與「舊版沒送鍵」一模一樣的紀錄。**
    --      而它們的意思完全不同:一個是「那個版本還沒有這一格」, 另一個是**表單壞了**。
    --    ✅ 改成先用 `?` 問【鍵在不在】, 只有**缺鍵**才准是 NULL。
    --    🔵 `?` 是 jsonb 的存在運算子;運算子住在 `pg_catalog`, 而 `pg_catalog` 永遠隱含可見
    --      ⇒ `SET search_path = ''` 之下照樣解析得到(與本函式其他 `->>` / `||` 同理)。
    IF v_line ? 'tax_basis' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'tax_basis') <> 'string'
         OR (v_line ->> 'tax_basis') NOT IN ('untaxed', 'taxed') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的稅基 [%] 不是 untaxed / taxed',
                        v_sku, COALESCE(v_line ->> 'tax_basis', '<null>');
      END IF;
      v_line_basis := v_line ->> 'tax_basis';
    ELSE
      -- 🔵 **只有這一條路允許 NULL** —— 部署順序是「先貼 migration、再上碼」,
      --    中間那段窗口舊版表單不送這個鍵。報錯的話那段窗口所有手動單都建不出來。
      v_line_basis := NULL;
    END IF;
    -- 🔵 **`unit_price` 一起記** —— 它是【送進來的那個值】(表單那一側已經換算過了)。
    --    配上這一列的 `tax_basis` 與這張單的 `invoice_requested`, 三個湊起來就答得出
    --    「他當初打的是哪個數字、當成什麼」:
    --      勾了 + taxed ⇒ 他打的是 unit_price × 21/20   ·   沒勾 ⇒ 他打的就是 unit_price
    -- 🔴🔴 **`line_key` 是承重的, 而它不是我發明的鍵 —— 就是上面那道去重用的同一把**
    --    (codex R4 2026-09-09 must-fix ③, 它對)。
    --    ⛔ ~~只記 `variant_sku`~~ ⇒ **對不回 `order_items`**:代購列的去重鍵是
    --      `custom:料號|品名|單價|規格`(見上面 `v_key`)⇒ 📌 **同料號同品名同單價、只有規格不同的
    --      兩列是合法的**, 而它們的 `variant_sku` 一模一樣。
    --      🛑 沒勾發票時兩列都不換算 ⇒ 連單價也一樣 ⇒ **把兩列的稅基對調, 訂單資料完全相同。**
    --    ✅ 記 `v_key` 就對得回去, 而且**不必動 `order_items` 的結構、不必生新 id**:
    --      · 變體列 ⇒ `variant:<uuid>` 對 `order_items.variant_id`
    --      · 代購列 ⇒ `custom:…|規格` 對 `variant_sku` + `product_snapshot`(**代購列的 spec
    --        不會被權威覆蓋** —— 那道覆蓋只在 `pv.spec` 有值時發生, 而代購列 join 不到 pv)
    --    ⚠️ **代價明寫**:`v_key` 裡有品名與規格 ⇒ 這是把員工輸入**多抄一份**進 append-only 的稽核表,
    --      而本函式 `G9` 那段註解逐字寫過「少抄一份 = 少一個會過期、會外洩的副本」。
    --      🔵 而它**不含價格以外的敏感值**(零經銷價、零 cost、零客人資料), 換到的是
    --      **「三個月後對得回哪一列」** —— 那正是本片存在的理由。
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'line_key',    v_key,
      'variant_sku', v_sku,
      'tax_basis',   v_line_basis,
      'unit_price',  v_unit_price);
  END LOOP;"""
assert body_new.count(D_OLD) == 1, '替換 D 的錨不唯一'
body_new = body_new.replace(D_OLD, D_NEW)

# ── 替換 E:寫進 audit payload ─────────────────────────────────────
E_OLD = """            'item_count',       pg_catalog.jsonb_array_length(v_items)),"""
E_NEW = """            'item_count',       pg_catalog.jsonb_array_length(v_items),
            -- 🔴🔴 **第 7 代加這一格** —— 它是本片唯一「事後查得到員工原始意思」的落點。
            --    🛑 而它**只在 audit**:不進 `order_items`(那要動表結構, 不在 Sean 拍的範圍)、
            --      不進冪等指紋(🔴 加進去會在部署窗製造真的失敗:舊版表單不送這個鍵
            --      ⇒ 新舊兩版對同一筆重送算出不同指紋 ⇒ 被判「同鍵不同內容」而拒;
            --      而它不影響「這是不是同一個請求」的答案 —— **錢一模一樣**)。
            --    🔬 **怎麼查**(寫在這裡, 因為三個月後那個人不會回頭讀 migration):
            --      SELECT after -> 'line_tax_bases'
            --        FROM public.admin_audit_log
            --       WHERE action = 'order.manual_create'
            --         AND target = 'order:' || '<那張單的 id>';
            'line_tax_bases',   v_line_bases),"""
assert body_new.count(E_OLD) == 1, '替換 E 的錨不唯一'
body_new = body_new.replace(E_OLD, E_NEW)

# ── 替換 F:DECLARE 再加兩個 —— 品項 id 要【自己生】才對得回去 ─────────────
F_OLD = """  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;"""
F_NEW = """  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;
  -- 🔴🔴 **稽核要對得回 `order_items` 的【那一列】, 而唯一穩定的身分是它的 id。**
  --    ⛔ ~~第一版記 `line_key`(去重用的那把:料號|品名|單價|規格)~~ **codex R5 打掉它**:
  --      🔬 失敗情境逐字可構造:兩列合法代購, 料號品名規格相同而單價 1,000 / 1,200
  --      ⇒ 兩把 key 不同;而未開發票未付款的單**合法**可用 `admin_update_order_item_amount`
  --        把第一列改成 1,200 ⇒ 📌 **原本 1,000 那把對不到任何列, 原本 1,200 那把同時命中兩列。**
  --      🎯 **⇒ 它把一個【可以被改的值】當成身分的一部分。**
  --    ⛔ 而 `line_key` 還有第二個病:它明文含品名與規格(自由文字)⇒ 把員工輸入
  --      **多抄一份**進 append-only 的稽核表, 而那與本函式 G9 那段「少抄一份 = 少一個
  --      會過期、會外洩的副本」直接衝突。**我當時寫「不含敏感值」是錯的** —— 規格是自由文字。
  --    ✅ ⇒ 改成**自己生 id、明確寫進 `order_items`**, 稽核只記那個 id + 稅基 + 單價。
  --      🔵 **不動表結構**(`order_items.id` 本來就是 uuid 主鍵, 只是原本走 DEFAULT)。
  --      🔵 **不進冪等指紋** —— 它不進 `v_items`(那是指紋的來源);重送在指紋比對那一步就
  --        早退了, 根本走不到這個 INSERT。
  v_item_id     uuid;
  v_item_ids    jsonb := '[]'::jsonb;"""
assert body_new.count(F_OLD) == 1, '替換 F 的錨不唯一'
body_new = body_new.replace(F_OLD, F_NEW)

# ── 替換 G:迴圈裡生 id, 稽核改記 id(拿掉 line_key / variant_sku)──────
G_OLD = """    -- 🔴🔴 **`line_key` 是承重的, 而它不是我發明的鍵 —— 就是上面那道去重用的同一把**
    --    (codex R4 2026-09-09 must-fix ③, 它對)。
    --    ⛔ ~~只記 `variant_sku`~~ ⇒ **對不回 `order_items`**:代購列的去重鍵是
    --      `custom:料號|品名|單價|規格`(見上面 `v_key`)⇒ 📌 **同料號同品名同單價、只有規格不同的
    --      兩列是合法的**, 而它們的 `variant_sku` 一模一樣。
    --      🛑 沒勾發票時兩列都不換算 ⇒ 連單價也一樣 ⇒ **把兩列的稅基對調, 訂單資料完全相同。**
    --    ✅ 記 `v_key` 就對得回去, 而且**不必動 `order_items` 的結構、不必生新 id**:
    --      · 變體列 ⇒ `variant:<uuid>` 對 `order_items.variant_id`
    --      · 代購列 ⇒ `custom:…|規格` 對 `variant_sku` + `product_snapshot`(**代購列的 spec
    --        不會被權威覆蓋** —— 那道覆蓋只在 `pv.spec` 有值時發生, 而代購列 join 不到 pv)
    --    ⚠️ **代價明寫**:`v_key` 裡有品名與規格 ⇒ 這是把員工輸入**多抄一份**進 append-only 的稽核表,
    --      而本函式 `G9` 那段註解逐字寫過「少抄一份 = 少一個會過期、會外洩的副本」。
    --      🔵 而它**不含價格以外的敏感值**(零經銷價、零 cost、零客人資料), 換到的是
    --      **「三個月後對得回哪一列」** —— 那正是本片存在的理由。
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'line_key',    v_key,
      'variant_sku', v_sku,
      'tax_basis',   v_line_basis,
      'unit_price',  v_unit_price);"""
G_NEW = """    -- ✅ **這一列的 id 在這裡就決定**, 下面的 INSERT 明確寫它, 稽核記同一個。
    --    ⇒ 📌 **稽核那一列與 `order_items` 那一列從此靠【同一個 uuid】綁著, 不靠任何會變的值。**
    --    🔵 只記三樣:id + 稅基 + **建單當下**的單價。單價記的是「那一刻是多少」——
    --      它日後可能被 `admin_update_order_item_amount` 改掉, 而**那正是要留一份原值的理由**。
    --    🛑 **不記品名 / 規格 / 料號** —— 那些是自由文字, 抄進 append-only 的表就是多一份
    --      會過期、會外洩的副本(本函式 G9 那段逐字)。要看它們 ⇒ 拿 id 去 `order_items` 查。
    v_item_id := pg_catalog.gen_random_uuid();
    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'order_item_id', v_item_id,
      'tax_basis',     v_line_basis,
      'unit_price',    v_unit_price);"""
assert body_new.count(G_OLD) == 1, '替換 G 的錨不唯一'
body_new = body_new.replace(G_OLD, G_NEW)

# ── 替換 H:INSERT 明確寫 id(WITH ORDINALITY 對位)───────────────────
H_OLD = """  INSERT INTO public.order_items (
    order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT v_order_id,
         NULLIF(it ->> 'variant_id', '')::uuid,
         it ->> 'variant_sku',"""
H_NEW = """  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)—— 稽核那一列要指得回這一列。
  --    對位靠 `WITH ORDINALITY`:`v_item_ids` 是在同一個迴圈裡、同一個順序 append 的,
  --    而 `jsonb_array_elements` 依陣列順序展開 ⇒ 第 n 個元素配第 n 個 id。
  --    🛑 **不靠 `RETURNING` 的回傳順序** —— 那個順序 SQL 標準沒有保證。
  INSERT INTO public.order_items (
    id, order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT (v_item_ids ->> (it.ord - 1)::integer)::uuid,
         v_order_id,
         NULLIF(it.val ->> 'variant_id', '')::uuid,
         it.val ->> 'variant_sku',"""
assert body_new.count(H_OLD) == 1, '替換 H 的錨不唯一'
body_new = body_new.replace(H_OLD, H_NEW)

# ── 替換 I:INSERT 尾巴那幾個 `it ->>` 改成 `it.val ->>` + WITH ORDINALITY ──
I_OLD = """              THEN it -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it ->> 'quantity')::integer,
         (it ->> 'unit_price')::integer,
         (it ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) AS it
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid;"""
I_NEW = """              THEN it.val -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it.val -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it.val ->> 'quantity')::integer,
         (it.val ->> 'unit_price')::integer,
         (it.val ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS it(val, ord)
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it.val ->> 'variant_id', '')::uuid;"""
assert body_new.count(I_OLD) == 1, '替換 I 的錨不唯一'
body_new = body_new.replace(I_OLD, I_NEW)

# ── 替換 J:三個陣列長度不等 ⇒ 當場停(codex R6 nit)──────────────────────
J_OLD = """  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)"""
J_NEW = """  -- ══ 🔴 三個陣列必須等長, 不等長就停(codex R6 2026-09-09 nit)═══════════════
  --   `v_items`(要插的列)· `v_item_ids`(它們的 id)· `v_line_bases`(稽核那一份)
  --   是**同一個迴圈裡平行 append 的三份**, 而下面靠「第 n 筆對第 n 筆」把它們接起來。
  -- 🛑 **今天走不到這一格** —— 迴圈裡沒有 `CONTINUE`、沒有早退, 三個一定同步。
  --   ⇒ 📌 **所以它不是在修一個現在的 bug, 是在釘住一個【維護時很容易破壞】的不變式**:
  --     未來有人在「append id」與「append v_items」之間插一個 `CONTINUE`,
  --     多出來的 id 會被 INSERT **靜靜忽略**, 而稽核那一份已經 append
  --     ⇒ 留下一筆**指向不存在品項**的稽核紀錄。
  -- 🔴 **而那個世界【今天沒有任何東西會叫】**:短的那一邊會撞主鍵 NOT NULL 而紅,
  --   **長的那一邊不會** —— 兩個方向的傷害不對稱, 而不會叫的那個方向才是安靜的那個。
  IF pg_catalog.jsonb_array_length(v_item_ids) <> pg_catalog.jsonb_array_length(v_items)
     OR pg_catalog.jsonb_array_length(v_line_bases) <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 內部三個陣列長度不一致(items % / ids % / bases %)'
                    ' ⇒ 稽核會指到不存在的品項, 整筆停下。',
                    pg_catalog.jsonb_array_length(v_items),
                    pg_catalog.jsonb_array_length(v_item_ids),
                    pg_catalog.jsonb_array_length(v_line_bases);
  END IF;

  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)"""
assert body_new.count(J_OLD) == 1, '替換 J 的錨不唯一'
body_new = body_new.replace(J_OLD, J_NEW)

assert body_new != body_old
md5_old = hashlib.md5(body_old.encode('utf-8')).hexdigest()
md5_new = hashlib.md5(body_new.encode('utf-8')).hexdigest()

# ── 🔴 機械證明:把兩處【新增的整段】從新本體減掉, 剩下的必須逐字等於舊本體 ──
#    (學自 ⟦b4-BANKCARDRACE⟧ codex R1:釘字面在不在, 擋不住「述詞被改形狀」。)
back = (body_new.replace(J_NEW, J_OLD).replace(I_NEW, I_OLD).replace(H_NEW, H_OLD).replace(G_NEW, G_OLD)
        .replace(F_NEW, F_OLD).replace(E_NEW, E_OLD).replace(D_NEW, D_OLD)
        .replace(C_NEW, C_OLD).replace(B_NEW, B_OLD).replace(A_NEW, A_OLD))
assert back == body_old, '減回去之後對不上舊本體 ⇒ 我動到了別的地方'

print(f'body_old md5 = {md5_old}  ({len(body_old)} 字元)')
print(f'body_new md5 = {md5_new}  ({len(body_new)} 字元)')
print('減回去 == 舊本體 ⇒ 只動了那十段')
if '--emit' not in sys.argv:
    sys.exit(0)

HDR = f"""-- ══════════════════════════════════════════════════════════════════
-- ⟦b4-INVOICE5PCT⟧ · `admin_create_manual_order` 第 7 代
--   **稅只有在「這張單要開發票」被勾起來時才加。**
--
-- 🔴 **拍板逐字**(`~/pcm-mailbox/Sean拍板-20260904-七題.md:363`, Sean 2026-09-04 16:2x):
--    「我們傾向於我輸入單價，然後勾選開發票自己幫我+5 %上去，
--      **那如果我沒有勾選開發票價錢都不加**」
--    同檔 `:367-369` 已整理成規格:勾了 ⇒ +5%;**沒勾 ⇒ 價錢都不加**;
--    `:372` 逐字「勾了就是未稅+5%, **沒勾就是他打的數字即總額**」。
--
-- 🛑 **它修的是一個【線上現在就在發生】的事**:第 6 代(`20260905360000:443`)那一行
--    `v_tax :=` 是**無條件**的 ⇒ 沒勾也加 5%;而那顆勾選**預設不勾**
--    (`apps/admin/src/components/orders/manual-order-form-body.tsx:234` 逐字
--     「預設不勾選,也就是預設不開發票」)⇒ 📌 **不加稅才是常態路徑, 而它一直在加。**
--
-- 🔵 **本檔只動【一支函式的本體】** —— 零 DDL、零 schema、零 view、不碰 `admin_update_order_item_amount`。
-- 🛑 **簽章一個字都沒變** ⇒ 🔴 **刻意不寫 `NOTIFY pgrst, 'reload schema';`**:
--    那一行的判準是**簽章有沒有變**(前例 `20260811040000:49` / `20260904160000:7` 講的都是改簽章)。
--    ⇒ 📌 **本體改動 PostgREST 不快取** —— 加一行我不需要的東西, 會讓下一個人以為判準是「有沒有動函式」。
--
-- 🔬 **本體怎麼來的**:`scripts/gen-invoice5pct-tax-gate.py` 從第 6 代那支檔切出本體,
--    只做**兩處具名替換**(每處 `assert count == 1`), 並做一次**機械證明**:
--    把兩段新字串從新本體整段減掉, 剩下的**逐字等於**舊本體 ⇒ 我沒有動到別的地方。
--    ⚠️ **而它證不到「切出來的那一版就是正式庫在跑的那一版」** —— 那是下面前置閘②的事。
--
--    舊本體 md5 = {md5_old}  ({len(body_old)} 字元)
--    新本體 md5 = {md5_new}  ({len(body_new)} 字元)
--
-- 🔴 **回滾**:把本檔的 `CREATE OR REPLACE` 換成第 6 代那一份(`20260905360000:112-829`)重跑。
--    ⚠️ 而回滾之後**沒勾的單又會被加 5%** —— 那正是本檔在修的那件事, 不是副作用。
--    🛑 **已經用第 7 代建出來的單不會被回滾**:它們 `price_tax_mode='inclusive'` 且 `tax_total=0`,
--       而那與第 6 代之前的每一張單同一個形狀 ⇒ 分不出來, **也不需要分**。
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘 ════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_n integer; v_args text; v_md5 text; v_sig text; v_attr text;
BEGIN
  SELECT count(*), string_agg(p.pronargs::text, ',' ORDER BY p.pronargs)
    INTO v_n, v_args
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_create_manual_order';
  IF v_n <> 1 OR v_args <> '11' THEN
    RAISE EXCEPTION '前置閘①:admin_create_manual_order 有 % 支(引數數 %)—— 期望剛好 1 支 11 參。'
                    '🛑 多載會讓呼叫端拿 is not unique。', v_n, v_args;
  END IF;

  SELECT pg_catalog.md5(p.prosrc), pg_catalog.pg_get_function_arguments(p.oid),
         p.proisstrict::text || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|'
           || COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '')
    INTO v_md5, v_sig, v_attr
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_create_manual_order';

  -- ⓪ forward-only:本檔已經貼過?
  IF v_md5 = '{md5_new}' THEN
    RAISE EXCEPTION '前置閘⓪:函式本體已經是第 7 代(md5 %)⇒ 本檔已套用過, forward-only 拒重跑', v_md5;
  END IF;

  -- ② 🔴🔴 **這是本檔最承重的一格**:我要取代的必須【逐字】是第 6 代。
  --    ⛔ ~~只問「函式體裡有沒有某個字面」~~ —— 那擋不住「有人在別處改過一行」,
  --       而 `CREATE OR REPLACE` 會把那一行**靜靜地蓋掉**, 且**沒有任何東西會紅**。
  IF v_md5 <> '{md5_old}' THEN
    RAISE EXCEPTION '前置閘②:正式庫的函式本體 md5 是 %, 而我這一份是照 % 那一版改的。'
                    '🛑 中間有人動過它 ⇒ 貼下去會蓋掉那個改動。停下, 重新產生本檔。', v_md5, '{md5_old}';
  END IF;

  -- ④ 🔴🔴 **函式屬性 —— `prosrc` 不含它們**(codex R1 2026-09-09 nit ③, 它對)。
  --    反例逐字:在宣告加上 `STRICT`, **本體 md5、參數字串與 ACL 全都不變**, 上面每一格照樣過;
  --    而 repository 對留白的通知信箱送 `NULL` ⇒ `STRICT` 的函式**直接回 NULL、本體一行都不跑**
  --    ⇒ 📌 **一張單沒有被建出來, 而【資料庫這一側不會叫】** —— 沒有錯誤、沒有 RAISE。
  --    ⛔ ~~原句「畫面與資料庫都不會叫」~~ **過度推論**(codex R2 2026-09-09 訂正, 它對):
  --      `apps/admin/src/lib/orders/manual-order-repository.ts:336-341` 會把 NULL payload
  --      判成 `code: 'bug'` 並記 log ⇒ **畫面那一側會叫。**
  --    🎯 ⇒ 這一格擋的是【DB 側靜默】, 不是「沒有任何人會知道」。差別要留著:
  --      下一個人若以為連畫面都不會叫, 他會去補一道**已經存在**的守門。
  --    ⇒ ✅ 所以前後各釘一次:`proisstrict` / `prosecdef` / `provolatile` / `proconfig`。
  IF v_attr IS DISTINCT FROM 'false|true|v|search_path=""' THEN
    RAISE EXCEPTION '前置閘④:函式屬性是 [%], 期望 [false|true|v|search_path=""]'
                    '(strict|definer|volatile|proconfig)⇒ 有人動過宣告, 停下', v_attr;
  END IF;

  -- ③ 簽章與 DEFAULT —— 🔴 `prosrc` **不含簽章** ⇒ md5 對得上而 DEFAULT 可能已被改,
  --    而這一貼會把它默默改回去(學自 ⟦b4-BANKCARDRACE⟧ codex R1)。
  IF v_sig NOT LIKE '%p_notification_email text DEFAULT NULL%' THEN
    RAISE EXCEPTION '前置閘③:第 11 參的 DEFAULT 不是 NULL(現在是 %)⇒ 停下, 不要用本檔蓋掉它', v_sig;
  END IF;
END
$pre$;

"""

POST = f"""
-- ══ 事後斷言 ══════════════════════════════════════════════════════════
DO $post$
DECLARE v_md5 text; v_body text; v_oid oid; v_acl aclitem[]; v_attr text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc),
         pg_catalog.regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'),
         p.oid, p.proacl,
         p.proisstrict::text || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|'
           || COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '')
    INTO v_md5, v_body, v_oid, v_acl, v_attr
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_create_manual_order';

  -- ① 🔴🔴 **機械證明** —— 這一格同時答兩件事:「我要的那一段進去了」與「別的地方沒被動」。
  --    ⛔ ~~逐條問「某個字面在不在」~~ —— 那是 ⟦b4-BANKCARDRACE⟧ codex R1 打穿的形狀:
  --       把 `IF` 改成別的判準、把兩個分支對調, **那些字面全都還在**, 每一格照樣綠。
  IF v_md5 <> '{md5_new}' THEN
    RAISE EXCEPTION '斷言①:貼完之後函式本體 md5 是 %, 期望 % ⇒ 進去的不是我這一份', v_md5, '{md5_new}';
  END IF;

  -- ② 兩個世界各自的可執行形狀都在(剝掉行註解之後才搜)
  --    🛑 **這一格【比 ① 弱】, 留著只是為了錯誤訊息說得出是哪一半不見了。**
  IF v_body NOT LIKE '%IF v_invoice_requested THEN%' THEN
    RAISE EXCEPTION '斷言②a:函式體(剝註解後)沒有那道 IF ⇒ 稅還是無條件加';
  END IF;
  IF v_body NOT LIKE '%v_tax := 0;%' THEN
    RAISE EXCEPTION '斷言②b:沒有「沒勾 ⇒ 稅 0」那一支 ⇒ Sean 說的「價錢都不加」沒有落點';
  END IF;

  -- ③ ⚪ **負對照方向**:舊那個常數必須【消失】。
  --    📌 少了這一格, 一個「IF 加了而常數還在(於是賦值編譯失敗或被覆蓋)」的世界也會過 ②。
  IF v_body LIKE '%v_price_tax_mode constant%' THEN
    RAISE EXCEPTION '斷言③:v_price_tax_mode 還是 constant ⇒ 第 6 代沒被換掉';
  END IF;

  -- ③b 🔴 **函式屬性**(codex R1 nit ③)—— `prosrc` 不含它們 ⇒ 斷言① 對它們完全失明。
  --    🛑 `STRICT` 是這裡最貴的一格:加上它 ⇒ 任一參數是 `NULL` 就**直接回 NULL、本體不跑**,
  --      而 repository 對留白的通知信箱送的正是 `NULL`。⇒ 📌 一張單沒被建出來而沒有東西會叫。
  IF v_attr IS DISTINCT FROM 'false|true|v|search_path=""' THEN
    RAISE EXCEPTION '斷言③b:貼完之後函式屬性是 [%], 期望 [false|true|v|search_path=""]', v_attr;
  END IF;

  -- ④ 取代不是多載 —— 🔴 多一支 11 參的同名函式會讓呼叫端拿 `is not unique`。
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='admin_create_manual_order') <> 1 THEN
    RAISE EXCEPTION '斷言④:admin_create_manual_order 不只一支 ⇒ 我建出了多載';
  END IF;

  -- ⑤ ACL 沒掉。`CREATE OR REPLACE` 應該保留它, 而**這一格證它**而不是相信它。
  --    🔴 `proacl IS NULL` 那一格是承重的:ACL 欄是 NULL 時 **PUBLIC 隱含有 EXECUTE**,
  --       而 `has_function_privilege('anon', …)` 那時會回 **true** ——
  --       ⇒ 📌 只問 anon 的話, 「被收乾淨了」與「整欄被重設成 NULL」印**相反**的結果,
  --          而錯的那個方向(NULL)看起來像沒事。(`docs/patterns/revoking-function-execute-in-supabase.md`)
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '斷言⑤:proacl 變成 NULL ⇒ PUBLIC 隱含拿回 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言⑤b:service_role 的 EXECUTE 不見了 ⇒ 後台建不了單';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言⑤c:anon 或 authenticated 拿到了 EXECUTE ⇒ 客人打得到後台建單 RPC';
  END IF;
END
$post$;

-- 🛑 **上面五道【證不到稅算得對】** —— 它們看的是函式本體的位元與 catalog 的形狀。
--    要證兩個世界各自算出什麼, 得**真的建兩張單**:
--      勾了  ⇒ tax_total = ROUND((小計 + 運費) × 0.05)、price_tax_mode = 'exclusive'
--      沒勾  ⇒ tax_total = 0、price_tax_mode = 'inclusive'、total = 小計 + 運費
--    📌 **「md5 對上了」與「稅是對的」是兩個宣稱。**
--    ✅ 那十格跑在拋棄式 PG 上:`scripts/probe-invoice5pct-tax-gate.sh`。

COMMIT;
"""

# 🟢 **正對照:用舊本體重組, 必須逐位元等於原檔那一段** —— 證明我的切法沒有吃掉字元。
assert create_head + body_old + '$fn$;' == src[i:src.index(CLOSE, j) + len(CLOSE)], '切法會吃字元'
OUT.write_text(HDR + create_head + body_new + '$fn$;\n' + POST, encoding='utf-8')
print('寫出', OUT)
