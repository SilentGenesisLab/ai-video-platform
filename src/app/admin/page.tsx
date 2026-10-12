import AdminConsole from "@/components/admin-console";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, requirePlatform } from "@/lib/auth";
import "../marketing.css";
import "../auth.css";
import "../teams.css";
import "../admin.css";
export default async function AdminPage() {
  let actor;
  try {
    actor = await authenticate(
      new Request((process.env.APP_URL ?? "http://127.0.0.1:3000") + "/admin", {
        headers: await headers(),
      }),
    );
  } catch {
    redirect("/login");
  }
  if (actor.type !== "human" || !actor.platformAdmin)
    redirect("/studio/products");
  requirePlatform(actor);
  return <AdminConsole />;
}
