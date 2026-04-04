import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, LogIn, LogOut, Settings, User } from "lucide-react";
import { USER_APP_URL } from "@/shared/constants";
import { useAuth } from "../hooks/useAuth";
import { useAppStore } from "../store";

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function AccountMenu() {
  const { isAuthenticated, profile, setPage } = useAppStore();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const displayName = useMemo(() => {
    const fullName = profile?.full_name?.trim();
    if (fullName) return fullName;
    return profile?.email?.trim() || "User";
  }, [profile]);

  const displayEmail = profile?.email?.trim() || "No email";
  const initials = getInitials(profile?.full_name, profile?.email);

  const openUserApp = () => {
    chrome.tabs.create({ url: USER_APP_URL });
    setOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="p-1.5 rounded-md text-wf-muted hover:text-wf-text hover:bg-wf-surfaceHover transition-colors"
        aria-label="Open account menu"
      >
        <Settings className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[236px] rounded-xl border border-wf-borderBright bg-wf-surface shadow-xl z-50 p-1">
          {isAuthenticated ? (
            <>
              <div className="px-2 py-2 flex items-center gap-2">
                {profile?.picture_url ? (
                  <img
                    src={profile.picture_url}
                    alt="Profile"
                    className="w-8 h-8 rounded-full object-cover border border-wf-border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary-500/20 text-primary-400 text-xs font-semibold flex items-center justify-center border border-primary-500/30">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-wf-text truncate">{displayName}</p>
                  <p className="text-[11px] text-wf-muted truncate">{displayEmail}</p>
                </div>
              </div>

              <div className="h-px my-1 bg-wf-border" />

              <button
                type="button"
                onClick={openUserApp}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-wf-text rounded-lg hover:bg-wf-surfaceHover transition-colors"
              >
                <User className="w-4 h-4 text-wf-muted" />
                <span>My Profile</span>
              </button>
              <button
                type="button"
                onClick={openUserApp}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-wf-text rounded-lg hover:bg-wf-surfaceHover transition-colors"
              >
                <BarChart3 className="w-4 h-4 text-wf-muted" />
                <span>Track Applications</span>
              </button>

              <div className="h-px my-1 bg-wf-border" />

              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPage("login");
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-wf-text rounded-lg hover:bg-wf-surfaceHover transition-colors"
            >
              <LogIn className="w-4 h-4 text-wf-muted" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
