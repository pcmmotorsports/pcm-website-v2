// title-shape-gate.test.ts — 品名形狀 gate 的雙向表演 + 接線斷言(2026-08-21 W1)
//
// 🔴 一道閘的「分母太寬」與「太窄」**都回綠** ⇒ 只證 `#N/A` 被擋是不夠的:
//    ①要證真貨不會被擋(而真貨用【正式庫實際存在的品名】,不是我編的)
//    ②要證【接線真的裝上去了】—— 判別式對而沒接,45 個測試一樣全綠(codex 關卡2 MF-6)
//    ③要證【模式行為】對 —— 拿掉 throw 或把 dryRun 條件寫反,測試也要紅(codex 關卡2 MF-7)
//    ④規則表的**每個成員**都要有自己的一發,而**期望清單必須獨立於實作**(codex 關卡2 MF-8)——
//      從實作的陣列生成測資的話,刪掉一個成員會連它的測試一起刪掉 ⇒ 恆綠。

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalTitle, classifyTitle, decideTitleGateAction, normalizeTitle, renderedTitle,
  runTitleShapeGate, titleGateAbortMessage, titleGateSkipMessage, applyTitleGateSkip,
  TITLE_GATE_ABORT_MIN, TITLE_GATE_ABORT_RATIO,
} from './title-shape-gate';

/**
 * 🔴 正式庫「品名完全無 CJK」的**全部 18 筆**(2026-08-21 02:2x 實查 `products`,逐筆貼回,非抽樣)。
 * 其中 1 筆是事故那件 `#N/A`,**其餘 17 筆是正常英文品名、一件都不能被擋**。
 * codex 關卡2 MF-9:第一版這裡只放了 16 筆,而交件寫「17 件」——
 * **17 是查 DB 得到的,16 是我手打進來的,兩個數字來自不同動作而長得一樣。**
 */
const REAL_NO_CJK_2026_08_21 = [
  '#N/A', // ← 事故那件,唯一該被擋的
  'Double Side Wings - Yamaha MT09 V4 - Standard',
  'Double Side Wings - Yamaha MT09 V4 - To be painted',
  'Evotech Action / Dash Cam Sat Nav Mount - Honda CB1000GT (2026+)',
  'Evotech Beeline Moto 2 Sat Nav Mount - Honda CB1000GT (2026+)',
  'Evotech Carpuride Mount - Honda CB1000GT (2026+)',
  'Evotech Chigee Mount - Honda CB1000GT (2026+)',
  'Evotech Garmin Sat Nav Mount - Honda CB1000GT (2026+)',
  'Evotech LED Indicator Amber (Single Item)',
  'Evotech LED Indicator Smoked (Single Item)',
  'Evotech LED Sequential Indicator (Single Item)',
  'Evotech Peak Design Sat Nav Mount - Honda CB1000GT (2026+)',
  'Evotech Quad Lock Compatible Mount - Honda CB1000GT (2026+)',
  'Evotech Race Fuel Tank Pad - Ducati Panigale V4 R (2026+)',
  'Evotech SP Connect Sat Nav Mount Honda CB1000GT (2026+)',
  'Evotech TomTom Sat Nav Mount - Honda CB1000GT (2026+)',
  "Men's / Unisex Black Designed T Shirt",
  'Quad Lock MAG Ring',
];
/** 其他正式庫真品名(含 #、極短中文、一般款)。 */
const REAL_OTHER_2026_08_21 = [
  '引擎護蓋 #1', '引擎護蓋 #6', '鐵彈簧', '鐵軸套', '純棉帽', '防倒球',
  '遠端調整旋鈕 (forged, cnc, rcs corsa corta, accossato)',
  'EBC 前煞車皮 FA181HH', '碳纖維前土除 - 通用款', 'Brembo RCS 19 拉桿', '排氣管尾段(不鏽鋼)',
];

