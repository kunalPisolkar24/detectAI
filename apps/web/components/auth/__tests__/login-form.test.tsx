import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoginForm } from "../login-form";
import React from "react";
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

class MockResizeObserver {
  observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
}
// @ts-ignore
global.ResizeObserver = MockResizeObserver;
// @ts-ignore
global.matchMedia = global.matchMedia || function() { return { matches : false, addListener : vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), }; };

// --- Hoisted Mock Declarations ---
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockSignIn = vi.fn();
let mockOnVerify: (token: string) => void = () => {};
const mockFetch = vi.fn();


vi.mock('next/font/google', () => ({ Merriweather: () => ({ className: 'mock-merriweather-font' }), }));

vi.mock("next/navigation", async (importOriginal) => {
    const actual = await importOriginal<typeof import('next/navigation')>();
    return { ...actual, useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh, }), useSearchParams: vi.fn(() => new URLSearchParams()), };
});

vi.mock("next-auth/react", () => ({ signIn: (...args: any[]) => mockSignIn(...args), }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }), }));


vi.mock("@/components/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/common")>();
  return { ...actual, TurnstileComponent: vi.fn(({ onVerify }) => { mockOnVerify = onVerify; return React.createElement('div', { 'data-testid': 'mock-turnstile' }, 'Mock Turnstile'); }), Logo: () => React.createElement('div', { 'data-testid': 'mock-logo' }, 'Mock Logo'), };
});

const toastErrorSpy = vi.spyOn(toast, 'error');

global.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return { getItem: (key: string) => store[key] || null, setItem: (key: string, value: string) => { store[key] = value.toString(); }, removeItem: (key: string) => { delete store[key]; }, clear: () => { store = {}; }, };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

let setItemSpy: ReturnType<typeof vi.spyOn>;
let removeItemSpy: ReturnType<typeof vi.spyOn>;
let getItemSpy: ReturnType<typeof vi.spyOn>;


