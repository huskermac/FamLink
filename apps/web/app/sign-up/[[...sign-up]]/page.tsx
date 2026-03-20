import type { ReactElement } from "react";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