describe('該擋的要擋 · 規則表逐成員(期望清單獨立於實作、MF-8)', () => {
  it.each([
    // A 試算表錯誤字串 —— 每個成員一發,且含大小寫/尾標點變體(MF-2)
    '#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!', '#SPILL!', '#CALC!',
    '#GETTING_DATA', '#ERROR!', '#n/a', '#N/A!', '#Ref!',
    // B 字面 null(含括號/尾點包裝,MF-3)
    'null', 'undefined', 'NaN', 'None', 'nil', 'n/a', 'na', '(null)', 'NULL.', '[undefined]',
    // C 空 / 渲染後為空(MF-5)
    '', '   ', '\u3000', '&nbsp;', '&#xA0;', '&#160;', '&ZeroWidthSpace;', '<br>', '<br/>', '<p></p>',
    // D 只有標點或空白
    '---', '###', '...', '///', '-- --',
    // E 亂碼
    'abc\uFFFDdef', '\uFFFD',
    // F 佔位字(含尾標點與中文,MF-3)
    'TBD', 'todo', 'TBA', 'XXX', 'test', 'sample', 'Untitled', 'placeholder',
    '測試', '未命名', '待補', '待確認', '待填', '暫定', 'TBD.', '-- TBD --', '待補。',
    // G 控制字元
    '\u0007品名', '品名\u0000',
    // MF-4 全形 / 隱形字繞過
    'Ｎ／Ａ', 'ｎｕｌｌ', 'ＴＢＤ', '\u200Bnull\u200B', '\u202Anull\u202C', 'n\uFEFFull',
  ])('「%s」必須 block', (title) => {
    expect(classifyTitle(title)?.level, `「${title}」沒被擋 ⇒ 這道閘的分母比病窄`).toBe('block');
  });
});

describe('🔴 真貨一件都不能擋(fixture = 正式庫實查)', () => {
  it('前提斷言:無 CJK 那組是 18 筆,其中 1 筆是事故件', () => {
    // 🔴 這一發把「17」釘住 —— 少放 fixture 時會紅,不會恆綠(MF-9)。
    expect(REAL_NO_CJK_2026_08_21).toHaveLength(18);
    expect(REAL_NO_CJK_2026_08_21.filter((t) => classifyTitle(t)?.level === 'block')).toEqual(['#N/A']);
  });

  it.each([...REAL_NO_CJK_2026_08_21.slice(1), ...REAL_OTHER_2026_08_21])('「%s」不得 block', (title) => {
    expect(classifyTitle(title)?.level, `真實品名「${title}」被擋了 ⇒ 這道閘會炸掉正常匯入`).not.toBe('block');
  });

  it('🔴 codex MF-1:沒有【字母】但有資訊的品名不得被擋', () => {
    for (const t of ['360', '360°', '①②③', '2026', 'Ⅷ', '🏍️ 防倒球', '１２３']) {
      expect(classifyTitle(t)?.level, `「${t}」被擋了 ⇒ 又回到「沒字母就擋」那個錯`).not.toBe('block');
    }
  });
});

describe('只報不擋那一半', () => {
  it.each([
    ['品名\n換行', 'J'], [' 前後有空白 ', 'I'], ['A &amp; B', 'K'], ['A', 'L'], ['ADBR1', 'H'],
  ])('「%s」⇒ warn(%s),不是 block', (title, klass) => {
    const v = classifyTitle(title);
    expect(v?.level, `「${title}」被擋了 ⇒ 為了一個可修的內容問題停掉整批`).toBe('warn');
    expect(v?.id.startsWith(klass), `被判成 ${v?.id},預期 ${klass}`).toBe(true);
  });
});

