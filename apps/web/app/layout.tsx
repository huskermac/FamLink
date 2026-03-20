import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

/** Clerk requires runtime env; avoid static prerender without keys (CI / local build). */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "FamLink",
  description: "Family coordination platform"
};

export default function RootLayout(props: { children: ReactNode }) {
  const { children } = props;

  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      afterSignInUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL}
      afterSignUpUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL}
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
