import { useState } from "react";
import { useAuth } from "../state/AuthContext";
import { SpinnerIcon } from "../components/Icons";
import { Avatar } from "../components/Avatar";

type Mode = "login" | "register";

const DEMO_ACCOUNTS = ["alice", "bob", "carol"];

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await register({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          password,
          avatarUrl: avatarUrl.trim() || undefined,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const quickLogin = async (name: string) => {
    setError(null);
    setBusy(true);
    setUsername(name);
    setPassword("password");
    try {
      await login(name, "password");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* ambient background wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(58rem 40rem at 18% -8%, rgba(91,124,250,0.28), transparent 60%)," +
            "radial-gradient(46rem 34rem at 108% 108%, rgba(160,120,255,0.20), transparent 62%)",
        }}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-12 safe-top safe-bottom">
        <header className="mb-9 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-accent-600 to-violet-500 shadow-xl shadow-accent-500/25">
            <svg
              className="h-9 w-9 text-white"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.56.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.56 1 1 0 0 1-.25 1.02l-2.2 2.21z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">FreeCall</h1>
          <p className="mt-2 text-sm text-slate-400">
            Free audio &amp; video calls, one-to-one or in groups.
          </p>
        </header>

        {/* mode switch */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-800/70 p-1 text-sm font-medium">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={
                mode === m
                  ? "rounded-lg bg-accent-500 py-2 text-white shadow"
                  : "rounded-lg py-2 text-slate-400 hover:text-slate-200 transition"
              }
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Username
            </label>
            <input
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>

          {mode === "register" && (
            <div className="animate-slide-up">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Display name
              </label>
              <input
                className="field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alice Nguyen"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Password
            </label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "register" ? 6 : undefined}
            />
          </div>

          {mode === "register" && (
            <div className="animate-slide-up">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Avatar image URL{" "}
                <span className="text-slate-500">
                  — optional, shown when you call people
                </span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  className="field"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://…/me.jpg"
                  inputMode="url"
                  spellCheck={false}
                />
                <Avatar
                  src={avatarUrl || undefined}
                  name={displayName || username || "?"}
                  id={username}
                  size="h-12 w-12"
                  ring
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Leave blank and we'll generate one for you.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full !py-3 !text-base"
            disabled={busy}
          >
            {busy && <SpinnerIcon />}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "login" && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-wider text-slate-500">
                Demo accounts
              </span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void quickLogin(name)}
                  disabled={busy}
                  className="btn-ghost flex-col !gap-1.5 !py-3 capitalize"
                >
                  <Avatar name={name} id={name} size="h-8 w-8" />
                  <span className="text-xs">{name}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Open two of these in separate browser windows to try a call.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
