import type { LegalSection } from "../../constants";
import { LegalSections } from "./legal-sections";
import { LegalToc } from "./legal-toc";

interface LegalBodyProps {
  updated: string;
  sections: readonly LegalSection[];
  tocTitle: string;
}

export function LegalBody({ updated, sections, tocTitle }: LegalBodyProps) {
  return (
    <div className="w-full max-w-5xl">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        Last updated: {updated}
      </p>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
        <LegalToc sections={sections} title={tocTitle} />
        <LegalSections sections={sections} />
      </div>
    </div>
  );
}
