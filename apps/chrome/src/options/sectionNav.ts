/** Marks the section-list entry for the section currently being read. */
export function mountSectionNav(): void {
  const links = new Map(
    Array.from(document.querySelectorAll<HTMLAnchorElement>('.settings-nav a[href^="#"]'), (link) => [link.hash.slice(1), link]),
  );
  const inView = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id);
        else inView.delete(entry.target.id);
      }
      const current = [...links.keys()].find((id) => inView.has(id));
      for (const [id, link] of links) link.classList.toggle("active", id === current);
    },
    // A band in the upper part of the viewport decides which section is "current".
    { rootMargin: "-15% 0px -65% 0px" },
  );
  for (const id of links.keys()) observer.observe(document.getElementById(id)!);
}
