import { View, Text, ScrollView, TouchableOpacity, TextInput, Linking, Alert } from "react-native";
import { useState } from "react";
import { useRsvp, useAddItem, useDeleteItem, useClaimItem } from "../../hooks/useEvents";
import type { ForeignInvitedEventDTO, ForeignTask } from "../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export default function ForeignEventDetail({ eventId, dto }: { eventId: string; dto: ForeignInvitedEventDTO }): ReactElement {
  const rsvpMutation = useRsvp(eventId);
  const addItemMutation = useAddItem(eventId);
  const deleteItemMutation = useDeleteItem(eventId);
  const claimMutation = useClaimItem(eventId);
  const [newItemName, setNewItemName] = useState("");

  function handleAddItem() {
    const name = newItemName.trim();
    if (!name || addItemMutation.isPending) return;
    addItemMutation.mutate({ name });
    setNewItemName("");
  }

  function handleRemoveTask(task: ForeignTask) {
    Alert.alert("Remove item?", task.name, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteItemMutation.mutate(task.id) }
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="flex-row items-center mb-2">
        <Text className="text-slate-50 text-xl font-bold flex-1">{dto.title}</Text>
        <Text className="text-indigo-300 text-xs bg-indigo-950 px-2 py-0.5 rounded">Guest</Text>
      </View>
      <Text className="text-slate-400 mb-2">{formatDateTime(dto.startAt)}</Text>
      {dto.locationName && (
        <TouchableOpacity
          disabled={!dto.locationMapUrl}
          onPress={() => dto.locationMapUrl && void Linking.openURL(dto.locationMapUrl)}
        >
          <Text className="text-slate-400 mb-2">📍 {dto.locationName}</Text>
        </TouchableOpacity>
      )}
      {dto.description && <Text className="text-slate-300 mb-6">{dto.description}</Text>}

      {/* RSVP with myRsvp highlight */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Your RSVP</Text>
        <View className="flex-row gap-3">
          {(["YES", "NO", "MAYBE"] as const).map((status) => {
            const selected = dto.myRsvp === status;
            return (
              <TouchableOpacity
                key={status}
                testID={selected ? `rsvp-${status}-selected` : `rsvp-${status}`}
                onPress={() => rsvpMutation.mutate(status)}
                disabled={rsvpMutation.isPending}
                style={{
                  opacity: rsvpMutation.isPending ? 0.5 : 1,
                  backgroundColor:
                    status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20",
                  flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? "#6366f1" : "#334155"
                }}
              >
                <Text
                  className={`font-semibold text-sm ${
                    status === "YES" ? "text-green-400" : status === "NO" ? "text-red-400" : "text-amber-400"
                  }`}
                >
                  {status === "YES" ? "✓ Yes" : status === "NO" ? "✗ No" : "? Maybe"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Attendees — displayName only (isolation contract) */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Who's coming</Text>
        {dto.participants.map((p, i) => (
          <View key={`${p.displayName}-${i}`} className="flex-row justify-between py-1">
            <Text className="text-slate-50">{p.displayName}</Text>
            <Text className="text-slate-500 text-sm">{p.rsvpStatus ?? "—"}</Text>
          </View>
        ))}
      </View>

      {/* Tasks: add / claim / delete-own */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
        {dto.tasks.map((task) => (
          <View key={task.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <Text className="text-slate-50 font-medium">{task.name}</Text>
              {task.quantity && <Text className="text-slate-400 text-sm">{task.quantity}</Text>}
              {task.status !== "UNCLAIMED" && (
                <Text className="text-green-400 text-xs mt-1">Claimed</Text>
              )}
            </View>
            {task.status === "UNCLAIMED" && (
              <TouchableOpacity
                onPress={() => claimMutation.mutate(task.id)}
                disabled={claimMutation.isPending}
                style={{ opacity: claimMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
              </TouchableOpacity>
            )}
            {task.isOwn && (
              <TouchableOpacity onPress={() => handleRemoveTask(task)} disabled={deleteItemMutation.isPending} style={{ marginLeft: 8 }}>
                <Text className="text-red-400 text-sm">Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <View className="flex-row items-center mt-2">
          <TextInput
            className="flex-1 bg-slate-800 text-slate-50 rounded-xl px-4 py-2 mr-2"
            placeholder="Add something to bring…"
            placeholderTextColor="#64748b"
            value={newItemName}
            onChangeText={setNewItemName}
          />
          <TouchableOpacity
            onPress={handleAddItem}
            disabled={addItemMutation.isPending}
            style={{ opacity: addItemMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}
