// apps/web/lib/nav.ts

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",    href: "/dashboard",  icon: "⊞" },
  { label: "Events",       href: "/events",     icon: "📅",        children: [] },
  { label: "Family",       href: "/family",     icon: "👨‍👩‍👧", children: [] },
  { label: "Calendar",     href: "/calendar",   icon: "🗓" },
  { label: "AI Assistant", href: "/assistant",  icon: "✦" },
];
