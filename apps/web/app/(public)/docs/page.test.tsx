import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ApiDocs from './page';

vi.mock('@/components/landing', () => ({
  Navigation: () => <div data-testid="mock-navbar">Navbar</div>,
}));

let MockSwaggerUI: ReturnType<typeof vi.fn>;

vi.mock('swagger-ui-react', () => ({
  default: (props: any) => MockSwaggerUI(props),
}));

vi.mock('next/dynamic', () => ({
  default: vi.fn(() => (props: any) => MockSwaggerUI(props)),
}));


describe('ApiDocs Page', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MockSwaggerUI = vi.fn(({ url }) => (
      <div data-testid="mock-swagger-ui">SwaggerUI Component - URL: {url}</div>
    ));

    vi.clearAllMocks(); 
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });


  it('should render Navbar and SwaggerUI after mounting', async () => {
    render(<ApiDocs />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-swagger-ui')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mock-navbar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-swagger-ui')).toHaveTextContent('SwaggerUI Component - URL: /api/docs');
    expect(MockSwaggerUI).toHaveBeenCalledWith({ url: '/api/docs' });
    expect(screen.getByTestId('mock-swagger-ui').parentElement).toHaveClass('swagger-container py-10');
    expect(screen.queryByText('Loading documentation...')).not.toBeInTheDocument(); // Verify loading text is gone
  });

  it('should render error boundary fallback UI if SwaggerUI throws an error', async () => {
    MockSwaggerUI.mockImplementation(() => {
      throw new Error("Test Swagger Error");
    });

    render(<ApiDocs />);

    await waitFor(() => {
      expect(screen.getByText(/Error loading Swagger UI/)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-swagger-ui')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-navbar')).toBeInTheDocument();
    expect(consoleLogSpy).toHaveBeenCalledWith('SwaggerUI error:', expect.any(Error), expect.any(Object));
  });
});