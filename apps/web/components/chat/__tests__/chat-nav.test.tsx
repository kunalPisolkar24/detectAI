import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from 'next-themes';
import { useSession, signOut } from 'next-auth/react';
import { ChatNav } from '../chat-nav';

// --- Mocks ---

vi.mock('next/link', () => ({
    default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => <a href={href} className={className}>{children}</a>
}));

vi.mock('next-themes', () => ({
    useTheme: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
    useSession: vi.fn(),
    signOut: vi.fn(),
}));

vi.mock('@/components/common', () => ({
    Logo: () => <div data-testid="logo">Logo</div>,
}));

vi.mock('@workspace/ui/components/dropdown-menu', () => ({
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) => asChild ? children : <button>{children}</button>,
    DropdownMenuContent: ({ children, className, align }: { children: React.ReactNode, className?: string, align?: string }) => <div data-testid="dropdown-content" className={className} data-align={align}>{children}</div>,
    DropdownMenuItem: ({ children, onClick, className, asChild }: { children: React.ReactNode, onClick?: () => void, className?: string, asChild?: boolean }) => asChild ? <div>{children}</div> : <button onClick={onClick} className={className}>{children}</button>,
}));

vi.mock('@workspace/ui/components/avatar', () => ({
    Avatar: ({ children, className }: { children: React.ReactNode, className?: string }) => <div data-testid="avatar" className={`mock-avatar ${className}`}>{children}</div>,
    AvatarImage: ({ src, alt }: { src: string, alt: string }) => <img src={src} alt={alt} data-testid="avatar-image" />,
    AvatarFallback: ({ children }: { children: React.ReactNode }) => <div data-testid="avatar-fallback">{children}</div>,
}));

vi.mock('lucide-react', () => ({
    Sun: (props: any) => <svg data-testid="sun-icon" {...props} />,
    Moon: (props: any) => <svg data-testid="moon-icon" {...props} />,
    User: (props: any) => <svg data-testid="user-icon" {...props} />,
    Settings: (props: any) => <svg data-testid="settings-icon" {...props} />,
    LogOut: (props: any) => <svg data-testid="logout-icon" {...props} />,
}));


vi.mock('@/contexts/tabContext', () => ({
    useTab: vi.fn(() => ({
        tab: 'sequential',
        setTab: vi.fn(),
    })),
}));

vi.mock('../change-model', () => ({ 
    default: () => <div data-testid="change-model">ChangeModel</div>,
}));


// --- Test Suite ---

describe('ChatNav Component', () => {
    const mockSetTheme = vi.fn();
    // @ts-ignore
    const mockUseSession = useSession as vi.Mock;
    // @ts-ignore
    const mockUseTheme = useTheme as vi.Mock;
    // @ts-ignore
    const mockSignOut = signOut as vi.Mock;

    const user = userEvent.setup();

    const mockSession = {
        data: {
            user: {
                name: 'Test User',
                image: 'http://example.com/avatar.png',
            },
        },
    };

    const mockSessionNoImage = {
       data: {
            user: {
                name: 'Test User',
                image: null,
            },
        },
    };

    // Mock window resize - Start with desktop width
    const setWindowWidth = (width: number) => {
        global.innerWidth = width;
        global.dispatchEvent(new Event('resize'));
    };

 beforeEach(() => {
        vi.clearAllMocks();
        mockUseSession.mockReturnValue({ data: null }); // Default: no session
        mockUseTheme.mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
        setWindowWidth(1024);
        vi.spyOn(React, 'useEffect').mockImplementation(effect => { effect(); });
    });

    it('should render null if no session exists', () => {
        const { container } = render(<ChatNav />);
        expect(container.firstChild).toBeNull();
    });

    it('should render Logo and Avatar when session exists', () => {
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        expect(screen.getByTestId('logo')).toBeInTheDocument();
        expect(screen.getByTestId('avatar')).toBeInTheDocument();
    });

    it('should display AvatarImage when user image exists', () => {
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        expect(screen.getByTestId('avatar-image')).toBeInTheDocument();
        expect(screen.getByAltText('Test User')).toHaveAttribute('src', mockSession.data.user.image);
        expect(screen.queryByTestId('avatar-fallback')).not.toBeInTheDocument();
    });

    it('should display AvatarFallback with initials when no user image', () => {
        mockUseSession.mockReturnValue(mockSessionNoImage);
        render(<ChatNav />);
        expect(screen.getByTestId('avatar-fallback')).toBeInTheDocument();
        expect(screen.getByText('TU')).toBeInTheDocument(); // Initials for "Test User"
        expect(screen.queryByTestId('avatar-image')).not.toBeInTheDocument();
    });

    it('should render dropdown items correctly', () => {
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        expect(screen.getByRole('link', { name: /Profile/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Settings/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dark Mode/i })).toBeInTheDocument(); // Assumes initial theme is light
        expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
    });

    it('should have correct links for Profile and Settings', () => {
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        expect(screen.getByRole('link', { name: /Profile/i })).toHaveAttribute('href', '/profile');
        expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings');
    });

    it('should call setTheme to toggle theme when theme button is clicked (light to dark)', async () => {
        mockUseTheme.mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        const themeButton = screen.getByRole('button', { name: /Dark Mode/i });
        await user.click(themeButton);
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
    });

     it('should call setTheme to toggle theme when theme button is clicked (dark to light)', async () => {
        mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        const themeButton = screen.getByRole('button', { name: /Light Mode/i });
        await user.click(themeButton);
        expect(mockSetTheme).toHaveBeenCalledWith('light');
    });

     it('should display correct theme toggle text and icon based on current theme', () => {
        mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        expect(screen.getByRole('button', { name: /Light Mode/i })).toBeInTheDocument();
        expect(screen.getByTestId('sun-icon')).toBeInTheDocument(); 
        expect(screen.queryByTestId('moon-icon')).not.toBeInTheDocument();
     });

    it('should call signOut when logout button is clicked', async () => {
        mockUseSession.mockReturnValue(mockSession);
        render(<ChatNav />);
        const logoutButton = screen.getByRole('button', { name: /Logout/i });
        await user.click(logoutButton);
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/" });
    });

    it('should not render ChangeModel on desktop', () => {
        mockUseSession.mockReturnValue(mockSession);
        setWindowWidth(1024);
        render(<ChatNav />);
        expect(screen.queryByTestId('change-model')).not.toBeInTheDocument();
    });

     it('should render ChangeModel on mobile', () => {
        mockUseSession.mockReturnValue(mockSession);
        setWindowWidth(500);
        render(<ChatNav />); 
        expect(screen.getByTestId('change-model')).toBeInTheDocument();
    });
});