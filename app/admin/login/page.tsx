import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, checkPassword, issueToken } from "../../../lib/admin-auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) redirect("/admin/login?e=1");

  const store = await cookies();
  store.set(ADMIN_COOKIE, issueToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  redirect("/admin");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const configured = Boolean(process.env.ADMIN_PASSWORD);

  return (
    <main className="shell">
      <section className="card admin-login">
        <h1>LOGGLYPH ADMIN</h1>
        {!configured && (
          <p className="admin-error">
            ADMIN_PASSWORD が設定されていません。Vercelの環境変数を確認してください。
          </p>
        )}
        {e && <p className="admin-error">パスワードが違います。</p>}
        <form action={login}>
          <input
            type="password"
            name="password"
            placeholder="パスワード"
            autoComplete="current-password"
          />
          <button type="submit">ログイン</button>
        </form>
      </section>
    </main>
  );
}
