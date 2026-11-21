import { NavLink } from "@/components/ui/nav-link";
import { NAV_LINKS } from "../../constants";

export function DesktopNav() {
  return (
    <nav className="hidden items-center gap-6 lg:flex" aria-label="Main navigation">
      {NAV_LINKS.map((link) => (
        <NavLink key={link.href} href={link.href} label={link.label} />
      ))}
    </nav>
  );
}
