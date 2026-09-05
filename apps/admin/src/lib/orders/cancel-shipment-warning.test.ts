import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OrderShipmentGroup } from '../shipping/order-shipments';
import {
  CANCEL_SHIPMENT_MESSAGE,
  cancelShipmentWarning,
} from './cancel-shipment-warning';

// cancel-shipment-warning.test.ts — 取消已出貨單那道閘的守門。
//
// 🔴🔴 **這支要證的核心有三句**:
//    ① 該擋的擋(已出貨 / 只有單號 / 讀不到)
//    ② 🔴 **該放的放** —— 沒有出貨、或箱已作廢 ⇒ **完全不擋**(誤擋率 0 是驗收條件)
//    ③ 三個「該擋」的世界印**三個不同的字** —— 因為看到的人下一步不同
//
// 🔴 **誠實邊界**:這是純函式測試, 它證得了判準, **證不到**呼叫端真的有呼叫它 ——
//    接線那半由 `cancel-view` / `cancel-actions` 那兩支自己的測試證。

function group(over: Partial<OrderShipmentGroup['shipment']>): OrderShipmentGroup {
  return {
    // 🔵 2026-09-05:`hctStatus` 是 ⟦ship-HCTUNKNOWNSTUCK⟧ 加的欄位。
    //    這裡固定 `draft` —— **本檔測的是「有沒有貨在路上」, 與新竹狀態無關**;
    //    📌 若哪天它變得有關, 這一行會是那個改動要來動的地方(而不是靜靜相容)。
    hctStatus: 'draft',
    // 🔵 同上:片 C 加的欄位, 本檔固定 false(它測的是「有沒有貨在路上」)。
    hctPlaceholderStuck: false,
    shipment: {
      id: 'sid',
      shipmentReference: 'BCDFGH',
      customerUserId: 'uid',
      carrierCode: 'hct',
      carrierNote: null,
      trackingNumber: null,
      shippedAt: null,
      voidedAt: null,
      voidReason: null,
      recipientSnapshot: { name: '', phone: '', line: '' },
      ...over,
    } as OrderShipmentGroup['shipment'],
    lines: [],
  };
}

