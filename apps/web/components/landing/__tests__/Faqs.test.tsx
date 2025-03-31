import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { Faqs } from '../Faqs';

vi.mock('@workspace/ui/components/magicui/animated-gradient-text', () => ({
  AnimatedGradientText: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
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
  it('should render the FAQs badge', () => {
    render(<Faqs />);
    expect(screen.getByText('FAQs')).toBeInTheDocument();
  });

  it('should render the main heading', () => {
    render(<Faqs />);
    expect(
      screen.getByRole('heading', { name: /Frequently Asked Questions/i })
    ).toBeInTheDocument();
  });

  it('should render the description paragraph', () => {
    render(<Faqs />);
    expect(
      screen.getByText(/Here are some of the most frequently asked questions/i)
    ).toBeInTheDocument();
  });

  it('should render all FAQ questions as accordion triggers', () => {
    render(<Faqs />);
    faqsList.forEach((faq) => {
      expect(
        screen.getByRole('button', { name: faq.question })
      ).toBeInTheDocument();
    });
  });

  it('should initially have all accordion items closed', () => {
    render(<Faqs />);
    faqsList.forEach((faq) => {
      const trigger = screen.getByRole('button', { name: faq.question });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText(faq.answer)).toBeNull();
    });
  });

  it('should open an accordion item when its trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = screen.getByRole('button', { name: faqsList[0]!.question });
    const firstAnswerText = faqsList[0]!.answer;

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();

    await user.click(firstQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(firstAnswerText)).toBeInTheDocument();
    expect(screen.getByText(firstAnswerText)).toBeVisible();
  });

   it('should close an open accordion item when its trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = screen.getByRole('button', { name: faqsList[0]!.question });
    const firstAnswerText = faqsList[0]!.answer;

    await user.click(firstQuestionTrigger);
    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(firstAnswerText)).toBeVisible();

    await user.click(firstQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();
  });

  it('should close the previously opened item when a new item is opened (type=single)', async () => {
    const user = userEvent.setup();
    render(<Faqs />);

    const firstQuestionTrigger = screen.getByRole('button', { name: faqsList[0]!.question });
    const secondQuestionTrigger = screen.getByRole('button', { name: faqsList[1]!.question });
    const firstAnswerText = faqsList[0]!.answer;
    const secondAnswerText = faqsList[1]!.answer;

    await user.click(firstQuestionTrigger);
    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(firstAnswerText)).toBeVisible();
    expect(secondQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(secondAnswerText)).toBeNull();

    await user.click(secondQuestionTrigger);

    expect(firstQuestionTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstAnswerText)).toBeNull();
    expect(secondQuestionTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(secondAnswerText)).toBeVisible();
  });
});