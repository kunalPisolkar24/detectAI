import { LoginForm } from '@/components/auth'
import React, { Suspense } from 'react';
import { cn } from "@workspace/ui/lib/utils";

function LoginLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-var(--header-height,80px))]">
      <div
        className={cn(
          "animate-spin rounded-full h-12 w-12 border-4",
          "border-gray-200 dark:border-gray-600",
          "border-t-blue-600 dark:border-t-blue-400" 
        )}
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading chat...</span>
      </div>
    </div>
  );
}

const LoginPage = () => {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <LoginForm />
    </Suspense>
  )
}

export default LoginPage