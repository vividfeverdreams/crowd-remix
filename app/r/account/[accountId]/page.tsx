import { notFound, redirect } from "next/navigation";
import { getPrimarySessionForUser } from "@/lib/session-service";

export const dynamic = "force-dynamic";

type AccountRemixRouteProps = {
  params: Promise<{
    accountId: string;
  }>;
};

export default async function AccountRemixPage({ params }: AccountRemixRouteProps) {
  const { accountId } = await params;
  const session = await getPrimarySessionForUser(accountId);

  if (!session) {
    notFound();
  }

  redirect(`/r/${session.code}`);
}
