export async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Twitch iframe policies can reject Clipboard API writes. Fall back to
      // the legacy copy command while this click still has user activation.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);

  try {
    input.select();
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard write failed.");
    }
  } finally {
    input.remove();
  }
}
