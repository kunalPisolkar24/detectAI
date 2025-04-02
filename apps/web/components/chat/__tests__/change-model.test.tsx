import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ChangeModel from "../change-model";

const setTabMock = vi.fn();
vi.mock("@/contexts/tabContext", () => ({
  useTab: () => ({ tab: "sequential", setTab: setTabMock })
}));

describe("ChangeModel", () => {
  beforeEach(() => {
    setTabMock.mockClear();
  });

  it("renders with 'Sequential' as default", async () => {
    render(<ChangeModel />);
    expect(screen.getByRole("button")).toHaveTextContent("Sequential");
  });

  it("calls setTab with 'bert' on selecting BERT", async () => {
    render(<ChangeModel />);
    await userEvent.click(screen.getByRole("button"));
    const bertOption = await screen.findByText("BERT");
    await userEvent.click(bertOption);
    expect(setTabMock).toHaveBeenCalledWith("bert");
  });
});
