// real-transaction-id-shape-guard.test.ts
//
// 🔴 **這道守門為什麼存在,以及它【取代】了什麼決定。**
//
// 2026-08-29 有人交辦「把那 13 處真值換掉」,清單是三個值。
// 而線C(`-b4`)照【形狀】重掃一次,量到的是:
//
//   ```
//   **11 個不同的識別碼** —— 而交辦清單上只有 3 個
//   其中【沒有人列過】而看起來是真值的有 6 個:
//     DR20260801bHUZv8 ×10  · D20260809yRE3lo ×1  · D20260809AgULsD ×1
//     D202607314b3cIL  ×1   · D20260724gUTcg1 ×1  · D20260809xCwNLf ×1
//   ⚠️ 而其中【最後那一個是這支守門自己抓到的】,我手掃時漏了(理由見下方 allowlist 註)
//      ⇒ 📌 所以連「11」這個數字,都不是我一個人數出來的。
//   ✅ 而 -e9 對 DR20260803gvcV5i 數到的 ×8 與我完全相同
//      ⇒ 📌 他的尺沒壞,**他的清單就是他的分母** —— 他答的是被問的那題。
//   ```
//
// 📌 **⇒ 所以「換掉那 13 處」買不到乾淨** —— 那份清單從來就不是母體。
//    **你只能 grep 你已經知道的值。一份用值當入口的掃描,射程等於那份清單。**
//
// ── 🔴 而【判定:不做逐值替換】,理由三條(2026-08-29 線C 判,-48 派工 B)──
//  ① **歷史改不掉** —— 那些值都在 git 歷史裡,而八窗共用一棵樹 + main 已推
//     ⇒ 改寫歷史不在選項內 ⇒ 換掉工作樹只買到「現況乾淨」,而現況不是唯一的來源。
//  ② **剩下的每一處,值【就是證據】** —— 逐處開過(見下方 allowlist 的理由欄):
//     生產碼那 4 處**全是註解**,在說「2026-08-19 那筆卡住的退款(8X3N5Q)」這種話。
//     ⇒ 把它匿名化 = 那句話**失去它指向的東西**,而註解還在、讀起來還很正常。
//  ③ 🔴 **而換掉會【傷害】下一個掃描的人**:他若也用值清單,換完之後那些值不在了
//     ⇒ 他會得到一個乾淨的結果,**而歷史裡還有** ⇒ 我們用一次替換,製造了一個假綠。
//
// ── ✅ 所以買得到東西的是【形狀】那一半,而這支檔就是它 ──────────
//  下面的 allowlist **就是那個「不換」決定的落點**:
//  🔴 它刻意住在守門裡,不住在交件裡 —— **下一個發現這些值的人一定會經過這裡**
//     (他一動到那些值,這支就紅),而他不一定會去讀任何一份交件。
//
// ⚠️ **這支守門答不了什麼**(寫在自己身上,免得被外推):
//  · 它只認【D/DR + 8 位日期 + 含字母尾碼】這一種形狀。`8X3N5Q` 那種六碼
//    display_id **不在它的射程裡**(太短、與一般字串撞得太兇)⇒ 那一族未覆蓋。
//  · 尾碼長度鎖 `{5,10}` ⇒ **4 碼或 ≥11 碼的尾碼滑得過去**(例 `D20260901ABCD`)。
//  · 無 `i` 旗標 ⇒ **小寫開頭的 `dr20260803…` 滑得過去**。今天已知真值全大寫,
//    而「今天沒有」與「不會有」是兩件事 ⇒ 這兩格是【已知未覆蓋】,不是已排除。
//  · 它掃的是工作樹,**不掃 git 歷史**、不掃 `~/pcm-mailbox`、不掃別的 repo。
//  · 它答「有沒有新的滲進來」,**不答「這些值安不安全」** —— 後者 -e9 已驗
//    (不會印到客人畫面、不會進 DB、`COMMENT ON` 零命中)。兩件事,不要合起來讀。

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** D/DR + 8 位日期 + 5-10 碼尾碼,且尾碼含至少兩個字母(排除 migration 純數字時戳)。 */
const ID_SHAPE = /\bDR?20\d{6}[A-Za-z0-9]{5,10}\b/g;

export function findIdShapes(text: string): string[] {
  const hits = text.match(ID_SHAPE) ?? [];
  return [...new Set(hits.filter((h) => (h.match(/[A-Za-z]/g) ?? []).length >= 2))];
}

/**
 * 🔴 **這張表就是「不換」那個決定本身。**
 * 要新增一列,代表你**又讓一個真值進來了** —— 先問:它非在碼裡不可嗎?
 * · 是 fixture ⇒ **編一個**(照 `DR20991231ZZQ641` 那種明顯不可能的形狀),不要進這張表。
 * · 是註解在記一次真實事故 ⇒ 進表,而**理由欄要寫得出那次事故是什麼**。
 */
