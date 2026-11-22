import { IconLink } from "@/components/ui/icon-link";

import { FOOTER_SOCIALS } from "../../constants";

export function FooterSocials() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {FOOTER_SOCIALS.map((social) => (
        <IconLink
          key={social.name}
          href={social.href}
          hugeIcon={social.icon}
          label={social.name}
          external={!social.href.startsWith("mailto:")}
        />
      ))}
    </div>
  );
}
