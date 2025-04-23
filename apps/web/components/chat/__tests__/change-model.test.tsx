import React, { useState, SetStateAction } from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import ChangeModel from '../change-model';
import { TabProvider, useTab, TabContext, TabContextType } from '@/contexts/tabContext';

const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

const mockSetTheme = vi.fn();
const mockUseTheme = vi.fn(() => ({ theme: 'dark', setTheme: mockSetTheme }));
vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('@workspace/ui/components/dropdown-menu', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@workspace/ui/components/dropdown-menu')>();

    const MockDropdownMenu = ({ children, onOpenChange }: {children: React.ReactNode, onOpenChange?: (open: boolean) => void}) => {
        const [isOpen, setIsOpen] = React.useState(false);
        const handleOpenChange = (open: boolean) => {
            setIsOpen(open);
            onOpenChange?.(open);
        };
         return <div data-testid="dropdown-menu-wrapper" data-state={isOpen ? 'open' : 'closed'}>{React.Children.map(children, child => {
            if(React.isValidElement(child) && typeof child.type !== 'string' && (child.type as any).displayName === 'DropdownMenuTrigger') {
               return React.cloneElement(child, { onClick: () => handleOpenChange(!isOpen) } as any);
            }
             if(React.isValidElement(child) && typeof child.type !== 'string' && (child.type as any).displayName === 'DropdownMenuContent') {
               return isOpen ? child : null;
            }
            return child;
         })}</div>;
    };
    const MockDropdownMenuTrigger = ({ children, asChild, onClick }: { children: React.ReactNode; asChild?: boolean, onClick?: () => void }) => (
         asChild ? React.cloneElement(children as React.ReactElement, {onClick}) : <button data-testid="dropdown-trigger" onClick={onClick}>{children}</button>
    );
    const MockDropdownMenuContent = ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
        <div data-testid="dropdown-content" {...props}>{children}</div>
    );
    const MockDropdownMenuItem = ({ children, onClick, disabled, onSelect, ...props }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; onSelect?: React.ReactEventHandler<HTMLDivElement>, [key: string]: any }) => (
        <div data-testid="dropdown-item" onClick={!disabled ? onClick : undefined} onSelect={onSelect} role="menuitem" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} {...props}>
            {children}
        </div>
    );

    (MockDropdownMenu as any).displayName = 'DropdownMenu';
    (MockDropdownMenuTrigger as any).displayName = 'DropdownMenuTrigger';
    (MockDropdownMenuContent as any).displayName = 'DropdownMenuContent';


    return {
        ...actual,
        DropdownMenu: MockDropdownMenu,
        DropdownMenuTrigger: MockDropdownMenuTrigger,
        DropdownMenuContent: MockDropdownMenuContent,
        DropdownMenuItem: MockDropdownMenuItem,
    };
});


vi.mock('@workspace/ui/components/button', () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }>(
    ({ children, className, variant, ...props }, ref) => (
        <button ref={ref} className={`mock-button ${className} variant-${variant}`} {...props}>
            {children}
        </button>
    )
  )
}));

vi.mock('lucide-react', () => ({
  ChevronDown: ({ className }: { className?: string }) => <svg data-testid="chevron-down-icon" className={className} />,
  Cpu: () => <svg data-testid="cpu-icon" />,
  Brain: () => <svg data-testid="brain-icon" />,
  Lock: () => <svg data-testid="lock-icon" />,
}));


