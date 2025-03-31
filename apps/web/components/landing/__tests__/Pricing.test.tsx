// apps/web/components/landing/__tests__/Pricing.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { Pricing } from '../Pricing';

vi.mock('@workspace/ui/components/magicui/animated-gradient-text', () => ({
  AnimatedGradientText: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('Pricing Component', () => {
  it('should render the pricing badge', () => {
    render(<Pricing />);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('should render the main heading', () => {
    render(<Pricing />);
    expect(
      screen.getByRole('heading', { name: /choose the plan/i })
    ).toBeInTheDocument();
  });

  it('should render the description paragraph', () => {
    render(<Pricing />);
    expect(
      screen.getByText(/from simple ai text detection/i)
    ).toBeInTheDocument();
  });

  it('should render the billing cycle tabs', () => {
    render(<Pricing />);
    expect(screen.getByRole('tab', { name: /monthly/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /yearly/i })).toBeInTheDocument();
  });

  it('should default to the monthly billing cycle', () => {
    render(<Pricing />);
    const monthlyTab = screen.getByRole('tab', { name: /monthly/i });
    expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('₹0')).toBeInTheDocument();
    expect(screen.getByText('₹200')).toBeInTheDocument();
    expect(screen.getAllByText('/month')).toHaveLength(2);
  });

  it('should render the free plan card correctly on initial load (monthly)', () => {
    render(<Pricing />);
    expect(screen.getByRole('heading', { name: 'Free' })).toBeInTheDocument();
    expect(screen.getByText(/get started with ai detection/i)).toBeInTheDocument();
    expect(screen.getByText('Sequential Model for AI detection')).toBeInTheDocument();
    const getStartedButton = screen.getByRole('link', { name: /get started/i });
    expect(getStartedButton).toBeInTheDocument();
    expect(getStartedButton).toHaveAttribute('href', '/auth/login');
  });

  it('should render the premium plan card correctly on initial load (monthly)', () => {
    render(<Pricing />);
    expect(screen.getByRole('heading', { name: /premium/i })).toBeInTheDocument();
    expect(screen.getByText(/unlock the full power of ai/i)).toBeInTheDocument();
    expect(screen.getByText('Advanced BERT Model for superior AI detection')).toBeInTheDocument();
    expect(screen.getByText('Most Popular')).toBeInTheDocument();
    const subscribeButton = screen.getByRole('link', { name: /subscribe/i });
    expect(subscribeButton).toBeInTheDocument();
    expect(subscribeButton).toHaveAttribute('href', '/auth/login');
  });

  it('should switch to yearly billing cycle when yearly tab is clicked', async () => {
    const user = userEvent.setup();
    render(<Pricing />);

    const yearlyTab = screen.getByRole('tab', { name: /yearly/i });
    const monthlyTab = screen.getByRole('tab', { name: /monthly/i });

    expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
    expect(yearlyTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('₹200')).toBeInTheDocument();
    expect(screen.queryByText('₹1000')).not.toBeInTheDocument();
    expect(screen.getAllByText('/month')).toHaveLength(2);
    expect(screen.queryByText('/year')).not.toBeInTheDocument();


    await user.click(yearlyTab);

    expect(yearlyTab).toHaveAttribute('aria-selected', 'true');
    expect(monthlyTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('₹200')).not.toBeInTheDocument();
    expect(screen.getByText('₹1000')).toBeInTheDocument();
    expect(screen.getAllByText('₹0')[0]).toBeInTheDocument();
    expect(screen.queryByText('/month')).not.toBeInTheDocument();
    expect(screen.getAllByText('/year')).toHaveLength(2);

  });

  it('should display correct yearly prices after switching', async () => {
    const user = userEvent.setup();
    render(<Pricing />);
    const yearlyTab = screen.getByRole('tab', { name: /yearly/i });

    await user.click(yearlyTab);

    expect(screen.getAllByText('₹0')[0]).toBeInTheDocument();
    expect(screen.getByText('₹1000')).toBeInTheDocument();
    expect(screen.getAllByText('/year')).toHaveLength(2);
  });

   it('should render all features for each plan', () => {
    render(<Pricing />);

    expect(screen.getByText('Sequential Model for AI detection')).toBeInTheDocument();
    expect(screen.getByText('Limited API calls (100/day)')).toBeInTheDocument();
    expect(screen.getByText('Basic accuracy level')).toBeInTheDocument();
    expect(screen.getByText('Community support')).toBeInTheDocument();

    expect(screen.getByText('Advanced BERT Model for superior AI detection')).toBeInTheDocument();
    expect(screen.getByText('Unlimited API calls')).toBeInTheDocument();
    expect(screen.getByText('High accuracy & deep analysis')).toBeInTheDocument();
    expect(screen.getByText('Priority customer support')).toBeInTheDocument();
    expect(screen.getByText('Early access to new features')).toBeInTheDocument();
  });

  it('should have buttons linking to login', () => {
      render(<Pricing />);
      const links = screen.getAllByRole('link');
      const loginLinks = links.filter(link => link.getAttribute('href') === '/auth/login');
      expect(loginLinks.length).toBe(2);
      expect(loginLinks[0]).toHaveTextContent(/get started/i);
      expect(loginLinks[1]).toHaveTextContent(/subscribe/i);
  });

});