import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth/auth-form";
import { getSession } from "../../lib/session";

export default async function Signup() {
  if (await getSession()) redirect("/dashboard");
  return <AuthForm mode="register" />;
}
