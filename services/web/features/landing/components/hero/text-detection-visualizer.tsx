"use client";

import { Fragment, useRef } from "react";
import { m, useInView } from "framer-motion";
import { Zap } from "lucide-react";

import { GlassPanel } from "@/components/ui/glass-panel";
import { VISUALIZER_TEXT, VISUALIZER_TEXT_COMPACT } from "../../constants";
import { VisualizerProgress } from "./visualizer-progress";
import { VisualizerWord } from "./visualizer-word";

const words = VISUALIZER_TEXT.split(" ");
const compactWords = VISUALIZER_TEXT_COMPACT.split(" ");

export function TextDetectionVisualizer() {
  const mobileRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const mobileInView = useInView(mobileRef);
  const desktopInView = useInView(desktopRef);
  const active = mobileInView || desktopInView;

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 0.5 }}
      className="mt-12 w-full max-w-3xl"
    >
      <GlassPanel elevated brand className="overflow-hidden">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="size-5 text-purple-500" aria-hidden="true" />
            <span className="text-sm font-medium">AI Detection in Progress</span>
          </div>

          <div className="text-left font-mono text-xs leading-relaxed sm:text-sm">
            <p className="sr-only">{VISUALIZER_TEXT}</p>
            <div aria-hidden="true" className="sm:hidden" ref={mobileRef}>
              {compactWords.map((word, index) => (
                <Fragment key={index}>
                  <VisualizerWord word={word} index={index} active={mobileInView} />
                  {" "}
                </Fragment>
              ))}
            </div>
            <div aria-hidden="true" className="hidden sm:block" ref={desktopRef}>
              {words.map((word, index) => (
                <Fragment key={index}>
                  <VisualizerWord word={word} index={index} active={desktopInView} />
                  {" "}
                </Fragment>
              ))}
            </div>

            <VisualizerProgress active={active} />

            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Analyzing patterns...</span>
              <m.span
                animate={{ opacity: active ? [0.5, 1, 0.5] : 0.5 }}
                transition={
                  active
                    ? { duration: 1.5, repeat: Number.POSITIVE_INFINITY }
                    : { duration: 0 }
                }
              >
                Processing...
              </m.span>
            </div>
          </div>
        </div>
      </GlassPanel>
    </m.div>
  );
}
