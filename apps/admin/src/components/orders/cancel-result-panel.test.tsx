// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import {
  CANCEL_PANEL_RESULT_CODES,
  CancelResultPanel,
  cancelFormsAllowedOnResultPage,
  isCancelPanelResultCode,
  type CancelResultPanelProps,
} from './cancel-result-panel';
import {
  CANCEL_NOT_SENT_CODES,
  CANCEL_SENT_CODES,
  ORDER_CANCELLED_RESULT_CODE,
  toOrderCancelResultCode,
} from '../../lib/orders/cancel-action-state';
import { CancelResultUrlCleanup } from './cancel-result-url-cleanup';

// cancel-result-panel.test.tsx — A13b D5 驗收①-④。
//
// 🔴 **突變清單(逐發字面 = 實跑過的那一行;全紅零存活)**:
//   Q1  拿掉 `cancelFormsAllowedOnResultPage` 的 `Array.isArray` 早退... 只紅重複鍵那格
//       🔴 那是 fail-open:面板不出現、表單卻開著 = 員工看不到警告卻按得下第二次。
//   Q2  `cancelFormsAllowedOnResultPage` 恆回 `true`................... 紅 B 類/成功碼那格
//       **這發是本片核心**:它等於「結果頁上就地讓他重送」= 第二筆刪不掉的取消。
//       ⚠️ **P1-P3(舊設計:按 verdict 分流的 `mayReopenCancelForms`)已隨該函式一起刪除** ——
//       R2 抓到那個設計與文案自相矛盾(文案叫他重整,閘卻當場放行)。
//   P4  成功碼的 `matched` 條件放寬成「碼是成功碼就顯示已完成」.......... 只紅驗收④
//       = 偽造 `?r=order_cancelled` 對沒被取消的單顯示「已完成」。
//   P5  面板碼集合加入 A 類 `order_cancel_denied`....................... 只紅互斥那格
//   P6  `typeof resultCode === 'string'` 拿掉(讓陣列也進面板)......... 只紅重複鍵那格
//   P7  `miss_complete` 文案改成**另一種**危險寫法(「這筆確定沒送出去,可以放心重送」) 只紅那格
//       🔴 舊版斷言只擋 `沒有寫進去` 這個子字串 ⇒ 換個寫法照樣全綠。
//       改成**釘住核准過的完整那一句**才擋得住 —— 危險說法有無限多種,枚舉禁詞追不完。
//   P8  `match_other_actor` 文案寫死「登記人不是你」.................... 只紅 actor 為 null 那格
//   P9  網址清除改成整段清空 query(`url.search = ''`)................. 只紅「其餘 query 保留」
//   P10 面板不掛清除元件............................................... 只紅「面板真的有掛」
//   P14 拿掉清除元件的 `hasAny` 早退................................... 只紅「完全不呼叫 replaceState」
//       ⓘ 這發**只有 spy 版的斷言擋得到** —— 舊版只比對網址,而每次都寫 history 時網址一模一樣。
//   P11 成功碼的 matched 放寬回收 `match_other_actor`.................. 紅 2(別人那筆 / actor 為 null)
//       🔴 **這發就是 R1 must-fix 1** —— 補這兩條測試之前它**存活**:
//       我第一版真的會對「別人那筆」或「認不出人」顯示綠字「取消已完成」,
//       等於把 D3 的 actor fail-closed 整格吃掉。
//   P12 把 `CANCEL_RESULT_PARAM` 改壞成 `'rr'`......................... 紅 1
//   P13 把 `CANCEL_REQUEST_TOKEN_PARAM` 改壞成 `'rtt'`................. 紅 2
//       ⓘ P12/P13 是拿來**證明本檔測試端手打字面確實有外部觀點**的(見下方 setUrl 的註解)。
//       ⚠️ 這兩發是**先寫了「我實驗過會紅」那句話、才回頭去跑**的 —— 順序錯了。
//       宣稱在前、驗證在後,就算結論對也是運氣;記在這裡提醒下一次先跑再寫。
//   ⚠️ **本清單自己也犯過一次**:P9/P10 跑過了卻只列到 P8,收工卻宣稱十發
//     ——「改了清單沒改總數」的同族,本 slice 第四次(R1 must-fix 3 抓到)。

const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const OTHER_TOKEN = 'f9e8d7c6-b5a4-4392-8180-7f6e5d4c3b2a';
const ACTOR = 'staff-alice';
const OTHER_ACTOR = 'staff-bob';

