import type { ReactElement } from "react";
import { Button } from "../components/ui/button";

export default function HomePage(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-50">FamLink</h1>
        <p className="text-slate-400">A focused hub for family coordination, across web and mobile.</p>
      </div>
      <div className="flex gap-3">
        <Button>Open web app</Button>
        <Button variant="outline">Open mobile app</Button>
      </div>
    </main>
  );
}
