import type { ReactElement } from "react";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