const SENT_CODE = toOrderCancelResultCode('retry');

/**
 * 🔴 基準:帳本**非空且不含 TOKEN** —— 空帳本會讓「找不到」與「帳本是空的」分不出來。
 * `cancellationsTruncated: false` 讓 `miss_truncated` 構造得出來。
 */
const BASE: CancelResultPanelProps = {
  resultCode: SENT_CODE,
  requestToken: TOKEN,
  actor: ACTOR,
  cancellations: [{ actor: OTHER_ACTOR, idempotencyKey: OTHER_TOKEN }],
  cancellationsTruncated: false,
};

function panel(over: Partial<CancelResultPanelProps> = {}) {
  return render(<CancelResultPanel {...BASE} {...over} />);
}

afterEach(cleanup);

describe('D5 驗收① 五分類各自的文案', () => {
  it('unreadable(帳本沒讀到)→ 說「不代表沒有送出」', () => {
    const { container } = panel({ cancellations: null });
    expect(container.textContent).toContain('查不到取消紀錄');
    expect(container.textContent).toContain('不代表沒有送出');
  });

  it('match_same_actor → 說已經寫進去了', () => {
    const { container } = panel({ cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }] });
    expect(container.textContent).toContain('已經寫進去了');
  });

  it('match_other_actor → 說與同事確認', () => {
    const { container } = panel({ cancellations: [{ actor: OTHER_ACTOR, idempotencyKey: TOKEN }] });
    expect(container.textContent).toContain('與同事確認');
  });

  it('miss_truncated → 說無法斷定、先不要重送', () => {
    const { container } = panel({ cancellationsTruncated: true });
    expect(container.textContent).toContain('無法斷定');
    expect(container.textContent).toContain('先不要重送');
  });

  it('miss_complete → 目前查不到,重整再確認', () => {
    const { container } = panel({});
    expect(container.textContent).toContain('目前查不到');
  });

  it('🔴 miss_complete 的文案逐字等於核准過的那句(E-044-Q 裁 A)', () => {
    // 🔴 它踩在兩個沒人量過的前提上(跨單 token / 導頁後讀取新鮮度,backlog #357)
    //    ⇒ 任何斷言句都會讓員工直接重送 = 第二筆刪不掉的取消。
    // 🔴 **斷言整句、不是「不含某個子字串」**(R2 codex must-fix):只擋 `沒有寫進去` 的話,
    //    改寫成「這筆確定沒送出去」「可以放心重送」照樣全綠 —— 危險的說法有無限多種寫法,
    //    枚舉禁詞永遠追不完;**釘住核准過的那一句**才是有邊界的斷言。
    const { container } = panel({});
    expect(container.textContent).toContain('目前查不到這筆取消');
    expect(container.textContent).toContain(
      '取消紀錄裡沒有你這次送出的那一筆。請重新整理本單再確認一次;仍然沒有,才重新送一次。',
    );
  });

  it('🔴 match_other_actor 的文案要容得下「認不出你是誰」', () => {
    // actor 為 null 時 D3 fail-closed 走這一格,那時的事實不是「登記人不是你」。
    const { container } = panel({
      actor: null,
      cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
    });
    expect(container.textContent).toContain('認不出你是誰');
  });

  it('🔴 match_other_actor 的文案逐字等於核准過的那句(Q-CANCELHINT 裁甲)', () => {
    // 🔴 **為什麼釘【整句】而不是禁幾個詞**:同檔 miss_complete 那格已經寫過理由 ——
    //    危險的說法有無限多種寫法,枚舉禁詞永遠追不完;釘住核准過的那一句才有邊界。
    //
    // 🔴 **這一句在防的兩件事,兩件都是【改一個字就恢復】的**:
    //    ① ~~「也可能是你還沒在右上角選人」~~ —— 線上到得了這句話的世界裡,那半句全是白工
    //       (`actor === null` 有四種來源,只有 `self-selected` 那種選了才有用,
    //        而它要求 `ADMIN_REQUIRE_REAL_IDENTITY` 是關的 —— 那顆旗標 2026-08-25 已設為 1)。
    //    ② 🔴 **不得叫他登出重登** —— `app/page.tsx:100-104` codex 關卡2 R4 must-fix:
    //       上游還沒送 `sub` 時他登出就回不來,而舊票還讀得到東西。
    //       (而這個後台目前**沒有登出入口**:`grep -rlEi 'logout|signout|sign-out'
    //        apps/admin/src/app` ⇒ 0 檔;正對照 `login|sso` ⇒ 64 檔。)
    //
    // 🔴 **翻面條件(寫出來,免得它變成一格恆綠)**:
    //    · 有人把那半句改回去指那顆選單 ⇒ 整句斷言紅
    //    · 有人「順手統一文案」把句子改軟 ⇒ 整句斷言紅
    //    · 有人加一句「請登出後重新登入」⇒ 下面那條 not.toContain 紅
    //    ⚠️ 而【本測試不驗】那句話說得對不對 —— 它只保證這句話不會在沒有人看見的情況下被改掉。
    //       文案調性是 Sean 的板;用字是線I 挑的,他一個字就能改(改了記得同步這裡)。
    const { container } = panel({
      actor: null,
      cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
    });
    // 🔴 **codex R1 must-fix 3+4 之後改成 `toBe`,不是 `toContain`** —— 兩條同一個根:
    //    · `toContain` 之下,**在核准句後面【加】一句危險的話照樣全綠**
    //      (codex 的反例:加「請退出帳號再重新登入」—— 它避開了「登出」兩個字)。
    //    · ~~`not.toContain('登出')`~~ **已刪**:它守錯邊界 —— 正確的警語「請先不要登出」
    //      會被它誤紅,而上面那句危險的同義句它抓不到。**`toBe` 把兩邊一起解掉。**
    const hint = container.querySelector('p.text-xs');
    expect(hint?.textContent).toBe(
      '可能是同事同時在處理,也可能是系統這次認不出你是誰。請先與同事確認,不要直接再送一次;而右上角那顆選單【不一定】選了就生效 —— 要知道你這次是哪一種情況、該做什麼,看後台首頁「具名身分」那張卡。',
    );
    // 🔴 **tone 也要釘**(codex R1 must-fix 4 的另一半):字串一字不改、把 `tone` 改成 `ok`
    //    ⇒ 面板變綠色「看起來成功了」而文字照舊 ⇒ 上面那條 `toBe` 全綠。
    // 🔴 **codex R2 must-fix 1**:~~只釘 hint~~ ⇒ **標題不釘的話,把標題改成
    //    「這筆沒有送出,可以直接再送一次」而 hint / tone 一字不動 ⇒ 全綠,而畫面自相矛盾。**
    const title = container.querySelector('p.font-medium');
    expect(title?.textContent).toBe('找到相符的取消紀錄,但登記人不是你(或系統認不出你是誰)');
    // 🔴 **codex R2 must-fix 2**:~~`toContain('amber')` + `not.toContain('emerald')`~~ **太鬆** ——
    //    改成 `border-amber-300 bg-sky-50 text-sky-900` ⇒ 畫面主色變藍,而那兩條照樣全綠。
    //    ⇒ 釘**整串** warn 的 class(`TONE_CLASS.warn` 逐字)。
    const section = container.querySelector('section');
    expect(section?.className).toContain('border-amber-300 bg-amber-50 text-amber-900');
    //
    // ⚠️ **這一格【沒有】驗到的**(明寫,不要讓下一個人以為它守得比實際寬):
    //    · 提示被 CSS 隱藏 / 字級縮到看不見 ⇒ `textContent` 一樣回這串,**測不出來**
    //    · 🔴 **可近用性**(codex R2 nit):替 hint 加 `aria-hidden`、或拿掉 section 的
    //      `role='status'` ⇒ 螢幕閱讀器收不到,而本測試三條全綠。**這一格沒有人在守。**
    //    · 🔴 **選擇器不穩**(codex R2 nit):`p.text-xs` / `p.font-medium` 目前各自唯一,
    //      而**純樣式重構(換 class)會讓這格【假紅】** —— 假紅可以排隊,假綠不能,故接受。
    //    · 這句話說得【對不對】⇒ 那是 Sean 的板,不是這條測試的事
  });
});

