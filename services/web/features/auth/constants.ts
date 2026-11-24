export const AUTH_COPY = {
  login: {
    label: "Sign In",
    title: "Welcome Back",
    backHref: "/signup",
    backLabel: "Don't have an account? Sign up here.",
    submit: "SIGN IN",
    submitting: "Signing in...",
  },
  signup: {
    label: "Create Account",
    title: "Get Started",
    backHref: "/login",
    backLabel: "Already have an account? Login here.",
    submit: "CREATE ACCOUNT",
    submitting: "Creating account...",
  },
  social: {
    divider: "Or continue with",
    google: "Continue with Google",
    github: "Continue with GitHub",
  },
  fields: {
    firstName: { label: "First Name", placeholder: "John" },
    lastName: { label: "Last Name", placeholder: "Doe" },
    email: { label: "Email", placeholder: "you@example.com" },
    password: { label: "Password", placeholder: "••••••••" },
    confirmPassword: { label: "Confirm Password", placeholder: "••••••••" },
    rememberMe: "Remember me",
  },
  turnstile: {
    config: "Human verification is unavailable right now.",
    expired: "Verification expired. Retry to continue.",
    timeout: "Verification timed out. Retry to continue.",
    unsupported: "Your browser could not load human verification.",
    fallback: "Verification failed. Retry to continue.",
    retry: "Retry verification",
  },
} as const

export const TURNSTILE_ERROR_MESSAGES: Record<string, string> = {
  expired: AUTH_COPY.turnstile.expired,
  timeout: AUTH_COPY.turnstile.timeout,
  unsupported: AUTH_COPY.turnstile.unsupported,
  config: AUTH_COPY.turnstile.config,
}

export const PLACEHOLDER_SITE_KEYS = new Set([
  "mock-turnstile-site-key-not-configured",
  "dummy",
])
