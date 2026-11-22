import { Container } from "@/components/layout/container";

import { FooterBrand } from "./footer-brand";
import { FooterBottom } from "./footer-bottom";
import { FooterLinks } from "./footer-links";

export function Footer() {
  return (
    <footer className="w-full border-t border-black/10 bg-background dark:border-white/10">
      <Container className="py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-5">
          <FooterBrand />
          <FooterLinks />
        </div>
        <FooterBottom />
      </Container>
    </footer>
  );
}
