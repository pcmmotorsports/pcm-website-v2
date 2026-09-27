import { NextResponse } from 'next/server';
import { taipeiDataAsOf } from '../../../lib/orders/order-export-all';
import {
  PRODUCT_ASCII_FILENAME,
  PRODUCT_CSV_CONTENT_TYPE,
  buildProductExportCsv,
  collectProductsForExport,
  listProductsForExport,
  productExportBlockedMessage,
  productExportFilename,
  productExportFilterNote,
} from '../../../lib/products/product-export';
import { parseProductListParams, PRODUCT_ATTENTION_LABEL } from '../../../lib/products/product-list-view';
import { listProductFilterOptions } from '../../../lib/products/product-repository';
import { resolveProductListQuery } from '../../../lib/products/product-taxonomy-options';

// /products/export — 匯出目前篩選的商品清單(M-4a-24 第二片, Sean 2026-09-27 F1 甲 / F3「都放」)。
// 登入由 `src/proxy.ts` 的登入閘擋(matcher 涵蓋本路徑);權限同商品列表:看得到商品列表的員工都能匯出。
// 篩選走 `resolveProductListQuery`,與 `app/products/page.tsx` 同一支 ⇒ 匯出的就是員工眼前那批商品。
// 讀不完整 / 超過上限 / 途中變動 ⇒ 不給檔,回一句給員工看的話(純文字)。

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
  const { filter } = parseProductListParams(toRaw(new URL(req.url).searchParams));
  let options;
  let resolved;
  let result;
  try {
    // 🔴 選項撈不到時列表頁會降級(分類條件不套用、顯示提示);匯出不降級,直接不給檔 ——
    //    員工拿到一份跟他以為的篩選不同的檔案,比拿不到檔更糟。
    options = await listProductFilterOptions();
    resolved = resolveProductListQuery(filter, options);
    result = await collectProductsForExport(listProductsForExport(resolved.query));
  } catch (e) {
    console.error('[admin/products/export] 商品匯出讀取失敗', e);
    return message('商品資料載入失敗,這次沒有產生檔案。請回到商品列表重新整理後再試。', 500);
  }
  if (result.kind !== 'ok') return message(productExportBlockedMessage(result), 409);

  const brandIds = resolved.query.brandIds ?? [];
  const csv = buildProductExportCsv(result.rows, {
    total: result.total,
    filterNote: productExportFilterNote({
      keyword: filter.keyword,
      setBy: filter.setBy,
      brandNames: options.brands.filter((b) => brandIds.includes(b.id)).map((b) => b.name),
      categoryPath: filter.categoryPath,
      skuCount: filter.skus?.length ?? 0,
      attentionLabels: filter.attention?.map((k) => PRODUCT_ATTENTION_LABEL[k]),
      brandFilterDropped: resolved.brandFilterDropped,
      categoryFilterDropped: resolved.categoryFilterDropped,
    }),
    dataAsOf: taipeiDataAsOf(now),
  });
  const filename = productExportFilename(now);
  return new NextResponse(csv, {
    headers: {
      'content-type': PRODUCT_CSV_CONTENT_TYPE,
      // 中文檔名走 RFC 5987 的 filename*;前面的 ASCII 檔名給不認得 filename* 的舊瀏覽器
      'content-disposition': `attachment; filename="${PRODUCT_ASCII_FILENAME}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
}
