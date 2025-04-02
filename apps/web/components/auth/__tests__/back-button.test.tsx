import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BackButton } from '../back-button'; // Adjust the import path


vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>
}));

vi.mock('@workspace/ui/components/button', () => ({
    Button: ({ children, variant, className, size, asChild }: { children: React.ReactNode, variant?: string, className?: string, size?: string, asChild?: boolean }) => {
        if (asChild) {
            return <>{children}</>;
        }
        return <button className={className} data-variant={variant} data-size={size}>{children}</button>;
    }
}));


describe('BackButton Component', () => {
    const testLabel = 'Go Back';
    const testHref = '/previous-page';

    it('should render a link with the correct label', () => {
        render(<BackButton label={testLabel} href={testHref} />);
        const linkElement = screen.getByRole('link', { name: testLabel });
        expect(linkElement).toBeInTheDocument();
        expect(linkElement).toHaveTextContent(testLabel);
    });

    it('should render a link with the correct href attribute', () => {
        render(<BackButton label={testLabel} href={testHref} />);
        const linkElement = screen.getByRole('link', { name: testLabel });
        expect(linkElement).toHaveAttribute('href', testHref);
    });

});