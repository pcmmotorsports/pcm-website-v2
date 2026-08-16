# 三個併發 harness（可重跑）—— 今晚跑出數字的那三個

- **來源**：E 窗 2026-08-16。三個都在**拋棄式 PostgreSQL 17.10** 上跑過。
- **為什麼落檔**：它們原本只活在 `/tmp`，**session 一結束就沒了**。
  📎 我自己今晚寫過那句：**「寫下『它會消失』只是記錄損失，不是避免損失。」**
- ⚠️ **這是【機制】的 harness，不是那幾支真函式的測試** —— 每個都用**同構最小模型**、
  **不是真 schema**。撐得住「這個形狀會不會壞」，**撐不住「他們那支的每一條路徑都如此」**。

---

## 🔴 檔頭先讀：**我今晚三次讓控制組沒紅，而三次的成因都不同**

**這一節比下面的 harness 難重建** —— harness 你照抄就有，**而「控制組為什麼會假綠」要踩過才知道。**

| # | 場合 | 控制組為什麼沒紅 | 類 |
|---|---|---|---|
| 1 | 掛品項超量 race | **時序意外序列化** —— 兩個交易差 0.5 秒起跑，第二個的 `INSERT` 剛好在第一個 commit **之後**才開始 | 安靜 |
| 2 | 行號機械複驗 | **量具本身有洞** —— regex 要求檔名有副檔名，而出問題那條我寫成縮寫 `…_…:517` ⇒ 沒被匹配到，卻回報「0 條超出」 | 安靜 |
| 3 | 出貨作廢 CAS | **情境本身讓競態不發生** —— 包裹一開始就是已作廢的，TOCTOU 版在**讀那一步**就 REJECT 了 | 安靜 |

🔴 **三次都是「安靜」的** —— 輸出看起來全部像好消息。**沒有一次會自己叫。**

**共通的可操作版：**

> **跑完先看控制組那一格。控制組沒紅 ⇒ 這一輪的所有綠全部作廢，整輪重做，不要只補那一格。**

**而 #3 的教訓是最不直覺的那個：**

> **我把「兩個方向」當成了「會競爭」——
> 而它們競爭的前提是【兩邊的檢查都要先通過】。**
> ⇒ **構造競態時，先問「兩個呼叫會不會都走到寫入那一步」，不是「它們是不是相反的操作」。**

---

## 0. 共用：起一台拋棄式 PG（**絕不對正式庫跑**）

```bash
export LC_ALL=C
PGBIN=/opt/homebrew/opt/postgresql@17/bin
rm -rf /tmp/h && mkdir -p /tmp/h/pg /tmp/h/s
"$PGBIN/initdb" -D /tmp/h/pg -U postgres --no-locale -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D /tmp/h/pg -o "-p 54799 -c unix_socket_directories=/tmp/h/s -c listen_addresses=''" -l /tmp/h/pg.log start
sleep 2
```

🔴 **zsh 提醒（我今晚踩了兩次）**：**不要把整條 psql 命令放進變數再展開** ——
zsh 不對變數做 word splitting，會整條被當成一個檔名。**用函式或直接寫完整命令。**

**收尾**：`"$PGBIN/pg_ctl" -D /tmp/h/pg stop -m fast`，並 `pgrep -f /tmp/h/pg` 確認沒有殘留。

---

## 1. 冪等樹 × 取消守門的**順序**

**要證的**：把兩者順序對調，行為會變，**而兩格「功能測試」照樣全綠**。

