import { Tabs } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { Redirect } from "expo-router";
import { Text } from "react-native";
import type { ReactNode } from "react";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Family: "👨‍👩‍👧",
    Events: "📅",
    Calendar: "🗓",
    Assistant: "🤖",
  };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
      {icons[label] ?? "•"}
    </Text>
  );
}

export default function TabsLayout(): ReactNode {
  const { isSignedIn, isLoaded } = useAuth();

  if (isLoaded && !isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#0f172a", borderTopColor: "#1e293b" },
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#64748b",
      }}
    >
      <Tabs.Screen
        name="family"
        options={{
          title: "Family",
          tabBarIcon: ({ focused }) => <TabIcon label="Family" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ focused }) => <TabIcon label="Events" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ focused }) => <TabIcon label="Calendar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: "Assistant",
          tabBarIcon: ({ focused }) => <TabIcon label="Assistant" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
