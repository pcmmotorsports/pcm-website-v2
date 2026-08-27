#!/usr/bin/env python3
"""
N3b §4.1d:「其餘 653 行逐字不動」的機械證明。

## 為什麼需要這支
N3b 對 create_order 的**語意** delta 只有「產號 + 有界重試」一件事,
但 PostgreSQL 不允許只替換函式體的一段
⇒ 必須把整支 654 行重新下一次。
🔴 **實際 diff 是 69 行、不是 3 行**(關卡2-B n2 更正:DECLARE 3 行 + 段 8 整段重寫)——
   「只改 3 行」是對語意的描述,不是對 diff 的描述,寫成後者就是字面 vs 事實。
這是本片**最大的人工失真面**,而既有機制都守不到它:

  · 自指指紋只證明「常數 == 我實際寫出來的檔」—— **抄漏一行它照樣綠**
  · #216 drift gate 只守運費 CASE **一處**
  · 突變矩陣驗的是「我寫的邏輯對不對」,不是「我有沒有在搬 654 行時弄壞別的東西」

這條裸露面由 Fable 關卡1 R2 指出;本檔是它要求的那道守門。
🔴 **不能用肉眼比對代替**:654 行、單一 delta,人眼掃過去必然宣稱「一樣」。

## 做法
在拋棄式庫上取兩份 `pg_get_functiondef`:
  BEFORE = 20260719120000(現行生效版)的 CREATE 塊
  AFTER  = 20260730120100(N3b)的 CREATE 塊
兩邊各自以**標記**框出「允許變動的行域」,然後斷言**域外每一行逐字元相同**。

🔴 刻意不用「diff hunk 數 == N」當斷言:difflib 會因為區塊中間夾了相同的空行
   而把一個邏輯區塊拆成多個 hunk(首次實跑實測 3 個),且殘餘集合會隨它對空行的
   對齊方式漂移。改用「兩邊都由標記定義行域」⇒ 判定與 diff 演算法完全無關。

## 誠實邊界
本檔證明的是「N3b 的函式定義相對 07-19 版,只在 DECLARE 與段 8 有差異」。
它**不證明**段 8 的新邏輯是對的(那是 scripts/n3-verify.sh 的行為段與突變矩陣),
也不證明結帳真的能用(那只有 Sean 的 1 元真刷算)。
"""
import difflib
import re
import subprocess
import sys

URL = "postgresql://postgres@127.0.0.1:54329/postgres"
SIG = "public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)"
OLD = "supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql"
NEW = "supabase/migrations/20260730120100_m4b_e10_n3b_create_order_new_display_id.sql"

MARK_8B = "── 8b. 🔴 #241"


def die(msg: str) -> None:
    print(f"🔴 FAIL: {msg}")
    sys.exit(1)


def psql(sql: str | None = None, path: str | None = None) -> str:
    cmd = ["psql", URL, "-v", "ON_ERROR_STOP=1", "-qtA"]
    cmd += ["-f", path] if path else ["-c", sql or ""]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        die(f"psql 失敗:\n{r.stderr[-1500:]}")
    return r.stdout


def funcdef() -> list[str]:
    return psql(f"SELECT pg_get_functiondef('{SIG}'::regprocedure)").rstrip("\n").split("\n")


def extract_create_block(path: str) -> str:
    """從 migration 抽出 create_order 的 CREATE 塊,統一成 OR REPLACE 形式。"""
    lines = open(path, encoding="utf-8").read().split("\n")
    # N6:anchor 找不到時走 die()、不丟 traceback(與檔內其他錯誤路徑一致)
    i = next(
        (k for k, l in enumerate(lines)
         if re.match(r"^CREATE (OR REPLACE )?FUNCTION public\.create_order\($", l)), -1)
    if i < 0:
        die(f"{path} 內找不到 create_order 的 CREATE 起點")
    j = next((k for k in range(i, len(lines)) if lines[k].strip() == "$fn$;"), -1)
    if j < 0:
        die(f"{path} 內找不到 $fn$; 終點")
    blk = lines[i:j + 1]
    blk[0] = "CREATE OR REPLACE FUNCTION public.create_order("
    return "\n".join(blk) + "\n"