```sql
CREATE TABLE orders(id int primary key, payment_status text, cancelled bool,
                    rec text, amount int, updated_at timestamptz);

-- 版本 A（正確）：取消守門 → 冪等樹
CREATE FUNCTION confirm_A(p_id int, p_rec text, p_amt int) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE id=p_id FOR UPDATE;
  IF o.cancelled THEN RAISE EXCEPTION 'CANCELLED_GUARD'; END IF;
  IF o.payment_status='paid' AND o.rec IS NOT DISTINCT FROM p_rec AND o.amount=p_amt
    THEN RETURN jsonb_build_object('confirmed',true,'idempotent',true); END IF;
  UPDATE orders SET payment_status='paid', rec=p_rec, amount=p_amt, updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('confirmed',true,'idempotent',false);
END $$;

-- 版本 B（對調）：冪等樹 → 取消守門。【只有這兩塊換位置，其餘逐字相同】
CREATE FUNCTION confirm_B(p_id int, p_rec text, p_amt int) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE id=p_id FOR UPDATE;
  IF o.payment_status='paid' AND o.rec IS NOT DISTINCT FROM p_rec AND o.amount=p_amt
    THEN RETURN jsonb_build_object('confirmed',true,'idempotent',true); END IF;
  IF o.cancelled THEN RAISE EXCEPTION 'CANCELLED_GUARD'; END IF;
  UPDATE orders SET payment_status='paid', rec=p_rec, amount=p_amt, updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('confirmed',true,'idempotent',false);
END $$;
```

**三組測資**（前兩組＝一般人會寫的功能測試）：

```sql
-- ① 未取消 + 已 paid + 同 rec 同額重放
TRUNCATE orders; INSERT INTO orders VALUES (1,'paid',false,'R',100,now());
SELECT confirm_A(1,'R',100);   SELECT confirm_B(1,'R',100);
-- ② 已取消 + 尚未 paid
TRUNCATE orders; INSERT INTO orders VALUES (2,'unpaid',true,NULL,NULL,now());
SELECT confirm_A(2,'R',100);   SELECT confirm_B(2,'R',100);
-- 🔴 ③ 已取消【且】已 paid + 同 rec 同額  ← 只有這組分得出對錯
TRUNCATE orders; INSERT INTO orders VALUES (3,'paid',true,'R',100,now());
SELECT confirm_A(3,'R',100);   SELECT confirm_B(3,'R',100);
```

**2026-08-16 實測輸出：**

```
①  A = {"confirmed":true,"idempotent":true}    B = 同上          ← 一模一樣
②  A = ERROR: CANCELLED_GUARD                  B = 同上          ← 一模一樣
③  A = ERROR: CANCELLED_GUARD                  B = {"idempotent":true}   🔴 分開了
```

> **兩格功能測試在壞掉的版本上全綠。**
> 要分出對錯，測資必須**同時**滿足「已取消」與「已 paid 且同 rec 同額」——
> **那正好是兩個測試各自都不會用到的組合。**

---

## 2. 三個入口同時結算同一張單（webhook × callback × sweeper）

**要證的**：那兩條**沒有節流**的入口，安全**只**由冪等樹保證；拿掉它會**重複入帳**。

```sql
CREATE TABLE orders(id int primary key, payment_status text, rec text, amount int);
CREATE TABLE order_payments(id serial primary key, order_id int, rail text, amount int, rec text);

CREATE FUNCTION confirm_tree(p_id int, p_rec text, p_amt int) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  PERFORM pg_sleep(0.3);                                   -- 放大競態窗
  SELECT * INTO o FROM orders WHERE id=p_id FOR UPDATE;
  IF o.payment_status='paid' AND o.rec IS NOT DISTINCT FROM p_rec AND o.amount=p_amt
    THEN RETURN jsonb_build_object('idempotent',true); END IF;   -- 🔴 冪等樹
  UPDATE orders SET payment_status='paid', rec=p_rec, amount=p_amt WHERE id=p_id;
  INSERT INTO order_payments(order_id,rail,amount,rec) VALUES (p_id,'card',p_amt,p_rec);
  RETURN jsonb_build_object('idempotent',false);
END $$;

-- 🔴 控制組：冪等樹被「優化」掉（它看起來只是提早 return）
CREATE FUNCTION confirm_notree(p_id int, p_rec text, p_amt int) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  PERFORM pg_sleep(0.3);
  SELECT * INTO o FROM orders WHERE id=p_id FOR UPDATE;
  UPDATE orders SET payment_status='paid', rec=p_rec, amount=p_amt WHERE id=p_id;
  INSERT INTO order_payments(order_id,rail,amount,rec) VALUES (p_id,'card',p_amt,p_rec);
  RETURN jsonb_build_object('idempotent',false);
END $$;
```

