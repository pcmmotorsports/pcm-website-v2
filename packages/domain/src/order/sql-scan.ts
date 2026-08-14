// sql-scan.ts — migration 文字守門共用的「引號感知 SQL 掃描」。
//
// 🔴 **本檔是搬家、不是新寫**(`#473b-1`):原本住在 `shipping-rpc-drift.test.ts` 裡,
//    第二個 migration 文字守門(`refund-remaining-single-source.test.ts`)要用同一支。
//    複製一份 = 兩份會各自被修、各自漂 —— 這正是本 repo 反覆記過的形狀
//    (`refund-ledger-view.ts:1-2` 檔頭逐字:「兩處各養一份就是下一個漂移點」)。
//    ⚠️ 搬家時**一個字都沒改邏輯**;它累積的那些 codex/Fable 修正(見下方註解)全部原樣保留。
//
// ⚠️ **誠實邊界**:這是文字比對啟發式、**不是 SQL parser**。非 canonical 的 DDL 寫法理論上
//    仍可能繞過。不引入 SQL AST 依賴的理由 = 範圍擴張;catalog 層級的權威驗證放在各 migration
//    自己的 apply 時斷言(不符即 RAISE 拒套用)⇒ **CI 文字 gate + apply 時 catalog 自檢** 兩層互補。
//
// ⚠️ **已知未處理的兩種寫法**(codex 關卡2 nit,2026-08-14;**刻意留著**):
//    ① `E'...\''` 這種 E-string 的反斜線跳脫 —— 本掃描只認 `''` 雙寫轉義,
//       遇到 `E'\''` 會把字串邊界算錯、之後的位置全部失同步。
//    ② 雙引號 identifier(`"refund_amount"`)—— 本掃描不特別處理雙引號。
//    **不在 `#473b-1` 修的理由**:本函式是從 `shipping-rpc-drift.test.ts` **原樣搬過來**的,
//    它守著運費金額、已累積多輪 codex/Fable 修正;在搬家的同一片改它的行為 =
//    把「搬家」和「改邏輯」混進同一個 diff,出事時分不清是哪一個造成的。
//    ⇒ 消費端自己補:`refund-remaining-single-source.test.ts` 的正則寫成 `"?refund_amount"?`,
//      雙引號那面在該檔已覆蓋;E-string 那面兩邊都還沒有(migrations 目前零使用)。

/**
 * 引號感知的單次掃描:剝註解、並分離「字串/dollar-quote 內容」與「真正的 DDL 文字」。
 *
 * 🔴 為何不能用「一律 regex 剝掉 dash-dash 到行尾」(codex 關卡2 R2 抓出):單引號字串**裡面**的 `--`
 *   是資料、不是註解;粗暴 replace 會把該行後面的**真 DDL 吃掉** → anchor 回退舊 migration = 假綠。
 * 🔴 dollar-quote tag 允許數字(`$fn$` / `$func1$`);舊版 regex `[A-Za-z_]*` 讀不到 `$func1$`。
 *
 * 回傳三種視角:
 *   · `code`          = 剝掉註解、**保留**字串與 dollar-quote 內容(函式本體就在 `$$…$$` 裡)
 *   · `codeNoLiterals`= 再把字串與 dollar-quote 整塊清空(判斷「真的寫在頂層 DDL 上」用)
 *   · `literals`      = 每一段字串/dollar-quote 內容(逐段判斷動態 DDL 用)
 * ⚠️ dollar-quote 內容視為「程式碼」(PL/pgSQL 本體)→ 遞迴剝它裡面的 `--` 註解。
 */
export function scanSql(sql: string): { code: string; codeNoLiterals: string; literals: string[] } {
  let code = '';
  let codeNoLiterals = '';
  const literals: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      let depth = 1; // PG 的 block comment 可嵌套
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; } // '' = 轉義的單引號
          j++;
          break;
        }
        j++;
      }
      const lit = sql.slice(i, j);
      literals.push(lit);
      code += lit; // 保留(字串內的 dash-dash 不得被當註解)
      codeNoLiterals += ' ';
      i = j;
      continue;
    }
    const dq = /^\$([A-Za-z_][A-Za-z0-9_]*|)\$/.exec(sql.slice(i));
    if (dq) {
      const tag = dq[0];
      const end = sql.indexOf(tag, i + tag.length);
      const inner = sql.slice(i + tag.length, end === -1 ? sql.length : end);
      const innerCode = scanSql(inner).code; // 內容當程式碼:遞迴剝其註解
      // 🔴 推「已剝註解」的版本(Fable nit):否則 DO block 內一行提到 ALTER…SET DEFAULT 的
      //   **註解**就會讓下游的動態 DDL 偵測假陽性轉紅。
      literals.push(innerCode);
      code += innerCode;
      codeNoLiterals += ' ';
      i = end === -1 ? sql.length : end + tag.length;
      continue;
    }
    code += sql[i];
    codeNoLiterals += sql[i];
    i++;
  }
  return { code, codeNoLiterals, literals };
}
