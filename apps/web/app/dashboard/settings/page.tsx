import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SlackSettings } from "../../../components/slack/slack-settings";
import { getSession } from "../../../lib/session";

export default async function Settings() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Suspense
      fallback={
        <p role="status" className="mail-list-loading">
          Loading settings...
        </p>
      }
    >
      <SlackSettings session={session} />
    </Suspense>
  );
}
