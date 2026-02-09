import { useCallback, useState } from "react";
import { STORAGE_KEYS, MSG } from "@/shared/constants";
import { authGoogle, devLogin, getProfile } from "../services/api";
import { useAppStore } from "../store";

export function useAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setAuthenticated, setProfile, setPage } = useAppStore();

  /**
   * Complete the login flow after receiving JWT tokens from any auth method.
   */
  const completeLogin = useCallback(
    async (tokens: { access_token: string; refresh_token?: string; is_new_user: boolean }) => {
      // Store tokens
      await chrome.storage.local.set({
        [STORAGE_KEYS.ACCESS_TOKEN]: tokens.access_token,
        ...(tokens.refresh_token ? { [STORAGE_KEYS.REFRESH_TOKEN]: tokens.refresh_token } : {}),
      });

      // Ensure session ID exists
      const stored = await chrome.storage.local.get([STORAGE_KEYS.SESSION_ID]);
      if (!stored[STORAGE_KEYS.SESSION_ID]) {
        await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_ID]: crypto.randomUUID() });
      }

      setAuthenticated(true);

      // Fetch profile
      const profile = await getProfile();
      setProfile(profile);

      // Cache profile for content script access
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: profile });

      // Navigate based on whether user is new
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
      // Get Google access token via Chrome Identity API
      const response = await chrome.runtime.sendMessage({ type: MSG.GET_AUTH_TOKEN });
      if (response.error) throw new Error(response.error);

      // Exchange for our JWT
      const tokens = await authGoogle(response.token, "access_token");
      await completeLogin(tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }, [completeLogin]);

  /**
   * Dev login — skip Google OAuth entirely.
   * Only works when the backend is running in development mode.
   */
  const devSignIn = useCallback(
    async (email: string, fullName: string = "") => {
      setLoading(true);
      setError(null);

      try {
        const tokens = await devLogin(email, fullName);
        await completeLogin(tokens);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Dev login failed. Is the backend running?");
      } finally {
        setLoading(false);
      }
    },
    [completeLogin]
  );

  const signOut = useCallback(async () => {
    await chrome.storage.local.remove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_PROFILE,
    ]);
    setAuthenticated(false);
    setProfile(null);
    setPage("login");
  }, [setAuthenticated, setProfile, setPage]);

  return { signInWithGoogle, devSignIn, signOut, loading, error };
}
