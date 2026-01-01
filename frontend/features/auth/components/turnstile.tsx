"use client";

import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef } from "react";

interface TurnstileComponentProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: (error: unknown) => void;
  onExpire?: () => void;
}

export function TurnstileComponent({
  siteKey,
  onVerify,
  onError,
  onExpire,
}: TurnstileComponentProps) {
  const turnstileRef = useRef<TurnstileInstance>(null);

  const handleSuccess = (token: string) => {
    onVerify(token);
  };

  const handleError = (error: unknown) => {
    console.error("Turnstile Error:", error);
    if (onError) {
      onError(error);
    }
  };

  return (
    <Turnstile
      ref={turnstileRef}
      siteKey={siteKey}
      onSuccess={handleSuccess}
      onError={handleError}
      onExpire={onExpire}
    />
  );
}