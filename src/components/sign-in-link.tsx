import { githubSignInUrl, POST_SIGN_IN_URL } from "@/lib/site-links";

export function SignInLink({
  className,
  callbackURL = POST_SIGN_IN_URL,
}: {
  className?: string;
  callbackURL?: string;
}) {
  return (
    <a
      href={githubSignInUrl(callbackURL)}
      className={className}
    >
      Sign in
    </a>
  );
}
