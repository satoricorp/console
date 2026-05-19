import { AuthButton } from "@/components/auth-button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Console
        </h1>
        <AuthButton />
      </div>
    </main>
  );
}
