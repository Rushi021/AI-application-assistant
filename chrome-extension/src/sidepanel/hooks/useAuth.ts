import { useCallback, useState } from "react";
import { STORAGE_KEYS, MSG } from "@/shared/constants";
import { buildAutofillAnswersFromProfile } from "@/shared/autofill-answers";
import { ApiError, authGoogle, getProfile } from "../services/api";
import { useAppStore } from "../store";

function mapChromeIdentityError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("did not approve") || m.includes("canceled") || m.includes("cancelled") || m.includes("user closed")) {
    return "Sign-in was cancelled. Try again and approve access when Google asks.";
  }
  if (m.includes("blocked") || m.includes("popup")) {
    return "The sign-in window was blocked. Allow popups for this extension and try again.";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("internet")) {
    return "Network error while contacting Google. Check your connection and try again.";
  }
  if (m.includes("oauth2") || m.includes("token")) {
    return `Google sign-in failed: ${message}`;
  }
  return message || "Google sign-in failed. Please try again.";
}

function mapAuthError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return "Access denied. Your email is not activated by an administrator yet. Ask an admin to activate your account.";
    }
    if (err.status === 401) {
      return "Session expired or invalid. Try signing in again.";
    }
    return err.message || `Sign-in failed (${err.status}).`;
  }
  if (err instanceof Error) {
    return mapChromeIdentityError(err.message);
  }
  return "Sign-in failed. Please try again.";
}

export function useAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setAuthenticated, setProfile, setPage } = useAppStore();

  /**
   * Complete the login flow after receiving JWT tokens from any auth method.
   */
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
   * Sign in with Google via Chrome Identity API.
   * Requires a valid OAuth2 client_id in manifest.json.
   */
  const signInWithGoogle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Belt-and-suspenders: if the background never calls sendResponse (e.g. SW bug), don't hang forever.
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: MSG.GET_AUTH_TOKEN }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "The extension did not get a response from Google sign-in in time. Reload the extension, confirm oauth2.client_id in manifest.json matches Google Cloud Console for this extension ID, then try again."
                )
              ),
            125_000
          )
        ),
      ]);
      if (response && typeof response === "object" && "error" in response && response.error) {
        throw new Error(mapChromeIdentityError(String(response.error)));
      }
      if (!response || typeof response !== "object" || !("token" in response) || !response.token) {
        throw new Error("Google sign-in did not return a token. Try again.");
      }

      const tokens = await authGoogle(response.token as string, "access_token");
      await completeLogin(tokens);
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
