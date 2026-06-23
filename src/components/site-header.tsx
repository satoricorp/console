"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DiscordIcon } from "@/components/discord-icon";
import { AppCommandPalette } from "@/components/app-command-palette";
import { AppSupportLinks } from "@/components/app-support-links";
import { GitHubIcon } from "@/components/github-icon";
import { GxLogo } from "@/components/gx-logo";
import { HeaderAuthActions } from "@/components/header-auth-actions";
import { NavSeparator } from "@/components/nav-separator";
import { UserMenu } from "@/components/user-menu";
import { authClient } from "@/lib/auth-client";
import { DISCORD_URL, GITHUB_REPO_URL, NAV_LINKS } from "@/lib/site-links";
import { cn } from "@/lib/utils";

const navLinkClassName =
  "text-sm text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";

const iconLinkClassName =
  "inline-flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";

function SocialIconLinks() {
  return (
    <>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        className={iconLinkClassName}
        aria-label="GitHub repository"
      >
        <GitHubIcon className="h-[18px] w-[18px]" />
      </a>
      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noreferrer"
        className={iconLinkClassName}
        aria-label="Discord community"
      >
        <DiscordIcon className="h-[18px] w-[18px]" />
      </a>
    </>
  );
}

function SocialIconCluster({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <NavSeparator />
      <div className="flex items-center gap-1 px-3 sm:px-4">
        <SocialIconLinks />
      </div>
      <NavSeparator />
    </div>
  );
}

function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, "");
  const target = document.getElementById(id);
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.pushState(null, "", hash);
  return true;
}

function NavAnchorLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : null;
  const path = hash ? href.slice(0, hashIndex) || "/" : href;

  return (
    <Link
      href={href}
      className={navLinkClassName}
      onClick={(event) => {
        if (!hash || pathname !== path) return;

        if (scrollToHash(hash)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const isHome = pathname === "/";
  const [belowFold, setBelowFold] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const updateBelowFold = () => {
      frame = null;
      setBelowFold(window.scrollY >= window.innerHeight);
    };

    const scheduleUpdate = () => {
      if (frame !== null) {
        return;
      }

      frame = requestAnimationFrame(updateBelowFold);
    };

    if (!isHome) {
      const resetFrame = requestAnimationFrame(() => setBelowFold(false));

      return () => cancelAnimationFrame(resetFrame);
    }

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [isHome]);

  useEffect(() => {
    if (pathname !== "/" || !window.location.hash) return;

    const hash = window.location.hash;
    requestAnimationFrame(() => {
      scrollToHash(hash);
    });
  }, [pathname]);

  const showNavLogo = !isHome || belowFold;

  if (isPending) {
    return (
      <header className="fixed right-5 top-4 z-50 sm:right-10">
        <div className="flex justify-end">
          <div
            className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
            aria-hidden="true"
          />
        </div>
      </header>
    );
  }

  if (session?.user) {
    return (
      <>
        <header className="fixed right-5 top-4 z-50 sm:right-10">
          <div className="flex justify-end gap-2">
            <AppCommandPalette />
            <UserMenu user={session.user} />
          </div>
        </header>
        <AppSupportLinks />
      </>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-background/95 py-3 backdrop-blur-sm dark:border-zinc-800">
      <div className="relative flex w-full items-center pl-0.5 pr-5 sm:pr-10">
        <Link
          href="/"
          aria-label="GX home"
          aria-hidden={!showNavLogo}
          tabIndex={showNavLogo ? undefined : -1}
          className={cn(
            "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-500 ease-out",
            showNavLogo
              ? "max-w-[8.25rem] opacity-100"
              : "pointer-events-none max-w-0 opacity-0",
          )}
        >
          <GxLogo variant="header" />
        </Link>

        <nav
          aria-label="Primary"
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-6 sm:gap-8"
        >
          {NAV_LINKS.map((link) => (
            <NavAnchorLink key={link.href} href={link.href} label={link.label} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <SocialIconCluster className="hidden sm:flex" />

          <div className="flex items-center gap-1 sm:hidden">
            <SocialIconLinks />
          </div>

          <HeaderAuthActions />
        </div>
      </div>
    </header>
  );
}
