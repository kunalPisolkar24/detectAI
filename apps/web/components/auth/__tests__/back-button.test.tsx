import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BackButton } from '../back-button';
import '@testing-library/jest-dom';


vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string;[key: string]: any }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    motion: {
      div: vi.fn(({ children, ...props }) => <div {...props}>{children}</div>),
    },
  };
});

let mockTheme = 'light';
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('@workspace/ui/components/button', () => ({
  Button: ({ children, asChild, variant, size, className, ...props }: any) => {
    if (asChild && React.isValidElement(children)) {
      const childProps = children.props as { className?: string; [key: string]: any };

      return React.cloneElement(children, {
        ...props,
        className: `${childProps.className || ''} ${className || ''}`.trim(),
      });
    }
    return <button className={className} {...props}>{children}</button>;
  },
}));


vi.mock('lucide-react', () => ({
  ArrowLeft: (props: any) => <svg data-testid="mock-arrow-left" {...props} />,
}));


describe('BackButton', () => {
  const mockProps = {
    label: 'Go Back',
    href: '/previous-page',
  };

  const renderComponent = (theme = 'light') => {
    mockTheme = theme; 
    return render(<BackButton {...mockProps} />);
  };

  beforeEach(() => {
    mockTheme = 'light';
  });

  it('should render the label text correctly', () => {
    renderComponent();
    expect(screen.getByText(mockProps.label)).toBeInTheDocument();
  });

  it('should render a link with the correct href', () => {
    renderComponent();
    const linkElement = screen.getByRole('link');
    expect(linkElement).toBeInTheDocument();
    expect(linkElement).toHaveAttribute('href', mockProps.href);
  });

  it('should render the ArrowLeft icon', () => {
    renderComponent();
    expect(screen.getByTestId('mock-arrow-left')).toBeInTheDocument();
  });

  it('should apply base classes correctly to the link', () => {
     renderComponent();
     const linkElement = screen.getByRole('link');
     expect(linkElement).toHaveClass('font-normal');
     expect(linkElement).toHaveClass('w-full');
     expect(linkElement).toHaveClass('justify-center');
     expect(linkElement).toHaveClass('sm:justify-start');
     expect(linkElement).toHaveClass('gap-1');
  });

  it('should apply light theme classes correctly', () => {
    renderComponent('light');
    const linkElement = screen.getByRole('link');
    expect(linkElement).toHaveClass('text-neutral-700');
    expect(linkElement).toHaveClass('hover:text-black');
    expect(linkElement).not.toHaveClass('text-neutral-300');
    expect(linkElement).not.toHaveClass('hover:text-white');
  });

   it('should apply dark theme classes correctly', () => {
    renderComponent('dark');
    const linkElement = screen.getByRole('link');
    expect(linkElement).toHaveClass('text-neutral-300');
    expect(linkElement).toHaveClass('hover:text-white');
    expect(linkElement).not.toHaveClass('text-neutral-700');
    expect(linkElement).not.toHaveClass('hover:text-black');
   });

   it('should render inside a motion.div wrapper', () => {
    renderComponent();
    const linkElement = screen.getByRole('link');
    expect(linkElement.parentElement?.tagName).toBe('DIV');
   });

});