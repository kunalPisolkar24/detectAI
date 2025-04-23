import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardWrapper } from '../card-wrapper';
import '@testing-library/jest-dom';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

const signInMock = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => signInMock(...args),
}));

vi.mock('next/font/google', () => ({
  Merriweather: () => ({
    className: 'mock-merriweather-classname',
  }),
}));

vi.mock('next/image', () => ({
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={props.src || ''} alt={props.alt || ''} data-testid="next-image-mock"/>;
  },
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    motion: {
      div: vi.fn(({ children, ...props }) => <div {...props}>{children}</div>),
      h1: vi.fn(({ children, ...props }) => <h1 {...props}>{children}</h1>),
      button: vi.fn(({ children, ...props }) => <button {...props}>{children}</button>),
    },
  };
});


vi.mock('@workspace/ui/lib/utils', () => ({
  cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('@workspace/ui/components/card', () => ({
  Card: ({ children, className }: any) => <div className={`mock-card ${className}`}>{children}</div>,
  CardHeader: ({ children }: any) => <div className="mock-card-header">{children}</div>,
  CardContent: ({ children }: any) => <div className="mock-card-content">{children}</div>,
  CardFooter: ({ children }: any) => <div className="mock-card-footer">{children}</div>,
}));

vi.mock('@workspace/ui/components/button', () => ({
  Button: ({ children, onClick, className, variant, ...props }: any) => (
    <button onClick={onClick} className={`mock-button ${className || ''}`} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../auth-header', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth-header')>();
  return {
    ...actual,
    AuthHeader: ({ label, title }: { label: string; title: string }) => (
      <div data-testid="auth-header">
        <h1>{title}</h1>
        <p>{label}</p>
      </div>
    ),
  };
});


vi.mock('../back-button', () => ({
  BackButton: ({ label, href }: { label: string; href: string }) => (
    <a href={href} data-testid="back-button">
      {label}
    </a>
  ),
}));


vi.mock('@/components/common', () => ({
  Logo: () => <div data-testid="logo">Mock Logo</div>,
}));


describe('CardWrapper', () => {
  const mockProps = {
    label: 'Test Label',
    title: 'Test Title',
    backButtonHref: '/test-back-href',
    backButtonLabel: 'Test Back Label',
    children: <div data-testid="test-children">Test Children Content</div>,
  };

  const setup = async (props = mockProps, mockEffect = false) => {
     if (mockEffect) {
       const originalUseEffect = React.useEffect;
       vi.spyOn(React, 'useEffect').mockImplementationOnce(f => {});
     }
     const renderResult = render(<CardWrapper {...props} />);
     if(!mockEffect) {
         await screen.findByTestId('auth-header'); 
     }

     if (mockEffect) {
        vi.restoreAllMocks();
     }
     return renderResult;
  };


  beforeEach(async () => {
    vi.clearAllMocks();
    await setup(); 
  });


  it('should render the AuthHeader with correct title and label', () => {
    const header = screen.getByTestId('auth-header');
    expect(header).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: mockProps.title })).toBeInTheDocument();
    expect(screen.getByText(mockProps.label)).toBeInTheDocument();
  });

  it('should render the children content', () => {
    expect(screen.getByTestId('test-children')).toBeInTheDocument();
    expect(screen.getByText('Test Children Content')).toBeInTheDocument();
  });

  it('should render Google and GitHub sign-in buttons', () => {
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /github/i })).toBeInTheDocument();
  });

  it('should render the "or continue with email" divider', () => {
    expect(screen.getByText('or continue with email')).toBeInTheDocument();
  });

  it('should render the BackButton with correct label and href', () => {
    const backButton = screen.getByTestId('back-button');
    expect(backButton).toBeInTheDocument();
    expect(backButton).toHaveTextContent(mockProps.backButtonLabel);
    expect(backButton).toHaveAttribute('href', mockProps.backButtonHref);
  });

  it('should call signIn with "google" when Google button is clicked', async () => {
    const user = userEvent.setup();
    const googleButton = screen.getByRole('button', { name: /google/i });
    await user.click(googleButton);
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/chat' });
  });

  it('should call signIn with "github" when GitHub button is clicked', async () => {
    const user = userEvent.setup();
    const githubButton = screen.getByRole('button', { name: /github/i });
    await user.click(githubButton);
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith('github', { callbackUrl: '/chat' });
  });

  it('should render the auth image placeholder', () => {
     expect(screen.getByTestId('next-image-mock')).toBeInTheDocument();
     expect(screen.getByAltText('Auth image')).toBeInTheDocument();
  });

});