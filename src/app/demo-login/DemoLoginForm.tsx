"use client";

/**
 * Client auth form for registration and credentials-based login.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Handles mode switching between account creation and sign-in.
 */
export default function DemoLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Handles either registration or login depending on selected mode.
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setBusy(false);
        return;
      }

      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          name: username,
        }),
      });

      if (!registerResponse.ok) {
        const payload = (await registerResponse.json().catch(() => ({ message: "Registration failed" }))) as {
          message?: string;
        };
        setError(payload.message ?? "Registration failed.");
        setBusy(false);
        return;
      }

      setSuccess("Registration successful. You can now log in.");
      setMode("login");
      setBusy(false);
      return;
    }

    const result = await signIn("credentials", {
      identifier: username.trim(),
      password,
      callbackUrl,
      redirect: false,
    });

    if (!result) {
      setError("Login failed. No response from auth server.");
      setBusy(false);
      return;
    }

    if (result.error) {
      setError("Login failed. Check username/email and password.");
      setBusy(false);
      return;
    }

    // Navigate only after NextAuth confirms successful credentials exchange.
    window.location.assign(result.url ?? callbackUrl);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <form className="w-full rounded-xl border border-slate-300 bg-white p-6 shadow-sm" onSubmit={onSubmit}>
        <h1 className="text-xl font-semibold text-slate-900">Demo Login</h1>
        <p className="mt-2 text-sm text-slate-700">
          Auth.js-backed login and registration. User records are persisted in the User table.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setSuccess(null);
            }}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              mode === "login" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-900"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
              setSuccess(null);
            }}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              mode === "register" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-900"
            }`}
          >
            Register
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-900">
              {mode === "login" ? "Username or Email" : "Username"}
            </label>
            <input
              id="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder={mode === "login" ? "alice or alice@example.com" : "alice"}
            />
          </div>
          {mode === "register" ? (
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-900">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="alice@example.com"
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-900">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="demo-password"
            />
          </div>
          {mode === "register" ? (
            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-slate-900">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="repeat password"
              />
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Working..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}
        <p className="mt-3 text-xs text-slate-600">
          You can register multiple users, then sign in as each and message between accounts.
        </p>
      </form>
    </div>
  );
}