describe('🔴 門檻制(主視窗裁定丙;codex MF-10)', () => {
  const good = (i: number) => ({ external_id: `G${i}`, handle: `g${i}`, title: `碳纖維前土除 ${i}` });
  const bad = (i: number) => ({ external_id: `B${i}`, handle: `b${i}`, title: '#N/A' });
  const mute = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };

  it('判定函式:0 筆 ⇒ pass', () => {
    expect(decideTitleGateAction(0, 667)).toBe('pass');
  });

  it('🔴 1 筆壞(= 今天的真實情境)⇒ skip,不是 abort', () => {
    // 667 群裡 1 筆 —— 這就是 extreme 今天的樣子。整批 abort 會讓其餘 666 群停更。
    expect(decideTitleGateAction(1, 667)).toBe('skip');
  });

  it('🔴 數量到門檻但占比很低 ⇒ 仍是 skip(稀疏個案不是來源壞掉)', () => {
    expect(decideTitleGateAction(TITLE_GATE_ABORT_MIN, 3559)).toBe('skip');
    expect(decideTitleGateAction(10, 3559)).toBe('skip'); // 0.28%
  });

  it('🔴 占比高但只有 1-2 筆 ⇒ 仍是 skip(單群批次不該因一筆就整批停)', () => {
    expect(decideTitleGateAction(1, 1)).toBe('skip');
    expect(decideTitleGateAction(2, 2)).toBe('skip');
  });

  it('🔴 數量【且】占比都過線 ⇒ abort', () => {
    expect(decideTitleGateAction(TITLE_GATE_ABORT_MIN, 10)).toBe('abort'); // 30%
    expect(decideTitleGateAction(300, 667)).toBe('abort');
  });

  it('前提斷言:門檻常數就是 3 與 5%(改了要有人知道)', () => {
    // 🔴 5% 沿用本 repo 既有慣例(抓取完整性 / null-v2 兩道都是 5%);3 是保守值、無歷史分布可推。
    expect(TITLE_GATE_ABORT_MIN).toBe(3);
    expect(TITLE_GATE_ABORT_RATIO).toBe(0.05);
  });

  it('WRITE + 1 筆壞 ⇒ 不 throw、回 skip、指名要移除哪一筆', () => {
    mute();
    const rows = [...Array.from({ length: 20 }, (_, i) => good(i)), bad(1)];
    const r = runTitleShapeGate(rows, { dryRun: false });
    expect(r.action).toBe('skip');
    expect(r.skipExternalIds).toEqual(['B1']);
    vi.restoreAllMocks();
  });

  it('🔴 WRITE + 門檻以上 ⇒ throw,而訊息與 skip【長得不一樣】', () => {
    mute();
    const rows = [...Array.from({ length: 5 }, (_, i) => good(i)), bad(1), bad(2), bad(3)];
    expect(() => runTitleShapeGate(rows, { dryRun: false })).toThrow(/整批 abort/);
    vi.restoreAllMocks();
  });

  it('WRITE + 0 筆壞 ⇒ 不 throw、skipExternalIds 為空(防恆擋)', () => {
    mute();
    const r = runTitleShapeGate([good(1)], { dryRun: false });
    expect(r.action).toBe('pass');
    expect(r.skipExternalIds).toEqual([]);
    vi.restoreAllMocks();
  });

  it('dry-run 就算到 abort 門檻也不 throw(對齊既有六道 gate)', () => {
    mute();
    const rows = [...Array.from({ length: 5 }, (_, i) => good(i)), bad(1), bad(2), bad(3)];
    expect(() => runTitleShapeGate(rows, { dryRun: true })).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('🔴 兩種訊息不可混淆(主視窗:否則兩種情境在畫面上又變成同一件事)', () => {
  it('skip 訊息:不准出現「已跳過」,而且要說「還在架上 + 停止更新 + 不會自動下架」', () => {
    const m = titleGateSkipMessage(['PED-GP EVO PPV4']);
    expect(m).not.toMatch(/已跳過/); // 🔴「已跳過」聽起來像處理完了
    expect(m).toMatch(/仍在架上販售/);
    expect(m).toMatch(/停止更新/);
    expect(m).toMatch(/不會】自動下架/);
    expect(m).toMatch(/PED-GP EVO PPV4/); // 指名道姓,人才修得到
    expect(m).toMatch(/設回 true/); // MF-11
  });

  it('abort 訊息:要說整批不寫 + 比例 + 「先查來源是不是壞了」,而不是叫人逐筆手改', () => {
    const m = titleGateAbortMessage(300, 667, 100);
    expect(m).toMatch(/整批 abort/);
    expect(m).toMatch(/45\.0%/);
    expect(m).toMatch(/不要逐筆手改/);
    expect(m).toMatch(/尚有 200 筆未列出/);
  });

  it('🔴 兩種訊息的開頭必須不同(掃 log 的人靠它分辨)', () => {
    expect(titleGateAbortMessage(3, 10, 3).slice(0, 12)).not.toBe(titleGateSkipMessage(['x']).slice(0, 12));
  });
});

describe('🔴 接線與模式行為(MF-6 / MF-7)', () => {
  const rows = [
    { external_id: 'GOOD', handle: 'good', title: 'EBC 前煞車皮 FA181HH' },
    { external_id: 'BAD', handle: 'bad', title: '#N/A' },
  ];

  it('dry-run 有 block ⇒ 不 throw,只回報(對齊既有六道 gate)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = vi.spyOn(console, 'table').mockImplementation(() => {});
    const r = runTitleShapeGate(rows, { dryRun: true });
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]?.external_id).toBe('BAD');
    spy.mockRestore(); t.mockRestore();
  });

  it('WRITE 模式沒有 block ⇒ 不 throw(否則就是恆擋)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => runTitleShapeGate([rows[0]!], { dryRun: false })).not.toThrow();
    spy.mockRestore();
  });

  it('🔴 abort 訊息在超過列出上限時,要講「還有幾筆」+ 修完還會再擋(nit :389)', () => {
    expect(titleGateAbortMessage(30, 100, 20)).toMatch(/尚有 10 筆未列出/);
    expect(titleGateAbortMessage(30, 100, 20)).toMatch(/一次修完全部 30 筆/);
    expect(titleGateAbortMessage(5, 100, 5)).not.toMatch(/尚有/);
  });

  it('🔴🔴 MF-6:rpm-import.ts 真的接上了這道 gate —— 這一發在接線被刪掉時會紅', () => {
    // 判別式全對而沒接上去,上面每一發都還是綠的。**只有讀 rpm-import.ts 的原始碼才看得到這件事。**
    const src = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'); // 剝註解:註解裡提到不算接上
    expect(code, 'rpm-import.ts 沒有 import runTitleShapeGate').toMatch(/import\s*\{[^}]*runTitleShapeGate[^}]*\}\s*from\s*'\.\/title-shape-gate'/);
    expect(code, 'rpm-import.ts 沒有【呼叫】runTitleShapeGate ⇒ 這道 gate 沒有裝上').toMatch(/runTitleShapeGate\s*\(\s*productRows\s*,/);
    expect(code, 'gate 沒有把 DRY_RUN 傳進去 ⇒ WRITE 模式不會 abort').toMatch(/runTitleShapeGate\([\s\S]{0,80}dryRun:\s*DRY_RUN/);
    expect(code, 'rpm-import 沒有呼叫 applyTitleGateSkip ⇒ 跳過的主碼照樣被寫進去')
      .toMatch(/applyTitleGateSkip\(\s*productRows\s*,\s*variantsByExternalId\s*,\s*variantRows\s*,\s*titleGate\.skipExternalIds/);
    expect(code, '沒有設非零退出 ⇒ cron 不會警報,沒有人會知道有東西被跳過').toMatch(/process\.exitCode\s*=\s*1/);
  });

  it('🔴 applyTitleGateSkip 真的把三個容器都清乾淨(突變⑨:第一版只斷言「字有出現」⇒ 停掉移除照樣全綠)', () => {
    const productRows = [{ external_id: 'A' }, { external_id: 'B' }, { external_id: 'C' }];
    const variantsByExtId = new Map<string, Array<{ sku: string }>>([
      ['A', [{ sku: 'a1' }]], ['B', [{ sku: 'b1' }, { sku: 'b2' }]], ['C', [{ sku: 'c1' }]],
    ]);
    const variantRows = [...variantsByExtId.values()].flat();
    applyTitleGateSkip(productRows, variantsByExtId, variantRows, ['B']);
    expect(productRows.map((p) => p.external_id), 'productRows 沒移除 ⇒ 壞品名照樣寫進 DB').toEqual(['A', 'C']);
    expect([...variantsByExtId.keys()], 'map 沒移除 ⇒ variant work 分流計數不一致會擋下【整批】').toEqual(['A', 'C']);
    expect(variantRows.map((v) => v.sku), 'variantRows 沒同步 ⇒ delta 報告與實寫不一致').toEqual(['a1', 'c1']);
  });

  it('applyTitleGateSkip 空清單 ⇒ 什麼都不動(防它反過來亂刪)', () => {
    const productRows = [{ external_id: 'A' }];
    const m = new Map<string, Array<{ sku: string }>>([['A', [{ sku: 'a1' }]]]);
    const vr = [...m.values()].flat();
    applyTitleGateSkip(productRows, m, vr, []);
    expect(productRows).toHaveLength(1);
    expect(vr.map((v) => v.sku)).toEqual(['a1']);
  });

  it('🔴🔴 順序不變式:gate 必須在 sourceExternalIds / sourceVariantSkus 【之後】', () => {
    // 🔴 若把 gate 搬到那兩個集合之前,被跳過的商品會從對賬分母裡消失
    //    ⇒ 被當成「來源已無此品」而**軟下架**、變體被**硬刪**。
    //    那是「跳過」變成「悄悄下架客人看得到的商品」,而畫面上不會有任何異常。
    const src = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const posSourceIds = code.indexOf('const sourceExternalIds');
    const posSourceSkus = code.indexOf('const sourceVariantSkus');
    const posGate = code.indexOf('runTitleShapeGate(productRows');
    expect(posSourceIds, 'sourceExternalIds 不見了').toBeGreaterThan(-1);
    expect(posSourceSkus, 'sourceVariantSkus 不見了').toBeGreaterThan(-1);
    expect(posGate, 'gate 呼叫不見了').toBeGreaterThan(-1);
    expect(posGate, '🔴 gate 被搬到 sourceExternalIds 之前 ⇒ 跳過的商品會被軟下架').toBeGreaterThan(posSourceIds);
    expect(posGate, '🔴 gate 被搬到 sourceVariantSkus 之前 ⇒ 跳過的變體會被硬刪').toBeGreaterThan(posSourceSkus);
  });
});

describe('量具自檢', () => {
  it('canonicalTitle 收斂全形、隱形字、包裝標點', () => {
    expect(canonicalTitle('Ｎ／Ａ')).toBe('n/a');
    expect(canonicalTitle('(null)')).toBe('null');
    expect(canonicalTitle('\u200BTBD\u200B')).toBe('tbd');
  });
  it('renderedTitle 把渲染成空白的實體變成空', () => {
    expect(renderedTitle('&nbsp;')).toBe('');
    expect(renderedTitle('<br/>')).toBe('');
    expect(renderedTitle('A &amp; B')).not.toBe('');
  });
  it('normalizeTitle 吃掉半形/全形/NBSP 空白', () => {
    expect(normalizeTitle('\u3000 品名 \u00A0')).toBe('品名');
  });
  it('🔴 正常品名回 null —— 沒有這發,「真貨沒被擋」同時相容於「判別式沒在跑」', () => {
    expect(classifyTitle('EBC 前煞車皮 FA181HH')).toBeNull();
  });
});
