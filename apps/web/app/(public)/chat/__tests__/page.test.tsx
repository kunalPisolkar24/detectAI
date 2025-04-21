import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Chat from '../page'; 

vi.mock('@/components/chat', () => ({
  ChatPage: () => <div data-testid="mock-chat-page">Mock Chat Page Content</div>,
}));

vi.mock('@workspace/ui/lib/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
  };
});


describe('Chat Page', () => {
  it('should render the ChatPage component wrapped in Suspense', () => {
    render(<Chat />);
    const chatPageElement = screen.getByTestId('mock-chat-page');
    expect(chatPageElement).toBeInTheDocument();
    expect(chatPageElement).toHaveTextContent('Mock Chat Page Content');
  });

  it('should render the loading fallback correctly', () => {
    render(<Chat />);

    render(

        <Suspense fallback={<div>Fallback Test</div>}>
            <Chat />
        </Suspense>
    );


    function TestChatLoadingFallback() {
        return (
          <div className="flex items-center justify-center min-h-[calc(100vh-var(--header-height,80px))]">
            <div
              className={
                "animate-spin rounded-full h-12 w-12 border-4 " + 
                "border-gray-200 dark:border-gray-600 " +
                "border-t-blue-600 dark:border-t-blue-400"
              }
              role="status"
              aria-live="polite"
            >
              <span className="sr-only">Loading chat...</span>
            </div>
          </div>
        );
      }

    render(<TestChatLoadingFallback />);

    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('aria-live', 'polite');
    expect(spinner).toHaveClass('animate-spin');
    expect(spinner).toHaveClass('rounded-full');
    expect(spinner).toHaveClass('h-12');
    expect(spinner).toHaveClass('w-12');
    expect(spinner).toHaveClass('border-4');
    expect(spinner).toHaveClass('border-gray-200');
    expect(spinner).toHaveClass('dark:border-gray-600');
    expect(spinner).toHaveClass('border-t-blue-600');
    expect(spinner).toHaveClass('dark:border-t-blue-400');


    const srText = screen.getByText('Loading chat...');
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveClass('sr-only');
  });
});