/* Auth0 sign-in, optional. With no VITE_AUTH0_* values the app runs in "local mode":
   no sign-in, and saved plans stay in this browser. Only the token's holder is trusted by
   the server; the browser never decides who a user is. */
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import type { ReactNode } from "react";

const DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN;
const CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID;
const AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE;

/** Fixed at build time, so the hooks below are called the same way on every render. */
export const AUTH_ENABLED = Boolean(DOMAIN && CLIENT_ID && AUDIENCE);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return (
    <Auth0Provider
      domain={DOMAIN!}
      clientId={CLIENT_ID!}
      authorizationParams={{ redirect_uri: window.location.origin, audience: AUDIENCE }}
      useRefreshTokens
      cacheLocation="localstorage"
      onRedirectCallback={(appState) => {
        // Hash routes: go back to the page the person was on before signing in.
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + (appState?.returnTo || "#/hotspots"),
        );
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
    >
      {children}
    </Auth0Provider>
  );
}

export interface AuthApi {
  enabled: boolean;
  ready: boolean;
  signedIn: boolean;
  label: string;
  login: () => void;
  logout: () => void;
  getToken: () => Promise<string | null>;
}

const LOCAL: AuthApi = {
  enabled: false,
  ready: true,
  signedIn: false,
  label: "",
  login: () => undefined,
  logout: () => undefined,
  getToken: async () => null,
};

export function useAuth(): AuthApi {
  if (!AUTH_ENABLED) return LOCAL;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const a = useAuth0();
  return {
    enabled: true,
    ready: !a.isLoading,
    signedIn: a.isAuthenticated,
    label: a.user?.name || a.user?.email || "Signed in",
    login: () => void a.loginWithRedirect({ appState: { returnTo: window.location.hash } }),
    logout: () => void a.logout({ logoutParams: { returnTo: window.location.origin } }),
    getToken: async () => {
      try {
        return await a.getAccessTokenSilently();
      } catch {
        return null;
      }
    },
  };
}

/** Sign in / out in the header. Renders nothing in local mode. */
export function AuthControls() {
  const a = useAuth();
  if (!a.enabled) return null;
  return (
    <div className="who">
      {a.signedIn ? (
        <>
          <span className="who-org" title={a.label}>
            {a.label}
          </span>
          <button className="who-out" onClick={a.logout}>
            Sign out
          </button>
        </>
      ) : (
        <button className="who-out" onClick={a.login} disabled={!a.ready}>
          Sign in
        </button>
      )}
    </div>
  );
}
