import Link from "next/link";

import { FadeIn } from "@/components/motion/fade-in";

import { FOOTER_LINK_GROUPS } from "../../constants";

export function FooterLinks() {
  return (
    <>
      {FOOTER_LINK_GROUPS.map((group, index) => (
        <FadeIn key={group.title} delay={0.1 + index * 0.1}>
          <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
          <ul className="mt-4 space-y-3">
            {group.links.map((link) => (
              <li key={link.name}>
                <Link
                  href={link.href}
                  className="inline-flex w-fit text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </FadeIn>
      ))}
    </>
  );
}
