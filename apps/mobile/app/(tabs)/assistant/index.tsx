import { useRef, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useMyFamilies } from "../../../hooks/useFamily";
import { API_BASE } from "../../../lib/config";
import type { ReactElement } from "react";

export default function AssistantScreen(): ReactElement {
  const { getToken } = useAuth();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const [inputText, setInputText] = useState("");
  const listRef = useRef<FlatList<UIMessage>>(null);

  const transport = new DefaultChatTransport({
    api: `${API_BASE}/api/v1/ai/chat`,
    headers: async () => {
      const token = await getToken();
      return { Authorization: `Bearer ${token ?? ""}` };
    },
    prepareSendMessagesRequest: async ({ id, messages, body }) => {
      const lastMsg = messages[messages.length - 1];
      const text = (lastMsg?.parts ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      return {
        body: {
          messages: [{ role: "user", content: text }],
          conversationId: id,
          ...(body as object | undefined),
        },
      };
    },
  });

  const { messages, status, sendMessage } = useChat({ transport });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  function handleSend() {
    if (!inputText.trim() || !familyId || isStreaming) return;
    void sendMessage({ text: inputText.trim() }, { body: { familyGroupId: familyId } });
    setInputText("");
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-12">
            <Text className="text-slate-400 text-center">Ask about your family — events, birthdays, who's coming…</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isUser = item.role === "user";
          const textContent = (item.parts ?? [])
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("");

          return (
            <View className={`mb-3 flex-row ${isUser ? "justify-end" : "justify-start"}`}>
              <View
                className={`rounded-2xl px-4 py-3 max-w-[80%] ${
                  isUser ? "bg-indigo-600" : "bg-slate-800"
                }`}
              >
                <Text className={isUser ? "text-white" : "text-slate-50"}>{textContent}</Text>
              </View>
            </View>
          );
        }}
      />

      {isStreaming && (
        <View className="px-4 pb-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#6366f1" />
          <Text className="text-slate-400 text-sm">Thinking…</Text>
        </View>
      )}

      <View className="flex-row items-center gap-3 px-4 py-3 border-t border-slate-800">
        <TextInput
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-50"
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about your family…"
          placeholderTextColor="#64748b"
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!inputText.trim() || isStreaming || !familyId}
          className="bg-indigo-600 rounded-xl p-3 disabled:opacity-50"
        >
          <Text className="text-white font-semibold">↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
