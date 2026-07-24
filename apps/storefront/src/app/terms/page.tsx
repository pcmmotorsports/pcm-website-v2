// app/terms/page.tsx — 服務條款 route(#291、2026-07-24)
//
// 結帳頁與註冊頁的「服務條款」連結指向此頁(先前為 no-op `href="#"` = 客人勾同意卻讀不到內容)。
// 版面由 LegalDocPage 負責;文字單一真相 = data/legal-content.ts。
//
// 🔴 標題 / 副標 / metadata.description **一律取自 TERMS_DOC、不在本檔寫死**:
//   那三者都是客人讀得到的對外文字,寫死於此 = 不進 canonicalLegalPayload()
//   = 可以被改而內容雜湊不變、守門失效。(實際踩過:原本硬寫的 description 宣告
//   「七日解除權」,與第 10 條的排除主張相反,且無任何測試會紅。)

import type { Metadata } from 'next';
import { LegalDocPage } from '@/components/LegalDocPage';
import { TERMS_DOC, LEGAL_UI_STRINGS } from '@/data/legal-content';

export const metadata: Metadata = {
  title: `${TERMS_DOC.title}${LEGAL_UI_STRINGS.titleSuffix}`,
  description: TERMS_DOC.description,
};

export default function TermsRoute() {
  return (
    <LegalDocPage
      screenLabel="Terms"
      title={TERMS_DOC.title}
      subtitle={TERMS_DOC.subtitle}
      sections={TERMS_DOC.sections}
    />
  );
}
