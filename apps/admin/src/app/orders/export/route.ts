import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getAdminOrderRepository } from '../../../lib/orders/order-repository';
import { ORDER_KEYWORD_COOKIE } from '../../../lib/orders/order-keyword-cookie';
import {
  ORDER_ALL_ASCII_FILENAME,
  ORDER_CSV_CONTENT_TYPE,
  buildOrderAllCsv,
  collectOrdersForExport,
  orderAllExportFilename,
  orderExportAllBlockedMessage,
  orderExportFilterNote,
  resolveOrderExportFilter,
  taipeiDataAsOf,
} from '../../../lib/orders/order-export-all';

// /orders/export — 匯出目前篩選的【全部】訂單(M-4a-24 第一片, Sean 2026-09-27 F1 甲)。
// 登入由 `src/proxy.ts` 的登入閘擋(matcher 涵蓋本路徑), 權限同訂單列表:看得到訂單列表的員工都能匯出(Q5 甲維持)。
// 讀不完整 / 超過上限 / 途中變動 ⇒ 不給檔, 回一句給員工看的話(純文字)。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toRaw(sp: URLSearchParams): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    raw[key] = all.length > 1 ? all : all[0]!;
  }
  return raw;
}

function message(text: string, status: number) {
  return new NextResponse(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: Request) {
  const now = new Date();
  const filter = resolveOrderExportFilter(
    toRaw(new URL(req.url).searchParams),
    now,
    (await cookies()).get(ORDER_KEYWORD_COOKIE)?.value,
  );
  let result;
  try {
    const repo = getAdminOrderRepository();
    result = await collectOrdersForExport((f, p) => repo.listOrderSummariesForAdmin(f, p), filter);
  } catch (e) {
    console.error('[admin/orders/export] 訂單匯出讀取失敗', e);
    return message('訂單資料載入失敗,這次沒有產生檔案。請回到訂單列表重新整理後再試。', 500);
  }
  if (result.kind !== 'ok') return message(orderExportAllBlockedMessage(result), 409);

  const csv = buildOrderAllCsv(result.orders, {
    total: result.total,
    filterNote: orderExportFilterNote(filter),
    dataAsOf: taipeiDataAsOf(now),
  });
  const filename = orderAllExportFilename(now);
  return new NextResponse(csv, {
    headers: {
      'content-type': ORDER_CSV_CONTENT_TYPE,
      // 中文檔名走 RFC 5987 的 filename*;前面的 ASCII 檔名給不認得 filename* 的舊瀏覽器
      'content-disposition': `attachment; filename="${ORDER_ALL_ASCII_FILENAME}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
}
