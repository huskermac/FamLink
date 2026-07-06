import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEvent, isForeignEvent } from "../../../hooks/useEvents";
import OwnEventDetail from "../../../components/events/OwnEventDetail";
import ForeignEventDetail from "../../../components/events/ForeignEventDetail";
import type { ReactElement } from "react";

export default function EventDetailRoute(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const eventQuery = useEvent(eventId);

  if (eventQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  // isError FIRST — never render cached data after an authoritative error
  if (eventQuery.isError || !eventQuery.data) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">This event is no longer available.</Text>
      </View>
    );
  }

  if (isForeignEvent(eventQuery.data)) {
    return <ForeignEventDetail eventId={eventId} dto={eventQuery.data} />;
  }

  return <OwnEventDetail eventId={eventId} detail={eventQuery.data} />;
}
