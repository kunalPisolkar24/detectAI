import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfileLayout from '../layout'; 

vi.mock('@/components/profile/profile-nav', () => ({
  ProfileNav: () => <nav data-testid="mock-profile-nav">Profile Navigation</nav>,
}));

describe('Profile Layout', () => {
  it('should render its children', () => {
    const childText = 'Profile Page Content';
    render(<ProfileLayout>{childText}</ProfileLayout>);
    expect(screen.getByText(childText)).toBeInTheDocument();
  });

  it('should render the ProfileNav component', () => {
    render(<ProfileLayout><div>Children</div></ProfileLayout>);
    expect(screen.getByTestId('mock-profile-nav')).toBeInTheDocument();
  });

  it('should render children inside a main tag', () => {
    const childText = 'Main Content';
    render(<ProfileLayout>{childText}</ProfileLayout>);
    const mainElement = screen.getByRole('main');
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toContainElement(screen.getByText(childText));
    expect(mainElement).toHaveClass('flex-1');
  });
});