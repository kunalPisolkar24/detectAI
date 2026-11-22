import { TERMS_SECTIONS } from "../../constants";
import { TermsSection } from "./terms-section";

export function TermsSections() {
  return (
    <div className="col-span-1 flex min-w-0 flex-col gap-8 lg:col-span-8">
      {TERMS_SECTIONS.map((section, index) => (
        <TermsSection key={section.id} section={section} index={index} />
      ))}
    </div>
  );
}
