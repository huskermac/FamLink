import { Redirect } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { View, ActivityIndicator } from "react-native";
import type { ReactElement } from "react";

export default function Index(): ReactElement {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return <Redirect href={isSignedIn ? "/(tabs)/events" : "/(auth)/sign-in"} />;
}
