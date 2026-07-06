import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEvent, isForeignEvent, useInviteeSuggestions, useSendInvitations } from "../../../../hooks/useEvents";
import type { InviteeEntry } from "../../../../hooks/useEvents";
import { useMembers, useIsFamilyAdmin } from "../../../../hooks/useFamily";
import type { ReactElement } from "react";

export default function InviteScreen(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const eventQuery = useEvent(eventId);
  const detail = eventQuery.data;
  const familyGroupId = detail && !isForeignEvent(detail) ? detail.event.familyGroupId : null;

  const membersQuery = useMembers(familyGroupId);
  // Only fetch suggestions for a manageable own-family event — a foreign/missing
  // event (familyGroupId null) must not fire the request (council round-2).
  const suggestionsQuery = useInviteeSuggestions(eventId, { enabled: !!familyGroupId });
  const canAdmin = useIsFamilyAdmin(familyGroupId);
  const sendMutation = useSendInvitations(eventId);

  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [adminSuggestionIds, setAdminSuggestionIds] = useState<Set<string>>(new Set());
  const [externalName, setExternalName] = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPhone, setExternalPhone] = useState("");

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  function handleSend() {
    if (sendMutation.isPending) return;
    const invitees: InviteeEntry[] = [
      ...[...selectedPersonIds].map((id): InviteeEntry => ({ kind: "person", personId: id })),
      ...[...selectedSuggestionIds].map((id): InviteeEntry => ({ kind: "famlinkUser", personId: id, role: adminSuggestionIds.has(id) ? "EVENT_ADMIN" : "PARTICIPANT" })),
      ...(externalEmail || externalPhone
        ? [{ kind: "guest", guestName: externalName || "Guest", guestEmail: externalEmail || undefined, guestPhone: externalPhone || undefined } as InviteeEntry]
        : []),
    ];
    if (invitees.length === 0) return;
    sendMutation.mutate(invitees, { onSuccess: () => router.back() });
  }

  if (eventQuery.isLoading) {
    return <View className="flex-1 bg-slate-950 items-center justify-center"><ActivityIndicator color="#6366f1" /></View>;
  }
  // Guard: inviting is only for an own-family event. A foreign/missing event yields
  // familyGroupId === null — never render the invite form for it (the server would 403
  // a famlinkUser invite anyway, but don't present the UI in the first place).
  if (!familyGroupId) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">This event can’t be managed here.</Text>
      </View>
    );
  }

  const members = membersQuery.data?.members ?? [];
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-50 text-xl font-bold mb-1">Invite people</Text>
      <Text className="text-slate-400 text-sm mb-6">Select family members, suggested guests, or add someone external.</Text>

      {members.length > 0 && (
        <View className="mb-6">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Family members</Text>
          {members.map((m) => {
            const name = m.person.preferredName ?? `${m.person.firstName} ${m.person.lastName}`.trim();
            const selected = selectedPersonIds.has(m.person.id);
            return (
              <TouchableOpacity
                key={m.person.id}
                onPress={() => setSelectedPersonIds((s) => toggle(s, m.person.id))}
                className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3 mb-2"
              >
                <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: selected ? "#6366f1" : "#475569", backgroundColor: selected ? "#6366f1" : "transparent", marginRight: 10 }} />
                <Text className="text-slate-50">{name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {suggestions.length > 0 && (
        <View className="mb-6">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Suggested guests</Text>
          {suggestions.map((s) => {
            const selected = selectedSuggestionIds.has(s.person.id);
            return (
              <View key={s.person.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2">
                <TouchableOpacity className="flex-row items-center" onPress={() => setSelectedSuggestionIds((set) => toggle(set, s.person.id))}>
                  <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: selected ? "#6366f1" : "#475569", backgroundColor: selected ? "#6366f1" : "transparent", marginRight: 10 }} />
                  <View className="flex-1">
                    <Text className="text-slate-50">{s.person.displayName}</Text>
                    <Text className="text-slate-500 text-xs">via {s.via.personName} · {s.via.relationshipType.toLowerCase()}</Text>
                  </View>
                </TouchableOpacity>
                {canAdmin && selected && (
                  <TouchableOpacity
                    className="flex-row items-center mt-2 ml-7"
                    onPress={() => setAdminSuggestionIds((set) => toggle(set, s.person.id))}
                  >
                    <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 2, borderColor: adminSuggestionIds.has(s.person.id) ? "#6366f1" : "#475569", backgroundColor: adminSuggestionIds.has(s.person.id) ? "#6366f1" : "transparent", marginRight: 8 }} />
                    <Text className="text-slate-400 text-xs">Make event admin</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View className="mb-6">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">External guest</Text>
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3 mb-2" placeholder="Name" placeholderTextColor="#64748b" value={externalName} onChangeText={setExternalName} />
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3 mb-2" placeholder="Email address" placeholderTextColor="#64748b" autoCapitalize="none" keyboardType="email-address" value={externalEmail} onChangeText={setExternalEmail} />
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3" placeholder="Phone (optional)" placeholderTextColor="#64748b" keyboardType="phone-pad" value={externalPhone} onChangeText={setExternalPhone} />
      </View>

      {sendMutation.isSuccess && <Text className="text-green-400 text-sm mb-3">Invitations created</Text>}

      <TouchableOpacity
        onPress={handleSend}
        disabled={sendMutation.isPending}
        style={{ opacity: sendMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 14, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>{sendMutation.isPending ? "Sending…" : "Send invitations"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
