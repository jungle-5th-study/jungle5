import { createContext, useContext } from "react";
import type { Me } from "../../shared/api";

export const SessionContext = createContext<Me | null>(null);

/** The logged-in member. Only usable below the authenticated app shell. */
export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used inside the authenticated app shell");
  return me;
}
