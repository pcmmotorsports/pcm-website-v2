/**
 * 🔴 **登記 RPC 的第一個呼叫端出生時,這一格會紅** —— 而那正是要人去讀 `#787` 的時刻。
 *
 * ## 為什麼需要它(W5 對抗審查 D2 R1 MF-1)
 * 片 D2(`20260820022000`)把 `admin_record_manual_refund` 的 EXECUTE 開給 `service_role`
 * ⇒ 從那一刻起,**任何帶 service_role 的 server 路徑**都寫得進一筆
 * **改不掉、而且會永久多扣可退餘額**的列(`20260820010000:167` 的 `CHECK (> 0)` 讓沖銷寫不出來;
 * `pcm_order_refundable_remaining` `:246-249` 無條件 SUM 全部列)。
 *
 * 🔴 而 W1 的封印裁定只約束「登記畫面那一片」—— **約束不到其他呼叫端**。
 * ⇒ 缺口已記在 backlog `#787`,**而 backlog 不會在有人加第一個呼叫端的那一刻說話。**
 * ⇒ **這一格會。** 它紅在那個人的 CI 裡,而不是紅在一份他沒理由打開的檔案裡。
 *
 * ## 這一格【不是】禁止加呼叫端
 * 它要求的只有一件:**加之前先讀 `#787`,並確認封印(沖銷 RPC 可呼叫)已經在你那一片裡。**
 * 確認過了 ⇒ 把檔案路徑加進 `CALLER_ALLOWLIST` 並寫 why。形狀照同目錄
 * `refund-remaining-single-source.test.ts` 的 `SQL_ALLOWLIST`(同 repo 前例)。
 *
 * ⚠️ **它擋不住什麼**(誠實邊界,不擴張):
 * - 它掃的是**字面**。有人用字串拼接或變數繞過去 ⇒ 掃不到。
 * - 它不驗封印**做對了沒**,只驗「有人動了這一格」⇒ 它是**觸發器**,不是防線。
 * - 真正的防線是那一片自己的前置閘(形狀照片 A 的閘二:先判存在、再驗能不能用)。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** repo 根(本檔在 packages/domain/src/order/)。 */
const REPO = resolve(__dirname, '../../../..');

/** RPC 名 —— 與 `20260820021000` 建的那支逐字相同。 */
const RPC = 'admin_record_manual_refund';

/**
 * 量具自檢用的對照目標:同族那支**確實有呼叫端**的 RPC(2026-08-20 實測 16 個檔命中)。
 * ⚠️ 它哪天被改名 / 下架 ⇒ 本檔會 throw,而**原因與退款登記無關** —— 訊息裡寫了怎麼分辨。
 */
const CONTROL_NEEDLE = 'admin_record_manual_payment';

/**
 * 已經被讀過 `#787`、確認過封印的呼叫端。
 * 🔴 **加一行之前請先讀 `#787`**;`why` 要寫「封印在哪一片、驗的是什麼」,不要寫「已確認」。
 */
const CALLER_ALLOWLIST: Record<string, string> = {
  // 目前為空 —— 2026-08-20 實測 0 個呼叫端(正向對照 admin_record_manual_payment ⇒ 16)。
};

function grepCallers(needle: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      ['-rlF', '--include=*.ts', '--include=*.tsx', needle, 'packages', 'apps'],
      { cwd: REPO, encoding: 'utf8' },
    );
    return (
      out
        .split('\n')
        .filter(Boolean)
        // 🔴 **本檔自己一定會命中**(它把那兩個名字寫在原始碼裡)⇒ 一律排除,**對主查詢與對照都一樣**。
        //    2026-08-20 實測到的病:原本只有主查詢排除了自己,**對照沒有**
        //    ⇒ 我把對照目標換成一個不存在的名字去做突變,而它**照樣綠** —— 因為它找到了自己。
        //    ⇒ ⇒ 那格對照當時是**恆真**的,而它的用途正是證明量具還活著。
        .filter((f) => !f.endsWith('manual-refund-caller-gate.test.ts'))
    );
  } catch {
    // 🔴 **這裡刻意【不靠 exit code 分辨】**(W5 R2 nit-1 提的修法,我實測後發現它在本機不成立):
    //    W5 建議「status === 1 ⇒ 零命中、其餘 rethrow」,而 2026-08-20 在本機實測:
    //      `grep -rlF … no_such_dir_xyz`(目錄不存在)⇒ status **1**
    //      `grep -rlF …(零命中)`                    ⇒ status **1**
    //    ⇒ **兩個世界同一個碼** ⇒ 那個修法在這台機器上分不出來。
    //    (成因很可能是這裡的 `grep` 是 **ugrep 7.8.4**、不是 GNU grep —— 而**我沒有去查它的文件**,
    //     我只量到「兩者同碼」這個事實,那已經足以否決那個修法。)
    return [];
  }
}

