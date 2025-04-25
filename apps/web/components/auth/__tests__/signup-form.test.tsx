import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignupForm } from "../signup-form";
import React from "react";
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
// @ts-ignore
global.ResizeObserver = MockResizeObserver;
// @ts-ignore
global.matchMedia = global.matchMedia || function() {
    return {
        matches : false,
        addListener : vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
};

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockSignIn = vi.fn();
let mockOnVerify: (token: string) => void = () => {};
const mockFetch = vi.fn();

vi.mock('next/font/google', () => ({
    Merriweather: () => ({ className: 'mock-merriweather-font' }),
}));

vi.mock("next/navigation", async (importOriginal) => {
    const actual = await importOriginal<typeof import('next/navigation')>();
    return {
        ...actual,
        useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh, }),
        useSearchParams: vi.fn(() => new URLSearchParams()),
    };
});

vi.mock("next-auth/react", () => ({
  signIn: (...args: any[]) => mockSignIn(...args),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("@/components/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/common")>();
  return {
    ...actual,
    TurnstileComponent: vi.fn(({ onVerify }) => {
      mockOnVerify = onVerify;
      return React.createElement('div', { 'data-testid': 'mock-turnstile' }, 'Mock Turnstile');
    }),
    Logo: () => React.createElement('div', { 'data-testid': 'mock-logo' }, 'Mock Logo'),
  };
});

const toastErrorSpy = vi.spyOn(toast, 'error');

global.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });


