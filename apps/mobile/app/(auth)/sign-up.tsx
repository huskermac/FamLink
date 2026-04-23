import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSignUp } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import type { ReactElement } from "react";

export default function SignUp(): ReactElement {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signUp.create({ firstName, lastName, emailAddress: email, password });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)/events");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = firstName && lastName && email && password && !loading;

  return (
    <View className="flex-1 bg-slate-950 px-6 justify-center">
      <Text className="text-2xl font-bold text-slate-50 mb-8">Create your account</Text>

      {error && (
        <View className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-300 text-sm">{error}</Text>
        </View>
      )}

      <View className="flex-row gap-3 mb-4">
        <View className="flex-1">
          <Text className="text-slate-400 text-sm mb-1">First name</Text>
          <TextInput
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            placeholderTextColor="#64748b"
            placeholder="Jane"
          />
        </View>
        <View className="flex-1">
          <Text className="text-slate-400 text-sm mb-1">Last name</Text>
          <TextInput
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            placeholderTextColor="#64748b"
            placeholder="Smith"
          />
        </View>
      </View>

      <Text className="text-slate-400 text-sm mb-1">Email</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-4"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        placeholderTextColor="#64748b"
        placeholder="you@example.com"
      />

      <Text className="text-slate-400 text-sm mb-1">Password</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-6"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholderTextColor="#64748b"
        placeholder="••••••••"
      />

      <TouchableOpacity
        onPress={handleSignUp}
        disabled={!canSubmit}
        className="bg-indigo-600 rounded-lg py-3 items-center mb-4"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Create account</Text>
        )}
      </TouchableOpacity>

      <Link href="/(auth)/sign-in" asChild>
        <TouchableOpacity className="items-center">
          <Text className="text-slate-400">
            Already have an account?{" "}
            <Text className="text-indigo-400">Sign in</Text>
          </Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}
