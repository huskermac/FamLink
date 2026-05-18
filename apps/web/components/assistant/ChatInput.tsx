"use client";

import { useRef, type KeyboardEvent, type FormEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat input textarea. Enter sends the message; Shift+Enter inserts a newline.
 */
export function ChatInput({ onSend, disabled = false, placeholder = "Ask about your family…" }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function submit() {
    const text = ref.current?.value.trim() ?? "";
    if (!text || disabled) return;
    onSend(text);
    if (ref.current) ref.current.value = "";
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
        aria-label="Chat message"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        style={{ background: "var(--accent)" }}
      >
        Send
      </button>
    </form>
  );
}
