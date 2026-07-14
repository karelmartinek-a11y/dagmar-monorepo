import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal, StatusMessage } from "../src/components/Primitives";

describe("state primitives", () => {
  it("announces errors", () => { render(<StatusMessage kind="error" title="Chyba">Detail</StatusMessage>); expect(screen.getByRole("alert")).toHaveTextContent("Chyba"); });
  it("keeps destructive confirmation cancellable", async () => { const close=vi.fn(); render(<Modal title="Smazat?" description="Důsledek" confirmLabel="Smazat" danger onClose={close} onConfirm={vi.fn()}/>); await userEvent.click(screen.getByRole("button",{name:"Zrušit"})); expect(close).toHaveBeenCalledOnce(); });
  it("traps keyboard focus and closes on Escape", async () => { const user=userEvent.setup();const close=vi.fn();render(<Modal title="Potvrdit?" description="Důsledek" confirmLabel="Potvrdit" onClose={close} onConfirm={vi.fn()}/>);const cancel=screen.getByRole("button",{name:"Zrušit"});const confirm=screen.getByRole("button",{name:"Potvrdit"});expect(cancel).toHaveFocus();await user.tab({shift:true});expect(confirm).toHaveFocus();await user.keyboard("{Escape}");expect(close).toHaveBeenCalledOnce(); });
});
