import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useEvents, useParticipatingEvents } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  });
}

interface MergedEventRow {
  id: string;
  title: string;
  startAt: string;
  locationName: string | null;
  isBirthdayEvent: boolean;
  isForeign: boolean;
}

export default function EventsIndex(): ReactElement {
  const router = useRouter();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const eventsQuery = useEvents(familyId);
  const participatingQuery = useParticipatingEvents(30);

  if (familiesQuery.isLoading || eventsQuery.isLoading || participatingQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  // Partial-failure isolation: one failing source must not blank the list.
  if (eventsQuery.isError && participatingQuery.isError) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Could not load events.</Text>
      </View>
    );
  }

  const own: MergedEventRow[] = (eventsQuery.data?.events ?? []).map((e) => ({
    id: e.id, title: e.title, startAt: e.startAt,
    locationName: e.locationName, isBirthdayEvent: e.isBirthdayEvent, isForeign: false,
  }));
  const foreign: MergedEventRow[] = (participatingQuery.data?.events ?? []).map((e) => ({
    id: e.id, title: e.title, startAt: e.startAt,
    locationName: e.locationName, isBirthdayEvent: false, isForeign: true,
  }));
  const events = [...own, ...foreign].sort(
    (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)
  );

  return (
    <View className="flex-1 bg-slate-950">
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-slate-400">No upcoming events</Text>
          </View>
        }
        renderItem={({ item }: { item: MergedEventRow }) => (
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/events/${item.id}`)}
            className="bg-slate-800 rounded-xl p-4"
          >
            <View className="flex-row justify-between items-start mb-1">
              <Text className="text-slate-50 font-semibold flex-1 mr-2">{item.title}</Text>
              {item.isForeign && (
                <Text className="text-indigo-300 text-xs bg-indigo-950 px-2 py-0.5 rounded">Guest</Text>
              )}
              {item.isBirthdayEvent && (
                <Text className="text-yellow-400 text-xs">🎂 Birthday</Text>
              )}
            </View>
            <Text className="text-slate-400 text-sm">
              {formatDate(item.startAt)} · {formatTime(item.startAt)}
            </Text>
            {item.locationName && (
              <Text className="text-slate-500 text-sm mt-1">{item.locationName}</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
