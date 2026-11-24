"use client";

import { useActionState } from "react";
import { requestLink } from "./actions";

export function LoginForm() {
  const [result, formAction, sending] = useActionState(requestLink, null);
  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
      </div>
      <div style={{ marginTop: "1rem" }}>
        <button className="button" type="submit" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
      </div>
      {result && <p role="status" className={result.ok ? "message-ok" : "message-error"}>{result.message}</p>}
    </form>
  );
}
