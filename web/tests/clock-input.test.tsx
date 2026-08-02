import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClockInput } from "../src/components/ClockInput";

describe("ClockInput", () => {
  it("commits only a backend-compatible 24-hour value", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="18:30" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    expect(input).toHaveValue("18:30");
    fireEvent.change(input, { target: { value: "19:05" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("19:05");
  });

  it("restores the backend value after invalid text", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.change(input, { target: { value: "8 PM" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("08:00");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels a changed value with Escape without committing it", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.change(input, { target: { value: "09:00" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("08:00");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
