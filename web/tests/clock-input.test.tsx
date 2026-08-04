import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClockInput } from "../src/components/ClockInput";

describe("ClockInput", () => {
  it.each([
    ["1", "01:00"],
    ["10", "10:00"],
    ["2310", "23:10"],
    ["020", "00:20"],
    ["750", "07:50"],
  ])("normalizes %s on blur and commits it after acknowledgement", async (raw, normalized) => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="18:30" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    expect(input).toHaveValue("18:30");
    fireEvent.change(input, { target: { value: raw } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(normalized);
    expect(input).not.toHaveClass("clock-input--saved");
    await waitFor(() => expect(input).toHaveClass("clock-input--saved"));
  });

  it("keeps the draft after invalid text", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.change(input, { target: { value: "8 PM" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("8 PM");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits an empty value for Delete followed by blur", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("deletes the whole value when Delete is pressed immediately after focus", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("selects the existing time on focus so Delete then Enter clears it", () => {
    const onCommit = vi.fn();
    render(<ClockInput aria-label="Čas" value="23:11" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("");
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("does not show saved before a rejected async commit", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("Konflikt"));
    render(<ClockInput aria-label="Čas" value="08:00" onCommit={onCommit} />);
    const input = screen.getByLabelText("Čas");
    fireEvent.change(input, { target: { value: "09:00" } });
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).not.toHaveClass("clock-input--saved");
    expect(input).toHaveValue("09:00");
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
