import type { ReactElement } from "react";
import Link from "next/link";
import { Button } from "../components/ui/button";

export default function HomePage(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-50">FamLink</h1>
        <p className="text-slate-400">A focused hub for family coordination, across web and mobile.</p>
      </div>
      <div className="flex gap-3">
        <Link href="/dashboard">
          <Button className="px-4 py-2">Open web app</Button>
        </Link>
      </div>
    </main>
  );
}
