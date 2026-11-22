"use cache";

import Link from "next/link";

import { FadeIn } from "@/components/motion/fade-in";

import { FOOTER_LINK_GROUPS, FOOTER_TEXT } from "../../constants";

export async function FooterBottom() {
  const legalLinks =
    FOOTER_LINK_GROUPS.find((group) => group.title === "Legal")?.links ?? [];
  const year = new Date().getFullYear();

  return (
    <FadeIn
      delay={0.4}
      className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-black/10 pt-6 sm:flex-row dark:border-white/10"
    >
      <p className="text-xs text-muted-foreground">
        &copy; {year} {FOOTER_TEXT.copyright}
      </p>
      <nav className="flex flex-wrap justify-center gap-6">
        {legalLinks.map((link) => (
          <Link
            key={link.name}
            href={link.href}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {link.name}
          </Link>
        ))}
      </nav>
    </FadeIn>
  );
}
