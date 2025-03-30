import React, { createContext, useContext, useMemo } from "react";

function generateId(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substring(2, 15);
}

const SessionUUIDContext = createContext<string | null>(null);

export function SessionUUIDProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Generate the id only once for the whole session subtree.
  const uuid = useMemo(() => generateId(), []);
  return (
    <SessionUUIDContext.Provider value={uuid}>
      {children}
    </SessionUUIDContext.Provider>
  );
}

export function useSessionUUID(): string {
  const uuid = useContext(SessionUUIDContext);
  if (!uuid) {
    throw new Error("useSessionUUID must be used within a SessionUUIDProvider");
  }
  return uuid;
}
