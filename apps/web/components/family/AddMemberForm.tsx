"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { createPerson, addFamilyMember } from "@/lib/api/family";
import { createLinkRequest } from "@/lib/api/linkRequests";

interface Props {
  familyId: string;
  households: { id: string; name: string }[];
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  fontSize: "14px",
  color: "var(--text-primary)"
} as const;

export function AddMemberForm({ familyId, households }: Props) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [attestedAdult, setAttestedAdult] = useState(false);
  const [carryHouseholdId, setCarryHouseholdId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const emailFilled = email.trim() !== "";
  const phoneFilled = phone.trim() !== "";
  const hasContact = emailFilled || phoneFilled;
  const bothContacts = emailFilled && phoneFilled;
  const showAttestation = hasContact;
  const showDateOfBirth = !hasContact;

  async function submit() {
    if (bothContacts) {
      setMessage("Enter an email or a phone, not both.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (hasContact) {
        await createLinkRequest(
          {
            kind: "FAMILY_MEMBERSHIP",
            direction: "PULL",
            familyGroupId: familyId,
            targetEmail: email.trim() || undefined,
            targetPhone: phone.trim() || undefined,
            attestedAdult: attestedAdult || undefined,
            carryHouseholdId: carryHouseholdId || undefined
          },
          getToken
        );
        setMessage("Invitation sent, pending consent.");
        return;
      }

      const person = await createPerson(
        { firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth: dateOfBirth.trim() || undefined, familyGroupId: familyId },
        getToken
      );
      try {
        await addFamilyMember(familyId, person.id, getToken);
        queryClient.invalidateQueries({ queryKey: ["family", familyId] });
        setMessage("Member added.");
      } catch (err) {
        if (err instanceof Error && err.message.includes("CONSENT_REQUIRED")) {
          await createLinkRequest(
            {
              kind: "FAMILY_MEMBERSHIP",
              direction: "PULL",
              familyGroupId: familyId,
              targetPersonId: person.id,
              carryHouseholdId: carryHouseholdId || undefined
            },
            getToken
          );
          setMessage("Invitation sent, pending consent.");
        } else {
          throw err;
        }
      }
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "24px", maxWidth: "480px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
        Add a member
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>First name
          <input aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Last name
          <input aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Email (optional)
          <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Phone (optional)
          <input aria-label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
        </label>
        {showDateOfBirth && (
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Date of birth (optional)
            <input aria-label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} style={inputStyle} />
          </label>
        )}

        {showAttestation && (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
            <input type="checkbox" aria-label="This person is an adult" checked={attestedAdult} onChange={(e) => setAttestedAdult(e.target.checked)} />
            This person is an adult.
          </label>
        )}

        {households.length > 0 && (
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Also add to household
            <select aria-label="Also add to household" value={carryHouseholdId} onChange={(e) => setCarryHouseholdId(e.target.value)} style={inputStyle}>
              <option value="">No household</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          marginTop: "12px",
          padding: "10px 20px",
          borderRadius: "8px",
          border: "none",
          background: "var(--color-primary, #6366f1)",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer"
        }}
      >
        {busy ? "Working…" : "Add member"}
      </button>

      {message && (
        <p style={{ marginTop: "10px", fontSize: "13px", color: "var(--text-secondary)" }}>{message}</p>
      )}
    </section>
  );
}
