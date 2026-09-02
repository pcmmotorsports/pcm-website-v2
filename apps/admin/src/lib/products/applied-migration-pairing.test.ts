import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `#20` 片2c 的**硬前提守門**:後台 SELECT 到的欄位,不得早於它的 migration apply 而上線。
//
// ── 為什麼需要這支(關卡 R1 must-fix-1)────────────────────────────────────────
// 片2c 把 `listing_set_by` / `source_missing_at` 放進 **無條件** 的 SELECT 清單
// (`product-repository.ts` 的 `PRODUCT_LIST_COLUMNS` 與 `PRODUCT_DETAIL_COLUMNS`)。
// 而 `20260815030000` 尚未 apply ⇒ 這段 code 若先上線,PostgREST 每次都回 `42703`:
//   · 列表頁 → 走 catch → 顯示「商品列表載入失敗」
//   · 詳情頁 → 走 catch → `notFound()` → **404,讀起來像「這個商品不存在」而不是「系統壞了」**
// 🔴 而三道守門全部看不到:單測 `vi.mock` 掉 Supabase client、typecheck 因為
//    `database.types.ts` 被手改成「這兩欄存在」而全綠。
//    ⇒ **三綠全綠、突變全紅、正式站 42703** —— 08-07 A9h 事故(正式站壞約 8 小時)同一形狀。
//
// ── 為什麼寫成 `it.fails`,而不是一條普通斷言 ─────────────────────────────────
// 普通斷言會**現在就紅**,擋住 commit;而 Sean 的 apply 是獨立停點,不是我或主視窗能代的。
// 🔴 `it.fails` 讓這件事變成**「現在綠、apply 之後紅」**:
//   · 未 apply(現在)→ 內層斷言失敗 → `it.fails` 通過 → 可以 commit
//   · Sean apply 之後 → 內層斷言成立 → **`it.fails` 開始紅** → 逼下一個人回到這裡
//     ⇒ **而那正是該重 gen `database.types.ts` 並刪掉它檔頭第 ④ 段的同一刻。**
// ⚠️ **這不是把紅藏起來** —— 它把紅**挪到有人能處理的那一刻**。
//    現在紅沒有人能修(要 Sean),apply 後紅的人手上剛好有全部材料。
//
// ⚠️ **本守門不驗正式庫**,它讀的是 `supabase/APPLIED.tsv`(**自陳帳**)。
//    帳與真實不符時它會誤判 —— 那本帳按設計就是自陳的,這裡只是不假裝它不是。

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const MIGRATION_VERSION = '20260815030000';
const NEW_COLUMNS = ['listing_set_by', 'source_missing_at'] as const;

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('🔴 #20 片2c:SELECT 的欄位不得早於 migration apply 而上線', () => {
  it('前提斷言:repository 真的有 SELECT 那兩欄(不然本檔整支恆綠、白站崗)', () => {
    const code = read('apps/admin/src/lib/products/product-repository.ts');
    for (const col of NEW_COLUMNS) {
      expect({ [`repository 有 select ${col}`]: code.includes(col) }).toEqual({
        [`repository 有 select ${col}`]: true,
      });
    }
  });

  it('前提斷言:APPLIED.tsv 讀得到、而且格式是我以為的那樣(正向對照)', () => {
    const applied = read('supabase/APPLIED.tsv');
    // 拿一支「一定已 apply」的當正向對照 —— 沒有它,下面那格的「0 命中」可能只是路徑或格式錯。
    expect(applied).toContain('20260815020000');
  });

  // 🏁 2026-08-15 13:3x:Sean 已 apply,本格已依設計「開始紅」並被處理 ——
  //    主視窗重 gen database.types.ts、把它檔頭第 ④ 段標成作廢留痕(未刪,它記錄了一個真實發生過的狀態),
  //    並把本格從 `it.fails` 改成普通斷言。上面那段「為什麼寫成 it.fails」保留當紀錄:
  //    🔴 它是本 repo 第一次把「紅」刻意排到【有人能處理的那一刻】，而不是刻意讓它現在就紅或永遠不紅。
  //    ⇒ 從現在起本格的意義變成「這片的 SELECT 與那支 migration 必須成對存在」的常設守門。
  it('SELECT 用到的兩欄，其 migration 必須已登記在 APPLIED.tsv（成對存在）', () => {
    // 🔴🔴 **2026-09-01 修:原本是 `expect(整檔文字).toContain(MIGRATION_VERSION)`。**
    //   ⛔ ~~那一行~~ 的問題不是它會漏, 是它**答不出「登記在哪一欄」**:
    //      `APPLIED.tsv` 是四欄 TAB 分隔(版本號 / sha256 / apply 日期 / 由誰記),
    //      而**整檔子字串比對**會讓下面三種世界一律印綠 ——
    //      · 版本號只出現在檔頭的 `#` 註解裡
    //      · 版本號出現在【備註欄】(有人寫「跟在 20260815030000 之後」)
    //      · 一支更長的版本號把它當前綴吞掉(`202608150300001`)
    //      ⇒ **而它宣稱的是「已登記」。那三種世界都不是已登記。**
    //   ✅ 改成:剝掉註解行、取第一欄、比對**集合成員**。
    //      🔵 `toContain` 對【陣列】是**元素完全相等**(不是子字串)⇒ 前綴吞不掉它。
    //      📌 **⇒ 修法與病因是同一件事的兩面:`toContain` 的語意由【對象型別】決定。**
    //   🛑 **已知限制**:它證的是「這個版本號在第一欄」, **證不到「正式庫真的 apply 了」**
    //      —— `APPLIED.tsv` 是一本**帳本**, 而「帳上寫著」與「庫裡真的有」是兩個宣稱。
    const versions = read('supabase/APPLIED.tsv')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
      .map((l) => l.split('\t')[0]?.trim() ?? '');
    // 🟢 先證這把尺撈得到東西 —— 剝完剩 0 列的話下面那格會變成假紅,
    //    而假紅會被下一個人改回子字串 ⇒ 我們剛修掉的東西就回來了。
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain(MIGRATION_VERSION);
    // 🔵 負對照:同一把尺對一個現造版本號撈不到
    expect(versions).not.toContain('29990101000000');
  });
});
