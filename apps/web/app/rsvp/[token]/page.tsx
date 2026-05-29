import { notFound } from "next/navigation";
import { getGuestInvitation } from "@/lib/api/events";
import { RsvpButtons } from "./RsvpButtons";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function RsvpPage({ params }: Props) {
  const { token } = await params;

  let data: Awaited<ReturnType<typeof getGuestInvitation>> | undefined;
  try {
    data = await getGuestInvitation(token);
  } catch {
    notFound();
  }

  if (!data) notFound();

  const { event, guestName, currentStatus } = data;

  const date = new Date(event.startAt).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  const time = new Date(event.startAt).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit"
  });

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
          {event.familyGroup.name}
        </p>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 16px" }}>
          {event.title}
        </h1>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          📅 {date} at {time}
        </div>
        {event.locationName && (
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "16px" }}>
            📍 {event.locationName}
          </div>
        )}
        {guestName && (
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "0" }}>
            You're invited, <strong>{guestName}</strong>.
          </p>
        )}
        <RsvpButtons token={token} initialStatus={currentStatus} />
      </div>
    </div>
  );
}
