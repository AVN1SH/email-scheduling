import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth/auth-form";
import { getSession } from "../../lib/session";

const errors: Record<string, string> = {
  oauth_state:
    "Google sign-in expired or could not be verified. Please try again.",
  oauth_cancelled: "Google sign-in was cancelled. Please try again.",
  oauth_failed: "Google sign-in could not be completed. Please try again.",
  account_exists:
    "This email already has an account. Sign in using its existing login method.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const params = await searchParams;
  return (
    <AuthForm
      mode="login"
      initialError={
        typeof params.error === "string" ? errors[params.error] : undefined
      }
    />
  );
}
