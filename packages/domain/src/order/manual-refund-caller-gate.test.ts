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
      ['-rl', '--include=*.ts', '--include=*.tsx', needle, 'packages', 'apps'],
      { cwd: REPO, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    // grep 零命中時 exit 1 ⇒ 這裡的空陣列是「真的零」,不是「跑失敗」。
    // 而下面的正向對照那一格會在 grep 整個壞掉時紅 —— 兩者分得開。
    return [];
  }
}

describe('🔴 admin_record_manual_refund 的呼叫端閘(#787 的觸發器)', () => {
  it('🔴 正向對照:同族那支【確實有】呼叫端 ⇒ 證明這把尺是活的', () => {
    // 少了這一格,grep 整個壞掉時下面那格會「零命中 ⇒ 綠」—— 那是恆綠。
    const control = grepCallers('admin_record_manual_payment');
    expect(control.length).toBeGreaterThan(0);
  });

  it('🔴 出現第一個呼叫端時必須紅 —— 而紅的意思是「先讀 #787」,不是「不准加」', () => {
    const callers = grepCallers(RPC)
      // 本檔自己會提到那個名字(它就是在檢查它)⇒ 排除自己,否則會擋自己
      .filter((f) => !f.endsWith('manual-refund-caller-gate.test.ts'))
      .filter((f) => !(f in CALLER_ALLOWLIST));

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