describe("LoginForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    setItemSpy = vi.spyOn(localStorageMock, 'setItem');
    removeItemSpy = vi.spyOn(localStorageMock, 'removeItem');
    // @ts-ignore
    getItemSpy = vi.spyOn(localStorageMock, 'getItem');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }), });
    mockSignIn.mockResolvedValue({ ok: true, error: null, url: "/chat" });
    // @ts-ignore
    (useSearchParams as vi.Mock).mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.restoreAllMocks(); 
  });


  it("should render the login form correctly", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Remember me/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Forgot password?/i })).toBeInTheDocument();
    expect(screen.getByTestId("mock-turnstile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Sign In")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Don't have an account\? Sign up here./i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GitHub/i })).toBeInTheDocument();
    expect(screen.getByText(/or continue with email/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Welcome Back/i })).toBeInTheDocument();
    expect(screen.getByTestId("mock-logo")).toBeInTheDocument();
  });


  it("should update email and password fields on input", async () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "password123");
    expect(emailInput).toHaveValue("test@example.com");
    expect(passwordInput).toHaveValue("password123");
  });

  it("should toggle password visibility", async () => {
    render(<LoginForm />);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const toggleButton = screen.getByRole("button", { name: /Show password/i });
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(toggleButton);
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: /Hide password/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide password/i }));
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /Show password/i })).toBeInTheDocument();
  });

  it("should update remember me state when checkbox is clicked", async () => {
    render(<LoginForm />);
    const rememberMeCheckbox = screen.getByRole("checkbox", { name: /Remember me/i });
    expect(rememberMeCheckbox).toHaveAttribute('data-state', 'unchecked');
    await user.click(rememberMeCheckbox);
    await waitFor(() => {
        expect(rememberMeCheckbox).toHaveAttribute('data-state', 'checked');
    });
    await user.click(rememberMeCheckbox);
     await waitFor(() => {
        expect(rememberMeCheckbox).toHaveAttribute('data-state', 'unchecked');
     });
  });

  it("should display validation errors using actual schema on submit attempt", async () => {
    render(<LoginForm />);
    const submitButton = screen.getByRole("button", { name: "Sign in" });
    mockOnVerify("mock-token");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    await user.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();
      expect(screen.getByText("Please enter a valid password")).toBeInTheDocument();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

   it("should display password validation error using actual schema", async () => {
     render(<LoginForm />);
     const emailInput = screen.getByLabelText(/Email/i);
     const passwordInput = screen.getByPlaceholderText('••••••••');
     const submitButton = screen.getByRole("button", { name: "Sign in" });
     await user.type(emailInput, "valid@email.com");
     await user.type(passwordInput, "123");
     mockOnVerify("mock-token");
     await waitFor(() => expect(submitButton).not.toBeDisabled());
     await user.click(submitButton);
     await waitFor(() => {
        expect(screen.getByText("Please enter a valid password")).toBeInTheDocument();
     });
     expect(mockSignIn).not.toHaveBeenCalled();
     expect(mockFetch).not.toHaveBeenCalled();
   });

  it("should show error message if Turnstile is not verified on submit", async () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole("button", { name: "Sign in" });
    await user.type(emailInput, "valid@example.com");
    await user.type(passwordInput, "validpassword");
    expect(submitButton).toBeDisabled();
    const form = submitButton.closest('form');
    expect(form).toBeInTheDocument();
    if(form) { fireEvent.submit(form); }
    await screen.findByText(/Please complete human verification/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
  });


  it("should handle Turnstile verification failure", async () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole("button", { name: "Sign in" });
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "password123");
    mockOnVerify("mock-token-123");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: "Mock Turnstile verification failed" }),
    });
    await user.click(submitButton);
    expect(mockFetch).toHaveBeenCalledWith("/api/verify-turnstile", expect.objectContaining({
        method: "POST", body: JSON.stringify({ token: "mock-token-123" }),
    }));
    expect(await screen.findByText(/Mock Turnstile verification failed/i)).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
  });


  it("should call signIn with redirect: true on successful login", async () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole("button", { name: "Sign in" });
    await user.type(emailInput, "success@example.com");
    await user.type(passwordInput, "password123");
    mockOnVerify("mock-token-success");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }), });
    await user.click(submitButton);
    await waitFor(() => expect(screen.getByRole("button", { name: /Signing in.../i })).toBeDisabled());
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/verify-turnstile", expect.objectContaining({
         body: JSON.stringify({ token: "mock-token-success" })
      }));
    });
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("credentials", {
        callbackUrl: "/chat?login_success=true", email: "success@example.com", password: "password123", redirect: true,
      });
    });
  });

  it("should handle CredentialsSignin error from URL params on initial load", async () => {
    // @ts-ignore
     (useSearchParams as vi.Mock)
        .mockReturnValueOnce(new URLSearchParams("?error=CredentialsSignin"))
        .mockReturnValue(new URLSearchParams());
     render(<LoginForm />);
     expect(await screen.findByText(/Invalid email or password/i)).toBeInTheDocument();
     await waitFor(() => {
       expect(mockReplace).toHaveBeenCalledWith("/login", { scroll: false });
     });
  });

  it("should handle general signIn failure callback (if redirect:false or error before redirect)", async () => {
     render(<LoginForm />);
     const emailInput = screen.getByLabelText(/Email/i);
     const passwordInput = screen.getByPlaceholderText('••••••••');
     const submitButton = screen.getByRole("button", { name: "Sign in" });
     await user.type(emailInput, "fail@example.com");
     await user.type(passwordInput, "wrongpassword");
     mockOnVerify("mock-token-fail");
     await waitFor(() => expect(submitButton).not.toBeDisabled());
     mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
     mockSignIn.mockResolvedValueOnce({ ok: false, error: "SomeOtherError", url: null });
     await user.click(submitButton);
     await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
     await waitFor(() => {
        expect(screen.getByText(/An unexpected error occurred during sign in./i)).toBeInTheDocument();
     });
     expect(submitButton).toBeDisabled();
  });


  it("should save email to localStorage if 'Remember me' is checked on successful login", async () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const rememberMeCheckbox = screen.getByRole("checkbox", { name: /Remember me/i });
    const submitButton = screen.getByRole("button", { name: "Sign in" });
    await user.type(emailInput, "remember@example.com");
    await user.type(passwordInput, "password123");
    await user.click(rememberMeCheckbox);
    mockOnVerify("mock-token-remember");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    mockSignIn.mockImplementation(async () => { return { ok: true, error: null, url: "/chat" }; });
    await user.click(submitButton);
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalled();
      expect(setItemSpy).toHaveBeenCalledWith("rememberEmail", "remember@example.com");
    });
  });

   it("should load email from localStorage on initial render", () => {
       localStorageMock.setItem("rememberEmail", "loaded@example.com");
       render(<LoginForm />);
       expect(screen.getByLabelText(/Email/i)).toHaveValue("loaded@example.com");
       expect(screen.getByRole("checkbox", { name: /Remember me/i })).toBeChecked();
   });

});