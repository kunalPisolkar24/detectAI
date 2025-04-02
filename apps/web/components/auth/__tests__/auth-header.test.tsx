import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthHeader } from '../auth-header';

describe('AuthHeader Component', () => {
  const testTitle = 'Welcome Back';
  const testLabel = 'Please sign in';

  it('should render the title correctly', () => {
    render(<AuthHeader title={testTitle} label={testLabel} />);
    expect(screen.getByRole('heading', { name: testTitle, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(testTitle)).toHaveClass('text-3xl font-semibold');
  });

  it('should render the label correctly', () => {
    render(<AuthHeader title={testTitle} label={testLabel} />);
    expect(screen.getByText(testLabel)).toBeInTheDocument();
    expect(screen.getByText(testLabel)).toHaveClass('text-muted-foreground text-sm');
  });

  it('should render the "Home" link with the correct href', () => {
    render(<AuthHeader title={testTitle} label={testLabel} />);
    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
    expect(homeLink).toHaveClass('text-foreground text-sm mb-4 font-medium');
  });

  it('should render the separator element', () => {
     render(<AuthHeader title={testTitle} label={testLabel} />);
     expect(screen.getByText('|')).toBeInTheDocument();
     expect(screen.getByText('|')).toHaveClass('px-2');
  });
});