import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEvent, useRsvp, useClaimItem } from "../../../hooks/useEvents";
import { useMyPerson } from "../../../hooks/useFamily";
import type { SerializedEventItem } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function EventDetail(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const myPersonQuery = useMyPerson();
  const myPersonId = myPersonQuery.data?.id ?? null;
  const eventQuery = useEvent(eventId);
  const rsvpMutation = useRsvp(eventId);
  const claimMutation = useClaimItem(eventId);

  if (eventQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (!eventQuery.data) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Event not found.</Text>
      </View>
    );
  }

  const { event, rsvps, eventItems } = eventQuery.data;

  function handleClaim(item: SerializedEventItem) {
    if (!myPersonId || claimMutation.isPending) return;
    claimMutation.mutate({ itemId: item.id, personId: myPersonId, currentItems: eventItems });
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      {/* Event header */}
      <Text className="text-slate-50 text-xl font-bold mb-2">{event.title}</Text>
      <Text className="text-slate-400 mb-4">{formatDateTime(event.startAt)}</Text>
      {event.locationName && (
        <Text className="text-slate-400 mb-4">📍 {event.locationName}</Text>
      )}
      {event.description && (
        <Text className="text-slate-300 mb-6">{event.description}</Text>
      )}

      {/* RSVP */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Your RSVP</Text>
        <View className="flex-row gap-3">
          {(["YES", "NO", "MAYBE"] as const).map((status) => (
            <TouchableOpacity
              key={status}
              onPress={() => rsvpMutation.mutate(status)}
              disabled={rsvpMutation.isPending}
              style={{
                opacity: rsvpMutation.isPending ? 0.5 : 1,
                backgroundColor: status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20",
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#334155",
              }}
            >
              <Text className={`font-semibold text-sm ${status === "YES" ? "text-green-400" : status === "NO" ? "text-red-400" : "text-amber-400"}`}>
                {status === "YES" ? "✓ Yes" : status === "NO" ? "✗ No" : "? Maybe"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row gap-4 mt-3">
          <Text className="text-slate-500 text-sm">{rsvps.YES} yes · {rsvps.NO} no · {rsvps.MAYBE} maybe · {rsvps.PENDING} pending</Text>
        </View>
      </View>

      {/* EventItems */}
      {eventItems.length > 0 && (
        <View>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
          {eventItems.map((item) => (
            <View key={item.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <Text className="text-slate-50 font-medium">{item.name}</Text>
                {item.quantity && <Text className="text-slate-400 text-sm">{item.quantity}</Text>}
                {item.assignedToPersonId && (
                  <Text className="text-green-400 text-xs mt-1">Claimed</Text>
                )}
              </View>
              {item.status === "UNCLAIMED" && (
                <TouchableOpacity
                  onPress={() => handleClaim(item)}
                  disabled={claimMutation.isPending}
                  style={{ opacity: claimMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
