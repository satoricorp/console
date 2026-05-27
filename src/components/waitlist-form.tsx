"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/button";

export function WaitlistForm() {
  const joinWaitlist = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await joinWaitlist({ email });
      setSubmitted(true);
      if (!result.alreadyJoined) {
        setEmail("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join waitlist");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300">
        You&apos;re on the list. We&apos;ll email you when Console opens.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="w-full space-y-3">
      <label htmlFor="waitlist-email" className="sr-only">
        Email
      </label>
      <input
        id="waitlist-email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        className="w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-900/10 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300"
      />
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <Button type="submit" fullWidth disabled={submitting}>
        {submitting ? "Joining…" : "Join waitlist"}
      </Button>
    </form>
  );
}
