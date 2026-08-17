// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import {
  REFUND_EXCEPTION_STALL_MS,
  isRefundException,
  refundStatusLabel,
} from '../../lib/payment/refund-ledger-view';
import { RefundLedgerSection } from './refund-ledger-section';

// M-3 A7c RW3:退款帳本區塊(server component,jsdom 直接 render —— 無 hook 無 context)。

const NOW = Date.parse('2026-08-04T12:00:00+08:00');

function row(over: Partial<OrderRefundRow> = {}): OrderRefundRow {
  return {
    id: 'r-1',
    kind: 'partial',
    status: 'confirmed',
    refundAmount: 100,
    reason: '缺貨退款',
    actor: 'sean',
    createdAt: new Date(NOW - 60_000).toISOString(),
    failedReason: null,
    failedDetail: null,
    providerEvidence: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe('RefundLedgerSection — RW3', () => {
  it('[1] 零列且未失敗 → 整區不渲染', () => {
    const { container } = render(
      <RefundLedgerSection rows={[]} unregisteredAmount={null} nowMs={NOW} />,
    );
    expect(container.innerHTML).toBe('');
  });

  // 🔴 #445a-3 驗收 §6-32:445a-3 刪掉呼叫端「有列才打 RPC」的短路 ⇒
  //    「零列 && 未登記額讀取失敗」**從不可達變成可達**。這個組合若落回 [1] 的
  //    「整區不渲染」,值班看到的是「退款鈕不見了、頁面上一個字都沒有」。
  //    ⇒ 這格紅的時候是誰讓它紅的:把失敗分支挪到 `rows.length === 0` 早退**之後**。
  it('[1b] 🔴 零列 + 未登記額讀取失敗 → 要看得到說明,不得整區不渲染', () => {
    const { container } = render(
      <RefundLedgerSection rows={[]} unregisteredAmount={null} unregisteredFailed nowMs={NOW} />,
    );
    expect(container.innerHTML).not.toBe('');
    expect(container.textContent).toContain('讀取失敗');
    // 要講出「錢沒動」與「下一步」(Sean 08-13:使用上直覺、好用即可)
    expect(container.textContent).toContain('錢沒有動');
    expect(container.textContent).toContain('重新整理');
    // 🔴 **不得宣稱按鈕被關掉** —— 本區塊看不到旗標/channel/status,
    //    轉帳單或旗標關時入口本來就不存在,講了就是假話(code-reviewer 抓到我第一版寫了)。
    expect(container.textContent).not.toMatch(/入口已.*關閉|按鈕.*收起/);
    // 措辭鐵律:禁語不准出現(與資料來源無關)
    expect(container.textContent).not.toMatch(/還能退|剩餘可退/);
    // 🔴 純文字輸出不得混 Markdown —— 員工會看到字面星號。
    //    同日我在 `refund-action-state.ts` 被 codex 抓過一次、一小時後又犯 ⇒ 做成守門。
    expect(container.textContent).not.toContain('**');
  });

  // §6-33:零列 + 成功 ⇒ 行為與現況一致,不因刪短路多冒一個空區塊出來。
  it('[1c] 零列 + 讀取成功(拿到數字)→ 仍然整區不渲染', () => {
    const { container } = render(
      <RefundLedgerSection rows={[]} unregisteredAmount={1000} nowMs={NOW} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('[2] 載入失敗 → 警告(不靜默;明寫勿在此期間發起退款)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[]} unregisteredAmount={null} loadFailed nowMs={NOW} />,
    );
    expect(container.textContent).toContain('退款帳本載入失敗');
    expect(container.textContent).toContain('勿在此期間發起退款');
  });

  it('[3] 列渲染:金額/狀態字面/原因/失敗說明/發起人', () => {
    const { container } = render(
      <RefundLedgerSection
        rows={[
          row({ kind: 'full', refundAmount: 4500 }),
          row({
            id: 'r-2',
            status: 'failed',
            failedReason: 'rejected_out_of_range',
            failedDetail: 'TapPay 10051:Out of range',
          }),
          row({ id: 'r-3', status: 'deferred' }),
        ]}
        unregisteredAmount={500}
        nowMs={NOW}
      />,
    );
    const text = container.textContent!;
    expect(text).toContain('4,500');
    expect(text).toContain('全額');
    expect(text).toContain(refundStatusLabel('confirmed'));
    expect(text).toContain('TapPay 拒絕:金額超出可退範圍');
    expect(text).toContain('TapPay 10051:Out of range');
    expect(text).toContain(refundStatusLabel('deferred'));
    expect(text).toContain('sean');
  });

  it('[4] 🔴 措辭鐵律(F25):顯示「帳本未登記額」,不得出現「還能退」「剩餘可退」', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={500} nowMs={NOW} />,
    );
    const text = container.textContent!;
    expect(text).toContain('帳本未登記額');
    expect(text).toContain('NT$ 500');
    expect(text).toContain('Portal 場外退款不在其中');
    // 🔴 負向:這兩個字面出現=值班會把它當真實可退額(同一筆錢退兩次的入口)。
    expect(text).not.toContain('還能退');
    expect(text).not.toContain('剩餘可退');
  });

  // 🏁 **2026-08-14 新增(Sean 在正式站退了兩筆真錢之後回報的口徑)。**
  //    立這格的理由:換字面的那一刻,這條規則在帳本這一面**零守門** ——
  //    本檔既有的引用是 `refundStatusLabel('confirmed')`(間接),改回舊字面不會有任何一格紅。
  //    **一條沒有守門的鐵律就是一句註解**,而註解會被下一個人順手改回去(同族:`#470`)。
  // 🔴 **正向與負向必須成對**:只留負向的話,選擇器/取值路徑失效時 `not.toContain` 恆真
  //    ⇒ 那格會變成「永遠綠的守門」。正向那條就是用來證明我們真的取到那段文字。
  it('[4b] 🔴 `confirmed` 的字面 = 「退款完成」,不得回頭寫「已受理」', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row({ status: 'confirmed' })]} unregisteredAmount={500} nowMs={NOW} />,
    );
    // 🔴 **只取狀態格,不掃整個區塊** —— 區塊的劃界小字裡有「處理中+已受理佔額」這個**合法**的
    //    「已受理」(`refund-ledger-section.tsx:91`);掃整塊會讓下面那條負向恆紅,而它守的是
    //    **狀態欄的字面**,不是「這三個字不准出現在畫面上」。
    // ⚠️ 用固定索引 3 ⇒ 欄一搬家這格會靜默指到別格 ⇒ 先釘表頭第 4 欄是「狀態」,
    //    搬欄的人拿到的會是「表頭對不上」而不是一條莫名其妙的措辭紅。
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers[3]).toBe('狀態');
    const statusCell = [...container.querySelectorAll('tbody tr td')][3]!;
    const text = statusCell.textContent!;
    // 正向(先證明真的取到了那一格的文字;沒有這兩條,下面的負向在取值失敗時恆真)
    expect(text).toContain('退款完成');
    expect(text).toContain('客人入帳時間依照各家銀行而定');
    // 🔴 負向:`confirmed` 已經帶著 TapPay 憑證(`20260801120000:337-339` UPDATE 守門**本體**,
    //    `ERRCODE = 'P7C09'`)⇒ 再寫「已受理」是把已知講成未知,員工會以為還要再追一次。
    expect(text).not.toContain('已受理');
    // 🔴 入帳時間只准講**條件**、不准講**時長或時點**(依各家銀行而定;講死就是對員工說謊)。
    //    ⚠️ **字集要與宣稱一樣寬**:第一版只掃 `:`/`點`/`時`,而「約 3 個工作天」不會紅 ——
    //       我在上一行才寫「掃描字集比宣稱窄是老坑」,下一行就犯了(D 窗審查抓到)。
    //       現在的字集 = 阿拉伯數字與中文數字 × {點,時,小時,分鐘,天,工作天,日,週},外加無數字的「隔日/次日/翌日/明天」。
    expect(text).not.toMatch(
      /[0-9０-９一二三四五六七八九十兩幾數]+\s*(個)?\s*(工作天|小時|分鐘|點|時|天|日|週|[:：])|隔日|次日|翌日|明天|每日|每天|當天|當日|即時|馬上|立即|立刻/,
    );
  });

  it('[5] 未登記額 null → 顯「查無」而非 0(0 是會被照著操作的數字)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={null} nowMs={NOW} />,
    );
    expect(container.textContent).toContain('查無');
  });

  it('[5b] 未登記額讀取失敗 → 紅色錯誤態、不得顯成「查無」(codex MF2:查無會被照著操作)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={null} unregisteredFailed nowMs={NOW} />,
    );
    expect(container.textContent).toContain('讀取失敗');
    expect(container.textContent).toContain('勿依本頁發起退款');
    expect(container.textContent).not.toContain('查無');
  });

  it('[5c] 未登記額為負 → 對帳異常態、不得當普通金額顯示(codex MF3:「真實可退 ≤ 此數」對負值不成立)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={-1000} nowMs={NOW} />,
    );
    expect(container.textContent).toContain('對帳異常');
    expect(container.textContent).toContain('1,000');
    expect(container.textContent).toContain('勿再發起退款');
    expect(container.textContent).not.toContain('NT$ -');
  });

  // 🔴 本格的期望值被【拍板】推翻過一次,不是被 code 現況推翻的 ——
  //    原格(0a3e2a44,2026-08-04,codex MF1)釘的是「顯警示 + 列照印」;
  //    Sean 2026-08-17 Q2＝甲(撈不全就整區失敗、不顯示任何一列)推翻了那個設計。
  //    ⚠️ 原格的斷言字面留在這裡備查:`toContain('更舊的紀錄未列出')`。
  //       它當時是對的 —— 錯的不是那行警示,是警示下面還有一張可以照著算的表。
  it('[5d] 帳本列截斷 → 整區失敗、一列都不印(Sean 2026-08-17 Q2＝甲 推翻 0a3e2a44 的原設計)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={500} rowsTruncated nowMs={NOW} />,
    );
    // 正向對照:這把尺量得到東西 —— 該出現的說明真的在。
    expect(container.textContent).toContain('不顯示任何一列');
    // 🔴 判別力在這兩條:一列都不印。少了它們,「印說明 + 列照印」
    //    (正是被推翻的那個設計)會讓本格全綠。
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain(row().id);
    // 舊行為不得復活:那行警示現在是誤導 —— 它暗示下面還有一張表可看。
    expect(container.textContent).not.toContain('更舊的紀錄未列出');
  });

  // 🔴 codex 2026-08-18 關卡2 must-fix 折出來的格:我第一版文案寫了
  //    「錢沒有因為這個狀況而變動,也沒有任何退款被這個狀況取消」——
  //    而本元件【看不到被藏起來的那些列】,那兩句它證明不了;
  //    值班會讀成「退款還沒發生」然後重複發起退款。
  //    ⇒ 本格釘住「不准再寫回去」。與 :69-75 那條(誤稱退款按鈕被關掉)同族。
  it('[5e] 截斷文案不得宣稱錢沒動 / 沒有退款被取消(元件看不到被藏起來的列,證明不了)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={500} rowsTruncated nowMs={NOW} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('錢沒有');
    expect(text).not.toContain('沒有任何退款被');
    // 正向對照:它該講的是「別用這一頁判斷、別在這個狀態發起退款」。
    expect(text).toContain('不要用這一頁判斷');
    expect(text).toContain('不要在這個狀態下發起退款');
  });

  it('[6] 異常列(processing 滯留逾 30 分)→ 顯異常清單連結;新鮮 processing 不顯', () => {
    const stale = row({
      id: 'r-stale',
      status: 'processing',
      createdAt: new Date(NOW - REFUND_EXCEPTION_STALL_MS - 60_000).toISOString(),
    });
    const fresh = row({ id: 'r-fresh', status: 'processing' });
    const { container } = render(
      <RefundLedgerSection rows={[stale, fresh]} unregisteredAmount={500} nowMs={NOW} />,
    );
    const links = container.querySelectorAll('a[href="/orders/refund-exceptions"]');
    expect(links).toHaveLength(1);
  });

  // ── #483:卡住的人工判定列在訂單頁也要說話(#473b-2 沒收完的尾)───────────────
  //    病:清單那邊已經看得見了、訂單頁卻不說。而**訂單頁才是員工每天在看的那頁**
  //    ⇒ 兩邊說法不一致時他會相信訂單頁。
  const stuckRow = (over: Partial<OrderRefundRow> = {}) =>
    row({
      id: 'r-stuck',
      status: 'failed',
      failedReason: 'manual_failed',
      failedDetail: 'Record 差額 0',
      ...over,
    });

  it('[6b] 🔴 卡住的人工判定列 → 訂單頁也掛徽章(原本只有清單看得見)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[stuckRow()]} unregisteredAmount={500} nowMs={NOW} />,
    );
    const badge = container.querySelector('a[href="/orders/refund-exceptions"]');
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(1);
    expect(container.textContent).toContain('這裡沒有可以改的動作');
    // 🔴 兩關同抓:第一版把「需要更正請聯絡工程師」整段刪掉**四格全綠** ——
    //    而那句正是這顆徽章唯一新增的價值(**講下一步找誰**)。零斷言 = 零守門。
    expect(container.textContent).toContain('聯絡工程師');
    // 🔴 欄位歸屬(關卡1 nit):把整塊搬到「原因/說明」欄也會全綠 ⇒ 釘在狀態欄裡。
    expect(badge?.closest('td')?.textContent ?? '').toContain(refundStatusLabel('failed'));
  });

  it('[6b2] 🔴 `failedDetail` 為 null 的卡住列同樣要掛(關卡2 codex:正例全帶 detail ⇒ 偷加 detail 條件會全綠)', () => {
    // 清單那支查詢**不看** failed_detail(只看 status + failed_reason)⇒ UI 若偷加
    // `&& row.failedDetail !== null`,清單收得到、訂單頁卻不掛 = 兩頁再次漂移。
    const { container } = render(
      <RefundLedgerSection
        rows={[stuckRow({ failedDetail: null })]}
        unregisteredAmount={500}
        nowMs={NOW}
      />,
    );
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(1);
  });

  it('[6d2] 🔴 **未來新增**的 failed_reason 與未知 status 都不掛(關卡2 codex:blocklist 寫法會全綠)', () => {
    // [6d] 只證了「今天已知的兩個正常碼不掛」⇒ 把判定式改成「排除那兩碼」的 blocklist
    // 照樣全綠,而未來新增一個 failed_reason 就會被誤標成卡住。這格釘 allowlist 語意。
    const { container } = render(
      <RefundLedgerSection
        rows={[
          stuckRow({ id: 'r-future', failedReason: 'some_future_reason_2027' }),
          stuckRow({ id: 'r-unknown-status', status: 'some_future_status' }),
        ]}
        unregisteredAmount={500}
        nowMs={NOW}
      />,
    );
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(0);
  });

  it('[6c] 🔴 兩顆徽章措辭不同:卡住的那顆不得說「待對帳處理」(它沒有事可做)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[stuckRow()]} unregisteredAmount={500} nowMs={NOW} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('待對帳處理');
    expect(text).not.toContain('勿重複發起');
    // 🔴 徽章本身不得複述「錢沒有動」—— 那正是可能判錯、要更正的東西(#473b-2 兩關同抓)。
    //    ⚠️ 只掃徽章、不掃整區:狀態欄本來就會顯示判定內容,掃整區會誤紅。
    const badge = container.querySelector('a[href="/orders/refund-exceptions"]');
    expect(badge?.textContent ?? '').not.toContain('錢沒有動');
  });

  it('[6d] 🔴 其他 failed_reason 不掛這顆徽章 —— 它們是正常的失敗結果、不是卡住', () => {
    const { container } = render(
      <RefundLedgerSection
        rows={[
          stuckRow({ id: 'r-ns', failedReason: 'not_sent' }),
          stuckRow({ id: 'r-oor', failedReason: 'rejected_out_of_range' }),
        ]}
        unregisteredAmount={500}
        nowMs={NOW}
      />,
    );
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(0);
  });

  it('[6e] 同一張訂單混合時,兩種列**各自**掛自己那顆(不是整張單一種說法)', () => {
    const stale = row({
      id: 'r-stale',
      status: 'processing',
      createdAt: new Date(NOW - REFUND_EXCEPTION_STALL_MS - 60_000).toISOString(),
    });
    const { container } = render(
      <RefundLedgerSection rows={[stale, stuckRow()]} unregisteredAmount={500} nowMs={NOW} />,
    );
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(2);
    const text = container.textContent ?? '';
    expect(text).toContain('待對帳處理');
    expect(text).toContain('這裡沒有可以改的動作');
  });

  it('[7] G7-hold(有受理證據)→ 不等 30 分、立即標異常(fable N4)', () => {
    const held = row({ id: 'r-held', status: 'processing', providerEvidence: 'DR999' });
    const { container } = render(
      <RefundLedgerSection rows={[held]} unregisteredAmount={500} nowMs={NOW} />,
    );
    expect(container.querySelectorAll('a[href="/orders/refund-exceptions"]')).toHaveLength(1);
  });

  it('[8] 未知狀態(S6 未來值)→ 原樣顯示、不猜語意', () => {
    const { container } = render(
      <RefundLedgerSection
        rows={[row({ status: 'some_future_status' })]}
        unregisteredAmount={500}
        nowMs={NOW}
      />,
    );
    expect(container.textContent).toContain('some_future_status');
  });
});

describe('isRefundException — §4-1 判準矩陣', () => {
  const base = { status: 'processing', createdAt: new Date(NOW - 1000).toISOString(), providerEvidence: null };
  it.each([
    ['processing 新鮮無證據', base, false],
    ['processing 滯留逾閾', { ...base, createdAt: new Date(NOW - REFUND_EXCEPTION_STALL_MS - 1).toISOString() }, true],
    ['恰好 30 分整=不算(嚴格 >,與 DB 查詢的 lt 同邊界;codex nit:>= 會兩處分岔)', { ...base, createdAt: new Date(NOW - REFUND_EXCEPTION_STALL_MS).toISOString() }, false],
    ['processing 有證據(新鮮也算)', { ...base, providerEvidence: 'DR1' }, true],
    ['confirmed 滯留也不算', { status: 'confirmed', createdAt: new Date(NOW - REFUND_EXCEPTION_STALL_MS * 2).toISOString(), providerEvidence: null }, false],
    ['createdAt 壞掉 → fail-closed 進清單', { ...base, createdAt: 'not-a-date' }, true],
  ])('%s → %s', (_label, input, expected) => {
    expect(isRefundException(input, NOW)).toBe(expected);
  });
});
