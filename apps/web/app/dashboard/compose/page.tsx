import { redirect } from "next/navigation";
import { Compose } from "../../../components/compose/compose";
import { getSession } from "../../../lib/session";

export default async function ComposePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Compose session={session} />;
}
