import { GradientText } from "@/components/ui/gradient-text";
import { HERO_TEXT } from "../../constants";

export function HeroHeadline() {
  return (
    <div className="space-y-4">
      <h1 className="text-5xl font-extrabold tracking-tighter sm:text-6xl lg:text-8xl">
        <GradientText animate>{HERO_TEXT.titleStart}</GradientText>
        <span className="mt-2 block">{HERO_TEXT.titleEnd}</span>
      </h1>
      <p className="mx-auto max-w-2xl px-4 font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:px-6 lg:text-lg">
        {HERO_TEXT.description.map((line) => (
          <span className="block" key={line}>
            {line}
          </span>
        ))}
      </p>
    </div>
  );
}
