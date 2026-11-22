import type { LegalSection } from "../../constants";
import { LegalSection as LegalSectionCard } from "./legal-section";

interface LegalSectionsProps {
  sections: readonly LegalSection[];
}

export function LegalSections({ sections }: LegalSectionsProps) {
  return (
    <div className="col-span-1 flex min-w-0 flex-col gap-8 lg:col-span-8">
      {sections.map((section, index) => (
        <LegalSectionCard key={section.id} section={section} index={index} />
      ))}
    </div>
  );
}
