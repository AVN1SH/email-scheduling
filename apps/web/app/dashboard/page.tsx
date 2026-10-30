import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Mailbox } from "../../components/mailbox/mailbox";
import { getSession } from "../../lib/session";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Suspense
      fallback={
        <p role="status" className="mail-list-loading">
          Loading emails…
        </p>
      }
    >
      <Mailbox session={session} />
    </Suspense>
  );
}
