import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Logo } from "../Logo";

vi.mock("lucide-react", () => ({
  BotIcon: ({ className, strokeWidth, ...rest }: React.SVGProps<SVGSVGElement> & { strokeWidth?: number | string }) => (
    <svg
      data-testid="mock-bot-icon"
      className={className}
      stroke-width={strokeWidth ? String(strokeWidth) : undefined}
      {...rest}
    />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("Logo Component", () => {
  it("renders a link pointing to the root '/'", () => {
    render(<Logo />);
    const linkElement = screen.getByRole("link");
    expect(linkElement).toBeInTheDocument();
    expect(linkElement).toHaveAttribute("href", "/");
  });

  it("renders the BotIcon with correct attributes", () => {
    render(<Logo />);
    const iconElement = screen.getByTestId("mock-bot-icon");
    expect(iconElement).toBeInTheDocument();
    expect(iconElement).toHaveClass("size-8");
    expect(iconElement).toHaveAttribute("stroke-width", "1.5");
  });

  it("renders the text 'Detect AI'", () => {
    render(<Logo />);
    const textElement = screen.getByText("Detect AI");
    expect(textElement).toBeInTheDocument();
    expect(textElement.tagName).toBe("SPAN");
  });

  it("applies correct classes to the link and text", () => {
     render(<Logo />);
     const linkElement = screen.getByRole("link");
     const textElement = screen.getByText("Detect AI");

     expect(linkElement).toHaveClass("flex items-center gap-2");
     expect(textElement).toHaveClass("text-[15px]");
     expect(textElement).toHaveClass("mt-[5px]");
     expect(textElement).toHaveClass("font-semibold");
     expect(textElement).toHaveClass("hidden");
     expect(textElement).toHaveClass("md:block");
  });
});