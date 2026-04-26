import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useCalendarMonth, eventsOnDate } from "../../../hooks/useCalendar";
import type { ReactElement } from "react";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function DayView(): ReactElement {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const calendarQuery = useCalendarMonth(familyId, year, month);

  const dayEvents = calendarQuery.data ? eventsOnDate(calendarQuery.data.events, date) : [];

  const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  if (calendarQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-400 text-sm mb-6">{displayDate}</Text>

      {dayEvents.length === 0 ? (
        <View className="items-center py-12">
          <Text className="text-slate-400">Nothing on this day</Text>
        </View>
      ) : (
        dayEvents.map((event) => (
          <TouchableOpacity
            key={event.id}
            onPress={() => !event.isBirthdayEvent && router.push(`/(tabs)/events/${event.id}`)}
            className="bg-slate-800 rounded-xl p-4 mb-3"
          >
            <View className="flex-row items-start gap-3">
              <Text className="text-xl">{event.isBirthdayEvent ? "🎂" : "📅"}</Text>
              <View className="flex-1">
                <Text className="text-slate-50 font-medium">{event.title}</Text>
                <Text className="text-slate-400 text-sm mt-1">{formatTime(event.startAt)}</Text>
                {event.locationName && (
                  <Text className="text-slate-500 text-sm mt-0.5">{event.locationName}</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
