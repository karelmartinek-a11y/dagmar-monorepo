const button = document.getElementById("connect");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const ticket = new URL(location.href).searchParams.get("ticket");
    const response = await fetch("/sections/dochazka/oauth/consent", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ticket}),
    });
    if (!response.ok) throw new Error("Připojení vypršelo nebo se ho nepodařilo povolit.");
    const callback = new URL((await response.json()).redirect);
    if (callback.origin !== "https://chatgpt.com") throw new Error("Návratová adresa není platná.");
    const link = document.createElement("a");
    link.href = callback.href;
    link.textContent = "Dokončit připojení v ChatGPT";
    status.replaceChildren(link);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