const ALLOWED: Record<string, string> = {
  DR20260801bHUZv8: 'TapPay 退款線 wire 契約的實測背書值(wire.ts:228 註解在說 refund_amount 語意從未被保存)',
  DR20260803gvcV5i: '2026-08-03 匯款退款那天的實測值;refund-recovery 那族的既有 fixture 與註解',
  D20260819P8ZewM: '稽核明細「識別碼不可翻譯」那條規則的舉例值(audit-field-label.ts:5 / audit-detail.tsx:36)',
  D20260809yRE3lo: 'settle-charge.ts:466 註解:sandbox 實測 5 CANCEL 成立的那一筆',
  D20260809AgULsD: 'settle-charge.ts:468 註解:上一筆的【正向對照】—— 兩筆一起才有判別力,不可只留一筆',
  D202607314b3cIL: '20260811080000 那支 migration 註解裡的退款帳本實例',
  D20260724gUTcg1: 'wire.test.ts 既有 fixture(2026-07-24 實測形狀)',
  D20260803TESTrec: '刻意編的(尾碼含 TEST);留著當本表的正對照——它證明這張表不是只收真值',
  DR20991231ZZQ641: '2026-08-29 線C 編的替代值(日期 2099 不可能為真);TapPayChargeAdapter.test.ts 用它換掉一顆真的',
  // 🔴 下面這兩列是【這支守門第一次跑就抓到的】,而抓到的是【我自己漏的】——
  //    我手動掃時下了 `--include='*.ts|*.tsx|*.sql'` 且只掃 apps/packages/supabase
  //    ⇒ 漏掉 `scripts/` 底下的 `.sh` 與 `.py`。
  //    📌 **一把用形狀掃的尺,仍然可以有一個太窄的分母 —— 而它印出來的樣子與「乾淨」相同。**
  //    ⇒ 這也是為什麼掃描要交給 `git grep`(全追蹤檔)而不是我手打的副檔名清單。
  D20260811GUARD: '刻意編的(尾碼 GUARD);scripts/l5b2-2c-verify.sh:448 的 harness fixture',
  D20260809xCwNLf: 'scripts/tappay-sandbox-3ds-prime-page.py:10 註解:2026-08-09 sandbox 實測產出的交易',
};

function scanRepo(): { value: string; where: string }[] {
  // git grep 只看被追蹤的檔,天然排除 node_modules / .next / 本機雜物。
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['grep', '-hoIE', 'DR?20[0-9]{6}[A-Za-z0-9]{5,10}', '--', 'apps', 'packages', 'supabase', 'scripts'],
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (e) {
    // 🔴 `git grep` 零命中 ⇒ **rc=1** ⇒ execFileSync 預設 throw。
    //    而零命中在這裡是【最正常的那條通過路徑】(repo 真的乾淨)
    //    ⇒ 不接住它的話,「乾淨」會以一個未捕捉例外的形式炸掉,而畫面上看起來像測試壞了。
    //    📌 這正是本 repo 記過的同族:`grep -c` 印 0 而 rc=1 ⇒ 一個【合法的零】把後面截斷。
    //    ⚠️ 只吞 status===1;status>1 = git 自己出錯(壞 repo / 壞參數)⇒ 必須繼續往外丟。
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
  return findIdShapes(out).map((value) => ({ value, where: 'apps|packages|supabase|scripts' }));
}

describe('真值形狀守門', () => {
  it('不得有 allowlist 以外的交易識別碼形狀', () => {
    const unexpected = scanRepo().filter(({ value }) => !Object.hasOwn(ALLOWED, value));
    expect(unexpected.map((u) => u.value)).toEqual([]);
  });

  // ✅ 正對照:尺是活的。掃不到已知值 ⇒ 上面那個 [] 是「尺瞎了」不是「乾淨」。
  it('正對照:掃得到至少一個已知的 allowlist 值', () => {
    const found = scanRepo().map((s) => s.value);
    expect(found.some((v) => Object.hasOwn(ALLOWED, v))).toBe(true);
  });

  // ✅ 負對照:乾淨的輸入必須零命中,否則上面的 [] 沒有意義。
  it('負對照:沒有識別碼的文字回零', () => {
    expect(findIdShapes('這段話裡沒有任何識別碼,只有 20260604120000 這種 migration 時戳')).toEqual([]);
  });

  // ✅ 突變:現造一個沒人見過的真值形狀 ⇒ 必須被抓到。
  //    🔴 這一發才是這支檔的職務 —— 前三發只證明它「會動」,這一發證明它「擋得住新的」。
  it('突變:新滲進來的識別碼形狀會被抓到,且不在 allowlist 裡', () => {
    // 🔴🔴 **這個樣本【拼出來,不寫成字面】—— 而理由是這支檔自己踩過的坑。**
    //    第一版把那個樣本【寫成字面】⇒ 我跑過、4 passed、commit。
//    ⚠️ 而這句註解的第一版【又把那個字面打了一次】⇒ 它自己讓守門紅了。
//       📌 **解釋一個坑的句子,可以再踩一次那個坑。** ⇒ 所以這裡連提都不提它長什麼樣。
    //    ⇒ 而 commit 的那一刻它變成【被追蹤的檔】⇒ `git grep` 從此看得到它
    //    ⇒ ⇒ **這道守門開始把自己的突變樣本當成違規,而我 commit 之後沒有再跑一次。**
    //    📌 **綠的那一發與紅的那一發,中間唯一的差別是「它被 commit 了」——**
    //    **而那個動作不在任何人的檢查清單上。**
    //    ✅ 拼接讓那個形狀在檔案裡【不存在】⇒ 這支檔仍然留在掃描範圍內,沒有盲區。
    //    ⚠️ 反面做法(把本檔排除在 pathspec 外)會製造一個真的盲區:
    //       那時這支檔就可以藏真值而沒有人會知道。
    const sample = `DR${'20260915'}qWeRtY`;
    const planted = findIdShapes(`log: refund_id=${sample} 已送出`);
    expect(planted).toEqual([sample]);
    expect(planted.filter((v) => !Object.hasOwn(ALLOWED, v))).toHaveLength(1);
  });
});
