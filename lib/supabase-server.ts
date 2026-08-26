import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * 匿名キーのクライアント（既存互換のため残している）。
 * vNextでは書き込みをすべてサーバー経由に統一するため、通常はAdminクライアントを使う。
 */
export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let adminClient: SupabaseClient | null = null;

/**
 * service_role キーのクライアント。**サーバー側でのみ使うこと。**
 * このキーはRLSを無視するため、クライアントへ渡してはいけない。
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/** Adminクライアントが使えるかどうか（設定漏れの判定用） */
export function isAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
