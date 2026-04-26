import { Stack } from "expo-router";
import type { ReactNode } from "react";
export default function CalendarStack(): ReactNode {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f8fafc", headerTitleStyle: { color: "#f8fafc" } }}>
      <Stack.Screen name="index" options={{ title: "Calendar" }} />
      <Stack.Screen name="[date]" options={{ title: "Day" }} />
    </Stack>
  );
}
