import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfilePage from '../page';

vi.mock("@/components/profile", () => ({
  UserProfile: () => <div data-testid="mock-user-profile">UserProfile Component</div>,
}));

describe('Profile Page', () => {
  it('should render the UserProfile component', () => {
    render(<ProfilePage />);
    const userProfileElement = screen.getByTestId('mock-user-profile');
    expect(userProfileElement).toBeInTheDocument();
    expect(userProfileElement).toHaveTextContent('UserProfile Component');
  });

  it('should render within a fragment (no extra wrapping divs from the page itself)', () => {
    const { container } = render(<ProfilePage />);
    expect(container.firstChild).toBe(screen.getByTestId('mock-user-profile'));
  });
});