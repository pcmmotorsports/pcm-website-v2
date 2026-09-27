import { createCatalogAnonClient } from './catalog-anon-client';

// product-redirect.ts — 商品舊網址轉址(migration 20260927100000;Ilmberger 合卡配套)。
// 計畫:~/pcm-mailbox/計畫-商品舊網址轉址與舊卡下架-20260927.md
// 只在 /products/<handle> 找不到商品時查(正常商品頁不多查一次)。讀前台 view product_redirects_live_v:
// 它只給「新卡上架中」的列 ⇒ 新卡下架時舊網址回到 404,不會把人轉去看不到的卡。
// 🔴 查詢出錯一律當查無(照舊 404),不讓商品頁壞掉。

export async function findProductRedirect(handle: string): Promise<string | null> {
  try {
    const { data, error } = await createCatalogAnonClient()
      .from('product_redirects_live_v')
      .select('new_handle')
      .eq('old_handle', handle)
      .maybeSingle();
    if (error) {
      console.error('[product-redirect] 轉址查詢失敗(當作查無, 顯示 404)', error.message);
      return null;
    }
    const next = data?.new_handle;
    // view 已排除轉到自己;這裡再擋一次,不做無限轉址
    return typeof next === 'string' && next !== '' && next !== handle ? next : null;
  } catch (error) {
    console.error('[product-redirect] 轉址查詢失敗(當作查無, 顯示 404)', error);
    return null;
  }
}
