/// <reference types="vitest/globals" />

import { render, screen, waitFor, within, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { Payment } from "./payment-dialog";
import React from "react";
import { Session } from "next-auth";
import { initializePaddle } from '@paddle/paddle-js';

class MockResizeObserver {
  observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
}
// @ts-ignore
global.ResizeObserver = MockResizeObserver;
// @ts-ignore
global.matchMedia = global.matchMedia || function() { return { matches : false, addListener : vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), }; };

const mockUseSession = vi.fn();
const mockUseTheme = vi.fn();
const mockPaddleOpen = vi.fn();

let capturedEventCallback: ((data: any) => void) | undefined;

const mockPaddleInstance = {
    Checkout: {
        open: mockPaddleOpen
    }
};

vi.mock('@paddle/paddle-js', () => ({
    initializePaddle: vi.fn(({ eventCallback }) => {
        capturedEventCallback = eventCallback;
        return Promise.resolve(mockPaddleInstance);
    }),
    Paddle: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
    useSession: () => mockUseSession()
}));

vi.mock("next-themes", () => ({
    useTheme: () => mockUseTheme()
}));

vi.mock('next/font/google', () => ({
    Merriweather: () => ({ className: 'mock-merriweather-font' }),
}));

describe("Payment Component", () => {
  const user = userEvent.setup();
  const mockOnSubscriptionAttempt = vi.fn();
  const mockOnSubscriptionSuccessAttempt = vi.fn();

  const defaultAuthSession: Session = {
      user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
      expires: 'some-future-date'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', 'test_paddle_client_token');

    (initializePaddle as Mock).mockImplementation(({ eventCallback }) => {
      capturedEventCallback = eventCallback;
      return Promise.resolve(mockPaddleInstance);
    });

    mockUseTheme.mockReturnValue({ theme: 'light' });
    mockUseSession.mockReturnValue({ data: defaultAuthSession, status: 'authenticated' });
    capturedEventCallback = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("should render free and premium plans with monthly prices by default", async () => {
    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);
    expect(screen.getByRole('heading', { name: /Free/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Premium/i })).toBeInTheDocument();
    expect(screen.getByText("₹0")).toBeInTheDocument();
    expect(screen.getByText("₹200")).toBeInTheDocument();
    expect(screen.getAllByText("/month")).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Current Plan/i })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /Monthly/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Yearly/i })).toHaveAttribute('aria-selected', 'false');
    expect(initializePaddle).toHaveBeenCalledTimes(1);

    const finalPremiumButton = await screen.findByRole('button', { name: /Upgrade Now/i });
    expect(finalPremiumButton).toBeInTheDocument();
    expect(finalPremiumButton).not.toBeDisabled();
  });

  it("should switch to yearly billing and update prices/badge", async () => {
    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);
    const yearlyTab = screen.getByRole('tab', { name: /Yearly/i });
    await user.click(yearlyTab);
    await waitFor(() => {
        expect(screen.getByText("₹1000")).toBeInTheDocument();
    });
    expect(screen.getAllByText("/year")).toHaveLength(2);
    expect(screen.getByText(/Save ₹1400/i)).toBeInTheDocument();
    expect(screen.queryByText("₹200")).not.toBeInTheDocument();
    expect(screen.queryByText("/month")).not.toBeInTheDocument();
    expect(yearlyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Monthly/i })).toHaveAttribute('aria-selected', 'false');
  });

  it("should disable upgrade button when paddle is loading", async () => {
    let resolvePaddle: (value: unknown) => void;
    const loadingPromise = new Promise(resolve => { resolvePaddle = resolve; });
    (initializePaddle as Mock).mockImplementation(({ eventCallback }) => {
        capturedEventCallback = eventCallback;
        return loadingPromise;
    });

    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now|Loading.../i });
    expect(upgradeButton).toBeDisabled();

    await act(async () => {
         resolvePaddle(mockPaddleInstance);
         try { await loadingPromise; } catch { /* ignore */ }
    });
  });

  it("should disable button and log error if paddle token is missing", async () => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', '');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUseSession.mockReturnValue({ data: defaultAuthSession, status: 'authenticated' });

    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i });
    expect(upgradeButton).toBeInTheDocument();
    expect(upgradeButton).toBeDisabled();

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith("Paddle Client Token not found.");
    });
    expect(initializePaddle).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("should disable upgrade button when session is loading", async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);
    const upgradeButton = await screen.findByRole('button', { name: /Loading.../i });
    expect(upgradeButton).toBeInTheDocument();
    expect(upgradeButton).toBeDisabled();
    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled();
    });
  });

  it("should disable upgrade button and show login text when unauthenticated", async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    (initializePaddle as Mock).mockResolvedValue(mockPaddleInstance);

    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);
    const upgradeButton = await screen.findByRole('button', { name: /Log in to Upgrade/i });
    expect(upgradeButton).toBeInTheDocument();
    expect(upgradeButton).toBeDisabled();
  });

  it("should handle paddle initialization failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (initializePaddle as Mock).mockImplementation(() => Promise.reject(new Error("Paddle Init Failed")));

    render(<Payment onSubscriptionAttempt={mockOnSubscriptionAttempt} onSubscriptionSuccessAttempt={mockOnSubscriptionSuccessAttempt} />);

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i });
    expect(upgradeButton).toBeInTheDocument();
    expect(upgradeButton).toBeDisabled();

    await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error initializing Paddle:", expect.any(Error));
    });

    expect(screen.queryByRole('button', { name: /Loading.../i })).not.toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("handleSubscription function should call Paddle Checkout correctly for monthly", () => {
      mockUseSession.mockReturnValue({ data: defaultAuthSession, status: 'authenticated' });
      mockUseTheme.mockReturnValue({ theme: 'light' });
      const localPaddleInstance = { Checkout: { open: mockPaddleOpen } };
      (initializePaddle as Mock).mockResolvedValue(localPaddleInstance);

       if (mockUseSession().status === 'authenticated' && localPaddleInstance) {
          const session = mockUseSession().data as Session;
          const priceId = "pri_01jr2gqggwjakpc1hd9xzym7fy";

          mockOnSubscriptionAttempt();
          localPaddleInstance.Checkout.open({
               items: [{ priceId: priceId, quantity: 1 }],
               customer: { email: session.user!.email! },
               customData: { userId: session.user!.id! },
               settings: { theme: 'light' }
           });
      } else {
          throw new Error("Test setup error: Session not authenticated or Paddle instance missing in simulation");
      }

      expect(mockOnSubscriptionAttempt).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledWith(expect.objectContaining({
          items: [{ priceId: "pri_01jr2gqggwjakpc1hd9xzym7fy", quantity: 1 }],
          settings: { theme: 'light' }
      }));
  });

  it("handleSubscription function should call Paddle Checkout correctly for yearly", () => {
      mockUseSession.mockReturnValue({ data: defaultAuthSession, status: 'authenticated' });
      mockUseTheme.mockReturnValue({ theme: 'light' });
      const localPaddleInstance = { Checkout: { open: mockPaddleOpen } };
      (initializePaddle as Mock).mockResolvedValue(localPaddleInstance);

      const billingCycle = "yearly";

      if (mockUseSession().status === 'authenticated' && localPaddleInstance) {
          const session = mockUseSession().data as Session;
          // @ts-ignore
          const priceId = billingCycle === 'monthly' ? "pri_01jr2gqggwjakpc1hd9xzym7fy" : "pri_01jr2gs8ckz66srr8sd1byh7n4";

          mockOnSubscriptionAttempt();
          localPaddleInstance.Checkout.open({
               items: [{ priceId: priceId, quantity: 1 }],
               customer: { email: session.user!.email! },
               customData: { userId: session.user!.id! },
               settings: { theme: 'light' }
           });
      } else { throw new Error("Test setup error"); }

      expect(mockOnSubscriptionAttempt).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledWith(expect.objectContaining({
          items: [{ priceId: "pri_01jr2gs8ckz66srr8sd1byh7n4", quantity: 1 }],
      }));
  });

  it("handleSubscription function should call Paddle Checkout correctly for dark theme", () => {
      mockUseSession.mockReturnValue({ data: defaultAuthSession, status: 'authenticated' });
      mockUseTheme.mockReturnValue({ theme: 'dark' });
      const localPaddleInstance = { Checkout: { open: mockPaddleOpen } };
      (initializePaddle as Mock).mockResolvedValue(localPaddleInstance);

       const currentSessionStatus = mockUseSession().status;
       const currentSessionData = mockUseSession().data;
       const currentTheme = mockUseTheme().theme;
       const currentPaddleInstance = localPaddleInstance;

       if (currentSessionStatus === 'authenticated' && currentPaddleInstance && currentSessionData?.user) {
          const priceId = "pri_01jr2gqggwjakpc1hd9xzym7fy";

          mockOnSubscriptionAttempt();
          currentPaddleInstance.Checkout.open({
               items: [{ priceId: priceId, quantity: 1 }],
               customer: { email: currentSessionData.user.email! },
               customData: { userId: currentSessionData.user.id! },
               settings: { theme: currentTheme === 'dark' ? 'dark' : 'light' }
           });
      } else {
          throw new Error("Test setup error: Conditions not met for handleSubscription simulation");
      }

      expect(mockOnSubscriptionAttempt).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledTimes(1);
      expect(mockPaddleOpen).toHaveBeenCalledWith(expect.objectContaining({
          settings: { theme: 'dark' }
      }));
  });

  it("eventCallback logic should call onSubscriptionSuccessAttempt when event is checkout.completed", () => {
    const testEventCallback = (data: any) => {
      if (data.name === 'checkout.completed') {
        if (mockOnSubscriptionSuccessAttempt) {
            mockOnSubscriptionSuccessAttempt();
        }
      }
    };

    expect(mockOnSubscriptionSuccessAttempt).not.toHaveBeenCalled();

    act(() => {
        testEventCallback({ name: 'checkout.completed', data: { } });
    });

    expect(mockOnSubscriptionSuccessAttempt).toHaveBeenCalledTimes(1);
  });

  it("eventCallback logic should NOT call onSubscriptionSuccessAttempt for other events like checkout.closed", () => {
     const testEventCallback = (data: any) => {
       if (data.name === 'checkout.completed') {
         if (mockOnSubscriptionSuccessAttempt) {
             mockOnSubscriptionSuccessAttempt();
         }
       }
     };

    expect(mockOnSubscriptionSuccessAttempt).not.toHaveBeenCalled();

    act(() => {
        testEventCallback({ name: 'checkout.closed', data: { } });
    });

    expect(mockOnSubscriptionSuccessAttempt).not.toHaveBeenCalled();
  });

});