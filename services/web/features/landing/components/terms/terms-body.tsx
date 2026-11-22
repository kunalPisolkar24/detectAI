import { TERMS_TEXT } from "../../constants";
import { TermsSections } from "./terms-sections";
import { TermsToc } from "./terms-toc";

export function TermsBody() {
  return (
    <div className="w-full max-w-5xl">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        Last updated: {TERMS_TEXT.updated}
      </p>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
        <TermsToc />
        <TermsSections />
      </div>
    </div>
  );
}
