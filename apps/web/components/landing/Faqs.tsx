import React from 'react'
import { AnimatedGradientText } from '@workspace/ui/components/magicui/animated-gradient-text'
import { cn } from '@workspace/ui/lib/utils'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@workspace/ui/components/accordion';

const faqsList = [
  {
    question: "What is Detect AI?",
    answer: "Detect AI is a tool that helps identify whether a piece of text is AI-generated or human-written.",
  },
  {
    question: "How accurate is Detect AI?",
    answer: "Detect AI uses advanced models like SNN and BERT to ensure high accuracy in AI text detection.",
  },
  {
    question: "Is Detect AI free to use?",
    answer: "Yes! We offer a free plan with basic detection features, while the premium plan provides advanced analysis.",
  },
  {
    question: "Can Detect AI detect mixed AI and human-written content?",
    answer: "Yes, it can analyze hybrid content and highlight AI-generated sections.",
  },
  {
    question: "Do I need an account to use Detect AI?",
    answer: "No, you can use the free version without an account. However, creating an account unlocks additional features.",
  },
  {
    question: "How does Detect AI handle user data?",
    answer: "We prioritize privacy and do not store or share any text submitted for analysis.",
  },
];

const Question = ({question, answer}: any) => {
  return (
    <AccordionItem value={question}>
      <AccordionTrigger className="text-left">{question}</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">{answer}</AccordionContent>
    </AccordionItem>

  );
}

export const Faqs = () => {
  return (
    <section
          id="faqs"
          className="w-full flex flex-col items-center justify-center py-32 overflow-hidden px-6 xs:px-8 sm:px-0 sm:x-8 lg:mx-auto"
        >
                <div className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] ">
        <span
          className={cn(
            "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]"
          )}
          style={{
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "destination-out",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "subtract",
            WebkitClipPath: "padding-box",
          }}
        />
        <AnimatedGradientText className="text-sm font-medium">
        FAQs
        </AnimatedGradientText>
      </div>
    
          <h2 className="subHeading mt-4">
            Frequently Asked Questions
          </h2>
          <p className="subText mt-4 text-center">
          Here are some of the most frequently asked questions about our product.
          </p>

          <Accordion type='single' collapsible className='w-full max-w-4xl mx-auto mt-16'>
            {
              faqsList.map((faq) => {
                return <Question key={faq.question} {...faq}/>
              })
            }
          </Accordion>
      </section>
  )
}

