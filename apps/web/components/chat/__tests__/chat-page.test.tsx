import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPage } from '../chat-page';
import { toast } from 'sonner';
import '@testing-library/jest-dom';


const mockRouterReplace = vi.fn();
const mockSearchParamsGet = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
  }),
}));


vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock('@/components/chat', () => ({
  ChatInterface: () => <div data-testid="mock-chat-interface">Mock Chat Interface</div>,
}));


describe('ChatPage', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
  });

  it('should render the ChatInterface component', () => {
    render(<ChatPage />);
    expect(screen.getByTestId('mock-chat-interface')).toBeInTheDocument();
  });

  it('should not show a toast or replace route if login_success param is not present', () => {
    render(<ChatPage />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('should not show a toast or replace route if login_success param is not "true"', () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'login_success') return 'false';
      return null;
    });
    render(<ChatPage />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

   it('should show a success toast and replace route if login_success param is "true"', () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'login_success') return 'true';
      return null;
    });
    render(<ChatPage />);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Login successful!");

    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith('/chat', { scroll: false });
   });

   it('should call searchParams.get with "login_success"', () => {
     render(<ChatPage />);
     expect(mockSearchParamsGet).toHaveBeenCalledWith('login_success');
   });
});