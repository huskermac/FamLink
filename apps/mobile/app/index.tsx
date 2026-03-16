import { Text, View } from "react-native";
import type { ReactElement } from "react";

export default function HomeScreen(): ReactElement {
  return (
    <View className="flex-1 items-center justify-center bg-slate-950">
      <Text className="text-lg font-semibold text-slate-50">FamLink mobile app</Text>
      <Text className="mt-2 text-slate-400">NativeWind-powered styling is ready to use.</Text>
    </View>
  );
}
