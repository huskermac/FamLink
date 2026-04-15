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
        className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Chat message"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        Send
      </button>
    </form>
  );
}
