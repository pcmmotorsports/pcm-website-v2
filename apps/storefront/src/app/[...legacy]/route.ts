import { notFound } from 'next/navigation';
import { legacyCategoryLocation } from '@/lib/legacy-category-redirect';

function redirectLegacyCategory(request: Request): Response {
  // 直接讀原始 URL pathname；不可改用 params，Next 會先移除 `_NEXTSEP_` 等內部標記。
  const location = legacyCategoryLocation(new URL(request.url).pathname);
  if (!location) notFound();
  return new Response(null, { status: 308, headers: { Location: location } });
}

export const GET = redirectLegacyCategory;
export const HEAD = redirectLegacyCategory;