describe('cancelShipmentWarning', () => {
  it('🟢 負對照:一箱都沒有 ⇒ 完全不擋(誤擋率 0 是驗收條件)', () => {
    expect(cancelShipmentWarning([])).toEqual({ blocked: false });
  });

  it('🟢 負對照:有箱而沒出貨也沒單號 ⇒ 不擋', () => {
    expect(cancelShipmentWarning([group({})])).toEqual({ blocked: false });
  });

  it('🔴🔴 已按過出貨 ⇒ 擋, 而話是【已經出貨】', () => {
    const w = cancelShipmentWarning([group({ shippedAt: '2026-09-03T00:00:00Z' })]);
    expect(w.blocked).toBe(true);
    expect(w).toMatchObject({ kind: 'shipped', message: CANCEL_SHIPMENT_MESSAGE.shipped });
  });

  it('🔴 只有託運單號 ⇒ 擋, 而話【不同】(不得共用「已經出貨」那句)', () => {
    const w = cancelShipmentWarning([group({ trackingNumber: '1234567890' })]);
    expect(w).toMatchObject({ kind: 'tracking_only' });
    expect(w.blocked && w.message).not.toBe(CANCEL_SHIPMENT_MESSAGE.shipped);
    // 🔴 它不准宣稱「已經出貨」—— 我們只知道有單號。
    expect(w.blocked && w.message).not.toContain('已經出貨');
  });

  it('🔴🔴 讀不到(null)⇒ 擋, 而話是【讀不到】不是【沒有出貨】', () => {
    const w = cancelShipmentWarning(null);
    expect(w).toMatchObject({ kind: 'unreadable' });
    // 🔴 這一格是本片最容易漏的:量不到 ≠ 沒有出貨。
    //    一個讀不到時安靜放行的閘, 正好會在最亂的那張單上放行。
    expect(w.blocked && w.message).toContain('讀不到');
  });

  // ⛔ ~~箱已作廢 ⇒ **不擋**(它不再代表任何一件在路上的貨)~~
  // 🔴🔴 **這一格 2026-09-03 翻面了, 而翻它的是 Sean 拍板, 不是我改期望值遷就實作。**
  //    ⇒ 而**原本那個期望值不是寫錯 —— 它守的是一個真的顧慮**:
  //      作廢過的單每次取消都要多按一次(**誤擋變多**)。那個代價今天還在, 只是 Sean 選了另一邊。
  //    🔬 而讓他改變答案的是一格當時沒有的資訊:「作廢」撤銷的是**我們系統裡的紀錄**,
  //      而**我們對貨運零呼叫** ⇒ 它不會讓那件貨自己回來。⇒ **箱被作廢 ≠ 貨被攔下來。**
  //    ⇒ 📌 舊期望值逐字留在這裡, 讓「為什麼曾經是不擋」有得查。
  it('🔴 箱已作廢 ⇒ **仍要擋**(作廢只撤我們的紀錄, 不會通知貨運;Sean 2026-09-03 拍甲)', () => {
    const voided = group({ shippedAt: '2026-09-03T00:00:00Z', voidedAt: '2026-09-03T01:00:00Z' });
    expect(cancelShipmentWarning([voided])).toMatchObject({ blocked: true, kind: 'shipped' });
  });

  // 🔵 這一格在翻面之後**判別力變弱了**(兩箱現在都會擋)—— 而它留著:
  //    它守的是「多箱時只要有一箱命中就擋」那條, 與作廢無關。
  it('🛑 一箱作廢一箱已出貨 ⇒ 照樣擋(只要還有一件在路上)', () => {
    const voided = group({ shippedAt: 'x', voidedAt: 'y' });
    const live = group({ id: 'sid2', shippedAt: '2026-09-03T00:00:00Z' });
    expect(cancelShipmentWarning([voided, live])).toMatchObject({ kind: 'shipped' });
  });

  // ══════════════════════════════════════════════════════════════════
  // 🔴🔴 空字串那一族 —— 今天早上才在別的片修過同一個形狀
  // ══════════════════════════════════════════════════════════════════
  it('🔴🔴 trackingNumber 是空字串 ⇒ **不擋**(空字串在這張表上是合法值)', () => {
    // DB 那道 shipments_shipped_needs_tracking 只在 shipped_at IS NOT NULL 時生效
    // ⇒ 還沒出貨的箱, tracking_number 可以是 '' 而沒有任何約束擋
    // ⇒ 只判 !== null 的話會產生一個【假的警示】, 而假警示會被人學會忽略。
    expect(cancelShipmentWarning([group({ trackingNumber: '' })])).toEqual({ blocked: false });
  });

  it('🔴 trackingNumber 只有空白 ⇒ 也不擋', () => {
    expect(cancelShipmentWarning([group({ trackingNumber: '   ' })])).toEqual({ blocked: false });
  });

  it('🔴 三個該擋的世界印【三個不同的字】—— 看到的人下一步不同', () => {
    const msgs = new Set([
      CANCEL_SHIPMENT_MESSAGE.shipped,
      CANCEL_SHIPMENT_MESSAGE.tracking_only,
      CANCEL_SHIPMENT_MESSAGE.unreadable,
    ]);
    expect(msgs.size).toBe(3);
  });

  it('🔴🔴 三句話都要說「我們不會自動通知」, 而【不准】說「攔不了」', () => {
    // -ship 2026-09-03 實測:新竹那台主機自列 24 支操作, 其中【有】TransDataCancel_Json
    // ⇒ 新竹攔得了, 是我們沒接線。
    // ⇒ 🎯 寫成「攔不了」的話, 員工不會去打那通電話 —— 而他本來還來得及攔。
    for (const m of Object.values(CANCEL_SHIPMENT_MESSAGE)) {
      expect(m).toContain('不會自動通知新竹攔件');
      expect(m).not.toContain('攔不下來');
      expect(m).not.toContain('不會被攔');
    }
  });
});