/**
 * 🔴 **每一次呼叫都讓量具自己表演一遍** —— 這是上面那個 catch 的替代方案。
 *
 * 病:`grepCallers` 回空陣列時,「真的沒有呼叫端」與「grep 整個壞了」**長得一樣**。
 * 而原本的解法是「另一個 `it` 會紅」—— **那句話錯在主詞**:分得開的是另一個 `it`,不是這個函式;
 * 哪天有人 skip 或改寫那格對照,這道閘就**永久綠而零訊號**。
 *
 * ⇒ 改成:**把對照放進同一條路徑**。查之前先確認同族那支「確實有呼叫端」的目標找得到;
 * 找不到 ⇒ **throw**,而不是回一個看起來很乾淨的空陣列。
 * ⇒ 這樣「零命中」這個答案,只有在**量具當場證明過自己還活著**的時候才出得來。
 */
function grepCallersOrThrow(needle: string): string[] {
  const alive = grepCallers(CONTROL_NEEDLE);
  if (alive.length === 0) {
    throw new Error(
      `🔴 量具沒有通過自檢:對照目標 ${CONTROL_NEEDLE} 一個呼叫端都找不到。\n` +
        '那代表 grep 壞了、搜尋根目錄不對,**或那支同族 RPC 被改名/下架了**。\n' +
        '⇒ 在修好它之前,本檔對「有沒有呼叫端」的任何答案都不算數。\n' +
        '⚠️ 若是被改名:換一個「確實有呼叫端」的同族目標,**不要把這個自檢放寬**。',
    );
  }
  return grepCallers(needle);
}

describe('🔴 admin_record_manual_refund 的呼叫端閘(#787 的觸發器)', () => {
  it('🔴 正向對照:同族那支【確實有】呼叫端 ⇒ 證明這把尺是活的', () => {
    // 少了這一格,grep 整個壞掉時下面那格會「零命中 ⇒ 綠」—— 那是恆綠。
    // ⚠️ **這一格會因為與本閘無關的理由紅**(W5 R2 nit-2):`admin_record_manual_payment`
    //    哪天被改名 / 下架,對照組就紅,而原因與退款登記一點關係都沒有。
    //    🔴 **那一刻的人會傾向「把對照組弄綠」,而那正好是弄壞它的動作。**
    //    ⇒ 這格紅時**先確認是不是那支被改名了**;是的話換一個「確實有呼叫端」的同族目標,
    //      **不要**把 `toBeGreaterThan(0)` 放寬。
    const control = grepCallers(CONTROL_NEEDLE);
    expect(control.length).toBeGreaterThan(0);
  });

  it('🔴 出現第一個呼叫端時必須紅 —— 而紅的意思是「先讀 #787」,不是「不准加」', () => {
    const callers = grepCallersOrThrow(RPC).filter((f) => !(f in CALLER_ALLOWLIST));

    expect(
      callers,
      `🔴 你加了 ${RPC} 的呼叫端:\n  ${callers.join('\n  ')}\n\n` +
        '而那支 RPC 寫進去的列**改不掉**,並且會永久多扣「可退餘額」——\n' +
        '⇒ 客人可以退的金額會被少算,而畫面上一切正常。\n\n' +
        '動手前請先讀 backlog #787,並確認【你這一片】自帶封印:\n' +
        '  沖銷 RPC 必須存在且可呼叫(形狀照片 A 的閘二:先判存在、再驗能不能用)。\n' +
        '確認過了 ⇒ 把檔案路徑加進本檔的 CALLER_ALLOWLIST 並寫 why。',
    ).toEqual([]);
  });
});
