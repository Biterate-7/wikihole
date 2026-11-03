"use client";

/** "Printable version": the print stylesheet drops the sidebars and header. */
export function PrintLink() {
  return (
    <a
      href="#print"
      onClick={(event) => {
        event.preventDefault();
        window.print();
      }}
    >
      Printable version
    </a>
  );
}
