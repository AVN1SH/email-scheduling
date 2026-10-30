import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { emailSummarySchema } from "@repo/shared";
import { getSession } from "../../../../lib/session";
import { EmailDetailView } from "../../../../components/mailbox/email-detail";

export default async function EmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  if (!emailSummarySchema.shape.id.safeParse(id).success) notFound();
  return (
    <Suspense
      fallback={
        <p role="status" className="mail-list-loading">
          Loading email…
        </p>
      }
    >
      <EmailDetailView id={id} session={session} />
    </Suspense>
  );
}
