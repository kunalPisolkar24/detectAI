import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTheme } from "next-themes";
import { SheetTheme } from "../SheetTheme"; // Adjust path if needed

vi.mock("next-themes", () => ({
  useTheme: vi.fn(),
}));

const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;
let mockSetTheme: ReturnType<typeof vi.fn>;

describe("SheetTheme Component", () => {
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
    render(<SheetTheme />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const button = screen.getByText("Dark Mode");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("P");

    fireEvent.click(button);
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("renders 'Light Mode' and calls setTheme('light') onClick when theme is dark after mounting", () => {
    mockUseTheme.mockReturnValue({
      resolvedTheme: "dark",
      setTheme: mockSetTheme,
    });
    render(<SheetTheme />);
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const button = screen.getByText("Light Mode");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("P");

    fireEvent.click(button);
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("applies expected base classes after mounting", () => {
    mockUseTheme.mockReturnValue({
      resolvedTheme: "light",
      setTheme: mockSetTheme,
    });
    render(<SheetTheme />);

     act(() => {
        vi.runOnlyPendingTimers();
    });

    const element = screen.getByText("Dark Mode");
    expect(element).toHaveClass("text-sm font-medium text-foreground bg-muted cursor-pointer border p-2 rounded-xl");
   });
});