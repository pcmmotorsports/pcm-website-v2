// @vitest-environment jsdom
import { LISTING_NOOP_NOTE_DROPPED_RESULT_CODE } from '../../lib/products/product-listing-form';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MESSAGES, ResultBanner } from './result-banner';
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
import {
  PAYMENT_DUPLICATE_RESULT_CODE,
  PAYMENT_RECORDED_RESULT_CODE,
} from '../../lib/orders/payment-action-state';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
} from '../../lib/orders/procurement-action-state';
import {
  RECEIPT_DUPLICATE_RESULT_CODE,
  RECEIPT_RECORDED_RESULT_CODE,
} from '../../lib/orders/receipt-action-state';
import { REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/refund-action-state';
import {
  REFUND_MARKED_FAILED_RESULT_CODE,
  REFUND_RECOVERED_RESULT_CODE,
} from '../../lib/payment/refund-recovery-state';
import {
  CANCEL_NOT_SENT_CODES,
  CANCEL_SENT_CODES,
  FAILURE_MESSAGES,
  ORDER_CANCELLED_RESULT_CODE,
  toOrderCancelResultCode,
} from '../../lib/orders/cancel-action-state';
import {
  ORDER_AMOUNT_ERROR_MESSAGE_GENERIC,
  ORDER_AMOUNT_ERROR_RESULT_CODE,
  ORDER_AMOUNT_REJECTED_MESSAGE,
  ORDER_AMOUNT_REJECTED_RESULT_CODE,
} from '../../lib/orders/amount-action-state';

// M-4b E10 A9d2-1:本片只加一個成功碼 ⇒ 本檔只測那一格 + 既有行為不被打壞。
//
// 🔴 原型鏈那組向量(`?r=__proto__` 等)**已於 #332-2 補上**(Sean 2026-08-06 拍板 Q1=A;
//    2026-08-02 拍板 B 曾把修法退回、當時這裡逐字寫著「刻意不測」)⇒ 見本檔最後一個 describe。
//    姊妹元件 `settings/settings-result-banner.tsx` 有同形的一組,在
//    `settings/settings-result-banner.test.tsx` —— 兩支各自在自己的元件層被釘住。

afterEach(cleanup);

describe('ResultBanner — A9d2-1 新增的備註成功碼', () => {
  // 🔴 關卡2 MF1:action 組 URL 與本元件查表**共用同一個常數** ⇒ typo 在結構上不可能。
  //    本條再從渲染面確認那個 key 真的有一則訊息(常數存在 ≠ 表裡有它)。
  it('備註成功碼渲染得出文字(action 與本元件共用同一個常數)', () => {
    const { container } = render(<ResultBanner code={NOTE_ADDED_RESULT_CODE} />);
    expect(container.textContent).toContain('備註已新增');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // M-3 RW2c:退款成功碼(關卡2 兩線同抓:漏掛/空白/tone 錯都不會有別的守門紅)。
  // 🏁 **2026-08-14 換口徑**:舊期望值釘的是「受理不等於已入帳」,那條鐵律已作廢
  //    (理由在 `result-banner.tsx` 那格註解:`confirmed` 必然帶 TapPay 憑證=結構保證)。
  //    ⚠️ 改期望值必附突變 —— 見 commit body 的 M1/M2 兩發。
  it('退款成功碼:講「完成」而不是「已受理」,且入帳時間不寫死鐘點', () => {
    const { container } = render(<ResultBanner code={REFUND_SUBMITTED_RESULT_CODE} />);
    expect(container.textContent).toContain('退款完成');
    // 🔴 正向不夠:只驗「有講完成」的話,把舊句原封不動貼回來也會綠(舊句開頭是「退款已送出」,
    //    但只要有人寫成「退款已送出,退款完成…」就過)⇒ 補一條負向,釘死舊口徑不得回歸。
    expect(container.textContent).not.toContain('已受理');
    expect(container.textContent).not.toContain('受理不等於已入帳');
    // 🔴 入帳時間只准講**條件**、不准講**時長或時點**(依各家銀行而定;講死就是對員工說謊)。
    //    ⚠️ **字集要與宣稱一樣寬**:第一版只掃 `:`/`點`/`時`,而「約 3 個工作天」不會紅 ——
    //       我在註解裡才寫「掃描字集比宣稱窄是老坑」,下一行就犯了(D 窗審查抓到)。
    //       現在的字集 = 阿拉伯/中文數字 × {點,時,小時,分鐘,天,工作天,日,週},外加無數字的「隔日/次日/翌日/明天」。
    expect(container.textContent).toMatch(/客人入帳時間依照各家銀行而定/);
    expect(container.textContent).not.toMatch(
      /[0-9０-９一二三四五六七八九十兩幾數]+\s*(個)?\s*(工作天|小時|分鐘|點|時|天|日|週|[:：])|隔日|次日|翌日|明天|每日|每天|當天|當日|即時|馬上|立即|立刻/,
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('既有改單碼未被打壞(加 key 不該動到別人)', () => {
    expect(render(<ResultBanner code='saved' />).container.textContent).toContain('已儲存變更');
    cleanup();
    expect(render(<ResultBanner code='denied' />).container.textContent).toContain('沒有權限');
  });

  it('缺 code → 不渲染', () => {
    expect(render(<ResultBanner code={undefined} />).container.textContent).toBe('');
  });
});

describe('ResultBanner — #352-b 到貨登錄兩個成功碼', () => {
  // 🔴 R1 must-fix 3 的守門:action 只驗 redirect 的 URL,**沒驗員工最終看到什麼**。
  //    這兩碼原本根本沒登記進 MESSAGES ⇒ PRG 之後 details 收合、橫幅回 null,
  //    而「到貨 0 件 / 溢收 N 件」連採購列的數字都不會動 ⇒ 成功、失敗、沒送出三者不可分辨。
  it.each([
    [RECEIPT_RECORDED_RESULT_CODE, '已登錄這筆到貨'],
    [RECEIPT_DUPLICATE_RESULT_CODE, '先前已經登錄過'],
  ])('%s → 渲染得出文字', (code, text) => {
    const { container } = render(<ResultBanner code={code} />);
    expect(container.textContent).toContain(text);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // 🔴 「溢收不計入到貨欄」那半句是**功能性的**,不是修辭:少了它,員工在本片主打的
  //    取消後到貨情境按完會看到數字沒變而重按。⇒ 釘住它,別讓後人當贅字刪掉。
  it('成功文案要解釋「為什麼到貨欄沒動」(溢收情境)', () => {
    const { container } = render(<ResultBanner code={RECEIPT_RECORDED_RESULT_CODE} />);
    expect(container.textContent).toContain('溢收');
  });
});

describe('ResultBanner — #15-B2-c 片2 手動收款兩個成功碼', () => {
  // 🔴 同到貨線那一格的理由:action 測試只驗 redirect 的 URL、沒驗員工最終看到什麼
  //    ⇒ 這兩碼沒登記進 MESSAGES 的話,PRG 之後橫幅回 null,而收款明細本來就會多一列
  //    ⇒ 員工分不出「我剛登的那筆」與「本來就在的那筆」。
  it.each([
    [PAYMENT_RECORDED_RESULT_CODE, '已登錄這筆收款'],
    [PAYMENT_DUPLICATE_RESULT_CODE, '先前已經登錄過'],
  ])('%s → 渲染得出文字', (code, text) => {
    const { container } = render(<ResultBanner code={code} />);
    expect(container.textContent).toContain(text);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // 🔴 兩碼**不可共用文案**(主視窗裁 Q-D6=A):「剛記好」與「先前已登錄過」是不同事實。
  //    共用之後員工看到綠字無法判斷這次到底有沒有真的寫進去 —— 而這條線是錢。
  it('兩碼的文案不相同', () => {
    const recorded = render(<ResultBanner code={PAYMENT_RECORDED_RESULT_CODE} />).container
      .textContent;
    const duplicate = render(<ResultBanner code={PAYMENT_DUPLICATE_RESULT_CODE} />).container
      .textContent;
    expect(recorded).not.toBe(duplicate);
  });
});

describe('ResultBanner — A10b 新增的三個採購成功碼', () => {
  // 🔴 關卡2 codex nit:action 測試只驗 redirect 的 URL,**沒有驗最終員工看到什麼**
  //    ⇒ 把這三格從訊息表刪掉,action 測試照樣全綠、而畫面變成一片空白。
  it.each([
    [PROCUREMENT_CREATED_RESULT_CODE, '已新增這筆採購'],
    [PROCUREMENT_UPDATED_RESULT_CODE, '已更新這筆採購'],
    [PROCUREMENT_NO_CHANGE_RESULT_CODE, '沒有變更'],
  ])('%s → 渲染得出文字', (code, text) => {
    const { container } = render(<ResultBanner code={code} />);
    expect(container.textContent).toContain(text);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // 🔴 三格**不共用同一句話**:NO_CHANGE 是零寫入,說得跟「已更新」一樣會讓員工以為改成功了。
  it('三則訊息互異', () => {
    const texts = [
      PROCUREMENT_CREATED_RESULT_CODE,
      PROCUREMENT_UPDATED_RESULT_CODE,
      PROCUREMENT_NO_CHANGE_RESULT_CODE,
    ].map((c) => render(<ResultBanner code={c} />).container.textContent);
    expect(new Set(texts).size).toBe(3);
  });
});

// 🔴 這五個字串是**原型鏈上真的存在且 truthy** 的屬性名 ⇒ 裸索引 `MESSAGES[code]` 會取到它們、
//    讓 `if (!msg) return null` 整道守門失效(memory `reference_js-index-lookup-hits-prototype-chain`)。
//    逐字寫死、**不從任何 API 導出** —— 這組向量的價值就在「攻擊者最好猜的那幾個」是**具體哪幾個**。
//    砍短這個陣列 = 測試數對不上,是刻意設計的突變靶。
//    ⚠️ `prototype` 不在本組:它不是 plain object 繼承得到的屬性(`({}).prototype === undefined`),
//    放進來會是一格恆綠、沒有判別力的假向量。
//    ⚠️ 這份陣列與 `settings/settings-result-banner.test.tsx` 的那份**刻意各留一份** ——
//    兩支元件是獨立的守門面,共用一個常數會讓「其中一支被改回裸索引」時的失敗訊息指錯地方。
const PROTOTYPE_CHAIN_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
] as const;

describe('ResultBanner — 非自有 key 一律不渲染(#332-2)', () => {
  it.each(PROTOTYPE_CHAIN_KEYS)(
    '原型鏈屬性名 %s 當作 ?r= 傳進來時什麼都不畫',
    (code) => {
      const { container } = render(<ResultBanner code={code} />);

      // 🔴 這條比「查不到文字」嚴格:守門失效時畫出來的是一個 `class="… undefined"` 的**空框**
      //    (`msg.text` 是 undefined ⇒ 沒有文字),只斷言 textContent 為空會**照樣綠**。
      expect(container.innerHTML).toBe('');
    },
  );

  // 🔴 與姊妹元件的測試對稱補上(R1 nit 8):既有的 `缺 code → 不渲染` 只覆蓋 `undefined`,
  //    沒有覆蓋「有值但不是自有 key」。⚠️ 這條**不是**「修法沒被寫成只擋那五個」的證據
  //    —— 黑名單式實作下 `'nope'` 一樣回 null、本條照樣綠。
  it('一般的未知碼同樣什麼都不畫', () => {
    const { container } = render(<ResultBanner code='nope' />);

    expect(container.innerHTML).toBe('');
  });
});

// ── M-4b E10 A13b **D1**:取消線的結果碼 ───────────────────────────────────────
describe('ResultBanner — A13b D1 取消線結果碼', () => {
  // 🔴🔴 **成功碼刻意什麼都不畫**(D1 關卡2 must-fix,推翻第一版的「渲染得出『取消已完成』」)。
  //    `?r=` 是任何人都能自己打的字 ⇒ 靜態的成功訊息 = 對一張沒被取消的單說「已完成」。
  //    錯的方向是危險那邊(員工看到綠字就不再去取消),所以成功訊息移交 D5 的帳本核對面板。
  //    這條同時是**偽造 query 的負測**:D5 之後若有人把它加回 banner 當靜態文案,本條轉紅。
  it('🔴 偽造 ?r=order_cancelled 什麼都不畫(成功訊息必須由帳本核對,不由 URL 說了算)', () => {
    const { container } = render(<ResultBanner code={ORDER_CANCELLED_RESULT_CODE} />);
    expect(container.innerHTML).toBe('');
  });

  // 🔴 A 類 = 沒送到 RPC 的兩支。文案**逐字**取自 `FAILURE_MESSAGES` ——
  //    這裡刻意斷言「與那張表一模一樣」而不是斷言某個關鍵詞:
  //    關鍵詞式斷言在「banner 自己另寫了一句意思差不多的話」時照樣綠,而那正是兩份文案分岔的起點。
  it.each(CANCEL_NOT_SENT_CODES)('A 類 %s → 文案與 FAILURE_MESSAGES 逐字相同', (code) => {
    const { container } = render(<ResultBanner code={toOrderCancelResultCode(code)} />);
    expect(container.textContent).toBe(FAILURE_MESSAGES[code]);
  });

  // 🔴 tone 打錯不會有任何別的守門紅,而它的後果是**失敗長得像成功**(綠框)——
  //    員工掃一眼綠色就走人,以為取消送出去了。只釘「不得是 ok」,不釘 error/warn 的分法
  //    (那是可調的視覺選擇,這裡要守的是「失敗不准畫成成功」這條不變量)。
  it.each(CANCEL_NOT_SENT_CODES)('A 類 %s 的 tone 不得是 ok(失敗不准畫成綠色)', (code) => {
    const entry = MESSAGES[toOrderCancelResultCode(code)];

    // 🔴 先釘「有註冊」:少了這句,碼被拿掉時 `entry?.tone` 是 undefined、`not.toBe('ok')` 照樣綠。
    expect(entry, `${code} 必須註冊在 banner`).toBeDefined();
    expect(entry?.tone).not.toBe('ok');
  });

  // 🔴🔴 **反向斷言:B 類四碼不得在表裡**(plan v3.1 §1a「消費者互斥、兩邊都要釘」)。
  //    只釘正向的話,哪天有人「順手把六碼補齊」,員工會看到一句靜態文案就走人 ——
  //    而那四支的意思是「**已經送到 RPC 了、不知道有沒有寫進去**」,
  //    要的是拿 `?rt=` 去帳本核對(D5 的面板),不是一句安心的話。
  //    這格紅掉時的正確修法是**把碼從 banner 拿掉**,不是改這條測試。
  it.each(CANCEL_SENT_CODES)('B 類 %s → banner 什麼都不畫(它歸帳本核對面板)', (code) => {
    const { container } = render(<ResultBanner code={toOrderCancelResultCode(code)} />);
    expect(container.innerHTML).toBe('');
  });

  // 🔴🔴 零碰撞:取消線的碼**沒有一顆**等於別條線既有的碼。
  //
  //    ⚠️ **本條的第一版是假守門**(D1 code-review must-fix,已修):原本拿一份**硬寫的
  //    改單線 7 顆快照**當「既有碼」,而 `MESSAGES` 實際有 16 顆鍵 ⇒ 漏掉的那 7 顆
  //    (備註 1 + 退款 3 + 採購 3)就算被撞上也照樣綠。現在改成**從 `MESSAGES` 的鍵集合反推**:
  //    每一顆鍵都必須被歸進「取消線」或「其他線」其中一邊,兩邊都比對得上才算過。
  //
  //    判別力(三個突變各自轉紅;R2 更正:①的機制原本寫得不精確,兩種紅法要分開講):
  //    ①`toOrderCancelResultCode` 拿掉 namespace → A 類兩顆(denied/invalid)的 computed key
  //      直接**覆蓋掉**改單線同名的兩顆 ⇒ 表少兩顆鍵、第一個 `toEqual` 紅;
  //      而 `error`(B 類、不在表裡)則是被第二個斷言的**集合交集**抓到 —— 兩條互補;
  //    ②有人把裸 `retry` 加進 `MESSAGES` → 出現沒被歸類的鍵 → 紅;
  //    ③有人把 B 類碼或成功碼加進 `MESSAGES` → 取消線註冊集合對不上 → 紅。
  // 🔴🔴 #13 片1c-2 加的一格:**既有那 18 個消費端「零行為改變」不准用推的。**
  //
  //    上面那格守的是**鍵集合**(加/刪一顆會紅),而它**擋不住「手滑改到隔壁行的文案」** ——
  //    改 `MESSAGES.error.text` 鍵集合一個字都不會變。
  //    ⇒ 本格逐字釘住**既有鍵的文案與 tone**。
  //
  //    ⚠️ **判別力(2026-08-16 實跑)**:把 `error` 的文案改一個字 ⇒ **只有本格紅**、
  //    上面那格照樣綠 —— 兩格互補不是主次。
  //    ⚠️ **誠實界線**:本格釘的是**既有**那幾顆;新增一顆碼要自己來這裡登記,
  //    而「忘了登記」由上面那格的鍵集合比對抓。**兩格都要在。**
  it('既有結果碼的文案與 tone 逐字未變(改金額線只加鍵、不改別人的話)', () => {
    const FROZEN: Readonly<Record<string, { text: string; tone: string }>> = {
      saved: { text: '已儲存變更。', tone: 'ok' },
      noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
      conflict: {
        text: '這張單在你編輯期間被改過了,已重新載入最新狀態,請確認後再存一次。',
        tone: 'warn',
      },
      invalid: { text: '表單內容不正確,未儲存。', tone: 'warn' },
      denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
      not_found: { text: '找不到對象資料(可能已被移除),未儲存。', tone: 'warn' },
      error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
    };
    for (const [code, expected] of Object.entries(FROZEN)) {
      expect({ code, ...MESSAGES[code] }).toEqual({ code, ...expected });
    }
    // 🔴 正向對照:本片新加的**兩顆**確實在表裡,否則上面那個迴圈在表被清空時也會綠。
    expect(MESSAGES[ORDER_AMOUNT_REJECTED_RESULT_CODE]?.text).toBe(ORDER_AMOUNT_REJECTED_MESSAGE);
    expect(MESSAGES[ORDER_AMOUNT_ERROR_RESULT_CODE]?.text).toBe(ORDER_AMOUNT_ERROR_MESSAGE_GENERIC);
    // 🔴 而兩句**必須不同** —— 它們分開的全部理由就是「別把系統故障說成訂單狀態問題」。
    expect(ORDER_AMOUNT_REJECTED_MESSAGE).not.toBe(ORDER_AMOUNT_ERROR_MESSAGE_GENERIC);
    // 🔴🔴 codex R2:業務拒絕那句**不得只提訂單狀態** —— `P2C13` 底下有三條是**金額本身**
    //    (溢位 / 改後為負)。只提狀態會把員工導去查收款與折扣。
    //    ⇒ 這一格釘住「兩邊都提到」,而不是釘死整句話(整句留給文案定稿)。
    expect(ORDER_AMOUNT_REJECTED_MESSAGE).toContain('訂單狀態');
    expect(ORDER_AMOUNT_REJECTED_MESSAGE).toContain('金額');
    // 反向:不得出現任何具體判定
    for (const forbidden of ['已收款', '有折扣', '因為']) {
      expect(ORDER_AMOUNT_REJECTED_MESSAGE).not.toContain(forbidden);
    }
  });

  it('MESSAGES 的每一顆鍵都歸得了線,且取消線的碼與其他線零碰撞', () => {
    // 取消線**應該**註冊在 banner 的碼 = 只有 A 類兩碼。
    // 🔴 成功碼與 B 類四碼都**不在**表裡:前者要等 D5 的帳本核對(不能由 URL 說了算)、
    //    後者本來就歸帳本面板。把任何一顆加進 `MESSAGES` 都會讓下面的鍵集合比對轉紅。
    const cancelRegistered = CANCEL_NOT_SENT_CODES.map(toOrderCancelResultCode);
    // 其他線的碼:有常數的用常數,改單線那 7 顆在 `MESSAGES` 裡本來就是字面 key、沒有常數可引。
    const otherLines = [
      'saved',
      'noop',
      'conflict',
      'invalid',
      'denied',
      'not_found',
      'error',
      NOTE_ADDED_RESULT_CODE,
      REFUND_SUBMITTED_RESULT_CODE,
      REFUND_MARKED_FAILED_RESULT_CODE,
      REFUND_RECOVERED_RESULT_CODE,
      PROCUREMENT_CREATED_RESULT_CODE,
      PROCUREMENT_UPDATED_RESULT_CODE,
      PROCUREMENT_NO_CHANGE_RESULT_CODE,
      RECEIPT_RECORDED_RESULT_CODE,
      RECEIPT_DUPLICATE_RESULT_CODE,
      PAYMENT_RECORDED_RESULT_CODE,
      PAYMENT_DUPLICATE_RESULT_CODE,
      // 🔴 #13 片1c-2:改金額線只登錄這一顆失敗碼(成功/noop/conflict 走裸碼)。
      //    ⚠️ 本格在那顆被加進 MESSAGES 的當下**真的紅過**(2026-08-16 實跑,1 failed / 29 passed)
      //    —— 那就是它有判別力的證據,不是推的。
      ORDER_AMOUNT_ERROR_RESULT_CODE,
      ORDER_AMOUNT_REJECTED_RESULT_CODE,
      // 🔴 M-4b #20 上下架線只登錄這一顆(saved/noop/not_found/invalid/denied/error 走裸碼)。
      LISTING_NOOP_NOTE_DROPPED_RESULT_CODE,
    ];

    // ① 表裡沒有第三種鍵(新增未歸類的碼 → 紅)
    expect(Object.keys(MESSAGES).sort()).toEqual([...otherLines, ...cancelRegistered].sort());

    // ② 取消線**全部**的碼(含四顆不進表的 B 類)沒有一顆等於別條線的碼
    const allCancelCodes = [
      ORDER_CANCELLED_RESULT_CODE,
      ...[...CANCEL_NOT_SENT_CODES, ...CANCEL_SENT_CODES].map(toOrderCancelResultCode),
    ];

    expect(allCancelCodes).toHaveLength(7);
    expect(allCancelCodes.filter((c) => otherLines.includes(c))).toEqual([]);
  });
});
