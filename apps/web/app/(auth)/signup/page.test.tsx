import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SignupPage from './page';

vi.mock('@/components/auth', () => ({
  SignupForm: () => <div data-testid="mock-signup-form">Mock Signup Form Content</div>,
}));

describe('Signup Page', () => {
  it('should render the SignupForm component', () => {
    render(<SignupPage />);
    const signupFormElement = screen.getByTestId('mock-signup-form');
    expect(signupFormElement).toBeInTheDocument();
    expect(signupFormElement).toHaveTextContent('Mock Signup Form Content');
  });
});