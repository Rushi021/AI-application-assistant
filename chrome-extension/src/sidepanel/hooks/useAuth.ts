import { useCallback, useState } from "react";
import { STORAGE_KEYS, MSG } from "@/shared/constants";
import { buildAutofillAnswersFromProfile } from "@/shared/autofill-answers";
import { ApiError, getProfile } from "../services/api";
import { useAppStore } from "../store";

function mapAuthError(err: unknown): string {
  // Service worker passes { error, status? } but they arrive as plain objects after message passing.
  // Handle the two known status codes explicitly.
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
    if (m.includes("not configured")) return m; // surface config errors directly
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
   * Sign in with Google.
   * The service worker opens Google's consent screen via chrome.identity.launchWebAuthFlow,
   * exchanges the auth code with the backend, and returns app JWT tokens directly.
   * No Google client secret ever touches the extension.
   */
  const signInWithGoogle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response: { tokens?: { access_token: string; refresh_token?: string; is_new_user: boolean }; error?: string; status?: number } =
        await chrome.runtime.sendMessage({ type: MSG.GET_AUTH_TOKEN });

      if (!response) {
        throw new Error("No response from extension background. Try reloading the extension.");
      }

      if (response.error) {
        // Surface 403 with admin-specific copy; everything else passes through.
        if (response.status === 403 || response.error.toLowerCase().includes("access denied")) {
          throw new ApiError(403, response.error);
        }
        throw new Error(response.error);
      }

      if (!response.tokens?.access_token) {
        throw new Error("Sign-in did not return valid tokens. Try again.");
      }

      await completeLogin(response.tokens);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
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
