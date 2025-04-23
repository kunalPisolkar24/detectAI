import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { type ThemeProviderProps } from 'next-themes';
import { useTheme } from 'next-themes';

import { Providers } from './providers';

const mockUseTheme = vi.fn();

vi.mock('next-themes', async (importOriginal) => {
    const actual = await importOriginal<typeof import('next-themes')>();
    return {
        ...actual, 
        ThemeProvider: (props: ThemeProviderProps) => {
            return <div data-testid="mock-theme-provider" data-props={JSON.stringify(props)}>{props.children}</div>;
        },
        useTheme: () => mockUseTheme(), 
    };
});

const TestChild = () => {
  const { theme } = useTheme(); 
  return <div data-testid="theme-child">Current theme: {theme}</div>;
};


describe('Providers Component', () => {

  beforeEach(() => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() });
    vi.clearAllMocks(); 
  });

  it('should render children correctly', () => {
    render(
      <Providers>
        <div data-testid="child-element">Hello</div>
      </Providers>
    );
    expect(screen.getByTestId('child-element')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByTestId('mock-theme-provider')).toBeInTheDocument();
  });

  it('should pass the correct props to the mocked NextThemesProvider', () => {
    render(
      <Providers>
        <div>Child</div>
      </Providers>
    );

    const mockProvider = screen.getByTestId('mock-theme-provider');
    expect(mockProvider).toBeInTheDocument();

    const passedProps = JSON.parse(mockProvider.getAttribute('data-props') || '{}');

    expect(passedProps).toEqual(expect.objectContaining({
        attribute: 'class',
        defaultTheme: 'dark',
        enableSystem: true,
        disableTransitionOnChange: true,
        enableColorScheme: true,
    }));
  });

  it('should allow children to use the mocked theme context', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() });

    render(
      <Providers>
        <TestChild />
      </Providers>
    );

    expect(screen.getByTestId('theme-child')).toHaveTextContent('Current theme: dark');
    expect(mockUseTheme).toHaveBeenCalled();
  });
});