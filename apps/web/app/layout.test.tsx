import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RootLayout from './layout';
import '@testing-library/jest-dom';

vi.mock('next/font/google', () => ({
  Geist: () => ({
    className: 'mock-font-geist-classname',
    variable: 'mock-font-sans-variable',
  }),
  Geist_Mono: () => ({
    className: 'mock-font-geist-mono-classname',
    variable: 'mock-font-mono-variable',
  }),
}));

vi.mock('@/components/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-providers">{children}</div>
  ),
}));

vi.mock('@/lib/custom-session-provider', () => ({
  CustomSessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-custom-session-provider">{children}</div>
  ),
}));

vi.mock('sonner', () => ({
  Toaster: (props: { richColors?: boolean, [key: string]: any }) => {
    const attributes: { [key: string]: any } = { ...props };
    if (props.richColors) {
      attributes['richcolors'] = '';
    }
    delete attributes.richColors;

    return <div data-testid="mock-toaster" {...attributes}></div>;
  },
}));


describe('RootLayout', () => {
  const TestChild = () => <div>Test Child Content</div>;

  beforeEach(() => {
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('suppressHydrationWarning');
    document.body.className = '';

    render(
      <RootLayout>
        <TestChild />
      </RootLayout>
    );
  });

  it('should render children correctly', () => {
    expect(screen.getByText('Test Child Content')).toBeInTheDocument();
  });

  it('should include the Providers component', () => {
    expect(screen.getByTestId('mock-providers')).toBeInTheDocument();
  });

  it('should include the CustomSessionProvider component', () => {
    expect(screen.getByTestId('mock-custom-session-provider')).toBeInTheDocument();
  });

  it('should include the Toaster component with richColors attribute', () => {
    const toaster = screen.getByTestId('mock-toaster');
    expect(toaster).toBeInTheDocument();
    expect(toaster).toHaveAttribute('richcolors');
  });

  it('should apply font variables and core classes to the body', () => {
    expect(document.body).toHaveClass('mock-font-sans-variable');
    expect(document.body).toHaveClass('mock-font-mono-variable');
    expect(document.body).toHaveClass('font-sans');
    expect(document.body).toHaveClass('antialiased');
  });

  it('should set attributes on the html tag', () => {
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });
});