import { AcceptClient } from "./AcceptClient";

export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>This invitation is no longer available</h1>
    </main>;
  }
  return <AcceptClient token={token} />;
}