def region_before(lines: list[str]) -> set[int]:
    """BEFORE 允許變動的行域:v_seq_text 宣告 + 段 8(標題 → RETURNING)。"""
    i_seq = next((k for k, l in enumerate(lines) if l == "  v_seq_text       text;"), -1)
    i_8s = next((k for k, l in enumerate(lines) if "── 8. 產號 + 寫 order ──" in l), -1)
    if i_seq < 0 or i_8s < 0:
        die(f"BEFORE 的 anchor 找不到(v_seq_text={i_seq} / 段8={i_8s})⇒ 行域推導前提不成立")
    i_ret = next((k for k in range(i_8s, len(lines))
                  if "RETURNING id INTO v_order_id;" in lines[k]), -1)
    if i_ret < 0:
        die("BEFORE 內找不到 RETURNING id INTO v_order_id")
    return {i_seq} | set(range(i_8s, i_ret + 1))


def region_after(lines: list[str]) -> set[int]:
    """AFTER 允許變動的行域:新 DECLARE 三行 + 新段 8(標題 → 8b 之前的最後一行)。"""
    i_d0 = next((k for k, l in enumerate(lines) if "N3b delta:v_seq_text 移除" in l), -1)
    i_8s = next((k for k, l in enumerate(lines) if "── 8. 產號 + 寫 order(N3b" in l), -1)
    if i_d0 < 0 or i_8s < 0:
        die(f"AFTER 的 anchor 找不到(DECLARE={i_d0} / 段8={i_8s})⇒ 行域推導前提不成立")
    i_d1 = next((k for k in range(i_d0, len(lines)) if "v_cname" in lines[k]), -1)
    i_8b = next((k for k in range(i_8s, len(lines)) if MARK_8B in lines[k]), -1)
    if i_d1 < 0 or i_8b < 0:
        die(f"AFTER 的終點 anchor 找不到(v_cname={i_d1} / 8b={i_8b})")
    # 8b 標題前面那一行是空行(兩邊都有、屬於「相同」的部分)⇒ 域的終點是它再往前一行
    i_end = i_8b - 2
    if lines[i_8b - 1].strip() != "":
        die(f"AFTER 的 8b 標題前不是空行(第 {i_8b-1} 行:{lines[i_8b-1]!r})⇒ 行域推導前提不成立")
    return set(range(i_d0, i_d1 + 1)) | set(range(i_8s, i_end + 1))


def insert_block(lines: list[str]) -> list[str]:
    """抽出 orders 的 INSERT…RETURNING 塊(欄位列 + VALUES + RETURNING)。

    🔴 **M2(關卡2-A must-fix)**:這 13 行原本整段落在「允許變動行域」裡 ⇒ 零機械比對。
    實測證偽兩個突變都能讓本檔全綠:
      · `v_subtotal::integer` ↔ `v_total::integer` 對調
        —— 這個**碰巧**被既有的 `orders_total_balances` CHECK 擋下(訂單根本建不出來),
           但那是遮蔽、不是本檔守到的。
      · `'general'::public.member_tier` → `'premiumStore'`
        —— **沒有任何 CHECK 擋**:訂單真的建立、`tier_at_checkout` 寫成經銷價 tier,
           而本檔照樣印「✅ 通過」。這才是 M2 的真正嚴重性。
    N3b 把這 13 行搬進重試迴圈 ⇒ 只有縮排 +4 改變,內容必須逐字相同。
    ⇒ 改為【strip 後逐行嚴格比對】,縮排差異容許、任何其他字元差異一律 FAIL。
    """
    # 🔴 n5(關卡2-B):必須斷言**只有一個** orders INSERT ——
    #    原本只鎖第一個,域內若被塞第二個 INSERT(例如重複寫一筆訂單)本檔不會報,
    #    只有 harness B 段的「新格式 +1」計數才抓得到。多一道確定性的閘更便宜。
    hits = [k for k, l in enumerate(lines) if l.strip() == "INSERT INTO public.orders ("]
    if len(hits) != 1:
        die(f"orders 的 INSERT 起點應恰為 1 個,實際 {len(hits)} 個(行號 {hits})"
            " ⇒ 段 8 結構被動過,人工覆核")
    i = hits[0]
    j = next((k for k in range(i, len(lines)) if "RETURNING id INTO v_order_id;" in lines[k]), -1)
    if j < 0:
        die("找不到 RETURNING id INTO v_order_id ⇒ M2 守門的前提不成立")
    return lines[i:j + 1]