describe('D5 驗收② fail-closed:結果頁上不准就地重送', () => {
  // 🔴 R2 codex must-fix:第一版按 verdict 分流(只有 miss_complete 准重開),
  //    與文案「請重新整理再確認一次,仍然沒有才重送」**自相矛盾** —— 閘在同一次渲染就放行了。
  //    改成形狀規則:面板出現的那次渲染,表單一律不給;重整讓網址回 canonical 才自然回來。
  it('🔴 B 類四碼與成功碼(= 會開面板的那些)一律不給表單', () => {
    for (const code of CANCEL_SENT_CODES) {
      expect(cancelFormsAllowedOnResultPage(toOrderCancelResultCode(code))).toBe(false);
    }
    expect(cancelFormsAllowedOnResultPage(ORDER_CANCELLED_RESULT_CODE)).toBe(false);
  });

  it('A 類兩碼(RPC 從未被呼叫)不受影響,表單照常開著', () => {
    // 什麼都沒送出去,本來就該讓他改一改再送 —— 這格若也擋住就是誤傷。
    for (const code of CANCEL_NOT_SENT_CODES) {
      expect(cancelFormsAllowedOnResultPage(toOrderCancelResultCode(code))).toBe(true);
    }
  });

  it('canonical 網址(沒有結果碼)→ 表單正常給', () => {
    // 🔴 這格證明「重新整理」真的是重開表單的機制 —— 不是靠另外發一張通行證。
    expect(cancelFormsAllowedOnResultPage(undefined)).toBe(true);
    expect(cancelFormsAllowedOnResultPage('saved')).toBe(true);
  });

  it('🔴 重複 query key 也不給表單(與面板同一條 fail-closed)', () => {
    expect(cancelFormsAllowedOnResultPage([SENT_CODE, SENT_CODE])).toBe(false);
  });
});

