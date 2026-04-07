import { useCallback, useState } from "react";
import { STORAGE_KEYS, GOOGLE_CLIENT_ID } from "@/shared/constants";
import { buildAutofillAnswersFromProfile } from "@/shared/autofill-answers";
import { ApiError, exchangeExtensionGoogleCode, getProfile } from "../services/api";
import { useAppStore } from "../store";

function mapAuthError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return "Access denied. Your email is not activated by an administrator yet.";
    }
    if (err.status === 401) {
      return "Session expired. Try signing in again.";
    }
    return err.message || `Sign-in failed (${err.status}).`;
  }
  if (err instanceof Error) {
    const m = err.message;
    if (m.includes("Access denied") || m.includes("access denied")) {
      return "Access denied. Your email is not activated by an administrator yet.";
    }
    if (m.includes("not configured")) return m;
    if (m.toLowerCase().includes("did not approve") || m.toLowerCase().includes("cancel")) {
      return "Sign-in was cancelled. Try again and approve access when Google asks.";
    }
    return m || "Sign-in failed. Please try again.";
  }
  return "Sign-in failed. Please try again.";
}

export function useAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setAuthenticated, setProfile, setPage } = useAppStore();

  const completeLogin = useCallback(
    async (tokens: { access_token: string; refresh_token?: string; is_new_user: boolean }) => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.ACCESS_TOKEN]: tokens.access_token,
        ...(tokens.refresh_token ? { [STORAGE_KEYS.REFRESH_TOKEN]: tokens.refresh_token } : {}),
      });

      const stored = await chrome.storage.local.get([STORAGE_KEYS.SESSION_ID]);
      if (!stored[STORAGE_KEYS.SESSION_ID]) {
        await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_ID]: crypto.randomUUID() });
      }

      setAuthenticated(true);

      const profile = await getProfile();
      setProfile(profile);

      await chrome.storage.local.set({
        [STORAGE_KEYS.USER_PROFILE]: profile,
        [STORAGE_KEYS.AUTOFILL_ANSWERS]: buildAutofillAnswersFromProfile(profile),
      });

      if (tokens.is_new_user || !profile.full_name) {
        setPage("profile-setup");
      } else {
        setPage("job-description");
      }
    },
    [setAuthenticated, setProfile, setPage]
  );

  /**
   * Sign in with Google. `launchWebAuthFlow` MUST be invoked synchronously from the button click
   * (not after sendMessage / await), or Chrome will not show the account picker.
   */
  const signInWithGoogle = useCallback(() => {
    setError(null);
    if (!GOOGLE_CLIENT_ID.trim()) {
      setError(
        "Google OAuth client ID is not configured. Set VITE_GOOGLE_CLIENT_ID in chrome-extension/.env, rebuild, and reload the extension."
      );
      return;
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "select_account",
      }).toString();

    // Open OAuth first, then set loading — avoids React state flush consuming user activation before the popup.
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      void (async () => {
        try {
          if (chrome.runtime.lastError?.message) {
            setError(mapAuthError(new Error(chrome.runtime.lastError.message)));
            return;
          }
          if (!redirectUrl) {
            setError("Google sign-in was cancelled.");
            return;
          }

          const url = new URL(redirectUrl);
          const errParam = url.searchParams.get("error");
          if (errParam) {
            setError(`Google sign-in error: ${errParam}`);
            return;
          }

          const code = url.searchParams.get("code");
          if (!code) {
            setError("Google sign-in did not return an authorization code.");
            return;
          }

          const tokens = await exchangeExtensionGoogleCode(code, redirectUri);
          await completeLogin(tokens);
        } catch (err) {
          setError(mapAuthError(err));
        } finally {
          setLoading(false);
        }
      })();
    });

    setLoading(true);
  }, [completeLogin]);

  const signOut = useCallback(async () => {
    await chrome.storage.local.remove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_PROFILE,
    ]);
    setAuthenticated(false);
    setProfile(null);
    await chrome.storage.local.remove([STORAGE_KEYS.AUTOFILL_ANSWERS]);
    setPage("login");
  }, [setAuthenticated, setProfile, setPage]);

  return { signInWithGoogle, signOut, loading, error };
}