def main() -> None:
    shipped = funcdef()
    print(f"AFTER_0(migration 實際套用出的狀態)= {len(shipped)} 行")

    for tag, path in (("BEFORE", OLD), ("AFTER", NEW)):
        open(f"/tmp/n3b-blk-{tag}.sql", "w", encoding="utf-8").write(extract_create_block(path))

    psql(path="/tmp/n3b-blk-BEFORE.sql")
    before = funcdef()
    psql(path="/tmp/n3b-blk-AFTER.sql")
    after = funcdef()
    print(f"BEFORE(07-19 版)= {len(before)} 行   AFTER(N3b 版)= {len(after)} 行")

    # 自洽:重放 N3b 的 CREATE 塊必須得到與 migration 套用完全相同的定義
    if after != shipped:
        die("重放 N3b 的 CREATE 塊後,函式定義與 migration 套用出的結果不一致")
    print("✅ 自洽:重放 N3b CREATE 塊 == migration 實際套用結果")

    allow_b, allow_a = region_before(before), region_after(after)
    print(f"允許變動行域:BEFORE {len(allow_b)} / {len(before)} 行、"
          f"AFTER {len(allow_a)} / {len(after)} 行")

    # ── 核心斷言:域外逐字元相同 ──
    res_b = [l for k, l in enumerate(before) if k not in allow_b]
    res_a = [l for k, l in enumerate(after) if k not in allow_a]
    if res_b != res_a:
        print(f"🔴 域外不一致:BEFORE 殘餘 {len(res_b)} 行 vs AFTER 殘餘 {len(res_a)} 行")
        for d in list(difflib.unified_diff(res_b, res_a, "BEFORE域外", "AFTER域外", lineterm=""))[:30]:
            print("   " + d)
        die("段 8 / DECLARE 之外有東西被改動了 —— 這正是本檔要抓的「搬 654 行時弄壞別的東西」")
    print(f"✅ 域外 {len(res_b)} 行**逐字元相同**")

    # ── M2:錢欄 INSERT 塊必須逐字相同(縮排除外)──
    ib, ia = insert_block(before), insert_block(after)
    sb = [l.strip() for l in ib]
    sa = [l.strip() for l in ia]
    if sb != sa:
        print(f"🔴 orders 的 INSERT 塊內容不一致(BEFORE {len(sb)} 行 / AFTER {len(sa)} 行)")
        for d in list(difflib.unified_diff(sb, sa, "BEFORE_INSERT", "AFTER_INSERT", lineterm=""))[:20]:
            print("   " + d)
        die("段 8 的 INSERT 欄位列 / VALUES / RETURNING 被改動 —— 這 13 行是錢與 tier 的落點,"
            "只准縮排改變(搬進重試迴圈),內容一個字元都不准動")
    # 縮排必須是「整塊一致地 +4」(搬進 BEGIN…EXCEPTION 的唯一合理結果)
    deltas = {len(a) - len(a.lstrip()) - (len(b) - len(b.lstrip())) for a, b in zip(ia, ib)
              if a.strip()}
    if deltas != {4}:
        die(f"INSERT 塊的縮排位移不是整塊 +4:{sorted(deltas)} ⇒ 結構被動過,人工覆核")
    print(f"✅ orders 的 INSERT 塊 {len(sb)} 行 strip 後逐字元相同(縮排整塊 +4)")

    # ── 域內內容檢查:該有的有、該走的走 ──
    ins_b = [before[k] for k in sorted(allow_b)]
    ins_a = [after[k] for k in sorted(allow_a)]
    code_a = [l for l in ins_a if not l.lstrip().startswith("--")]  # 排除註解行再查字面

    fails: list[str] = []
    for need in ("FOR v_attempt IN 1 .. 5 LOOP", "public.pcm_generate_display_id()",
                 "orders_display_id_key", "pcm_display_id_exhausted",
                 "v_attempt        integer;", "v_cname          text;",
                 "RETURNING id INTO v_order_id;"):
        if not any(need in l for l in code_a):   # N5:正向也排除註解行
            fails.append(f"域內缺少應有的字面:{need}")
    # 舊產號器必須完全離線(只看程式碼行 —— 註解裡提到 v_seq_text 是說明它被移除了)
    for gone in ("nextval", "'PCM-'", "v_seq_text"):
        hit = [l for l in code_a if gone in l]
        if hit:
            fails.append(f"域內仍殘留舊產號字面 {gone}:{hit[:2]}")
    # 反向:BEFORE 的域內必須真的有舊產號器(否則行域推導抓錯地方)
    if not any("nextval" in l for l in ins_b):
        fails.append("BEFORE 的域內找不到 nextval ⇒ 行域推導抓錯位置,本次比對無效")

    if fails:
        for f in fails:
            print(f"🔴 {f}")
        sys.exit(1)

    print("✅ 域內檢查通過:新產號器已接線、舊產號器完全離線")
    print("\n✅ §4.1d 通過 —— N3b 相對 07-19 版的差異完全落在 DECLARE 與段 8,"
          f"其餘 {len(res_b)} 行逐字元不動")


if __name__ == "__main__":
    main()
