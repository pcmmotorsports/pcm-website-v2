// app/privacy/page.tsx — 隱私政策 route(#291、2026-07-24)
//
// 結帳頁與註冊頁的「隱私政策」連結指向此頁(先前為 no-op `href="#"`)。
// 版面由 LegalDocPage 負責;文字單一真相 = data/legal-content.ts。
//
// 🔴 標題 / 副標 / metadata.description 一律取自 PRIVACY_DOC、不在本檔寫死(理由見 terms/page.tsx)。

import type { Metadata } from 'next';
import { LegalDocPage } from '@/components/LegalDocPage';
import { PRIVACY_DOC, LEGAL_UI_STRINGS } from '@/data/legal-content';

export const metadata: Metadata = {
  title: `${PRIVACY_DOC.title}${LEGAL_UI_STRINGS.titleSuffix}`,
  description: PRIVACY_DOC.description,
};

export default function PrivacyRoute() {
  return (
    <LegalDocPage
      screenLabel="Privacy"
      title={PRIVACY_DOC.title}
      subtitle={PRIVACY_DOC.subtitle}
      sections={PRIVACY_DOC.sections}
    />
  );
}
