// BrandRichText.tsx — 品牌內容欄位的渲染端(D2a;2026-08-04)
//
// D1a 的 `parseBrandRichText` 把字串拆成扁平節點串,這支把節點串變成 React 元素。
// 兩者分開的理由:parser 是純函式(可在 server / test / metadata 產生器裡用),
// 這支只管長相。
//
// 🔴 **這是全站唯一允許把品牌內容字串變成畫面的路徑。**
//    任何地方直接 `{brand.about.lead}` 都會把 `<strong>` 四個字原樣印在畫面上;
//    任何地方用 `dangerouslySetInnerHTML` 都會把白名單守門整個繞過去
//    (D 計畫 §5.1 的 c 案、Sean 2026-08-04 指定)。
//    守門 = 本檔的測試 + `data/brand-content.test.ts` 的標記白名單那組。
//
// 這支刻意**不是** client component:純渲染、零狀態、零事件 ⇒ 留在 server component
// 就不會把 20 家內容的字串推進 client bundle 的 RSC payload 以外的地方。

import { Fragment } from 'react';
import { parseBrandRichText } from '@/lib/brand-rich-text';

/**
 * 渲染帶白名單標記的品牌內容。
 *
 * `as` 給包裹元素;不給就只吐節點(要塞進既有的 `<p>` / `<h2>` 裡時用)。
 */
export function BrandRichText({
  children,
  as: Wrapper,
  className,
}: {
  /** 內容字串(可能含 `<strong>` / `<br>` / `&amp;`)。 */
  children: string;
  as?: 'p' | 'span' | 'h2' | 'div';
  className?: string;
}) {
  const nodes = parseBrandRichText(children).map((node, index) => {
    // index 當 key:內容是靜態資料、不會重排也不會增刪,沒有 reconciliation 風險。
    if (node.kind === 'break') return <br key={index} />;
    if (node.kind === 'strong') return <strong key={index}>{node.text}</strong>;
    return <Fragment key={index}>{node.text}</Fragment>;
  });

  if (!Wrapper) return <>{nodes}</>;
  return <Wrapper className={className}>{nodes}</Wrapper>;
}