describe('D5 驗收④ 偽造成功碼不得顯示「已完成」', () => {
  it('🔴 `?r=order_cancelled` 但帳本找不到那顆 token → 不得出現「已完成」', () => {
    const { container } = panel({ resultCode: ORDER_CANCELLED_RESULT_CODE });
    expect(container.textContent).not.toContain('已完成');
    expect(container.textContent).toContain('目前查不到');
  });

  it('🔴 `?r=order_cancelled` + 帳本完全讀不到 → 也不得出現「已完成」', () => {
    const { container } = panel({
      resultCode: ORDER_CANCELLED_RESULT_CODE,
      cancellations: null,
    });
    expect(container.textContent).not.toContain('已完成');
    // 🔴 **正向斷言不可省**(R1 nit 6):只寫 `not.toContain` 的話,元件整個回 `null` 也照樣綠
    //    —— 那條斷言對「面板壞掉不顯示」全盲。
    expect(container.textContent).toContain('查不到取消紀錄');
  });

  it('🔴 `?r=order_cancelled` + 帳本裡是別人那筆 → 不得說「已完成」', () => {
    // 🔴 **R1 must-fix 1**:我第一版把 `match_other_actor` 也算成 matched ⇒ 綠字「取消已完成」。
    //    這等於把 D3 的 actor fail-closed 整格吃掉。可構造:員工沒選人(actor=null)
    //    或手上是同事 / 自己更早那筆的 token ⇒ 他這次的取消可能一件都沒送出,卻看到綠字。
    const { container } = panel({
      resultCode: ORDER_CANCELLED_RESULT_CODE,
      cancellations: [{ actor: OTHER_ACTOR, idempotencyKey: TOKEN }],
    });
    expect(container.textContent).not.toContain('已完成');
    expect(container.textContent).toContain('與同事確認');
  });

  it('🔴 `?r=order_cancelled` + actor 為 null(認不出人)→ 不得說「已完成」', () => {
    const { container } = panel({
      resultCode: ORDER_CANCELLED_RESULT_CODE,
      actor: null,
      cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
    });
    expect(container.textContent).not.toContain('已完成');
    expect(container.textContent).toContain('認不出你是誰');
  });

  it('`?r=order_cancelled` + 帳本對得上**且是本人** → 才說已完成', () => {
    const { container } = panel({
      resultCode: ORDER_CANCELLED_RESULT_CODE,
      cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
    });
    expect(container.textContent).toContain('取消已完成');
  });
});

