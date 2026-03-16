import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "FamLink",
  description: "Family coordination platform"
};

export default function RootLayout(props: { children: ReactNode }) {
  const { children } = props;

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
