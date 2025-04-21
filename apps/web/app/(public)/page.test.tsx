import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Home from '../(public)/page'; // Adjust the import path as necessary

vi.mock("@/components/landing", () => ({
  Navigation: () => <div data-testid="mock-navigation">Navigation</div>,
  HeroSection: () => <div data-testid="mock-hero-section">HeroSection</div>,
  Testimonials: () => <div data-testid="mock-testimonials">Testimonials</div>,
  Pricing: () => <div data-testid="mock-pricing">Pricing</div>,
  Faqs: () => <div data-testid="mock-faqs">Faqs</div>,
  Footer: () => <div data-testid="mock-footer">Footer</div>,
}));

describe('Home Page', () => {
  it('should render the main container element', () => {
    render(<Home />);
    const mainElement = screen.getByRole('main');
    expect(mainElement).toBeInTheDocument();
  });

  it('should apply correct layout classes to the main container', () => {
    render(<Home />);
    const mainElement = screen.getByRole('main');
    expect(mainElement).toHaveClass('flex');
    expect(mainElement).toHaveClass('flex-col');
    expect(mainElement).toHaveClass('min-h-screen');
    expect(mainElement).toHaveClass('items-center');
    expect(mainElement).toHaveClass('justify-center');
  });

  it('should render all the required child components', () => {
    render(<Home />);
    expect(screen.getByTestId('mock-navigation')).toBeInTheDocument();
    expect(screen.getByTestId('mock-hero-section')).toBeInTheDocument();
    expect(screen.getByTestId('mock-testimonials')).toBeInTheDocument();
    expect(screen.getByTestId('mock-pricing')).toBeInTheDocument();
    expect(screen.getByTestId('mock-faqs')).toBeInTheDocument();
    expect(screen.getByTestId('mock-footer')).toBeInTheDocument();
  });
});