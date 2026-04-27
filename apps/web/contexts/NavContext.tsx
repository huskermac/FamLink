"use client";

import { createContext, useContext, useState } from "react";

export type NavOrientation = "sidebar" | "topnav";

interface NavContextValue {
  orientation: NavOrientation;
  setOrientation: (o: NavOrientation) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [orientation, setOrientation] = useState<NavOrientation>("sidebar");
  return (
    <NavContext.Provider value={{ orientation, setOrientation }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNavOrientation(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNavOrientation must be used inside NavProvider");
  return ctx;
}
