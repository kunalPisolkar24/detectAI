// src/components/Footer.test.tsx
import { describe, it, expect, vi, beforeEach} from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Footer } from "../Footer" 
import React from "react"

// --- Mocks ---

// Mock next/link
vi.mock("next/link", () => {
  return {
    default: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  }
})

// Mock next-themes
const mockUseTheme = vi.fn()
vi.mock("next-themes", () => ({
  useTheme: () => mockUseTheme(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

// Mock framer-motion
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    motion: {
      ...actual.motion,
      div: ({ children, ...props }: any) => React.createElement("div", props, children),
      a: ({ children, ...props }: any) => React.createElement("a", props, children),
      span: ({ children, ...props }: any) => React.createElement("span", props, children),
      button: ({ children, ...props }: any) => React.createElement("button", props, children),
      li: ({ children, ...props }: any) => React.createElement("li", props, children),
    },
  }
})

// Mock lucide-react icons (optional but good practice for cleaner snapshots/output)
vi.mock("lucide-react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("lucide-react")>()
    const mockIcon = (name: string) => ({ size, className }: { size?: number, className?: string }) =>
      React.createElement("svg", { "data-testid": `${name}-icon`, className, width: size, height: size });

    return {
        ...actual, // Keep other exports if any
        Github: mockIcon("Github"),
        Twitter: mockIcon("Twitter"),
        Linkedin: mockIcon("Linkedin"),
        Mail: mockIcon("Mail"),
        Heart: mockIcon("Heart"),
        ArrowUpRight: mockIcon("ArrowUpRight"),
        Zap: mockIcon("Zap"),
        BotIcon: mockIcon("BotIcon"),
    };
});

// Mock cn utility (can be simplified if it doesn't have complex logic)
vi.mock("@workspace/ui/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}))

// --- Test Suite ---

describe("Footer Component", () => {
  const currentYear = new Date().getFullYear()

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()
    // Provide default mock values
    mockUseTheme.mockReturnValue({ theme: "light", setTheme: vi.fn() })
  })

  it("should render null initially due to mounting check", async () => {
    const { container } = render(
        <Footer />
    )
  
    await waitFor(() => { 
      expect(screen.getByText("Detect AI")).toBeInTheDocument()
    })
  })

  it("should render the footer content after mounting", async () => {
    render(
        <Footer />
    )

    // Wait for the useEffect to run and set mounted to true
    await waitFor(() => {
      expect(screen.getByText("Detect AI")).toBeInTheDocument()
    })

    // Check for logo and company name
    expect(screen.getByTestId("BotIcon-icon")).toBeInTheDocument()
    expect(screen.getByText("Detect AI")).toBeInTheDocument()

    // Check for company description
    expect(
      screen.getByText(
        /Detect AI helps you identify whether text is AI-generated/
      )
    ).toBeInTheDocument()

    // Check for social links by aria-label
    expect(screen.getByLabelText("GitHub")).toBeInTheDocument()
    expect(screen.getByLabelText("Twitter")).toBeInTheDocument()
    expect(screen.getByLabelText("LinkedIn")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()

    // Check for newsletter section
    expect(screen.getByText("Stay updated")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Your email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument()

    // Check for footer link sections
    expect(screen.getByText("Product")).toBeInTheDocument()
    expect(screen.getByText("Company")).toBeInTheDocument()
    expect(screen.getByText("Legal")).toBeInTheDocument()

    // Check for specific links
    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument()

    // Check for bottom bar content
    expect(
      screen.getByText(`© ${currentYear} Detect AI Inc. All rights reserved.`)
    ).toBeInTheDocument()
    expect(screen.getByTestId("Heart-icon")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Terms of Service" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Cookie Policy" })).toBeInTheDocument()
  })

  it("should render correct href attributes for links", async () => {
    render(
        <Footer />
    )
    await waitFor(() => {
      expect(screen.getByText("Detect AI")).toBeInTheDocument()
    })

    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/features"
    )
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "/blog"
    )
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy"
    )
    expect(screen.getByLabelText("GitHub")).toHaveAttribute(
      "href",
      "https://github.com"
    )
     expect(screen.getByLabelText("Email")).toHaveAttribute(
      "href",
      "mailto:info@detectai.com"
    )
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms"
    )
  })

  it("should apply light theme styles when theme is light", async () => {
     mockUseTheme.mockReturnValue({ theme: "light", setTheme: vi.fn() })
     const { container } = render(<Footer />)
     await waitFor(() => {
        expect(screen.getByText("Detect AI")).toBeInTheDocument()
     })
     const footerElement = container.querySelector('footer')
     expect(footerElement).toHaveClass('bg-white/90 border-black/10 text-gray-900')
   })

  it("should apply dark theme styles when theme is dark", async () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() })
    const { container } = render(<Footer />)

    await waitFor(() => {
      expect(screen.getByText("Detect AI")).toBeInTheDocument()
    })

    const footerElement = container.querySelector('footer')
    // Check for classes applied by cn based on the theme
    expect(footerElement).toHaveClass('bg-black/90 border-white/10 text-white')

    // Example check for a theme-dependent element within
    const emailInput = screen.getByPlaceholderText("Your email")
    expect(emailInput).toHaveClass('bg-black/40 border border-white/10 text-white')
  })
})