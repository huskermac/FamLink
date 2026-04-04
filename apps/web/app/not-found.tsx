import Link from "next/link";
import type { ReactElement } from "react";

export default function NotFound(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-50">Page not found</h1>
      <p className="max-w-md text-slate-400">
        There is no route for this URL in the FamLink web app. If you meant the API, use port{" "}
        <code className="text-slate-300">3001</code> (e.g. <code className="text-slate-300">/health</code>), not
        the Next.js port.
      </p>
      <div className="flex gap-4">
        <Link className="text-sky-400 underline" href="/">
          Home
        </Link>
        <Link className="text-sky-400 underline" href="/sign-in">
          Sign in
        </Link>
      </div>
    </main>
  );
}
