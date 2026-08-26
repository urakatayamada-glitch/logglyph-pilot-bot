import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase の URL を正規化する。
 *
 * 末尾に "/" が付いていると REST のパスが "//rest/v1/..." になり、
 * Supabase が "Invalid path specified in request URL" を返す。
 * 環境変数の設定ミスで起きやすいので、コード側で吸収する。
 */
function normalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

export function getSupabaseUrl(): string | undefined {
  return normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * 匿名キーのクライアント（既存互換のため残している）。
 * vNextでは書き込みをすべてサーバー経由に統一するため、通常はAdminクライアントを使う。
 */
export function getSupabase(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let adminClient: SupabaseClient | null = null;

/**
 * service_role（secret）キーのクライアント。**サーバー側でのみ使うこと。**
 * このキーはRLSを無視するため、クライアントへ渡してはいけない。
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
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
  return Boolean(getSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * 設定ミスの切り分け用。
 * URL は NEXT_PUBLIC_ の値なので秘密ではないが、キーは種別と長さだけ返す。
 */
export function describeSupabaseConfig() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  let keyKind = "未設定";
  if (key.startsWith("sb_secret_")) keyKind = "secret（正しい）";
  else if (key.startsWith("sb_publishable_")) keyKind = "publishable（誤り）";
  else if (key.startsWith("eyJ")) keyKind = "JWT形式（service_role か anon か要確認）";
  else if (key) keyKind = "不明な形式";

  return {
    url: getSupabaseUrl() ?? "(未設定)",
    rawUrlHadTrailingSlash: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().endsWith("/")
    ),
    keyKind,
    keyLength: key.length,
  };
}
