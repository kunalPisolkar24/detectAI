import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { Faqs } from '../Faqs';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@workspace/ui/components/magicui/animated-gradient-text', () => ({
  AnimatedGradientText: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    motion: {
      // @ts-ignore
      ...actual.motion,
      div: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
      span: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
      h2: ({ children, ...props }: { children: React.ReactNode }) => <h2 {...props}>{children}</h2>,
      p: ({ children, ...props }: { children: React.ReactNode }) => <p {...props}>{children}</p>,
      a: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

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

describe('Faqs Component', () => {
  beforeEach(() => {
    // Reset mocks if needed, though mocks above are generally sufficient
  });

  it('should render the FAQs badge', async () => {
    render(<Faqs />);
    expect(await screen.findByText('FAQs')).toBeInTheDocument();
  });

  it('should render the main heading', async () => {
    render(<Faqs />);
    expect(
      await screen.findByRole('heading', { name: /Frequently Asked Questions/i })
    ).toBeInTheDocument();
  });

  it('should render the description paragraph', async () => {
    render(<Faqs />);
    expect(
      await screen.findByText(/Here are some of the most frequently asked questions/i)
    ).toBeInTheDocument();
  });

  it('should render all FAQ questions as accordion triggers', async () => {
    render(<Faqs />);
    for (const faq of faqsList) {
        expect(
          await screen.findByRole('button', { name: faq.question })
        ).toBeInTheDocument();
    }
  });

  it('should initially have all accordion items closed', async () => {
    render(<Faqs />);
    for (const faq of faqsList) {
      const trigger = await screen.findByRole('button', { name: faq.question });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText(faq.answer)).toBeNull();
    }
  });

  it('should open an accordion item when its trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = await screen.findByRole('button', { name: faqsList[0]!.question });
    const firstAnswerText = faqsList[0]!.answer;

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();

    await user.click(firstQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    const answerElement = await screen.findByText(firstAnswerText);
    expect(answerElement).toBeInTheDocument();
    expect(answerElement).toBeVisible();
  });

   it('should close an open accordion item when its trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = await screen.findByRole('button', { name: faqsList[0]!.question });
    const firstAnswerText = faqsList[0]!.answer;

    await user.click(firstQuestionTrigger);
    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(firstAnswerText)).toBeVisible();

    await user.click(firstQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();
  });

  it('should close the previously opened item when a new item is opened (type=single)', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = await screen.findByRole('button', { name: faqsList[0]!.question });
    const secondQuestionTrigger = await screen.findByRole('button', { name: faqsList[1]!.question });
    const firstAnswerText = faqsList[0]!.answer;
    const secondAnswerText = faqsList[1]!.answer;

    await user.click(firstQuestionTrigger);
    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(firstAnswerText)).toBeVisible();
    expect(secondQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(secondAnswerText)).toBeNull();

    await user.click(secondQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();
    expect(secondQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(secondAnswerText)).toBeVisible();
  });

  it('should render the CTA section', async () => {
    render(<Faqs />);
    expect(
      await screen.findByRole('heading', { name: /Still have questions?/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If you couldn't find the answer to your question/i)
    ).toBeInTheDocument();
    const contactLink = screen.getByRole('link', { name: /Contact Support/i });
    expect(contactLink).toBeInTheDocument();
    expect(contactLink).toHaveAttribute('href', '/contact');
  });
});