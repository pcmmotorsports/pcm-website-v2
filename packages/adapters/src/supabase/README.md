# Supabase Adapter

對齊 ADR-0005「Custom + Supabase 直寫架構」。

## 結構

```
packages/adapters/src/supabase/
├── SupabaseProductAdapter.ts    ← M-1-03 main-b 落地
├── mappers/         ← M-1-03 main-b 落地
└── README.md        ← 本檔
```

> **Migration .sql 不在此目錄**:Supabase CLI 寫死 migration file 路徑為 repo 根 `supabase/migrations/`(無 config 選項可改、M-1-03-main-a2-1 §C 觀察驗證)。本目錄保留作 `SupabaseProductAdapter.ts`(M-1-03-main-b 落地)+ future SQL helpers / mappers 用。

## Migration 工作流(B 方案、Sean 2026-05-05 拍板)

1. Claude Code 在 **repo 根** `supabase/migrations/` 寫新的 .sql(用 `supabase migration new <name>` 自動產 `{timestamp}_{name}.sql`、Supabase CLI 寫死路徑)
2. Sean Terminal 跑 `supabase db push`(從 monorepo root)
3. Supabase Dashboard 驗證表 / policy 落地
4. commit migration 檔(SQL 進 git、是 source of truth)

## env 變數

對應 .env.example 樣板:

- **NEXT_PUBLIC_SUPABASE_URL**:Supabase project URL(public、可進 client bundle)
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**:anon key(public、RLS-protected、可進 client bundle)
- **SUPABASE_SERVICE_ROLE_KEY**:service role key(server-only、絕不進 client bundle、絕不入 git)

對齊 docs/architecture/supabase-schema-design.md §9.3。
