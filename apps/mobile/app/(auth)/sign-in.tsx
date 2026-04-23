import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSignIn } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import type { ReactElement } from "react";

export default function SignIn(): ReactElement {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn.create({ identifier: email, password });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)/events");
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message: string }> };
      const msg = clerkErr.errors?.[0]?.message ?? (err instanceof Error ? err.message : "Sign in failed");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-slate-950 px-6 justify-center">
      <Text className="text-2xl font-bold text-slate-50 mb-8">Sign in to FamLink</Text>

      {error && (
        <View className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-300 text-sm">{error}</Text>
        </View>
      )}

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
        autoComplete="current-password"
        placeholderTextColor="#64748b"
        placeholder="••••••••"
      />

      <TouchableOpacity
        onPress={handleSignIn}
        disabled={loading || !email || !password}
        style={{ opacity: loading || !email || !password ? 0.5 : 1 }}
        className="bg-indigo-600 rounded-lg py-3 items-center mb-4"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Sign in</Text>
        )}
      </TouchableOpacity>

      <Link href="/(auth)/sign-up" asChild>
        <TouchableOpacity className="items-center">
          <Text className="text-slate-400">
            No account?{" "}
            <Text className="text-indigo-400">Sign up</Text>
          </Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}
