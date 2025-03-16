'use client';

import React, { Component, useEffect, useState, ErrorInfo, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';
import { Navigation as Navbar } from '@/components/landing';

const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

interface SwaggerErrorBoundaryProps {
  children: ReactNode;
}

interface SwaggerErrorBoundaryState {
  hasError: boolean;
}

class SwaggerErrorBoundary extends Component<SwaggerErrorBoundaryProps, SwaggerErrorBoundaryState> {
  private originalConsoleError: typeof console.error | null;

  constructor(props: SwaggerErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
    
    this.originalConsoleError = null;
  }

  componentDidMount(): void {
    this.originalConsoleError = console.error;
    
    console.error = (...args: any[]): void => {
      const errorMessage = args.join(' ');
      if (errorMessage.includes('UNSAFE_componentWillReceiveProps') || 
          errorMessage.includes('componentWillReceiveProps')) {
        return;
      }
      
      if (this.originalConsoleError) {
        this.originalConsoleError.apply(console, args);
      }
    };
  }

  componentWillUnmount(): void {
    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }
  }

  static getDerivedStateFromError(error: Error): SwaggerErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.log('SwaggerUI error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div>Error loading Swagger UI. Please check console for details.</div>;
    }

    return this.props.children;
  }
}

export default function ApiDocs(): JSX.Element {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div>Loading documentation...</div>;
  }

  return (
    <>
    <Navbar/>
    <SwaggerErrorBoundary>
      <div className="swagger-container py-10">
        <SwaggerUI url="/api/docs" />
      </div>
    </SwaggerErrorBoundary>

    </>
  );
}