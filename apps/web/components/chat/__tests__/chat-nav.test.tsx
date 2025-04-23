import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { ChatNav } from '../chat-nav';
import { TabProvider } from '@/contexts/tabContext';

const mockSignOut = vi.fn();
const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signOut: (options: any) => mockSignOut(options),
}));

const mockSetTheme = vi.fn();
const mockUseTheme = vi.fn(() => ({ theme: 'dark', setTheme: mockSetTheme }));
vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: any }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    motion: {
      div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...props }, ref) => (
          <div {...props} ref={ref}>
            {children}
          </div>
        )
      ),
    },
  };
});

vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('@/components/common', () => ({
  Logo: () => <div data-testid="logo">MockLogo</div>,
}));

vi.mock('../change-model', () => {
  return {
    default: () => <div data-testid="change-model">MockChangeModel</div>,
  };
});


vi.mock('@workspace/ui/components/dropdown-menu', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@workspace/ui/components/dropdown-menu')>();
    return {
        ...actual,
        DropdownMenu: ({ children, onOpenChange }: {children: React.ReactNode, onOpenChange?: (open: boolean) => void}) => (
            <div data-testid="dropdown-menu" data-onopenchange={onOpenChange ? 'true' : 'false'}>{children}</div>
        ),
        DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
             asChild ? children : <button data-testid="dropdown-trigger">{children}</button>
        ),
        DropdownMenuContent: ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
            <div data-testid="dropdown-content" {...props}>{children}</div>
        ),
        DropdownMenuItem: ({ children, onClick, asChild, className, ...props }: { children: React.ReactNode; onClick?: () => void; asChild?: boolean; className?: string, [key: string]: any }) => (
            asChild
             ? React.cloneElement(children as React.ReactElement, { onClick, className, ...props })
             : <div data-testid="dropdown-item" onClick={onClick} role="menuitem" className={className} {...props}>{children}</div>
        ),
        DropdownMenuSeparator: () => <hr data-testid="dropdown-separator" />,
    };
});


vi.mock('@workspace/ui/components/avatar', () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="avatar" className={className}>{children}</div>
  ),
  AvatarImage: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: any }) => (
    <img data-testid="avatar-image" src={src} alt={alt} {...props} />
  ),
  AvatarFallback: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div data-testid="avatar-fallback" className={className}>{children}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  Sun: () => <svg data-testid="sun-icon" />,
  Moon: () => <svg data-testid="moon-icon" />,
  User: () => <svg data-testid="user-icon" />,
  Settings: () => <svg data-testid="settings-icon" />,
  LogOut: () => <svg data-testid="logout-icon" />,
  Cpu: () => <svg data-testid="cpu-icon" />,
  Brain: () => <svg data-testid="brain-icon" />,
  Lock: () => <svg data-testid="lock-icon" />,
  ChevronDown: () => <svg data-testid="chevron-down-icon" />,
}));

