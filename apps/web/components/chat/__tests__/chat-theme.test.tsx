import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTheme } from "next-themes";
import { ChatTheme } from "../chat-theme";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(),
}));

vi.mock("@workspace/ui/components/dropdown-menu", () => ({
  DropdownMenuItem: ({ children, onClick, className }: React.ComponentProps<"div">) => (
    <div onClick={onClick} className={className} data-testid="mock-dropdown-item">
      {children}
    </div>
  ),
}));

const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;
let mockSetTheme: ReturnType<typeof vi.fn>;

describe("ChatTheme Component", () => {
  beforeEach(() => {
    mockSetTheme = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });


  it("renders 'Dark Mode' and calls setTheme('dark') onClick when theme is light after mounting", () => {
    mockUseTheme.mockReturnValue({
      resolvedTheme: "light",
      setTheme: mockSetTheme,
    });
    render(<ChatTheme />);
    act(() => { vi.runOnlyPendingTimers(); });

    const menuItem = screen.getByTestId("mock-dropdown-item");
    expect(menuItem).toBeInTheDocument();
    expect(menuItem).toHaveTextContent("Dark Mode");
    expect(menuItem).toHaveClass("rounded-sm cursor-pointer");

    fireEvent.click(menuItem);
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("renders 'Light Mode' and calls setTheme('light') onClick when theme is dark after mounting", () => {
    mockUseTheme.mockReturnValue({
      resolvedTheme: "dark",
      setTheme: mockSetTheme,
    });
    render(<ChatTheme />);
    act(() => { vi.runOnlyPendingTimers(); });

    const menuItem = screen.getByTestId("mock-dropdown-item");
    expect(menuItem).toBeInTheDocument();
    expect(menuItem).toHaveTextContent("Light Mode");
    expect(menuItem).toHaveClass("rounded-sm cursor-pointer");

    fireEvent.click(menuItem);
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });
});