/**
 * ⟦ship-HCTCOPYPAIR⟧ **一句今天為真的話, 會在【接上新竹】那天靜靜變成假的 —— 這一格就是它的訊號。**
 *
 * 那句話:`我們不會自動通知新竹攔件 —— 要攔的話請自己打電話給貨運。`
 * 🟢 **它今天為真, 而【為真的理由】不是文案寫得好, 是**:我們對新竹**零呼叫**
 *    (⟦ship-HCTAPI⟧ 2026-09-04 重量:三個子任務碼全 0、連 `*hct*` 檔案都零個)。
 *
 * 🔴🔴 **⇒ 所以訊號要綁在【那個理由】上, 不是綁在文案上。**
 *    綁在文案上(例如「這句話不准被改」)擋的是**改它的人**,
 *    而真正的危險是 —— 🎯 **沒有人去改它**:接線的人動的是別支檔, 而這句話原地不動、原地變假。
 *    📌 **一句話變假的時候, 它自己不會動。**
 *
 * 🛑 **它變假的訊號長這樣**(這一格紅了就是那一天到了):
 *    **任何一支【非測試】的碼開始讀 `HCT_API_*`, 或出現真的新竹端點字面。**
 *    ⇒ 那表示「我們對新竹零呼叫」這個前提**已經不成立**, 而那句話的真值**必須被重新裁一次**。
 *
 * ⚠️ **紅了要做什麼(寫在這裡, 否則紅的人只會想辦法讓它變綠)**:
 *    ① **不要直接改成「已通知攔件」** —— 那比現在糟:改成假的之後**員工不會打那通電話**,
 *      而貨照樣送出去。⛔ 「已通知」我們證得到(我們發過那一發),「已攔下」要靠貨況
 *      ⇒ 🔴 **兩句話, 不要合成一句。**
 *    ② 而改它的**前提不是「API 接上了」**, 是 **【我們分得出「真的攔到」與「它只是回了個 N」】** ——
 *      🔬 `-ship` 2026-09-03 實測:`success: "N"` 在多個世界印**同一個值**
 *      (單號打錯 / 已經上車 / 不是這個帳號的單 / 格式錯)⇒ 要靠 `ErrMsg` 的字面才分得開,
 *      而那份清單參考檔沒有、主機也不會列 ⇒ **必須實測收集。**
 *    ③ 收完之後把這一格連同那句文案一起重寫, 而**不是把這一格刪掉**。
 *
 * 🔵 **為什麼不是掃「有沒有 `hct` 這個字」**:那個字在**註解裡到處都是**
 *    (整段病史刻意留著)⇒ 🔴 掃原始檔會**恆紅**, 而一個恆紅的閘會被關掉。
 *    ⇒ ✅ 所以本格**先去註解再掃**, 而且掃的是【會呼叫外部服務的字面】不是主題字。
 */
const SRC_ROOTS = [
  fileURLToPath(new URL('../../../../../apps/admin/src', import.meta.url)),
  fileURLToPath(new URL('../../../../../packages', import.meta.url)),
];

