import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TurnstileComponent } from "../turnstile";

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (props: any) => (
    <div>
      <button onClick={() => props.onSuccess("token123")}>Success</button>
      <button onClick={() => props.onError("error occurred")}>Error</button>
      <button onClick={() => props.onExpire && props.onExpire()}>Expire</button>
    </div>
  )
}));

describe("TurnstileComponent", () => {
  it("calls onVerify on success", () => {
    const onVerify = vi.fn();
    const { getByText } = render(
      <TurnstileComponent siteKey="key" onVerify={onVerify} />
    );
    fireEvent.click(getByText("Success"));
    expect(onVerify).toHaveBeenCalledWith("token123");
  });

  it("calls onError on error", () => {
    const onError = vi.fn();
    const { getByText } = render(
      <TurnstileComponent siteKey="key" onVerify={() => {}} onError={onError} />
    );
    fireEvent.click(getByText("Error"));
    expect(onError).toHaveBeenCalledWith("error occurred");
  });

  it("calls onExpire when expired", () => {
    const onExpire = vi.fn();
    const { getByText } = render(
      <TurnstileComponent siteKey="key" onVerify={() => {}} onExpire={onExpire} />
    );
    fireEvent.click(getByText("Expire"));
    expect(onExpire).toHaveBeenCalled();
  });
});
