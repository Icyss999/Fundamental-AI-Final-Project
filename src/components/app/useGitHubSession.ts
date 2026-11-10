import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth/client";

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubSession {
  status: "loading" | "ready";
  /** Whether GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are set on the server. */
  configured: boolean;
  user: GitHubUser | null;
  error: string | null;
}

/** Better Auth sends failed sign-ins back with `?error=<code>`; these are the codes worth explaining. */
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "GitHub sign-in was cancelled.",
  state_mismatch: "GitHub sign-in expired or was interrupted. Please try again.",
  state_not_found: "GitHub sign-in expired or was interrupted. Please try again.",
  please_restart_the_process: "GitHub sign-in expired or was interrupted. Please try again.",
  invalid_code: "GitHub rejected the sign-in. Check GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
  redirect_uri_mismatch: "The callback URL doesn't match the one registered on your GitHub app.",
  email_not_found: "GitHub didn't share an email address for this account, so sign-in could not finish.",
  unable_to_get_user_info: "Signed in, but GitHub did not return your profile. Please try again.",
};

export function signInErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `GitHub sign-in failed (${code.replace(/_/g, " ")}).`;
}

// The query string, read in a hydration-safe way (empty on the server).
const subscribeToLocation = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};
const readSearch = () => window.location.search;
const readSearchOnServer = () => "";

export function useGitHubSession() {
  const { data, isPending } = authClient.useSession();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const search = useSyncExternalStore(subscribeToLocation, readSearch, readSearchOnServer);
  const errorCode = new URLSearchParams(search).get("error");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/github/status")
      .then((r) => r.json())
      .then((d) => !cancelled && setConfigured(Boolean(d.configured)))
      .catch(() => !cancelled && setConfigured(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(() => {
    void authClient.signIn.social({ provider: "github", callbackURL: "/", errorCallbackURL: "/" });
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
  }, []);

  const dismissError = useCallback(() => {
    // Drop ?error=… so a reload doesn't show it again.
    window.history.replaceState(null, "", window.location.pathname);
    setErrorDismissed(true);
  }, []);

  const user = data?.user
    ? {
        login: data.user.login ?? data.user.name,
        name: data.user.name ?? null,
        avatarUrl: data.user.image ?? null,
      }
    : null;

  const session: GitHubSession = {
    status: isPending || configured === null ? "loading" : "ready",
    configured: configured ?? false,
    user,
    error: errorCode && !errorDismissed ? signInErrorMessage(errorCode) : null,
  };
  return { ...session, signIn, signOut, dismissError };
}
