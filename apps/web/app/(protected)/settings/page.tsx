"use client";

import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light",  label: "Light" },
  { value: "dark",   label: "Dark" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ padding: "24px", maxWidth: "480px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "24px" }}>
        Settings
      </h1>

      <section>
        <h2 style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "12px",
        }}>
          Appearance
        </h2>
        <div style={{
          display: "inline-flex",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}>
          {THEME_OPTIONS.map(({ value, label }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                style={{
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 400,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
