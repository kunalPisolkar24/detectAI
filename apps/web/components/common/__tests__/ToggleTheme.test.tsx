import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTheme } from "next-themes";
import { ModeToggle } from "../ToggleTheme";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  Sun: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="mock-sun-icon" {...props} />
  ),
  Moon: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="mock-moon-icon" {...props} />
  ),
}));

vi.mock("@workspace/ui/components/button", () => ({
  Button: ({ children, onClick, variant, size, ...props }: React.ComponentProps<"button"> & { variant?: string, size?: string }) => (
    <button onClick={onClick} data-variant={variant} data-size={size} {...props}>
      {children}
    </button>
  ),
}));


const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;
let mockSetTheme: ReturnType<typeof vi.fn>;

describe("ModeToggle Component", () => {
  beforeEach(() => {
    mockSetTheme = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });


  it("renders Sun icon and correct classes when theme is light after mounting", () => {
    mockUseTheme.mockReturnValue({ theme: "light", setTheme: mockSetTheme });
    render(<ModeToggle />);
    act(() => { vi.runOnlyPendingTimers(); });

    const button = screen.getByRole("button", { name: "Toggle theme" });
    const sunIcon = screen.getByTestId("mock-sun-icon");
    const moonIcon = screen.getByTestId("mock-moon-icon");

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveAttribute("data-size", "icon");

    expect(sunIcon).toBeInTheDocument();
    expect(moonIcon).toBeInTheDocument();

    expect(sunIcon).toHaveClass("block");
    expect(moonIcon).toHaveClass("hidden");

    // Check specific transition/rotation classes based on the component's CSS
    expect(sunIcon).toHaveClass("rotate-0 scale-100");
    expect(moonIcon).toHaveClass("rotate-90 scale-0"); // Initial state for Moon
  });

  it("renders Moon icon and correct classes when theme is dark after mounting", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: mockSetTheme });
    render(<ModeToggle />);
     act(() => { vi.runOnlyPendingTimers(); });

    const sunIcon = screen.getByTestId("mock-sun-icon");
    const moonIcon = screen.getByTestId("mock-moon-icon");

    expect(sunIcon).toBeInTheDocument();
    expect(moonIcon).toBeInTheDocument();

    expect(sunIcon).toHaveClass("hidden");
    expect(moonIcon).toHaveClass("block");

    expect(sunIcon).toHaveClass("dark:-rotate-90 dark:scale-0");
    expect(moonIcon).toHaveClass("dark:rotate-0 dark:scale-100");
  });


  it("calls setTheme with 'light' when clicked in dark mode", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: mockSetTheme });
    render(<ModeToggle />);
     act(() => { vi.runOnlyPendingTimers(); });

    const button = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(button);

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("calls setTheme with 'dark' when clicked in light mode", () => {
    mockUseTheme.mockReturnValue({ theme: "light", setTheme: mockSetTheme });
    render(<ModeToggle />);
    act(() => { vi.runOnlyPendingTimers(); });

    const button = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(button);

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("renders screen reader text", () => {
     mockUseTheme.mockReturnValue({ theme: "light", setTheme: mockSetTheme });
     render(<ModeToggle />);
     act(() => { vi.runOnlyPendingTimers(); });
     expect(screen.getByText("Toggle theme")).toBeInTheDocument();
     expect(screen.getByText("Toggle theme")).toHaveClass("sr-only");
  });
});