describe('ChangeModel Component', () => {
  const mockSetTab = vi.fn();

  const TestWrapper = ({ children, initialTabValue = 'sequential' }: { children: React.ReactNode; initialTabValue?: string }) => {
     const [tab, setTabInternal] = useState(initialTabValue);
     const contextValue: TabContextType = {
       tab,
       setTab: (value) => {
         mockSetTab(value);
         const newValue = typeof value === 'function' ? (value as (prevState: string) => string)(tab) : value;
         setTabInternal(newValue);
       }
     };
     return <TabContext.Provider value={contextValue}>{children}</TabContext.Provider>;
   };


  const renderComponent = (
    initialTab = 'sequential',
    sessionData: any = { user: { isPremium: false }, expires: 'never' },
    sessionStatus = 'authenticated'
  ) => {
    mockUseSession.mockReturnValue({ data: sessionData, status: sessionStatus });

    return render(
        <TestWrapper initialTabValue={initialTab}>
             <ChangeModel />
        </TestWrapper>
    );
  };


  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    mockUseSession.mockReturnValue({ data: { user: { isPremium: false } }, status: 'authenticated' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    render(
        <TestWrapper initialTabValue='sequential'>
            <ChangeModel />
        </TestWrapper>
    );
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(screen.getByText('', {selector: '.animate-pulse .bg-muted'})).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });


  it('should render sequential model selected by default for non-premium user', () => {
    renderComponent('sequential');
    expect(screen.getByRole('button', { name: /Sequential/i })).toBeInTheDocument();
    expect(screen.getByTestId('cpu-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('brain-icon')).not.toBeInTheDocument();
  });

   it('should render sequential model selected by default for premium user', () => {
     renderComponent('sequential', { user: { isPremium: true } }, 'authenticated');
     expect(screen.getByRole('button', { name: /Sequential/i })).toBeInTheDocument();
     expect(screen.getByTestId('cpu-icon')).toBeInTheDocument();
     expect(screen.queryByTestId('brain-icon')).not.toBeInTheDocument();
   });

  it('should open dropdown and show models for non-premium user', async () => {
    renderComponent('sequential');
    const triggerButton = screen.getByRole('button', { name: /Sequential/i });

    await act(async () => {
      fireEvent.click(triggerButton);
    });

    const sequentialItem = await screen.findByRole('menuitem', { name: /Sequential Standard model/i });
    const bertItem = await screen.findByRole('menuitem', { name: /BERT Requires Premium/i });

    expect(sequentialItem).toBeInTheDocument();
    expect(bertItem).toBeInTheDocument();
    expect(bertItem).toHaveAttribute('aria-disabled', 'true');
    expect(bertItem.querySelector('[data-testid="lock-icon"]')).toBeInTheDocument();
  });

   it('should open dropdown and show models for premium user', async () => {
     renderComponent('sequential', { user: { isPremium: true } }, 'authenticated');
     const triggerButton = screen.getByRole('button', { name: /Sequential/i });

     await act(async () => {
       fireEvent.click(triggerButton);
     });

     const sequentialItem = await screen.findByRole('menuitem', { name: /Sequential Standard model/i });
     const bertItem = await screen.findByRole('menuitem', { name: /BERT Advanced model/i });

     expect(sequentialItem).toBeInTheDocument();
     expect(bertItem).toBeInTheDocument();
     expect(bertItem).not.toHaveAttribute('aria-disabled', 'true');
     expect(bertItem.querySelector('[data-testid="lock-icon"]')).not.toBeInTheDocument();
   });

   it('should not call setTab when disabled BERT model is clicked', async () => {
     renderComponent('sequential');
     const triggerButton = screen.getByRole('button', { name: /Sequential/i });
     await act(async () => { fireEvent.click(triggerButton); });

     const bertItem = await screen.findByRole('menuitem', { name: /BERT Requires Premium/i });
     expect(bertItem).toHaveAttribute('aria-disabled', 'true');

     await act(async () => { fireEvent.click(bertItem); });

     expect(mockSetTab).not.toHaveBeenCalled();
   });

   it('should call setTab with "bert" when enabled BERT model is clicked by premium user', async () => {
     renderComponent('sequential', { user: { isPremium: true } }, 'authenticated');
     const triggerButton = screen.getByRole('button', { name: /Sequential/i });
     await act(async () => { fireEvent.click(triggerButton); });

     const bertItem = await screen.findByRole('menuitem', { name: /BERT Advanced model/i });
     await act(async () => { fireEvent.click(bertItem); });

     expect(mockSetTab).toHaveBeenCalledWith('bert');
   });

  it('should call setTab with "sequential" when Sequential model is clicked', async () => {
     renderComponent('bert', { user: { isPremium: true } }, 'authenticated');
     const triggerButton = screen.getByRole('button', { name: /BERT/i });
     await act(async () => { fireEvent.click(triggerButton); });

     const sequentialItem = await screen.findByRole('menuitem', { name: /Sequential Standard model/i });
     await act(async () => { fireEvent.click(sequentialItem); });

     expect(mockSetTab).toHaveBeenCalledWith('sequential');
   });

  it('should update button text and icon when tab changes (premium user)', async () => {
      mockUseSession.mockReturnValue({ data: { user: { isPremium: true } }, status: 'authenticated' });

      render(
         <TestWrapper initialTabValue='sequential'>
             <ChangeModel />
         </TestWrapper>
      );

      expect(screen.getByRole('button', { name: /Sequential/i })).toBeInTheDocument();
      expect(screen.getByTestId('cpu-icon')).toBeInTheDocument();

      const triggerButton = screen.getByRole('button', { name: /Sequential/i });
      await act(async () => { fireEvent.click(triggerButton); });
      const bertItem = await screen.findByRole('menuitem', { name: /BERT Advanced model/i });
      await act(async () => { fireEvent.click(bertItem); });

      const updatedButton = await screen.findByRole('button', { name: /BERT/i });
      expect(updatedButton).toBeInTheDocument();

      expect(within(updatedButton).getByTestId('brain-icon')).toBeInTheDocument();
      expect(within(updatedButton).queryByTestId('cpu-icon')).not.toBeInTheDocument();

   });

  it('should automatically switch to sequential if non-premium user has bert selected initially', async () => {
    renderComponent('bert');

    await waitFor(() => {
        expect(mockSetTab).toHaveBeenCalledWith('sequential');
    });

    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sequential/i })).toBeInTheDocument();
    })
    expect(screen.getByTestId('cpu-icon')).toBeInTheDocument();
  });


  it('should toggle chevron icon direction based on dropdown state', async () => {
      renderComponent('sequential');
      const triggerButton = screen.getByRole('button', { name: /Sequential/i });
      const chevronIcon = screen.getByTestId('chevron-down-icon');

      expect(chevronIcon).toHaveClass('rotate-0');
      expect(chevronIcon).not.toHaveClass('rotate-180');

      await act(async () => {
          fireEvent.click(triggerButton);
      });

      await waitFor(() => {
        expect(chevronIcon).toHaveClass('rotate-180');
      });
      expect(chevronIcon).not.toHaveClass('rotate-0');
   });
});