import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthHeader } from '../auth-header';
import '@testing-library/jest-dom';

let mockTheme = 'light';
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    motion: {
      div: vi.fn(({ children, className, ...props }) => <div className={className} {...props}>{children}</div>),
      h1: vi.fn(({ children, className, style, ...props }) => <h1 className={className} style={style} {...props}>{children}</h1>),
    },
  };
});

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));


describe('AuthHeader', () => {
  const mockProps = {
    label: 'Test Label',
    title: 'Test Title',
  };

  const renderComponent = (theme = 'light') => {
    mockTheme = theme;
    return render(<AuthHeader {...mockProps} />);
  };

  beforeEach(() => {
    mockTheme = 'light';
  });

  it('should render the label text correctly', () => {
    renderComponent();
    expect(screen.getByText(mockProps.label)).toBeInTheDocument();
  });

  it('should render the title text correctly', () => {
    renderComponent();
    expect(screen.getByRole('heading', { name: mockProps.title, level: 1 })).toBeInTheDocument();
  });

  it('should render the title within an H1 tag', () => {
    renderComponent();
    const titleElement = screen.getByText(mockProps.title);
    expect(titleElement.tagName).toBe('H1');
  });

  it('should apply base classes to the label container', () => {
    renderComponent();
    const labelElement = screen.getByText(mockProps.label);
    expect(labelElement).toHaveClass('text-sm');
    expect(labelElement).toHaveClass('px-3');
    expect(labelElement).toHaveClass('py-1');
    expect(labelElement).toHaveClass('rounded-full');
  });

  it('should apply light theme classes correctly', () => {
    renderComponent('light');
    const labelElement = screen.getByText(mockProps.label);
    const titleElement = screen.getByRole('heading', { name: mockProps.title, level: 1 });

    expect(labelElement).toHaveClass('bg-black/5');
    expect(labelElement).toHaveClass('text-black');
    expect(labelElement).not.toHaveClass('bg-white/10');
    expect(labelElement).not.toHaveClass('text-white');

    expect(titleElement).toHaveClass('text-2xl');
    expect(titleElement).toHaveClass('font-bold');
    expect(titleElement).toHaveClass('tracking-tight');
    expect(titleElement).toHaveClass('bg-clip-text');
    expect(titleElement).toHaveClass('text-transparent');
    expect(titleElement).toHaveClass('bg-gradient-to-r');
    expect(titleElement).toHaveClass('from-gray-900');
    expect(titleElement).toHaveClass('via-blue-600');
    expect(titleElement).toHaveClass('to-gray-900');
    expect(titleElement).toHaveClass('bg-[length:200%_100%]');
    expect(titleElement).not.toHaveClass('from-white');
    expect(titleElement).not.toHaveClass('via-blue-400');
    expect(titleElement).not.toHaveClass('to-white');
  });

   it('should apply dark theme classes correctly', () => {
    renderComponent('dark');
    const labelElement = screen.getByText(mockProps.label);
    const titleElement = screen.getByRole('heading', { name: mockProps.title, level: 1 });

    expect(labelElement).toHaveClass('bg-white/10');
    expect(labelElement).toHaveClass('text-white');
    expect(labelElement).not.toHaveClass('bg-black/5');
    expect(labelElement).not.toHaveClass('text-black');

    expect(titleElement).toHaveClass('text-2xl');
    expect(titleElement).toHaveClass('font-bold');
    expect(titleElement).toHaveClass('tracking-tight');
    expect(titleElement).toHaveClass('bg-clip-text');
    expect(titleElement).toHaveClass('text-transparent');
    expect(titleElement).toHaveClass('bg-gradient-to-r');
    expect(titleElement).toHaveClass('from-white');
    expect(titleElement).toHaveClass('via-blue-400');
    expect(titleElement).toHaveClass('to-white');
    expect(titleElement).toHaveClass('bg-[length:200%_100%]');
    expect(titleElement).not.toHaveClass('from-gray-900');
    expect(titleElement).not.toHaveClass('via-blue-600');
    expect(titleElement).not.toHaveClass('to-gray-900');
   });

   it('should apply animation styles to the title', () => {
     renderComponent();
     const titleElement = screen.getByRole('heading', { name: mockProps.title, level: 1 });
     expect(titleElement).toHaveStyle('backgroundPosition: 0% 0%');
     expect(titleElement).toHaveStyle('animation: gradientMove 5s linear infinite');
   });

   it('should render inside a motion.div and motion.h1 wrapper based on mock', () => {
      renderComponent();
      const labelElement = screen.getByText(mockProps.label);
      const titleElement = screen.getByText(mockProps.title);
      expect(labelElement.tagName).toBe('DIV');
      expect(titleElement.tagName).toBe('H1');
   });

});