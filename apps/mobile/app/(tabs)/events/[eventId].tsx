import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, FlatList, Alert
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEvent, useRsvp, useClaimItem } from "../../../hooks/useEvents";
import { useMyPerson } from "../../../hooks/useFamily";
import { useEventPhotos, useUploadEventPhoto, useDeletePhoto } from "../../../hooks/usePhotos";
import type { SerializedEventItem } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export default function EventDetail(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const myPersonQuery = useMyPerson();
  const myPersonId = myPersonQuery.data?.id ?? null;
  const eventQuery = useEvent(eventId);
  const rsvpMutation = useRsvp(eventId);
  const claimMutation = useClaimItem(eventId);
  const photosQuery = useEventPhotos(eventId);
  const uploadPhotoMutation = useUploadEventPhoto(eventId);
  const deletePhotoMutation = useDeletePhoto(eventId);

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

  async function handleAddPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to photos to add event photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";
    uploadPhotoMutation.mutate({ uri: asset.uri, mimeType });
  }

  const photos = photosQuery.data ?? [];

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
                backgroundColor:
                  status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20",
                flex: 1, paddingVertical: 8, borderRadius: 8,
                alignItems: "center", borderWidth: 1, borderColor: "#334155"
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
          ))}
        </View>
        <Text className="text-slate-500 text-sm mt-3">
          {rsvps.YES} yes · {rsvps.NO} no · {rsvps.MAYBE} maybe · {rsvps.PENDING} pending
        </Text>
      </View>

      {/* EventItems */}
      {eventItems.length > 0 && (
        <View className="mb-8">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
          {eventItems.map((item) => (
            <View
              key={item.id}
              className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between"
            >
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
                  style={{
                    opacity: claimMutation.isPending ? 0.5 : 1,
                    backgroundColor: "#4f46e5",
                    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Photos */}
      <View>
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">
            Photos ({photos.length})
          </Text>
          <TouchableOpacity
            onPress={handleAddPhoto}
            disabled={uploadPhotoMutation.isPending}
            style={{
              opacity: uploadPhotoMutation.isPending ? 0.5 : 1,
              backgroundColor: "#4f46e5",
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6
            }}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "500" }}>
              {uploadPhotoMutation.isPending ? "Uploading…" : "+ Add photo"}
            </Text>
          </TouchableOpacity>
        </View>
        {photos.length === 0 ? (
          <Text className="text-slate-500 text-sm italic">No photos yet.</Text>
        ) : (
          <FlatList
            data={photos}
            keyExtractor={(p) => p.id}
            numColumns={3}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                onLongPress={() =>
                  Alert.alert("Delete photo?", undefined, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deletePhotoMutation.mutate(item.id)
                    }
                  ])
                }
                style={{ flex: 1 / 3, aspectRatio: 1, padding: 2 }}
              >
                <Image
                  source={{ uri: item.url }}
                  style={{ flex: 1, borderRadius: 6 }}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </ScrollView>
  );
}
