import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ChatLayout from '../layout';

vi.mock('@/components/chat', () => ({
  ChatNav: () => <nav data-testid="mock-chat-nav">Chat Navigation</nav>,
}));

vi.mock('@/contexts/tabContext', () => ({
  TabProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-tab-provider">{children}</div>
  ),
}));

describe('Chat Layout', () => {
  it('should render its children', () => {
    const childText = 'Chat Page Content';
    render(<ChatLayout>{childText}</ChatLayout>);
    expect(screen.getByText(childText)).toBeInTheDocument();
  });

  it('should render the ChatNav component', () => {
    render(<ChatLayout><div>Children</div></ChatLayout>);
    expect(screen.getByTestId('mock-chat-nav')).toBeInTheDocument();
  });

  it('should wrap content with TabProvider', () => {
    const childText = 'Child Inside Provider';
    render(<ChatLayout>{childText}</ChatLayout>);
    expect(screen.getByTestId('mock-tab-provider')).toBeInTheDocument();
    expect(screen.getByTestId('mock-tab-provider')).toContainElement(screen.getByText(childText));
  });
});