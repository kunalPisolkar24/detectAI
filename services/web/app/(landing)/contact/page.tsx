import type { Metadata } from "next";

import { Contact } from "@/features/landing/components/contact";

export const metadata: Metadata = {
  title: "Contact | Detect AI",
  description:
    "Get in touch with the Detect AI team — general questions, feedback, partnerships, and support.",
};

export default function ContactPage() {
  return <Contact />;
}