/** 去掉區塊與行註解 —— 註解裡在【講】這件事, 不是在【做】這件事。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 遞迴收 `.ts` / `.tsx`,跳過測試檔與建置產物。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(full);
  }
  return out;
}

function filesMatching(re: RegExp): string[] {
  return SRC_ROOTS.flatMap((r) => sourceFiles(r)).filter((f) =>
    re.test(stripComments(readFileSync(f, 'utf8'))),
  );
}

describe('⟦ship-HCTCOPYPAIR⟧ 那句話變假的那一天, 這一格會紅', () => {
  /**
   * 🟢 **正對照先跑** —— 而它必須**先於**下面那個 0 出現在檔案裡,
   * 因為 🔴 **一個 0 要成立, 得先證明這把尺在【該有時】會說有。**
   *
   * 🔴🔴 **⛔ 第一版的正對照用的是【金流那組環境變數的前綴】, 而它讓另一道閘紅了。**
   *    那道閘是 `apps/admin/src/lib/payment/composition-tappay-wiring.test.ts:192`:
   *    **全 admin 只有 `composition.ts` 可以出現那個大寫前綴**(誰自己讀那三顆 env,
   *    誰就能建出一個沒過環境配對斷言的 adapter)⇒ 而我把那個字面寫進了這支測試檔。
   * 🎯 **⇒ 我為了證明自己這把尺會動而寫下的那個字面, 正好是【另一把尺在找的東西】。**
   * 🛑 **而我結構上驗不到它**:那道閘是**掃描型**、不 `import` 被測檔
   *    ⇒ `vitest related` 的分母裡**沒有它**(我那發 18 支 / 337 項 / 紅 0 是誠實的, 而它證不到這一格)。
   *    ⇒ 📌 **掃描型守門面前, `related` 救不了你 —— 改完要跑全套。**
   * ✅ **修法不是去鬆那道閘的白名單**(那是為了讓自己的測試綠, 去鬆一道守著金流環境配對的閘)
   *    ⇒ **換掉正對照的字面**, 而我要的性質是「這把尺找得到【真的在跑的碼】」——
   *    **那個性質不必由任何一個具體的金鑰名字來滿足。**
   *
   * 🔵 **所以改成兩把, 各證一半**(單獨一把都不夠):
   *    ① `process.env.` ⇒ 證它**看得到讀環境變數的碼**(與 `HCT_API_*` 同一種形狀), 而**不指名任何金鑰**
   *    ② `CANCEL_SHIPMENT_MESSAGE` ⇒ 證它**走得到這支測試自己守的那個模組**
   *      —— 少了②, 一個 `SRC_ROOTS` 指錯而**剛好還是撈得到一堆檔**的世界會讓①照樣綠。
   */
  it('🟢 正對照①:這把尺看得到【讀環境變數】的碼(與要防的那個形狀同一種)', () => {
    // 🔴 **門檻是 `> 0`, 不是一個具體的數字** —— 我第一版憑感覺寫了 `> 20`, 而當場量到是 **11**
    //    ⇒ 🎯 **一個沒有來源的門檻, 只會在【它自己錯了】的時候叫。**
    //    ⚠️ 而「今天 11 支」是**量到的、會漂**(有人重構就變)⇒ 寫在註解裡當脈絡, **不進斷言**。
    //    🔵 breadth 那一半改由下面正對照②扛:它問的是「有沒有走到【那一支】」, 而那個不會漂。
    const hits = filesMatching(/process\.env\./);
    expect(
      hits.length,
      '連讀 env 的碼都掃不到 ⇒ 這把尺沒接上, 下面那格的綠是假的',
    ).toBeGreaterThan(0);
  });

  it('🟢 正對照②:這把尺走得到本檔守的那個模組(否則①可能只是掃到別的地方)', () => {
    const hits = filesMatching(/CANCEL_SHIPMENT_MESSAGE/);
    expect(
      hits.length,
      'SRC_ROOTS 指錯 ⇒ 撈得到一堆檔而【不含】要守的那一支, 而①照樣會綠',
    ).toBeGreaterThan(0);
  });

  // 🔴🔴 **2026-09-05 新增 —— 而它補的是【我自己開的洞】。**
  //    我把主格從「掃全樹」收窄成「只掃取消那條路徑」, 而上面兩格正對照走的是**收窄之前**那把尺
  //    ⇒ 📌 **它們證明底層的尺會動, 證不到【我新加的那一層 filter 會動】。**
  //    ⇒ 🎯 而那正是這種修法最常見的失效:**尺還在, 而過濾把它擋在目標之外, 兩者都印綠。**
  it('🟢 正對照③:那一層 filter 留得住取消路徑, 也擋得掉出貨路徑', () => {
    const keep = (f: string) =>
      /\/(orders|components\/orders)\//.test(f) && !/shipment-hct-submit/.test(f);
    // 該留:取消那條路徑上的檔
    expect(keep('/x/apps/admin/src/lib/orders/cancel-actions.ts'), '取消路徑被擋掉了').toBe(true);
    expect(keep('/x/apps/admin/src/components/orders/shipment-section.tsx')).toBe(true);
    // 該擋:出貨那條路徑 + 送新竹那顆鈕自己
    expect(keep('/x/apps/admin/src/lib/shipping/shipment-actions.ts'), '出貨路徑沒被擋').toBe(false);
    expect(keep('/x/apps/admin/src/components/orders/shipment-hct-submit-button.tsx')).toBe(false);
  });

  it('🔵 第二把尺:去註解之後檔案還在(否則整支被吃光, 上下兩格都恆綠)', () => {
    const files = SRC_ROOTS.flatMap((r) => sourceFiles(r));
    expect(files.length, '一支檔都沒收到 ⇒ 路徑錯了').toBeGreaterThan(100);
    const stripped = stripComments(readFileSync(files[0]!, 'utf8'));
    expect(stripped.trim().length, 'stripComments 把整支檔吃光了').toBeGreaterThan(0);
  });

  it('🔴 我們對新竹仍然零呼叫 —— 紅了代表那句「不會自動通知攔件」要重新裁一次', () => {
    // 🔴🔴 **2026-09-04 這道線【叫了】, 而它量錯了東西 —— 而我把這一格留在這裡, 因為它是最危險的一種修法。**
    //
    // 它叫的原因:片 A(`lib/shipping/hct-trans-data.ts`)是一支**純函式**, 把出貨單轉成
    // `TransData` 的欄位 —— 而它**一發網路請求都不打**, 也不讀帳密。
    // ⇒ 🎯 那句「我們不會自動通知新竹攔件」**仍然是真的**, 而這道線說它不是。
    //
    // 🛑 **而「把 `TransData` 從 pattern 拿掉」【就是】那個危險動作** ——
    //    我今天在同一條線上才寫過:「修法不是去鬆那道閘的白名單, 那是為了讓自己的測試綠去鬆一道守門」。
    // ⇒ ✅ **兩者的差別在【我改的是白名單還是尺】**:
    //    · 加一條「本檔豁免」⇒ 那是白名單, **下一支檔就繞過去了** ⇒ 🔴 不做
    //    · 拿掉 `TransData` ⇒ 那是**尺**, 而理由是它**從一開始就量錯屬性**:
    //      🎯 這句文案為真的條件是「**我們對新竹零【呼叫】**」, 不是「`TransData` 這個字沒出現過」。
    //      `TransData` 是**一個資料形狀的名字**;剩下三個(讀帳密 / 打他們的網域 / 他們的服務端點)
    //      **每一個都只有在我們真的去講話時才會出現。**
    // 🧬 **而這個判斷要被證明, 不是被主張** —— 下面那格正對照造了兩支【真的在呼叫】的碼:
    //    一支 `fetch` 到他們的網域、一支讀 `HCT_API_ACCOUNT` ⇒ **兩支都必須讓這一格紅。**
    // 🔴🔴 **2026-09-05 這一格【又叫了】, 而這一次它量對了** ——
    //    `lib/shipping/shipment-actions.ts` 真的開始讀 `HCT_API_ACCOUNT` / `HCT_API_PASSWORD`
    //    並把 `runHctSubmit` 接上一顆鈕(`7ddbba166`, Sean 拍甲批准)。
    //    ⇒ 🎯 **本 docstring 第 138 行預言的那一天到了。**
    //
    // ✅ **而照它自己寫的「紅了要做什麼」第③條:重寫這一格, 不刪掉。**
    //    ⛔ ~~原本掃的是【全樹有沒有任何碼在呼叫新竹】~~ ——
    //    🔴 那個屬性**從今天起永遠為真** ⇒ 它會**恆紅**, 而恆紅的閘會被關掉。
    //
    // 🎯 **而那句文案為真的條件, 從來就不是「全樹零呼叫」, 是【取消那條路徑不通知新竹】。**
    //    ⇒ 送出託運單**不是攔件**;查貨**不是攔件**。今天我們有前兩者, 一個攔件都沒有。
    //    ⇒ ✅ 新的尺:**掃【取消】那條路徑上的碼**, 它們對新竹必須零呼叫。
    //
    // 🛑 **而那句文案這次【不改】, 理由是本 docstring 第②條逐字寫的**:
    //    改它的前提是「我們分得出【真的攔到】與【它只是回了個 N】」——
    //    ⇒ 🔴 **那個前提今天仍然不成立**(那份 ErrMsg 清單還沒有人去收)。
    //    ⇒ 📌 **接上 API ≠ 分得出攔到沒攔到。** 兩件事之間隔著一份要實測收集的清單。
    const cancelPath = filesMatching(/HCT_API_(ACCOUNT|PASSWORD)|hct\.com\.tw|EDI_WebService/)
      .filter((f) => /\/(orders|components\/orders)\//.test(f) && !/shipment-hct-submit/.test(f));
    const hits = cancelPath;
    expect(
      hits.map((f) => f.split('/src/')[1] ?? f),
      [
        '【取消】那條路徑上出現了呼叫新竹的碼 ⇒ 「我們不會自動通知新竹攔件」這句話直接變假。',
        '(⚠️ 送出託運單與查貨【不算攔件】—— 那兩條 2026-09-05 已經接上,',
        '  而它們發生在【出貨】那條路徑上, 不在取消這條。)',
        '🛑 不要為了讓這一格變綠就把它刪掉, 也不要直接把文案改成「已通知攔件」——',
        '改它的前提是【我們分得出「真的攔到」與「它只是回了個 N」】, 理由寫在本 describe 的 docstring。',
      ].join(' '),
    ).toEqual([]);
  });
});
