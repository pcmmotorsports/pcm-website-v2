// M0-S1 骨架占位頁。骨架驗收 = pnpm dev 跑得起來、殼(sidebar/header/theme 切換)可見可用;
// 不接資料、不做登入。訂單/客戶線於後續 slice 才裝真頁面。
export default function AdminHomePage() {
  return (
    <div className='mx-auto max-w-2xl space-y-4 py-10'>
      <h1 className='text-2xl font-semibold'>PCM 後台</h1>
      <div className='rounded-lg border bg-card p-6 text-card-foreground'>
        <p className='text-sm font-medium'>骨架建置完成(M-4a M0-S1)</p>
        <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          這是後台的殼:左側導覽、上方標題列、右上淺色／深色切換皆可操作。
          訂單管理、客戶管理與登入(SSO)會在後續 slice 依 PRD 逐步接上,目前尚未接資料。
        </p>
      </div>
    </div>
  );
}
