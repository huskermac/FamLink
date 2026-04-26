import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useCalendarMonth, eventsOnDate } from "../../../hooks/useCalendar";
import type { ReactElement } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function CalendarIndex(): ReactElement {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const calendarQuery = useCalendarMonth(familyId, year, month);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  );
  const events = calendarQuery.data?.events ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 16 }}>
      {/* Month nav */}
      <View className="flex-row items-center justify-between mb-6">
        <TouchableOpacity onPress={prevMonth} className="p-2">
          <Text className="text-slate-400 text-xl">‹</Text>
        </TouchableOpacity>
        <Text className="text-slate-50 font-semibold text-lg">{MONTHS[month - 1]} {year}</Text>
        <TouchableOpacity onPress={nextMonth} className="p-2">
          <Text className="text-slate-400 text-xl">›</Text>
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View className="flex-row mb-2">
        {DAYS.map(d => (
          <View key={d} className="flex-1 items-center">
            <Text className="text-slate-500 text-xs">{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      {calendarQuery.isLoading ? (
        <View className="py-12 items-center"><ActivityIndicator color="#6366f1" /></View>
      ) : (
        <View className="flex-row flex-wrap">
          {cells.map((day, i) => {
            if (day === null) {
              return <View key={`empty-${i}`} style={{ width: "14.28%" }} className="aspect-square" />;
            }
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsOnDate(events, dateStr);
            const hasBirthday = dayEvents.some(e => e.isBirthdayEvent);
            const hasEvent = dayEvents.some(e => !e.isBirthdayEvent);
            const isToday = dateStr === now.toISOString().slice(0, 10);
            return (
              <TouchableOpacity
                key={dateStr}
                onPress={() => router.push(`/(tabs)/calendar/${dateStr}`)}
                style={{ width: "14.28%" }}
                className="aspect-square items-center justify-center"
              >
                <View className={`w-8 h-8 rounded-full items-center justify-center ${isToday ? "bg-indigo-600" : ""}`}>
                  <Text className={`text-sm ${isToday ? "text-white font-bold" : "text-slate-300"}`}>{day}</Text>
                </View>
                <View className="flex-row gap-0.5 mt-0.5">
                  {hasEvent && <View className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                  {hasBirthday && <View className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
