import { notFound } from "next/navigation";
import { getConsentRequest } from "@/lib/api/consent";
import { ConsentAccept } from "./ConsentAccept";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function ConsentPage({ params }: Props) {
  const { token } = await params;

  let data: Awaited<ReturnType<typeof getConsentRequest>> | undefined;
  try {
    data = await getConsentRequest(token);
  } catch {
    notFound();
  }
  if (!data) notFound();

  const { familyName, targetName, status, notice } = data;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-page, #f8fafc)", padding: "24px"
    }}>
      <div style={{
        maxWidth: "480px", width: "100%", background: "var(--bg-card, #fff)",
        borderRadius: "12px", border: "1px solid var(--border, #e2e8f0)",
        padding: "32px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)"
      }}>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: ".05em" }}>
          {familyName}
        </p>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 16px" }}>
          Join request
        </h1>
        {targetName && (
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
            Hello, <strong>{targetName}</strong>.
          </p>
        )}
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "0" }}>
          {notice}
        </p>
        <ConsentAccept token={token} initialStatus={status} />
      </div>
    </div>
  );
}
