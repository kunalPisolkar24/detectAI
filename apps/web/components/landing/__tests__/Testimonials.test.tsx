import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Testimonials } from '../Testimonials';

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    motion: new Proxy({}, {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          return React.forwardRef((props: { children?: React.ReactNode; [key: string]: any }, ref: any) => {
            const MotionComponent = prop as keyof React.JSX.IntrinsicElements;
            const { children, ...restProps } = props;
            return React.createElement(MotionComponent, { ...restProps, ref }, children);
          });
        }
        return (target as any)[prop];
      }
    }),
  };
});

vi.mock('@workspace/ui/components/magicui/animated-gradient-text', () => ({
  AnimatedGradientText: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@workspace/ui/components/magicui/marquee', () => ({
  Marquee: ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
    <div data-testid="marquee" {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
    cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}));

describe('Testimonials Component', () => {
  const renderAndWaitForMount = async () => {
    render(<Testimonials />);
    await screen.findByRole('heading', { name: /what our users say/i });
  };

  it('should render the testimonials badge', async () => {
    await renderAndWaitForMount();
    expect(screen.getByText('Testimonials')).toBeInTheDocument();
  });

  it('should render the main heading', async () => {
    await renderAndWaitForMount();
    expect(screen.getByRole('heading', { name: /what our users say/i })).toBeInTheDocument();
  });

  it('should render the description paragraph', async () => {
    await renderAndWaitForMount();
    expect(
      screen.getByText(/see what our users have to say about detect ai/i)
    ).toBeInTheDocument();
  });

  it('should render the correct number of review cards', async () => {
    await renderAndWaitForMount();
    const reviewCards = await screen.findAllByRole('figure');
    expect(reviewCards).toHaveLength(6);
  });

  it('should render content from the review cards', async () => {
    await renderAndWaitForMount();
    expect(screen.getByText('Michael')).toBeInTheDocument();
    expect(screen.getByText('@michael')).toBeInTheDocument();
    expect(screen.getByText(/detect ai is fast and accurate/i)).toBeInTheDocument();
    expect(screen.getByText('Sophia')).toBeInTheDocument();
    expect(screen.getByText(/tested many ai detection tools/i)).toBeInTheDocument();
  });

  it('should render images with correct alt text in review cards', async () => {
      await renderAndWaitForMount();
      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('alt', "Michael's avatar");
      expect(images[1]).toHaveAttribute('alt', "Sophia's avatar");
      expect(screen.getByAltText("David's avatar")).toBeInTheDocument();
      expect(screen.getByAltText("Emily's avatar")).toBeInTheDocument();
      expect(screen.getByAltText("Alex's avatar")).toBeInTheDocument();
      expect(screen.getByAltText("Olivia's avatar")).toBeInTheDocument();
  });

  it('should render marquee components', async () => {
    await renderAndWaitForMount();
    const marquees = screen.getAllByTestId('marquee');
    expect(marquees).toHaveLength(2);
  });
});
