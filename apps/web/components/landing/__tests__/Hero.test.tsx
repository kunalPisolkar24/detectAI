import { vi } from 'vitest';
import React from 'react';


vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'dark', 
    setTheme: vi.fn(),
  }),
}));


vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    motion: new Proxy({}, { 
        get: (target, prop) => {
             // Return a component creator for motion.* elements
             if (typeof prop === 'string') {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 return React.forwardRef((props: { children?: React.ReactNode; [key: string]: any }, ref: any) => {
                    const MotionComponent = prop as keyof React.JSX.IntrinsicElements;
                    const { children, ...restProps } = props;
                    return React.createElement(MotionComponent, { ...restProps, ref }, children);
                 });
             }
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

vi.mock('@workspace/ui/lib/utils', () => ({
    cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '), 
}));

vi.mock('@workspace/ui/components/button', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>
}));


import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { HeroSection } from '../Hero'; // Adjust import path

// Mocks specific to this test file or rely on setup file
// Ensure mocks from Step 1 are active

describe('HeroSection Component', () => {

  // Helper to ensure component mounts (handles the initial null return)
  const renderAndWaitForMount = async () => {
    render(<HeroSection />);
    // Wait for an element expected *after* mount state is set
    await screen.findByText(/introducing detect ai/i);
  };

  it('should render the main heading', async () => {
    await renderAndWaitForMount();
    // Check for parts of the heading
    expect(screen.getByText(/detect your text/i)).toBeInTheDocument();
    expect(screen.getByText(/in seconds!/i)).toBeInTheDocument();
  });

  it('should render the introductory text', async () => {
    await renderAndWaitForMount();
    expect(screen.getByText(/introducing detect ai/i)).toBeInTheDocument();
  });

  it('should render the description paragraph', async () => {
    await renderAndWaitForMount();
    expect(
      screen.getByText(/provide your text, and our model will predict/i)
    ).toBeInTheDocument();
  });

  it('should render the "Get started!" link/button', async () => {
    await renderAndWaitForMount();
    const link = screen.getByRole('link', { name: /get started!/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/signup');
  });

  it('should render placeholder text from the animation component', async () => {
    await renderAndWaitForMount();
    // Check for text rendered within TextDetectionAnimation
    expect(screen.getByText(/analyzing patterns.../i)).toBeInTheDocument();
    expect(screen.getByText(/processing.../i)).toBeInTheDocument();
  });
});

