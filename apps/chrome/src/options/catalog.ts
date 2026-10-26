/** Discovery lives on the website; local installation remains in Settings. */
export function mountCatalog() {
  const link = document.createElement("a");
  link.id = "catalog";
  link.className = "btn secondary";
  link.textContent = "Discover more skills ↗";
  link.href = "https://xgoose.org/skills/";
  link.target = "_blank";
  link.rel = "noopener";
  document.querySelector("#section-skills")!.append(link);
}