describe('D5 驗收③ 看過即清除:網址上的 r/rt 被抹掉', () => {
  // 🔴 **這是 UX 不是安全前提**(plan §1b v3 降級):清除失效只會讓面板重整時再出現一次,
  //    不會讓任何判定變不安全 —— 安全論證靠「重播只會重跑帳本核對」。
  // ⚠️ **本 describe 內的網址刻意手打 `?r=` / `rt=` 字面,不引用那兩顆常數**(R1 nit 8):
  //    引用同源常數的話,常數被改壞時測試會跟著改壞而永遠綠 —— 這裡要的正是「外部觀點」。
  //    我實驗過:改掉常數後,這幾條會紅。plan `:149` 的「取消線零手拼」判準指的是**正式碼**,
  //    測試端刻意反過來,免得下次掃到被當成違規。
  function setUrl(search: string) {
    window.history.replaceState(null, '', `/orders/abc${search}`);
  }

  it('r 與 rt 被刪掉,其餘 query 保留', () => {
    setUrl(`?r=${SENT_CODE}&rt=${TOKEN}&correct=keep-me`);
    render(<CancelResultUrlCleanup />);
    const url = new URL(window.location.href);
    expect(url.searchParams.has('r')).toBe(false);
    expect(url.searchParams.has('rt')).toBe(false);
    // 🔴 只刪自己那兩顆、不整段清空:別人的參數(分頁、更正模式)不是我的。
    expect(url.searchParams.get('correct')).toBe('keep-me');
    expect(url.pathname).toBe('/orders/abc');
  });

  it('本來就沒有 r/rt 時,完全不呼叫 replaceState', () => {
    // 🔴 **要 spy 呼叫次數,不能只比對網址**(R2 codex nit):拿掉 `hasAny` 早退之後,
    //    每次 render 都會寫一次 history,而**網址內容一模一樣** ⇒ 只比網址的斷言恆綠。
    //    量的要是「有沒有發生」,不是「結果長不長一樣」。
    setUrl('?correct=keep-me');
    const spy = vi.spyOn(window.history, 'replaceState');
    render(<CancelResultUrlCleanup />);
    expect(spy).not.toHaveBeenCalled();

    // 🔴 **分母守門(2026-08-28 量到這一格是恆綠的)**:元件整個不動作時也是「零次呼叫」
    //    ⇒「它正確地判斷不用清」與「它根本沒跑」印同一個綠。
    //    ⇒ 分母不可能放在同一次渲染裡(那次本來就該是零次)——
    //      改成**同一格裡再跑一次活性對照**:換成有 r/rt 的網址,它必須清一次。
    cleanup();
    setUrl(`?r=${SENT_CODE}&rt=${TOKEN}`);
    // 🔴🔴 **這裡要先記次數再渲染** —— `setUrl` 自己就呼叫 `replaceState`
    //    ⇒ 直接寫 `expect(spy).toHaveBeenCalled()` 會**被我自己的 setUrl 餵綠**,
    //      而那個錨在「元件完全不跑」的世界照樣過(2026-08-28 我第一版就是這樣, 當場量到)。
    //    📌 一個活性對照如果會被【佈置現場的那一步】滿足, 它量的是我不是它。
    const before = spy.mock.calls.length;
    render(<CancelResultUrlCleanup />);
    expect(
      spy.mock.calls.length,
      '連該清的時候都沒清 ⇒ 元件沒在跑, 上面那個零次不算數',
    ).toBeGreaterThan(before);
    spy.mockRestore();
  });

  it('🔴 面板本身有掛清除元件(不然驗收③ 永遠不會發生)', () => {
    // 這條守的是「接線」而不是清除邏輯本身:清除元件寫得再對,沒被 render 也是零效果。
    setUrl(`?r=${SENT_CODE}&rt=${TOKEN}`);
    panel({});
    expect(new URL(window.location.href).searchParams.has('rt')).toBe(false);
  });
});

describe('D5 面板碼集合:與 banner 互斥', () => {
  it('B 類四支 + 成功碼都會開面板', () => {
    for (const code of CANCEL_SENT_CODES) {
      expect(isCancelPanelResultCode(toOrderCancelResultCode(code))).toBe(true);
    }
    expect(isCancelPanelResultCode(ORDER_CANCELLED_RESULT_CODE)).toBe(true);
    expect(CANCEL_PANEL_RESULT_CODES).toHaveLength(CANCEL_SENT_CODES.length + 1);
  });

  it('🔴 A 類兩碼不得開面板(它們歸既有 ResultBanner)', () => {
    // 🔴 反向斷言:A 類是「RPC 從未被呼叫」,帳本裡本來就沒那筆,開面板等於叫 D5 去找鬼。
    for (const code of CANCEL_NOT_SENT_CODES) {
      expect(isCancelPanelResultCode(toOrderCancelResultCode(code))).toBe(false);
    }
  });

  it('沒有結果碼 / 不相干的碼 → 面板整個不畫', () => {
    expect(panel({ resultCode: undefined }).container.innerHTML).toBe('');
    expect(panel({ resultCode: 'saved' }).container.innerHTML).toBe('');
  });

  it('🔴 重複 query key(`?r=a&r=b`)→ 不畫面板,不亂說話', () => {
    expect(panel({ resultCode: [SENT_CODE, SENT_CODE] }).container.innerHTML).toBe('');
  });
});
