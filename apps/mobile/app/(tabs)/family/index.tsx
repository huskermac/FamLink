import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies, useMembers, type FamilyMember } from "../../../hooks/useFamily";
import type { ReactElement } from "react";

function displayName(member: FamilyMember): string {
  const p = member.person;
  return p.preferredName?.trim() || `${p.firstName} ${p.lastName}`.trim();
}

export default function FamilyIndex(): ReactElement {
  const router = useRouter();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const membersQuery = useMembers(familyId);

  if (familiesQuery.isLoading || membersQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (membersQuery.isError) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Failed to load family members.</Text>
      </View>
    );
  }

  const members = membersQuery.data?.members ?? [];

  return (
    <View className="flex-1 bg-slate-950">
      <FlatList
        data={members}
        keyExtractor={(item) => item.person.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/family/${item.person.id}`)}
            className="bg-slate-800 rounded-xl px-4 py-4 flex-row items-center gap-4"
          >
            <View className="w-10 h-10 rounded-full bg-indigo-600 items-center justify-center">
              <Text className="text-white font-semibold text-base">
                {item.person.firstName[0]}{item.person.lastName[0]}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-slate-50 font-medium">{displayName(item)}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
