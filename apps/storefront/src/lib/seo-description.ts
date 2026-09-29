// seo-description.ts — 首頁 / 品牌頁 / 商品頁的 meta description(2026-09-29 Bing Webmaster「描述太短」)。
//
// 主視窗定甲(同日):120–150 字、重點放前 80 字(搜尋結果大約只顯示到那裡)、只用站上已經寫著的事實。
//   · 商品頁保留一句「適用 {車款}」—— 賣場文案 SOP §5.9「適用範圍句」允許車款(規則 D 管的是商品文案本體)。
//   · 🔴 不寫尚未提供的服務:合作店家地圖(/stores)與線上安裝預約(/install)都還是「即將上線」;
//     那兩頁寫的現況是「安裝先用 LINE 找我們安排」⇒ 首頁只寫這一句, 不寫「全台合作店家安裝」這種已上線的說法。
// 事實出處:原廠正品與代理/平行輸入(原首頁描述)、付款方式(結帳「信用卡付款」「ATM 轉帳」)、
//   免運門檻(@pcm/domain FREE_SHIPPING_THRESHOLD)、接單後向原廠訂購(原首頁描述)、LINE 諮詢(商品頁適用車款表下方)。

import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';

import type { UIFitment } from '@/data/mock-products';
import { productSeoHead, productSeoVehicle } from '@/lib/product-seo-title';

export const SEO_DESC_MIN = 120;
export const SEO_DESC_MAX = 150;

const SHOP_FACTS = `全站原廠正品，可依車款查詢適用零件，信用卡或 ATM 轉帳付款，訂單滿 NT$${FREE_SHIPPING_THRESHOLD.toLocaleString('en-US')} 免運。`;
/** 核心句之後依序補上的句子(都是站上既有事實);只補整句、放得下才補。 */
const EXTRAS = [
  SHOP_FACTS,
  '多數商品為接單後向原廠訂購，交期與適用問題可透過 LINE 詢問。',
  '部分品牌為台灣正式代理，部分為平行輸入。',
  '商品頁附完整適用車款表與規格。',
];

/**
 * 核心句在前;不到下限就依序補「放得下的整句」, 絕不把一句切一半。
 * 核心句本身就超過上限(極長品名)才截斷、結尾「…」。
 */
function compose(core: string, extras: readonly string[] = EXTRAS): string {
  if (core.length > SEO_DESC_MAX) return `${core.slice(0, SEO_DESC_MAX - 1)}…`;
  let out = core;
  for (const s of extras) {
    if (out.length >= SEO_DESC_MIN) break;
    if (out.length + s.length <= SEO_DESC_MAX) out += s;
  }
  return out;
}

/** 商品介紹的第一句(到第一個句號或換行為止);太長(>60 字)就不用, 免得擠掉後面的事實。 */
function firstSentence(description: string | undefined): string {
  const first = (description ?? '').split(/[。！？\n]/).map((s) => s.trim()).find(Boolean) ?? '';
  return first.length <= 60 ? first : '';
}

export function productMetaDescription(p: {
  brand: string;
  name: string;
  category?: string;
  description?: string;
  fitments?: readonly UIFitment[];
}): string {
  const head = productSeoHead(p);
  const vehicle = productSeoVehicle(p.fitments);
  const pitch = firstSentence(p.description);
  const category = p.category?.trim();
  return compose(
    `${head}${vehicle ? `，適用 ${vehicle}` : ''}。` + (pitch ? `${pitch}。` : '') + (category ? `類別：${category}。` : ''),
  );
}

/** 品牌介紹頁:品牌自己的 lede 在前, 再接上架件數與全站事實。件數讀不到(null)就不寫。 */
export function brandMetaDescription(b: { name: string; lede: string; productCount: number | null }): string {
  const lede = b.lede.trim();
  const count = b.productCount && b.productCount > 0 ? `PCM 目前上架 ${b.name} 商品 ${b.productCount.toLocaleString('en-US')} 件。` : '';
  return compose(`${lede}${count}`);
}

/** 品牌總覽:有商品的品牌數與件數最多的前三家。讀不到就不寫數字。 */
export function brandDirectoryMetaDescription(brands: readonly { name: string; count: number }[]): string {
  const listed = brands.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  const lead =
    listed.length > 0
      ? `依品牌找進口重機改裝部品：PCM 重機零件販售目前有 ${listed.length} 個品牌上架，包含 ${listed.slice(0, 3).map((b) => b.name).join('、')} 等。`
      : '依品牌找進口重機改裝部品，直接查看 PCM 重機零件販售各品牌商品。';
  return compose(lead);
}

export const HOME_META_DESCRIPTION = compose(
  'PCM 重機零件販售專營進口重機改裝部品，可依車款查詢適用零件。' +
    '全站皆為原廠正品，部分品牌為台灣正式代理，部分為平行輸入。' +
    `信用卡或 ATM 轉帳付款，訂單滿 NT$${FREE_SHIPPING_THRESHOLD.toLocaleString('en-US')} 免運。` +
    '多數商品為接單後向原廠訂購，需要安裝可先用 LINE 找我們安排。',
  [],
);
