import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Navigation } from "../Navbar";

vi.mock("@/components/common", () => ({
  Logo: () => <div data-testid="mock-logo">Logo</div>,
  ModeToggle: () => <div data-testid="mock-mode-toggle">ModeToggle</div>,
  SheetTheme: () => <div data-testid="mock-sheet-theme">SheetTheme</div>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@workspace/ui/components/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@workspace/ui/components/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-sheet">{children}</div>
  ),
  SheetTrigger: ({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) => {
     if (asChild && React.isValidElement(children)) {
        // @ts-ignore - Ignore potential type issue in mock refinement
         return React.cloneElement(children, { "data-testid": "mock-sheet-trigger" });
     }
     return <button data-testid="mock-sheet-trigger">{children}</button>;
  },
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-sheet-content">{children}</div>
  ),
   SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <div className="sr-only">{children}</div>
  ),
}));
vi.mock("lucide-react", () => ({
  PanelRight: (props: any) => <svg data-testid="mock-panel-right" {...props} />,
}));


describe("Navigation Component", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the logo", () => {
    render(<Navigation />);
    expect(screen.getByTestId("mock-logo")).toBeInTheDocument();
  });

  it("renders desktop navigation items correctly", () => {
    render(<Navigation />);
    const desktopNav = screen.getByRole('navigation', { name: "Main navigation" });
    expect(desktopNav).toBeInTheDocument();

    expect(within(desktopNav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(within(desktopNav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "/features");
    expect(within(desktopNav).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(within(desktopNav).getByRole("link", { name: "FAQs" })).toHaveAttribute("href", "/faqs");
    expect(within(desktopNav).getByRole("link", { name: "Detect AI" })).toHaveAttribute("href", "/chat");
    expect(within(desktopNav).getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(within(desktopNav).getByTestId("mock-mode-toggle")).toBeInTheDocument();

  });

   it("renders mobile navigation trigger and sheet content", () => {
    render(<Navigation />);
    expect(screen.getByTestId("mock-sheet-trigger")).toBeInTheDocument();

    const sheetContent = screen.getByTestId("mock-sheet-content");
    expect(sheetContent).toBeInTheDocument();
    const mobileNav = within(sheetContent).getByRole('navigation', { name: "Mobile navigation" });
    expect(mobileNav).toBeInTheDocument();

    expect(within(mobileNav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(within(mobileNav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "/features"); 
    expect(within(mobileNav).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(within(mobileNav).getByRole("link", { name: "FAQs" })).toHaveAttribute("href", "/faqs");
    expect(within(mobileNav).getByRole("link", { name: "Detect AI" })).toHaveAttribute("href", "/chat");
    expect(within(mobileNav).getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(within(mobileNav).getByTestId("mock-sheet-theme")).toBeInTheDocument();
   });

});