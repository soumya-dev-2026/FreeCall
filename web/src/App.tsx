import { useEffect } from "react";
import { AuthProvider, useAuth } from "./state/AuthContext";
import { useCall } from "./state/useCall";
import { usePresence } from "./state/usePresence";
import { LoginScreen } from "./screens/LoginScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { CallScreen } from "./screens/CallScreen";
import { IncomingCallScreen } from "./screens/IncomingCallScreen";
import { SpinnerIcon } from "./components/Icons";
import { registerServiceWorker } from "./lib/push";

function Shell() {
  const { user, socket, loading, connected, logout, updateProfile } = useAuth();
  const call = useCall(socket, user?.id ?? null);
  const { users, loading: usersLoading } = usePresence(socket, Boolean(user));

  // Register the service worker once — needed for push + notification actions.
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  /* ------------------------------------------------- session restoring */
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerIcon className="h-8 w-8 text-accent-400" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  /* ------------------------------------------------------ incoming call */
  if (call.phase === "incoming" && call.incoming) {
    return (
      <IncomingCallScreen
        incoming={call.incoming}
        selfId={user.id}
        onAccept={() => void call.acceptCall()}
        onReject={call.rejectCall}
      />
    );
  }

  /* ------------------------------------------------- active / outgoing */
  if (call.phase === "active" || call.phase === "outgoing") {
    return <CallScreen call={call} self={user} />;
  }

  /* -------------------------------------------------------------- home */
  return (
    <>
      {/* Errors from a failed call attempt surface above the home screen */}
      {call.error && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 animate-slide-up px-4 pt-3 safe-top"
        >
          <div className="mx-auto flex max-w-md items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-100 shadow-xl backdrop-blur">
            <span className="flex-1">{call.error}</span>
            <button
              type="button"
              onClick={call.clearError}
              className="shrink-0 font-medium text-rose-200 underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* A just-ended call leaves a brief note behind */}
      {!call.error && call.statusNote && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 animate-slide-up px-4 pt-3 safe-top"
        >
          <div className="mx-auto max-w-md rounded-xl bg-ink-800/95 px-4 py-2.5 text-center text-sm text-slate-200 shadow-xl ring-1 ring-white/10 backdrop-blur">
            {call.statusNote}
          </div>
        </div>
      )}

      <HomeScreen
        self={user}
        users={users}
        usersLoading={usersLoading}
        connected={connected}
        historyVersion={call.historyVersion}
        onCall={(callees, video) => void call.startCall(callees, video)}
        onLogout={logout}
        onUpdateProfile={updateProfile}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="h-full">
        <Shell />
      </div>
    </AuthProvider>
  );
}