describe('ChatNav Component', () => {
  const mockSessionData = {
    user: {
      name: 'Test User',
      email: 'test@example.com',
      image: 'https://example.com/avatar.png',
      isPremium: false,
    },
    expires: 'never',
  };

  const mockSessionDataNoImage = {
    user: {
      name: 'Test User NoImage',
      email: 'test-noimage@example.com',
      isPremium: false,
    },
    expires: 'never',
  };

  const setWindowWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
     window.dispatchEvent(new Event('resize'));
  };

  const renderComponent = () => {
    return render(
      <TabProvider>
        <ChatNav />
      </TabProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({ data: mockSessionData, status: 'authenticated' });
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    setWindowWidth(1024);
  });

   afterEach(() => {
    vi.restoreAllMocks();
   });

  it('should render null if session is not available', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { container } = renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('should render the navbar when session is available', async () => {
    renderComponent();
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('change-model')).toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', mockSessionData.user.image);
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('alt', mockSessionData.user.name);
  });

  it('should render initials in AvatarFallback if user image is not present', () => {
    mockUseSession.mockReturnValue({ data: mockSessionDataNoImage, status: 'authenticated' });
    renderComponent();
    expect(screen.getByTestId('avatar-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('TU');
    expect(screen.queryByTestId('avatar-image')).not.toBeInTheDocument();
  });

  it('should render initials "U" if user name is not present', () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'test@example.com', isPremium: false }, expires: 'never' },
      status: 'authenticated',
    });
    renderComponent();
    expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('U');
   });

  it('should open the dropdown menu on avatar click', async () => {
    renderComponent();
    const avatarTrigger = screen.getByTestId('avatar');

    await act(async () => {
      fireEvent.click(avatarTrigger);
    });

    expect(await screen.findByTestId('dropdown-content')).toBeInTheDocument();
    expect(screen.getByText(mockSessionData.user.name)).toBeInTheDocument();
    expect(screen.getByText(mockSessionData.user.email)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByText(/Light Mode/i)).toBeInTheDocument();
    expect(screen.getByTestId('sun-icon')).toBeInTheDocument();
    expect(screen.getByText(/Logout/i)).toBeInTheDocument();
    expect(screen.getByTestId('logout-icon')).toBeInTheDocument();
  });

  it('should call setTheme when theme toggle item is clicked (dark to light)', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    renderComponent();
    const avatarTrigger = screen.getByTestId('avatar');
     await act(async () => {
      fireEvent.click(avatarTrigger);
    });

    const avatarDropdownContent = avatarTrigger.closest('[data-testid="dropdown-menu"]')?.querySelector('[data-testid="dropdown-content"]');
    expect(avatarDropdownContent).toBeInTheDocument();

    const themeToggleItem = await screen.findByText(/Light Mode/i, { selector: '[data-testid="dropdown-content"] *' });

    await act(async () => {
       fireEvent.click(themeToggleItem);
    });

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('should call setTheme when theme toggle item is clicked (light to dark)', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
    renderComponent();
    const avatarTrigger = screen.getByTestId('avatar');
     await act(async () => {
      fireEvent.click(avatarTrigger);
    });

    const themeToggleItem = await screen.findByText(/Dark Mode/i, { selector: '[data-testid="dropdown-content"] *'});
    expect(screen.getByTestId('moon-icon')).toBeInTheDocument();
    await act(async () => {
       fireEvent.click(themeToggleItem);
    });

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('should call signOut when logout item is clicked', async () => {
    renderComponent();
    const avatarTrigger = screen.getByTestId('avatar');
     await act(async () => {
      fireEvent.click(avatarTrigger);
    });

    const logoutItem = await screen.findByText(/Logout/i, { selector: '[data-testid="dropdown-content"] *'});
     await act(async () => {
      fireEvent.click(logoutItem);
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/" });
  });

  it('should link to the profile page', async () => {
    renderComponent();
    const avatarTrigger = screen.getByTestId('avatar');
     await act(async () => {
      fireEvent.click(avatarTrigger);
    });

    const profileLink = await screen.findByRole('link', { name: /Profile/i });
    expect(profileLink).toBeInTheDocument();
    expect(profileLink).toHaveAttribute('href', '/profile');
    expect(profileLink.querySelector('[data-testid="user-icon"]')).toBeInTheDocument();
  });

  it('should render ChangeModel next to avatar on desktop', async () => {
    setWindowWidth(1024);
    renderComponent();
    await screen.findByTestId('change-model');

    const changeModel = screen.getByTestId('change-model');
    const avatar = screen.getByTestId('avatar');
    const actionItemsContainer = avatar.closest('.flex.items-center.gap-4');

    expect(actionItemsContainer).toBeInTheDocument();
    expect(actionItemsContainer).toContainElement(changeModel);
    expect(actionItemsContainer).toContainElement(avatar.parentElement);

    const mobileWrapper = changeModel.parentElement;
    expect(mobileWrapper).not.toHaveClass('absolute');
    expect(mobileWrapper).not.toHaveClass('left-1/2');
  });

  it('should render ChangeModel in the center on mobile', async () => {
    setWindowWidth(768);
    renderComponent();
    await screen.findByTestId('change-model');

    const changeModel = screen.getByTestId('change-model');
    const avatar = screen.getByTestId('avatar');

    const actionItemsContainer = avatar.closest('.flex.items-center.gap-4');
    expect(actionItemsContainer).not.toContainElement(changeModel);

    const mobileWrapper = changeModel.parentElement;
    expect(mobileWrapper).toHaveClass('absolute');
    expect(mobileWrapper).toHaveClass('left-1/2');
    expect(mobileWrapper).toHaveClass('transform');
    expect(mobileWrapper).toHaveClass('-translate-x-1/2');
  });
});