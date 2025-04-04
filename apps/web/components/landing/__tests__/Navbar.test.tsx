import React, { useState as originalUseState } from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => {
  const createMotionComponent = (tag: keyof JSX.IntrinsicElements) =>
    React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement(tag, { ref, ...props }, children)
    );
  return {
    motion: {
      div: createMotionComponent('div'),
      nav: createMotionComponent('nav'),
      span: createMotionComponent('span'),
      button: createMotionComponent('button'),
      header: createMotionComponent('header'),
      a: createMotionComponent('a'),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useScroll: vi.fn(() => ({ scrollY: { get: () => 0, onChange: vi.fn() } })),
    useTransform: vi.fn((value) => value),
  };
});

// Mock next/link
vi.mock('next/link', () => ({
    default: ({ children, href, className, onClick }: { children: React.ReactNode, href: string, className?: string, onClick?: () => void }) => (
        <a href={href} className={className} onClick={onClick}>{children}</a>
    )
}));

// Mock utils
vi.mock('@workspace/ui/lib/utils', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock Button
vi.mock('@workspace/ui/components/button', () => ({
    Button: React.forwardRef(({ children, className, variant, onClick, ...props }: any, ref: any) => <button ref={ref} className={className} data-variant={variant} onClick={onClick} {...props}>{children}</button>),
}));

// Mock Sheet
let isSheetCurrentlyOpen = false;
let associatedOnOpenChange: ((open: boolean) => void) | null = null;
vi.mock('@workspace/ui/components/sheet', () => ({
    Sheet: ({ children, open, onOpenChange }: { children: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) => {
        isSheetCurrentlyOpen = open;
        associatedOnOpenChange = onOpenChange;
        return <div data-testid="sheet-root" data-sheet-open={open}>{children}</div>;
    },
    SheetTrigger: ({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) => {
        const triggerAction = () => {
            if (associatedOnOpenChange) {
                associatedOnOpenChange(true);
            } else {
                console.warn('SheetTrigger Mock: associatedOnOpenChange not captured!');
            }
        };
        if (asChild && React.isValidElement(children)) {
            const originalOnClick = children.props.onClick;
            return React.cloneElement(children as React.ReactElement, {
                onClick: (event: React.MouseEvent) => {
                    if (originalOnClick) originalOnClick(event);
                    triggerAction();
                }
            });
        }
        return <button data-testid="sheet-trigger-button" onClick={triggerAction}>{children}</button>;
    },
    SheetContent: ({ children, className }: { children: React.ReactNode; className?: string }) => {
        if (!isSheetCurrentlyOpen) return null;
        return <div data-testid="sheet-content" className={className}>{children}</div>;
    },
    SheetTitle: ({ children }: { children: React.ReactNode }) => <h2 className="sr-only">{children}</h2>,
}));

// Mock lucide-react
vi.mock('lucide-react', async () => {
     const icons = {
        PanelRight: (props: any) => <svg data-testid="panel-right-icon" {...props} />,
        X: (props: any) => <svg data-testid="x-icon" {...props} />,
        Sun: (props: any) => <svg data-testid="sun-icon" {...props} />,
        Moon: (props: any) => <svg data-testid="moon-icon" {...props} />,
        BotIcon: (props: any) => <svg data-testid="bot-icon" {...props} />,
        FileText: (props: any) => <svg data-testid="filetext-icon" {...props} />,
        Package: (props: any) => <svg data-testid="package-icon" {...props} />,
        DollarSign: (props: any) => <svg data-testid="dollarsign-icon" {...props} />,
        HelpCircle: (props: any) => <svg data-testid="helpcircle-icon" {...props} />,
        LogIn: (props: any) => <svg data-testid="login-icon" {...props} />,
    };
    return icons;
});

// --- Test Suite Imports ---
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme as actualUseTheme } from 'next-themes';
import { Navigation } from '../Navbar';

// --- Get Mock References ---
// @ts-ignore
const mockedUseTheme = actualUseTheme as vi.Mock;

// --- Test Suite ---
describe('Navigation Component', () => {
    const mockSetTheme = vi.fn();
    const user = userEvent.setup({ delay: null });

    // Helper Functions
    const setWindowWidth = (width: number) => {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
        window.dispatchEvent(new Event('resize'));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseTheme.mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
        isSheetCurrentlyOpen = false;
        associatedOnOpenChange = null;
        setWindowWidth(1024); // Default width
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- Tests ---

    it('should render Logo and desktop navigation on wider screens', () => {
        render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const header = screen.getByRole('banner');
        const logoLink = within(header).getAllByRole('link', { name: /Detect AI/i }).find(link => link.getAttribute('href') === '/');
        expect(logoLink).toBeInTheDocument();
        const desktopNav = screen.getByRole('navigation', { name: /Main navigation/i });
        expect(desktopNav).toBeInTheDocument();
        expect(desktopNav).toBeVisible();
        expect(within(desktopNav).getByRole('link', { name: /Detect AI/i })).toHaveAttribute('href', '/chat');
        expect(within(desktopNav).getByRole('link', { name: /Docs/i })).toBeInTheDocument();
        expect(within(desktopNav).getByRole('button', { name: /Log in/i })).toBeInTheDocument();
        expect(within(desktopNav).getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument();
        expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
    });

    it('should render Logo and mobile sheet trigger on smaller screens', () => {
        setWindowWidth(640);
        render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const header = screen.getByRole('banner');
        const logoLink = within(header).getAllByRole('link', { name: /Detect AI/i }).find(link => link.getAttribute('href') === '/');
        expect(logoLink).toBeInTheDocument();

        const desktopNav = screen.queryByRole('navigation', { name: /Main navigation/i });
        expect(desktopNav).toBeVisible();

        const triggerButton = screen.getByRole('button', { name: /Open navigation menu/i });
        expect(triggerButton).toBeInTheDocument();
        expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
    });

    it('should toggle theme when ModeToggle is clicked (desktop)', async () => {
        render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const desktopNav = screen.getByRole('navigation', { name: /Main navigation/i });
        const toggleButton = within(desktopNav).getByRole('button', { name: /Switch to dark theme/i });
        await act(async () => { await user.click(toggleButton); });
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
     });

    it('should display correct theme icon (desktop)', () => {
        mockedUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
        render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const desktopNav = screen.getByRole('navigation', { name: /Main navigation/i });
        const toggleButton = within(desktopNav).getByRole('button', { name: /Switch to light theme/i });
        expect(within(toggleButton).getByTestId('sun-icon')).toBeInTheDocument();
        expect(within(toggleButton).queryByTestId('moon-icon')).not.toBeInTheDocument();
     });

    it('should open mobile sheet when trigger is clicked', async () => {
        setWindowWidth(640);
        const { rerender } = render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const triggerButton = screen.getByRole('button', { name: /Open navigation menu/i });
        expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
        await act(async () => { await user.click(triggerButton); });
        rerender(<Navigation />);
        const sheetContent = screen.getByTestId('sheet-content');
        expect(sheetContent).toBeInTheDocument();
        expect(within(sheetContent).getByRole('link', { name: /Docs/i })).toBeInTheDocument();
        expect(within(sheetContent).getByRole('button', { name: /Log in/i })).toBeInTheDocument();
        expect(within(sheetContent).getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument();
     });

    it('should close mobile sheet when an item is clicked', async () => {
        setWindowWidth(640);
        const { rerender } = render(<Navigation />);
        expect(mockedUseTheme).toHaveBeenCalled();
        const triggerButton = screen.getByRole('button', { name: /Open navigation menu/i });
        expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
        await act(async () => { await user.click(triggerButton); });
        rerender(<Navigation />);
        const sheetContent = screen.getByTestId('sheet-content');
        expect(sheetContent).toBeInTheDocument();
        const docsLink = within(sheetContent).getByRole('link', { name: /Docs/i });
        await act(async () => { await user.click(docsLink); });
        rerender(<Navigation />);
        expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Open navigation menu/i })).toBeInTheDocument();
     });
});