**跑法**：重置成一張 100 元未付的單，然後**三個 psql 同時**呼叫同一支（`&` + `wait`），
最後數 `order_payments`。

**2026-08-16 實測輸出：**

```
🔴 控制組（無冪等樹） → order_payments 3 列 / 合計 300 元   ← 一張 100 元的單記三次
✅ 有冪等樹           → order_payments 1 列 / 合計 100 元
```

---

## 3. 出貨作廢的 CAS vs 先查再改（TOCTOU）

**要證的**：CAS 擋住「兩個人都以為自己作廢了它」。

```sql
CREATE TABLE shipments(id int primary key, deleted_at timestamptz, void_reason text);

-- ✅ 真實形狀：述詞寫進 WHERE + ROW_COUNT
CREATE FUNCTION void_cas(p_id int, p_reason text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_sleep(0.4);
  UPDATE shipments SET deleted_at=now(), void_reason=p_reason
   WHERE id=p_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RETURN 'REJECTED(狀態剛被別人改過)'; END IF;
  RETURN 'VOIDED';
END $$;

-- 🔴 控制組：先查再改，述詞在 IF 裡、WHERE 只有 id=
CREATE FUNCTION void_toctou(p_id int, p_reason text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE s shipments;
BEGIN
  SELECT * INTO s FROM shipments WHERE id=p_id;
  IF s.deleted_at IS NOT NULL THEN RETURN 'REJECTED'; END IF;
  PERFORM pg_sleep(0.4);                                   -- 讀與寫之間的窗
  UPDATE shipments SET deleted_at=now(), void_reason=p_reason WHERE id=p_id;
  RETURN 'VOIDED';
END $$;
```

🔴 **情境必須是「一張【未作廢】的包裹，兩人同方向（都要作廢）」。**

**2026-08-16 實測輸出：**

```
🔴 控制組（TOCTOU） 甲=VOIDED   乙=VOIDED              ← 兩個人【都】收到成功
                    最終保留的原因：甲的原因            ← 而只有一個活下來
✅ CAS              甲=REJECTED 乙=VOIDED
                    最終保留的原因：乙的原因            ← 一致，且被拒的人知道自己被拒
```

### ⚠️ 我第一次把這個情境構造錯了（留檔）

第一次用的是「一張**已作廢**的包裹，一人復原、一人再作廢（**兩個方向**）」——
**控制組沒有紅，兩版輸出一模一樣。**
**原因**：包裹一開始就是已作廢的 ⇒ TOCTOU 版的 `void` **在讀那一步就 REJECT**，
**競態根本沒發生。**

> 🔴 **我把「兩個方向」當成了「會競爭」，而競爭的前提是【兩邊的檢查都要先通過】。**

---

## 4. 跑任何一個之前的**第一動**

> **先確認控制組會紅。**

今晚三個 harness，**有兩個第一版的控制組沒紅**，成因各不相同：

| | 成因 |
|---|---|
| 掛品項 race | 時序差 0.5 秒 ⇒ **意外被序列化** |
| 出貨 CAS | 情境選錯 ⇒ **競態根本沒發生** |

**控制組沒紅 ⇒ 那一輪的所有綠全部作廢，整輪重做，不要只補那一格。**

---

## 5. 這三個 harness **不能**取代什麼

- ❌ 不能取代在**真函式**上跑的突變測試（冪等規格 §3 的 N1/N2/N3 仍要跑）。
- ❌ 不能證明「他們那五支出貨 RPC 的每一條路徑都真的走了 CAS」——那仍是**讀 code** 的判斷。
- ✅ 能證明的是：**這些形狀本身，在拿掉那道防線之後會壞成什麼樣子，以及壞的規模。**

📌 **後續可做（我唯讀，沒做）**：把本檔三段收成一支 `scripts/` 底下可一鍵重跑的 `.sh`。
現在它是**可複製貼上**，還不是**一鍵**。
