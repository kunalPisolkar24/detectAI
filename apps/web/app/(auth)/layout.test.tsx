import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuthLayout from './layout';

describe('Auth Layout', () => {
  it('should render its children', () => {
    const childText = 'Test Children Content';
    render(<AuthLayout>{childText}</AuthLayout>);
    expect(screen.getByText(childText)).toBeInTheDocument();
  });
});