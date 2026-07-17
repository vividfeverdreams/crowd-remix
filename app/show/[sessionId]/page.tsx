import { notFound } from "next/navigation";
import { getSessionSnapshot } from "@/lib/snapshot";
import { ShowScreen } from "@/components/show-screen";

export const dynamic = "force-dynamic";

type ShowPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams: Promise<{
    monitor?: string;
  }>;
};

export default async function ShowPage({ params, searchParams }: ShowPageProps) {
  const [{ sessionId }, { monitor }] = await Promise.all([params, searchParams]);
  const snapshot = await getSessionSnapshot(sessionId);

  if (!snapshot) {
    notFound();
  }

  return <ShowScreen initialSnapshot={snapshot} isMonitor={monitor === "1"} />;
}
