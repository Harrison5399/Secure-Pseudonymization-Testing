"use client";

/**
 * Client messaging UI for listing users, sending messages, and viewing inbox/outbox.
 */

import { useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";

type UserItem = {
  id: string;
  username: string;
  name: string | null;
  email: string;
};

type MessageItem = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string; name: string | null };
  recipient: { id: string; username: string; name: string | null };
};

export default function MessagesClient({
  currentUser,
}: {
  currentUser: { id: string; usernameOrName: string; email: string | null };
}) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshData() {
    // Reads available users and message history for current session user.
    const [usersRes, messagesRes] = await Promise.all([fetch("/api/users"), fetch("/api/messages")]);

    if (usersRes.ok) {
      const usersPayload = (await usersRes.json()) as { users: UserItem[] };
      setUsers(usersPayload.users);
      if (!recipientId && usersPayload.users.length > 0) {
        setRecipientId(usersPayload.users[0].id);
      }
    }

    if (messagesRes.ok) {
      const messagesPayload = (await messagesRes.json()) as { messages: MessageItem[] };
      setMessages(messagesPayload.messages);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    // Sends one message then refreshes local UI state from APIs.
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId, content }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: "Failed to send message" }))) as {
        message?: string;
      };
      setError(payload.message ?? "Failed to send message");
      setBusy(false);
      return;
    }

    setContent("");
    await refreshData();
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
      <header className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">User Messaging Demo</h1>
        <p className="mt-2 text-sm text-slate-700">
          Messages are tied to real Auth.js user IDs from the User table.
        </p>
        <div className="mt-3 rounded-md bg-slate-100 p-3 text-sm text-slate-800">
          Logged in as: {currentUser.usernameOrName} ({currentUser.email ?? "no-email"}) | userId: {currentUser.id}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void refreshData()}
            className="rounded-md border border-slate-400 px-3 py-2 text-sm font-semibold text-slate-900"
          >
            Refresh Users and Messages
          </button>
          <Link href="/e2ee-client-side-encryption" className="rounded-md border border-slate-400 px-3 py-2 text-sm font-semibold text-slate-900">
            Back to E2EE Demo
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/demo-login" })}
            className="rounded-md border border-slate-400 px-3 py-2 text-sm font-semibold text-slate-900"
          >
            Sign Out
          </button>
        </div>
      </header>

      <section className="mt-4 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Compose Message</h2>
        <form className="mt-3 space-y-3" onSubmit={sendMessage}>
          <div>
            <label htmlFor="recipient" className="mb-1 block text-sm font-medium text-slate-900">
              Recipient
            </label>
            <select
              id="recipient"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
              required
            >
              <option value="">Select a user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} ({user.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="content" className="mb-1 block text-sm font-medium text-slate-900">
              Message
            </label>
            <textarea
              id="content"
              className="h-28 w-full rounded-md border border-slate-300 px-3 py-2"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? "Sending..." : "Send"}
          </button>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </form>
      </section>

      <section className="mt-4 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Inbox + Outbox</h2>
        <div className="mt-3 space-y-2">
          {messages.length === 0 ? <p className="text-sm text-slate-600">No messages yet.</p> : null}
          {messages.map((message) => {
            const direction = message.senderId === currentUser.id ? "Sent" : "Received";
            return (
              <article key={message.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-semibold text-slate-900">{direction}</p>
                <p className="text-slate-700">
                  From: {message.sender.username} ({message.sender.id})
                </p>
                <p className="text-slate-700">
                  To: {message.recipient.username} ({message.recipient.id})
                </p>
                <p className="mt-2 text-slate-900">{message.content}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(message.createdAt).toLocaleString()}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