describe("SignupForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
    });
    mockSignIn.mockResolvedValue({ ok: true, error: null, url: "/chat" });
    // @ts-ignore
    (useSearchParams as vi.Mock)?.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render the signup form correctly", () => {
    render(<SignupForm />);
    expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Last Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Bhaskar")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Prajapati")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bhaskarprajapati@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("••••••••")).toHaveLength(2);
    expect(screen.getByTestId("mock-turnstile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.getByText("Create a new account")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Get Started/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Already have an account\? Login here./i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GitHub/i })).toBeInTheDocument();
    expect(screen.getByTestId("mock-logo")).toBeInTheDocument();
  });

  it("should update all input fields on user input", async () => {
    render(<SignupForm />);
    const firstNameInput = screen.getByLabelText(/First Name/i);
    const lastNameInput = screen.getByLabelText(/Last Name/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    const passwordInput = passwordInputs[0];
    const confirmPasswordInput = passwordInputs[1];

    await user.type(firstNameInput, "Test");
    await user.type(lastNameInput, "User");
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput!, "password123");
    await user.type(confirmPasswordInput!, "password123");

    expect(firstNameInput).toHaveValue("Test");
    expect(lastNameInput).toHaveValue("User");
    expect(emailInput).toHaveValue("test@example.com");
    expect(passwordInput).toHaveValue("password123");
    expect(confirmPasswordInput).toHaveValue("password123");
  });

  it("should toggle password visibility for both password fields", async () => {
    render(<SignupForm />);
    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    const passwordInput = passwordInputs[0];
    const confirmPasswordInput = passwordInputs[1];

    expect(passwordInput).toHaveAttribute("type", "password");
    let showPasswordButton1 = screen.getAllByRole("button", { name: /Show password/i })[0];
    await user.click(showPasswordButton1!);
    expect(passwordInput).toHaveAttribute("type", "text");
    let hidePasswordButton1 = screen.getByRole("button", { name: /Hide password/i });
    expect(hidePasswordButton1).toBeInTheDocument();
    await user.click(hidePasswordButton1);
    expect(passwordInput).toHaveAttribute("type", "password");
    showPasswordButton1 = screen.getAllByRole("button", { name: /Show password/i })[0];
    expect(showPasswordButton1).toBeInTheDocument();

    expect(confirmPasswordInput).toHaveAttribute("type", "password");
    let showPasswordButton2 = screen.getAllByRole("button", { name: /Show password/i })[1];
    await user.click(showPasswordButton2!);
    expect(confirmPasswordInput).toHaveAttribute("type", "text");
    let hidePasswordButton2 = screen.getByRole("button", { name: /Hide password/i });
    expect(hidePasswordButton2).toBeInTheDocument();
    await user.click(hidePasswordButton2);
    expect(confirmPasswordInput).toHaveAttribute("type", "password");
    showPasswordButton2 = screen.getAllByRole("button", { name: /Show password/i })[1];
    expect(showPasswordButton2).toBeInTheDocument();
  });


  it("should display validation errors using actual schema on submit attempt", async () => {
    render(<SignupForm />);
    const submitButton = screen.getByRole("button", { name: "Create Account" });
    mockOnVerify("mock-token");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Please enter your first name")).toBeInTheDocument();
      expect(screen.getByText("Please enter your last name")).toBeInTheDocument();
      expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();
      const passwordErrors = screen.getAllByText("Password must be at least 6 characters long");
      expect(passwordErrors.length).toBeGreaterThanOrEqual(1);
    });

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should display validation error for non-matching passwords", async () => {
    render(<SignupForm />);
    const firstNameInput = screen.getByLabelText(/First Name/i);
    const lastNameInput = screen.getByLabelText(/Last Name/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    const passwordInput = passwordInputs[0];
    const confirmPasswordInput = passwordInputs[1];
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    await user.type(firstNameInput, "Test");
    await user.type(lastNameInput, "User");
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput!, "password123");
    await user.type(confirmPasswordInput!, "password456");

    mockOnVerify("mock-token");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Passwords must match")).toBeInTheDocument();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("should show error message if Turnstile is not verified on submit", async () => {
    render(<SignupForm />);
    const firstNameInput = screen.getByLabelText(/First Name/i);
    const lastNameInput = screen.getByLabelText(/Last Name/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    const passwordInput = passwordInputs[0];
    const confirmPasswordInput = passwordInputs[1];
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    await user.type(firstNameInput, "Test");
    await user.type(lastNameInput, "User");
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput!, "password123");
    await user.type(confirmPasswordInput!, "password123");

    expect(submitButton).toBeDisabled();

    const form = submitButton.closest('form');
    expect(form).toBeInTheDocument();
    if(form) { fireEvent.submit(form); }

    await screen.findByText(/Please complete human verification/i);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("should handle Turnstile verification API failure", async () => {
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/First Name/i), "Test");
    await user.type(screen.getByLabelText(/Last Name/i), "User");
    await user.type(screen.getByLabelText(/Email/i), "test@example.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "password123");
    await user.type(screen.getAllByPlaceholderText("••••••••")[1]!, "password123");
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    mockOnVerify("mock-token-fail");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: "Mocked Turnstile Fail" }),
    });

    await user.click(submitButton);

    expect(mockFetch).toHaveBeenCalledWith("/api/verify-turnstile", expect.objectContaining({
        method: "POST", body: JSON.stringify({ token: "mock-token-fail" }),
    }));
    expect(await screen.findByText(/Mocked Turnstile Fail/i)).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
  });

  it("should handle registration API failure (e.g., email exists)", async () => {
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/First Name/i), "Test");
    await user.type(screen.getByLabelText(/Last Name/i), "User");
    await user.type(screen.getByLabelText(/Email/i), "exists@example.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "password123");
    await user.type(screen.getAllByPlaceholderText("••••••••")[1]!, "password123");
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    mockOnVerify("mock-token-reg-fail");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    mockFetch.mockResolvedValueOnce({
        ok: false, status: 409,
        json: async () => ({ error: "Email already registered" }),
    });

    await user.click(submitButton);

    await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/verify-turnstile", expect.any(Object));
        expect(mockFetch).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"email":"exists@example.com"')
        }));
    });

    expect(await screen.findByText(/Email already registered/i)).toBeInTheDocument();

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
  });

  it("should successfully register and attempt sign in", async () => {
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/First Name/i), "New");
    await user.type(screen.getByLabelText(/Last Name/i), "User");
    await user.type(screen.getByLabelText(/Email/i), "new@example.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "password123");
    await user.type(screen.getAllByPlaceholderText("••••••••")[1]!, "password123");
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    mockOnVerify("mock-token-success");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: "User registered" }) });
    mockSignIn.mockResolvedValueOnce({ ok: true, error: null, url: "/chat?login_success=true" });

    await user.click(submitButton);

    await waitFor(() => expect(screen.getByRole("button", { name: /Creating Account.../i })).toBeDisabled());

    await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/verify-turnstile", expect.objectContaining({ body: JSON.stringify({ token: "mock-token-success"}) }));
        expect(mockFetch).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ body: expect.stringContaining('"email":"new@example.com"')}));
    });

    await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("credentials", {
            email: "new@example.com",
            password: "password123",
            callbackUrl: "/chat?login_success=true",
        });
    });
  });

  it("should handle post-registration sign-in failure", async () => {
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/First Name/i), "SignIn");
    await user.type(screen.getByLabelText(/Last Name/i), "Fail");
    await user.type(screen.getByLabelText(/Email/i), "signin-fail@example.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "password123");
    await user.type(screen.getAllByPlaceholderText("••••••••")[1]!, "password123");
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    mockOnVerify("mock-token-signin-fail");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: "User registered" }) });
    mockSignIn.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin", url: null });

    await user.click(submitButton);

    await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockSignIn).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/Sign in failed after registration. Please try logging in manually./i)).toBeInTheDocument();

    expect(submitButton).toBeDisabled();
  });

  it("should handle general exception during submit", async () => {
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/First Name/i), "Error");
    await user.type(screen.getByLabelText(/Last Name/i), "Test");
    await user.type(screen.getByLabelText(/Email/i), "error@example.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "password123");
    await user.type(screen.getAllByPlaceholderText("••••••••")[1]!, "password123");
    const submitButton = screen.getByRole("button", { name: "Create Account" });

    mockOnVerify("mock-token-exception");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    mockFetch.mockRejectedValueOnce(new Error("Network Error"));

    await user.click(submitButton);

    expect(await screen.findByText(/Network Error/i)).toBeInTheDocument();

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
  });

});