import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from 'next-themes';
import { signIn } from 'next-auth/react';
import { CardWrapper } from '../card-wrapper';


vi.mock('next/image', () => ({
    default: ({ src, alt, ...props }: any) => <img src={typeof src === 'string' ? src : src.src} alt={alt} {...props} />, // Handle src object
}));

vi.mock('next-themes', () => ({
    useTheme: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
    signIn: vi.fn(),
}));

vi.mock('@workspace/ui/components/card', () => ({
    Card: ({ children, className }: { children: React.ReactNode, className?: string }) => <div className={`mock-card ${className || ''}`}>{children}</div>, // Added || '' for safety
    CardHeader: ({ children }: { children: React.ReactNode }) => <header className="mock-card-header">{children}</header>,
    CardContent: ({ children }: { children: React.ReactNode }) => <div className="mock-card-content">{children}</div>,
    CardFooter: ({ children }: { children: React.ReactNode }) => <footer className="mock-card-footer">{children}</footer>,
}));

vi.mock('./auth-header', () => ({
    AuthHeader: ({ label, title }: { label: string, title: string }) => (
        <div>
            <h1>{title}</h1>
            <p>{label}</p>
             <a href="/">Home</a>
        </div>
    ),
}));

vi.mock('./back-button', () => ({
    BackButton: ({ label, href }: { label: string, href: string }) => (
         <a href={href}>{label}</a> 
    ),
}));


vi.mock('@workspace/ui/components/button', () => ({
    Button: ({ children, onClick, variant, className, asChild }: { children: React.ReactNode, onClick?: () => void, variant?: string, className?: string, asChild?: boolean }) => {
        if (asChild && React.isValidElement(children)) {
             return React.cloneElement(children as React.ReactElement);
        }
        return <button onClick={onClick} className={className} data-variant={variant}>{children}</button>;
    }
}));


vi.mock('@/components/common', () => ({
    Logo: () => <div data-testid="logo">Logo</div>,
}));

vi.mock('react-icons/fa', () => ({
    FaGoogle: (props: any) => <svg data-testid="google-icon" {...props} />,
    FaGithub: (props: any) => <svg data-testid="github-icon" {...props} />,
}));


// --- Tests ---

describe('CardWrapper Component', () => {
    // @ts-ignore
    const mockUseTheme = useTheme as vi.Mock;
    // @ts-ignore
    const mockSignIn = signIn as vi.Mock;
    const user = userEvent.setup();

    const defaultProps = {
        label: 'Test Label',
        title: 'Test Title',
        backButtonHref: '/back',
        backButtonLabel: 'Go Back',
        children: <div data-testid="test-child">Test Child Content</div>,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseTheme.mockReturnValue({ theme: 'light', resolvedTheme: 'light' });
        vi.spyOn(React, 'useState').mockImplementation(() => [true, vi.fn()]);
        vi.spyOn(React, 'useEffect').mockImplementation((f) => { f(); return () => {}; });
    });

    it('should render AuthHeader content with correct title and label', () => {
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByRole('heading', { name: defaultProps.title })).toBeInTheDocument();
        expect(screen.getByText(defaultProps.label)).toBeInTheDocument();
    });

    it('should render BackButton as a link with correct label and href', () => {
        render(<CardWrapper {...defaultProps} />);
        const backButtonLink = screen.getByRole('link', { name: defaultProps.backButtonLabel });
        expect(backButtonLink).toBeInTheDocument();
        expect(backButtonLink).toHaveTextContent(defaultProps.backButtonLabel);
        expect(backButtonLink).toHaveAttribute('href', defaultProps.backButtonHref);
    });

     it('should render child components', () => {
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByTestId('test-child')).toBeInTheDocument();
        expect(screen.getByText('Test Child Content')).toBeInTheDocument();
    });

    it('should render social login buttons', () => {
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
        expect(screen.getByTestId('google-icon')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Continue with GitHub/i })).toBeInTheDocument();
        expect(screen.getByTestId('github-icon')).toBeInTheDocument();
    });

    it('should call signIn with "google" when Google button is clicked', async () => {
        render(<CardWrapper {...defaultProps} />);
        const googleButton = screen.getByRole('button', { name: /Continue with Google/i });
        await user.click(googleButton);
        expect(mockSignIn).toHaveBeenCalledTimes(1);
        expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/chat' });
    });

    it('should call signIn with "github" when GitHub button is clicked', async () => {
        render(<CardWrapper {...defaultProps} />);
        const githubButton = screen.getByRole('button', { name: /Continue with GitHub/i });
        await user.click(githubButton);
        expect(mockSignIn).toHaveBeenCalledTimes(1);
        expect(mockSignIn).toHaveBeenCalledWith('github', { callbackUrl: '/chat' });
    });

     it('should render the "or" separator', () => {
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByText('or')).toBeInTheDocument();
      });

    it('should render the image section on larger screens (presence check)', () => {
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByAltText('Auth image')).toBeInTheDocument();
        expect(screen.getByTestId('logo')).toBeInTheDocument();
        expect(screen.getByText(/Using Detect AI has drastically improved/)).toBeInTheDocument();
        expect(screen.getByText('Bhaskar P.')).toBeInTheDocument();
    });

     it('should apply correct icon color class for light theme', () => {
        mockUseTheme.mockReturnValue({ theme: 'light', resolvedTheme: 'light' });
        vi.spyOn(React, 'useState').mockImplementation(() => [true, vi.fn()]);
        vi.spyOn(React, 'useEffect').mockImplementation((f) => { f(); return () => {}; });
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByTestId('google-icon')).toHaveClass('text-black');
        expect(screen.getByTestId('github-icon')).toHaveClass('text-black');
    });

    it('should apply correct icon color class for dark theme', () => {
        mockUseTheme.mockReturnValue({ theme: 'dark', resolvedTheme: 'dark' });
        vi.spyOn(React, 'useState').mockImplementation(() => [true, vi.fn()]);
        vi.spyOn(React, 'useEffect').mockImplementation((f) => { f(); return () => {}; });
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByTestId('google-icon')).toHaveClass('text-white');
        expect(screen.getByTestId('github-icon')).toHaveClass('text-white');
    });

     it('should apply correct icon color class for system theme resolving to dark', () => {
        mockUseTheme.mockReturnValue({ theme: 'system', resolvedTheme: 'dark' });
         vi.spyOn(React, 'useState').mockImplementation(() => [true, vi.fn()]);
        vi.spyOn(React, 'useEffect').mockImplementation((f) => { f(); return () => {}; });
        render(<CardWrapper {...defaultProps} />);
        expect(screen.getByTestId('google-icon')).toHaveClass('text-white');
        expect(screen.getByTestId('github-icon')).toHaveClass('text-white');
    });
});