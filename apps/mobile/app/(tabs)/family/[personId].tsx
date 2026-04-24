import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { usePerson, usePersonRelationships } from "../../../hooks/useFamily";
import type { ReactElement } from "react";

const RELATIONSHIP_LABELS: Record<string, string> = {
  SPOUSE: "Spouse", PARTNER: "Partner", EX_SPOUSE: "Ex-spouse",
  PARENT: "Parent", CHILD: "Child", STEP_PARENT: "Step-parent",
  STEP_CHILD: "Step-child", ADOPTIVE_PARENT: "Adoptive parent",
  ADOPTIVE_CHILD: "Adoptive child", SIBLING: "Sibling",
  HALF_SIBLING: "Half-sibling", STEP_SIBLING: "Step-sibling",
  GRANDPARENT: "Grandparent", GRANDCHILD: "Grandchild",
  AUNT_UNCLE: "Aunt/Uncle", NIECE_NEPHEW: "Niece/Nephew",
  COUSIN: "Cousin", CAREGIVER: "Caregiver",
  GUARDIAN: "Guardian", FAMILY_FRIEND: "Family friend",
};

export default function PersonProfile(): ReactElement {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const personQuery = usePerson(personId);
  const relQuery = usePersonRelationships(personId);

  if (personQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  const person = personQuery.data;
  if (!person) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Person not found.</Text>
      </View>
    );
  }

  const name = person.preferredName?.trim() || `${person.firstName} ${person.lastName}`.trim();
  const dob = person.dateOfBirth
    ? new Date(person.dateOfBirth).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="items-center mb-8">
        <View className="w-20 h-20 rounded-full bg-indigo-600 items-center justify-center mb-4">
          <Text className="text-white text-3xl font-semibold">
            {person.firstName[0]}{person.lastName[0]}
          </Text>
        </View>
        <Text className="text-slate-50 text-xl font-bold">{name}</Text>
        {name !== `${person.firstName} ${person.lastName}`.trim() && (
          <Text className="text-slate-400 text-sm mt-1">
            {person.firstName} {person.lastName}
          </Text>
        )}
      </View>

      {dob && (
        <View className="bg-slate-800 rounded-xl px-4 py-3 mb-4">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Birthday</Text>
          <Text className="text-slate-50">{dob}</Text>
        </View>
      )}

      {relQuery.data && relQuery.data.length > 0 && (
        <View className="bg-slate-800 rounded-xl px-4 py-3">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Relationships</Text>
          {relQuery.data.map((rel, i, arr) => (
            <View key={rel.id} className={`flex-row justify-between py-2${i < arr.length - 1 ? " border-b border-slate-700" : ""}`}>
              <Text className="text-slate-50">{rel.relatedPerson.displayName}</Text>
              <Text className="text-slate-400 text-sm">{RELATIONSHIP_LABELS[rel.type] ?? rel.type}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
