import { createContext, useContext } from "react";

/**
 * Whether the viewer has an account, as the server saw it when rendering the
 * page. It gates the tools that need one (the AI assistant, autocomplete,
 * audio and image generation), and coming from the server they are right on
 * first paint rather than waiting on the client session.
 */
const SignedInContext = createContext<boolean | null>(null);

export const SignedInProvider = SignedInContext.Provider;

export function useSignedIn(): boolean {
  const signedIn = useContext(SignedInContext);
  if (signedIn === null) {
    throw new Error("useSignedIn must be used within a SignedInProvider");
  }
  return signedIn;
}
