import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyToken } from "./admin-auth";

/**
 * Admin画面の保護。
 *
 * middlewareではなくサーバーコンポーネントで検証している理由：
 * middlewareはEdge Runtimeで動作し、node:cryptoが使えないため。
 */
export async function requireAdmin() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!verifyToken(token)) redirect("/admin/login");
}
