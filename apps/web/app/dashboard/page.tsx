import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage(): Promise<ReactElement> {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <p className="text-slate-200">Dashboard — {userId}</p>
    </main>
  );
}
