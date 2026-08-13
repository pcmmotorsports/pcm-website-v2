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

  it('[5d] 帳本列截斷旗標 → 顯「更舊的紀錄未列出」警示(codex MF1)', () => {
    const { container } = render(
      <RefundLedgerSection rows={[row()]} unregisteredAmount={500} rowsTruncated nowMs={NOW} />,
    );
    expect(container.textContent).toContain('更舊的紀錄未列出');
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
