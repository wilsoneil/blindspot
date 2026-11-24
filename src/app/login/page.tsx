import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import { SetupNotice } from "../setup-notice";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Blindspot" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const ctx = await getAppContext();
  if (ctx.status === "ready") redirect("/");
  if (ctx.status === "not-configured") return <SetupNotice ctx={ctx} />;

  const { error } = await searchParams;
  return (
    <section className="card">
      <h1>Sign in</h1>
      {error && (
        <p className="message-error">That sign-in link didn&apos;t work. It may have expired or already been used: ask for a new one.</p>
      )}
      <p className="muted">No password needed: you&apos;ll get a one-tap link by email.</p>
      <LoginForm />
    </section>
  );
}
